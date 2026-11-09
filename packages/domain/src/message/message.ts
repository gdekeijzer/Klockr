import type { Audience } from '../audience';
import type { BoardId } from '../ids';
import { err, ok, type Result } from '../result';
import type { EpochMs } from '../time';

/**
 * Ad-hoc operational message ("AFRONDEN", "STOP NU", "5 MIN"). NOT a Queue Item: it has no
 * place in the rundown, no timer and no lifecycle beyond sent / expired / cleared.
 */
export type MessagePriority = 'normal' | 'urgent';

export interface Message {
  readonly id: string;
  readonly text: string;
  /** Delivered to Boards of these audiences ... */
  readonly audiences: readonly Audience[];
  /** ... and/or to these specific Boards. */
  readonly boardIds: readonly BoardId[];
  readonly priority: MessagePriority;
  readonly createdAt: EpochMs;
  readonly expiresAt: EpochMs | null;
  readonly clearedAt: EpochMs | null;
}

export const MESSAGE_MAX_LENGTH = 120;

export function createMessage(input: {
  id: string;
  text: string;
  audiences: readonly Audience[];
  boardIds: readonly BoardId[];
  priority: MessagePriority;
  ttlMs: number | null;
  now: EpochMs;
}): Result<Message, string> {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MESSAGE_MAX_LENGTH) {
    return err(`message must be 1-${String(MESSAGE_MAX_LENGTH)} characters`);
  }
  if (input.audiences.length === 0 && input.boardIds.length === 0) {
    return err('choose at least one audience or board');
  }
  if (
    input.ttlMs !== null &&
    (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > 24 * 3_600_000)
  ) {
    return err('invalid expiry');
  }
  return ok({
    id: input.id,
    text,
    audiences: [...new Set(input.audiences)],
    boardIds: [...new Set(input.boardIds)],
    priority: input.priority,
    createdAt: input.now,
    expiresAt: input.ttlMs === null ? null : input.now + input.ttlMs,
    clearedAt: null,
  });
}

export function isMessageActive(message: Message, now: EpochMs): boolean {
  return message.clearedAt === null && (message.expiresAt === null || now < message.expiresAt);
}

/**
 * Display order of active Messages: higher priority first; at equal priority the most recently
 * created first. Several Messages may be active at once; a Board renders only the first one.
 */
export function compareMessages(
  a: { readonly priority: MessagePriority; readonly createdAt: EpochMs },
  b: { readonly priority: MessagePriority; readonly createdAt: EpochMs },
): number {
  const rank = (p: MessagePriority) => (p === 'urgent' ? 1 : 0);
  return rank(b.priority) - rank(a.priority) || b.createdAt - a.createdAt;
}

/** Messages addressed to a Board (audience or id) that are active at `now`, in display order. */
export function messagesFor(
  messages: readonly Message[],
  board: { readonly id: BoardId; readonly audience: Audience },
  now: EpochMs,
): Message[] {
  return messages
    .filter(
      (m) =>
        isMessageActive(m, now) &&
        (m.audiences.includes(board.audience) || m.boardIds.includes(board.id)),
    )
    .sort(compareMessages);
}

/**
 * The single dominant Message a Board renders, or null (normal layout). When it is cleared or
 * expires, the next valid active Message takes over automatically.
 */
export function dominantMessage(
  messages: readonly Message[],
  board: { readonly id: BoardId; readonly audience: Audience },
  now: EpochMs,
): Message | null {
  return messagesFor(messages, board, now)[0] ?? null;
}

/**
 * Client-side re-selection over an already scoped list (a Board snapshot): drops Messages that
 * expired locally since the snapshot (also while disconnected) and applies the same order.
 */
export function selectDominantMessage<
  T extends {
    readonly priority: MessagePriority;
    readonly createdAt: EpochMs;
    readonly expiresAt: EpochMs | null;
  },
>(messages: readonly T[], now: EpochMs): T | null {
  return (
    messages.filter((m) => m.expiresAt === null || now < m.expiresAt).sort(compareMessages)[0] ??
    null
  );
}
