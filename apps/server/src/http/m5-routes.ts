import {
  attachShowToEvent,
  claimPairing,
  createEvent,
  createScopedBoardShare,
  createShowInEvent,
  duplicateShow,
  executeDeviceCommand,
  executeEventCommand,
  getDeviceDisplay,
  getEventState,
  listBoardShares,
  listDevices,
  previewScopedBoard,
  revokeBoardShare,
  startPairing,
  type Actor,
  type AppError,
  type OwnerScope,
} from '@klockr/application';
import {
  attachShowRequestSchema,
  boardShareCreateRequestSchema,
  createEventRequestSchema,
  createEventShowRequestSchema,
  deviceCommandSchema,
  duplicateShowRequestSchema,
  eventCommandSchema,
  idSchema,
  pairingClaimRequestSchema,
  type CreatedShowResponse,
} from '@klockr/contracts';
import { EventId, ShowId } from '@klockr/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  deviceFromRequest,
  eventCookieName,
  eventOwnerFromRequest,
  managementFromRequest,
  ownerCookieName,
  ownerFromRequest,
} from './auth';
import { errorBody, httpStatusOf, unauthenticated } from './errors';
import { badRequest, setOwnerCookie, type ApiOptions } from './routes';

const eventParams = z.object({ eventId: idSchema });
const showParams = z.object({ showId: idSchema });

const fail = (reply: FastifyReply, error: AppError) =>
  reply.code(httpStatusOf(error)).send(errorBody(error));

/**
 * M5 HTTP API: Events/Rooms/placement, Show duplication, Devices (pairing, management, display)
 * and Board share management. Thin handlers: authenticate, validate with shared contracts, call
 * application use cases.
 */
export function registerM5Routes(app: FastifyInstance, options: ApiOptions): void {
  const { services } = options;

  /** Management principal of a scope: the Event cookie, or the Show's (or its Event's) cookie. */
  async function scopePrincipal(
    request: FastifyRequest,
    kind: 'show' | 'event',
    id: string,
  ): Promise<{ scope: OwnerScope; actor: { actor: Actor } } | null> {
    const principal =
      kind === 'show'
        ? await managementFromRequest(request, id, services)
        : await eventOwnerFromRequest(request, id, services);
    if (!principal) return null;
    return {
      scope:
        kind === 'show'
          ? { showId: ShowId(id), eventId: null }
          : { showId: null, eventId: EventId(id) },
      actor: { actor: principal.actor },
    };
  }

  // --- Events ---------------------------------------------------------------------------------

  app.post(
    '/api/v1/events',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = createEventRequestSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const created = await createEvent(body.data, services);
      if (!created.ok) return fail(reply, created.error);
      setOwnerCookie(
        reply,
        eventCookieName(created.value.eventId),
        created.value.ownerToken,
        options,
      );
      return reply.code(201).send({ eventId: created.value.eventId });
    },
  );

  app.get('/api/v1/events/:eventId/state', async (request, reply) => {
    const params = eventParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await eventOwnerFromRequest(request, params.data.eventId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const state = await getEventState(params.data.eventId, { actor: owner.actor }, services);
    return state.ok ? state.value : fail(reply, state.error);
  });

  app.post('/api/v1/events/:eventId/commands', async (request, reply) => {
    const params = eventParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await eventOwnerFromRequest(request, params.data.eventId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const command = eventCommandSchema.safeParse(request.body);
    if (!command.success) return badRequest(reply, command.error);
    const result = await executeEventCommand(
      params.data.eventId,
      command.data,
      { actor: owner.actor },
      services,
    );
    return result.ok ? result.value : fail(reply, result.error);
  });

  app.post('/api/v1/events/:eventId/shows', async (request, reply) => {
    const params = eventParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await eventOwnerFromRequest(request, params.data.eventId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const body = createEventShowRequestSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    const created = await createShowInEvent(
      params.data.eventId,
      body.data,
      { actor: owner.actor },
      services,
    );
    if (!created.ok) return fail(reply, created.error);
    setOwnerCookie(reply, ownerCookieName(created.value.showId), created.value.ownerToken, options);
    const response: CreatedShowResponse = { showId: created.value.showId };
    return reply.code(201).send(response);
  });

  /** Attach an existing Show: the browser must hold BOTH the Event and the Show owner cookie. */
  app.post('/api/v1/events/:eventId/shows/attach', async (request, reply) => {
    const params = eventParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const body = attachShowRequestSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    const event = await eventOwnerFromRequest(request, params.data.eventId, services);
    const show = await ownerFromRequest(request, body.data.showId, services);
    if (!event || !show) return reply.code(401).send(unauthenticated);
    const attached = await attachShowToEvent(
      params.data.eventId,
      body.data,
      { event: { actor: event.actor }, show: { actor: show.actor } },
      services,
    );
    return attached.ok ? { ok: true } : fail(reply, attached.error);
  });

  app.post('/api/v1/shows/:showId/duplicate', async (request, reply) => {
    const params = showParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await managementFromRequest(request, params.data.showId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const body = duplicateShowRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return badRequest(reply, body.error);
    // The copy joins the source's Event when this browser also manages that Event.
    const eventId = await services.locator.eventIdOfShow(ShowId(params.data.showId));
    const eventOwner = eventId ? await eventOwnerFromRequest(request, eventId, services) : null;
    const copy = await duplicateShow(
      params.data.showId,
      body.data,
      { actor: owner.actor },
      services,
      eventOwner ? { actor: eventOwner.actor } : undefined,
    );
    if (!copy.ok) return fail(reply, copy.error);
    setOwnerCookie(reply, ownerCookieName(copy.value.showId), copy.value.ownerToken, options);
    const response: CreatedShowResponse = { showId: copy.value.showId };
    return reply.code(201).send(response);
  });

  app.get('/api/v1/events/:eventId/boards/:boardId/preview', async (request, reply) => {
    const params = eventParams.extend({ boardId: idSchema }).safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const p = await scopePrincipal(request, 'event', params.data.eventId);
    if (!p) return reply.code(401).send(unauthenticated);
    const preview = await previewScopedBoard(p.scope, params.data.boardId, p.actor, services);
    return preview.ok ? preview.value : fail(reply, preview.error);
  });

  // --- Devices and Board shares, per scope (Show or Event) -------------------------------------

  for (const kind of ['show', 'event'] as const) {
    const base = kind === 'show' ? '/api/v1/shows/:id' : '/api/v1/events/:id';
    const params = z.object({ id: idSchema });

    app.get(`${base}/devices`, async (request, reply) => {
      const parsed = params.safeParse(request.params);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const p = await scopePrincipal(request, kind, parsed.data.id);
      if (!p) return reply.code(401).send(unauthenticated);
      const list = await listDevices(p.scope, p.actor, services);
      return list.ok ? list.value : fail(reply, list.error);
    });

    app.post(`${base}/devices`, async (request, reply) => {
      const parsed = params.safeParse(request.params);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const p = await scopePrincipal(request, kind, parsed.data.id);
      if (!p) return reply.code(401).send(unauthenticated);
      const command = deviceCommandSchema.safeParse(request.body);
      if (!command.success) return badRequest(reply, command.error);
      const result = await executeDeviceCommand(p.scope, command.data, p.actor, services);
      return result.ok ? result.value : fail(reply, result.error);
    });

    if (kind === 'event') {
      // Show Board shares are created on the existing Show route (routes.ts).
      app.post(`${base}/board-shares`, async (request, reply) => {
        const parsed = params.safeParse(request.params);
        if (!parsed.success) return badRequest(reply, parsed.error);
        const p = await scopePrincipal(request, kind, parsed.data.id);
        if (!p) return reply.code(401).send(unauthenticated);
        const body = boardShareCreateRequestSchema.safeParse(request.body ?? {});
        if (!body.success) return badRequest(reply, body.error);
        const share = await createScopedBoardShare(p.scope, body.data, p.actor, services);
        return share.ok ? reply.code(201).send(share.value) : fail(reply, share.error);
      });
    }

    app.get(`${base}/board-shares`, async (request, reply) => {
      const parsed = params.safeParse(request.params);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const p = await scopePrincipal(request, kind, parsed.data.id);
      if (!p) return reply.code(401).send(unauthenticated);
      const list = await listBoardShares(p.scope, p.actor, services);
      return list.ok ? list.value : fail(reply, list.error);
    });

    app.post(`${base}/board-shares/:shareId/revoke`, async (request, reply) => {
      const parsed = params.extend({ shareId: idSchema }).safeParse(request.params);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const p = await scopePrincipal(request, kind, parsed.data.id);
      if (!p) return reply.code(401).send(unauthenticated);
      const revoked = await revokeBoardShare(p.scope, parsed.data.shareId, p.actor, services);
      return revoked.ok ? { ok: true } : fail(reply, revoked.error);
    });
  }

  // --- Display side: pairing and the paired Device -------------------------------------------

  app.post(
    '/api/v1/devices/pairing',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (_request, reply) => reply.code(201).send(await startPairing(services)),
  );

  /** 202 while waiting, 200 with the credential exactly once, 410 when expired/used/unknown. */
  app.post(
    '/api/v1/devices/pairing/claim',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = pairingClaimRequestSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const claim = await claimPairing(body.data.pairingSecret, services);
      if (claim.status === 'pending') return reply.code(202).send(claim);
      if (claim.status === 'expired') {
        return reply
          .code(410)
          .send({ error: { code: 'not_found', message: 'Pairing expired; start again' } });
      }
      return claim;
    },
  );

  app.get(
    '/api/v1/device/state',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const device = await deviceFromRequest(request, services);
      if (!device) return reply.code(401).send(unauthenticated);
      return getDeviceDisplay(device, services);
    },
  );
}
