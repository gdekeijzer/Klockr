/**
 * Branded identifiers. Only the minimal identifiers needed to establish boundaries exist in M0.
 * IDs are opaque strings (UUIDs in practice); brands prevent mixing them up at compile time.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ShowId = Brand<string, 'ShowId'>;
export type QueueId = Brand<string, 'QueueId'>;
export type QueueItemId = Brand<string, 'QueueItemId'>;

export const ShowId = (value: string): ShowId => value as ShowId;
export const QueueId = (value: string): QueueId => value as QueueId;
export const QueueItemId = (value: string): QueueItemId => value as QueueItemId;
