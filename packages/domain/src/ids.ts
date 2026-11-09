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
export type EventId = Brand<string, 'EventId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type DeviceId = Brand<string, 'DeviceId'>;

export const ShowId = (value: string): ShowId => value as ShowId;
export const QueueId = (value: string): QueueId => value as QueueId;
export const QueueItemId = (value: string): QueueItemId => value as QueueItemId;
export const GroupId = (value: string): GroupId => value as GroupId;
export const BoardId = (value: string): BoardId => value as BoardId;
export const GrantId = (value: string): GrantId => value as GrantId;
export const EventId = (value: string): EventId => value as EventId;
export const RoomId = (value: string): RoomId => value as RoomId;
export const DeviceId = (value: string): DeviceId => value as DeviceId;
