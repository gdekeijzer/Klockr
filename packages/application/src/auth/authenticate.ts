import { isGrantActive, type AccessGrant, type Clock } from '@klockr/domain';
import type { Actor } from '../command';
import type { GrantRepository, TokenService } from '../ports';

export interface AuthenticatedPrincipal {
  readonly actor: Actor;
  readonly grant: AccessGrant;
}

/**
 * Resolve an opaque credential to an actor. Returns null for unknown, malformed, revoked or
 * expired credentials, and for a credential presented on the wrong channel (a Board token can
 * never authenticate as a management grant and vice versa).
 */
export async function authenticateToken(
  token: string,
  expected: 'owner' | 'board',
  deps: { readonly tokens: TokenService; readonly grants: GrantRepository; readonly clock: Clock },
): Promise<AuthenticatedPrincipal | null> {
  if (deps.tokens.kindOf(token) !== expected) return null;
  const grant = await deps.grants.findByTokenHash(deps.tokens.hash(token));
  if (!grant || !isGrantActive(grant, deps.clock.now())) return null;

  if (expected === 'owner' && grant.kind === 'anonymous_owner') {
    return { grant, actor: { kind: 'management_grant', id: grant.id } };
  }
  if (expected === 'board' && grant.kind === 'board_share') {
    return { grant, actor: { kind: 'board_share', id: grant.id } };
  }
  return null;
}
