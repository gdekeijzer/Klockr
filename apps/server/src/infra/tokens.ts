import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { TokenKind, TokenService } from '@klockr/application';

const PREFIX: Readonly<Record<TokenKind, string>> = {
  owner: 'klo_',
  event: 'kle_',
  board: 'klb_',
  device: 'kld_',
  pairing: 'klp_',
};

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
    const found = (Object.entries(PREFIX) as [TokenKind, string][]).find(([, p]) =>
      token.startsWith(p),
    );
    return found ? found[0] : null;
  }

  randomIndex(n: number): number {
    return randomInt(n);
  }
}
