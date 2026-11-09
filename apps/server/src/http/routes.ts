import {
  createBoardShare,
  createQuickTimer,
  getBoardState,
  getShowState,
  runShowTimerCommand,
  timerCommandFromDto,
  toTimerSnapshot,
  type ShowServiceDeps,
} from '@klockr/application';
import {
  createQuickTimerRequestSchema,
  idSchema,
  timerCommandSchema,
  type BoardShareResponse,
  type CreateQuickTimerResponse,
} from '@klockr/contracts';
import { ANONYMOUS_SHOW_TTL_MS, BoardId, ShowId } from '@klockr/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { boardFromRequest, ownerCookieName, ownerFromRequest } from './auth';
import { errorBody, httpStatusOf, unauthenticated } from './errors';

export interface ApiOptions {
  readonly services: ShowServiceDeps;
  /** Set the Secure attribute on credential cookies (true behind HTTPS). */
  readonly secureCookies: boolean;
}

const showParams = z.object({ showId: idSchema });

function badRequest(reply: FastifyReply, issues: z.ZodError) {
  return reply.code(400).send({
    error: {
      code: 'validation_failed',
      message: 'Invalid request',
      details: { issues: z.treeifyError(issues) },
    },
  });
}

/**
 * Versioned HTTP API. Handlers only authenticate, validate with shared contracts and call
 * application use cases; no business rules live here.
 */
export function registerApiRoutes(app: FastifyInstance, options: ApiOptions): void {
  const { services } = options;

  app.post(
    '/api/v1/shows',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = createQuickTimerRequestSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const created = await createQuickTimer(body.data, services);
      if (!created.ok)
        return reply.code(httpStatusOf(created.error)).send(errorBody(created.error));

      reply.setCookie(ownerCookieName(created.value.showId), created.value.ownerToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secureCookies,
        path: '/',
        // Outlives the nominal 7-day expiry by a day so management access does not vanish first.
        maxAge: Math.floor(ANONYMOUS_SHOW_TTL_MS / 1000) + 24 * 60 * 60,
      });
      const response: CreateQuickTimerResponse = {
        showId: created.value.showId,
        boardShareToken: created.value.boardShareToken,
      };
      return reply.code(201).send(response);
    },
  );

  app.get('/api/v1/shows/:showId/state', async (request, reply) => {
    const params = showParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await ownerFromRequest(request, params.data.showId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const state = await getShowState(ShowId(params.data.showId), { actor: owner.actor }, services);
    if (!state.ok) return reply.code(httpStatusOf(state.error)).send(errorBody(state.error));
    return state.value;
  });

  app.post('/api/v1/shows/:showId/commands', async (request, reply) => {
    const params = showParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await ownerFromRequest(request, params.data.showId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const command = timerCommandSchema.safeParse(request.body);
    if (!command.success) return badRequest(reply, command.error);

    const result = await runShowTimerCommand(
      ShowId(params.data.showId),
      timerCommandFromDto(command.data),
      { actor: owner.actor },
      services,
    );
    if (!result.ok) return reply.code(httpStatusOf(result.error)).send(errorBody(result.error));
    return {
      timer: toTimerSnapshot(result.value.queueItemId, result.value.state, services.clock.now()),
    };
  });

  app.post('/api/v1/shows/:showId/board-shares', async (request, reply) => {
    const params = showParams.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const owner = await ownerFromRequest(request, params.data.showId, services);
    if (!owner) return reply.code(401).send(unauthenticated);
    const share = await createBoardShare(
      ShowId(params.data.showId),
      { actor: owner.actor },
      services,
    );
    if (!share.ok) return reply.code(httpStatusOf(share.error)).send(errorBody(share.error));
    const response: BoardShareResponse = share.value;
    return reply.code(201).send(response);
  });

  app.get(
    '/api/v1/board/state',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const board = await boardFromRequest(request, services);
      if (!board?.grant.boardId) return reply.code(401).send(unauthenticated);
      const state = await getBoardState(
        BoardId(board.grant.boardId),
        { actor: board.actor },
        services,
      );
      if (!state.ok) return reply.code(httpStatusOf(state.error)).send(errorBody(state.error));
      return state.value;
    },
  );
}
