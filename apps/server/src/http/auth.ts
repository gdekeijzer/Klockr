import {
  authenticateDevice,
  authenticateToken,
  type AuthenticatedPrincipal,
  type PlatformDeps,
  type ShowServiceDeps,
} from '@klockr/application';
import { ShowId, type Device } from '@klockr/domain';
import type { FastifyRequest } from 'fastify';

type Cookies = Readonly<Record<string, string | undefined>>;

/** One HttpOnly cookie per Show holds that Show's anonymous owner credential. */
export const ownerCookieName = (showId: string): string =>
  `klockr_owner_${showId.replaceAll('-', '')}`;

/** M5: one HttpOnly cookie per Event holds that Event's anonymous owner credential. */
export const eventCookieName = (eventId: string): string =>
  `klockr_event_${eventId.replaceAll('-', '')}`;

export function ownerTokenFromCookies(cookies: Cookies, showId: string): string | undefined {
  return cookies[ownerCookieName(showId)];
}

export async function ownerFromRequest(
  request: FastifyRequest,
  showId: string,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  const token = ownerTokenFromCookies(request.cookies, showId);
  return token ? authenticateToken(token, 'owner', services) : null;
}

export async function eventOwnerFromCookies(
  cookies: Cookies,
  eventId: string,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  const token = cookies[eventCookieName(eventId)];
  return token ? authenticateToken(token, 'event', services) : null;
}

/**
 * Management credential for a Show: its own owner cookie, or (M5) the owner cookie of the Event
 * the Show is currently placed in. What that credential may do is decided by the authorizer.
 */
export async function managementFromCookies(
  cookies: Cookies,
  showId: string,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  const token = ownerTokenFromCookies(cookies, showId);
  const owner = token ? await authenticateToken(token, 'owner', services) : null;
  if (owner) return owner;
  const eventId = await services.locator.eventIdOfShow(ShowId(showId));
  return eventId ? eventOwnerFromCookies(cookies, eventId, services) : null;
}

export function managementFromRequest(
  request: FastifyRequest,
  showId: string,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  return managementFromCookies(request.cookies, showId, services);
}

export function eventOwnerFromRequest(
  request: FastifyRequest,
  eventId: string,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  return eventOwnerFromCookies(request.cookies, eventId, services);
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

/** Board credentials are presented as `Authorization: Bearer klb_...`, never as cookies. */
export async function boardFromRequest(
  request: FastifyRequest,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  const token = bearer(request);
  return token ? authenticateToken(token, 'board', services) : null;
}

/** M5: Device credentials (`Bearer kld_...`). Revoked Devices are rejected. */
export async function deviceFromRequest(
  request: FastifyRequest,
  services: PlatformDeps,
): Promise<Device | null> {
  const token = bearer(request);
  return token ? authenticateDevice(token, services) : null;
}
