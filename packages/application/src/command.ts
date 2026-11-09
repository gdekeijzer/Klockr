/**
 * Command conventions shared by every state-changing use case.
 *
 * - `commandId`: unique per attempt (UUID), used for tracing/audit.
 * - `idempotencyKey`: optional; a retried command with the same key and same intent returns the
 *   original outcome instead of being applied again.
 * - `expectedRevision`: optional optimistic-concurrency guard; mismatch -> `revision_conflict`.
 *
 * UI, HTTP API, realtime input and future integrations all call the same command handlers.
 */
export interface Command<TType extends string, TPayload> {
  readonly commandId: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly idempotencyKey?: string | undefined;
  readonly expectedRevision?: number | undefined;
}

/**
 * Who issues a command. Grant kinds are deliberately separate (CLAUDE.md, ADR-0007).
 * Board shares and Devices are read-only display grants and never issue control commands.
 */
export type Actor =
  | { readonly kind: 'management_grant'; readonly id: string }
  | { readonly kind: 'role_link'; readonly id: string }
  | { readonly kind: 'user'; readonly id: string }
  | { readonly kind: 'api_token'; readonly id: string }
  | { readonly kind: 'system'; readonly id: string };

export interface CommandContext {
  readonly actor: Actor;
}
