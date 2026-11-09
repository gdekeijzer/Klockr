import { createHash, randomBytes } from 'node:crypto';
import type { TokenKind, TokenService } from '@klockr/application';

const PREFIX: Readonly<Record<TokenKind, string>> = { owner: 'klo_', board: 'klb_' };

/**
 * Opaque credentials: 32 bytes (256 bits) from the OS CSPRNG, base64url, with a type prefix so
 * a Board token can never be presented as an owner token. Stored as SHA-256 hex: the secret is
 * high-entropy, so a fast hash is appropriate and verification is a single indexed lookup.
 */
export class NodeTokenService implements TokenService {
  issue(kind: TokenKind): { token: string; hash: string } {
    const token = PREFIX[kind] + randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  kindOf(token: string): TokenKind | null {
    if (token.length < 20 || token.length > 100) return null;
    if (token.startsWith(PREFIX.owner)) return 'owner';
    if (token.startsWith(PREFIX.board)) return 'board';
    return null;
  }
}
