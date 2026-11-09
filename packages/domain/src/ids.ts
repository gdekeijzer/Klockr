/**
 * Branded identifiers.
 * IDs are opaque strings (UUIDs in practice); brands prevent mixing them up at compile time.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ShowId = Brand<string, 'ShowId'>;
export type QueueId = Brand<string, 'QueueId'>;
export type QueueItemId = Brand<string, 'QueueItemId'>;
export type GroupId = Brand<string, 'GroupId'>;
export type BoardId = Brand<string, 'BoardId'>;
export type GrantId = Brand<string, 'GrantId'>;

export const ShowId = (value: string): ShowId => value as ShowId;
export const QueueId = (value: string): QueueId => value as QueueId;
export const QueueItemId = (value: string): QueueItemId => value as QueueItemId;
export const GroupId = (value: string): GroupId => value as GroupId;
export const BoardId = (value: string): BoardId => value as BoardId;
export const GrantId = (value: string): GrantId => value as GrantId;
