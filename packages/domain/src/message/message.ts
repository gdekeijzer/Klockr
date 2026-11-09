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

/** Messages a Board shows at `now` (newest first; urgent before normal). */
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
    .sort(
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === 'urgent' ? -1 : 1) ||
        b.createdAt - a.createdAt,
    );
}
