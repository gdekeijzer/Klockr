import {
  authenticateToken,
  type AuthenticatedPrincipal,
  type ShowServiceDeps,
} from '@klockr/application';
import type { FastifyRequest } from 'fastify';

/** One HttpOnly cookie per Show holds that Show's anonymous owner credential. */
export const ownerCookieName = (showId: string): string =>
  `klockr_owner_${showId.replaceAll('-', '')}`;

export function ownerTokenFromCookies(
  cookies: Readonly<Record<string, string | undefined>>,
  showId: string,
): string | undefined {
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

/** Board credentials are presented as `Authorization: Bearer klb_...`, never as cookies. */
export async function boardFromRequest(
  request: FastifyRequest,
  services: ShowServiceDeps,
): Promise<AuthenticatedPrincipal | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return authenticateToken(header.slice('Bearer '.length).trim(), 'board', services);
}
