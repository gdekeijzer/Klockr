/**
 * Absolute instant as milliseconds since the Unix epoch (UTC).
 * Domain logic never reads wall-clock time directly; it receives instants from a {@link Clock}.
 */
export type EpochMs = number;

/** A signed duration in milliseconds. */
export type DurationMs = number;

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
