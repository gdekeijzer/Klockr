'use client';

import type { EventShowSummary, EventStateSnapshot } from '@klockr/contracts';
import { formatClock } from '@klockr/ui';
import Link from 'next/link';
import { useState } from 'react';
import {
  ApiError,
  attachShow,
  createShowInEvent,
  duplicateShow,
  sendEventCommand,
  type EventCommandBody,
} from '../../../lib/api';
import { useEventRealtime } from '../../../lib/use-realtime';
import { useServerNow } from '../../../lib/use-server-now';
import styles from '../../show/[showId]/show.module.css';
import { EventFrame } from './event-frame';
import ev from './event.module.css';
import { ShowCard } from './show-card';

const NO_ROOM = '__none';
const DETACH = '__detach';

/**
 * Event Dashboard: a calm, high-level production overview — Rooms, the Shows in each Room with
 * their live status, Event Shows without Room, Devices — plus Event planning (Rooms, placing,
 * moving, detaching and duplicating Shows). Structural actions never start timers or change
 * Current; locks are respected server-side and shown here.
 */
export function EventDashboard({ eventId }: { eventId: string }) {
  const rt = useEventRealtime(eventId);
  const now = useServerNow(rt.offsetMs, 250);
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [showTitle, setShowTitle] = useState('');
  const [showRoom, setShowRoom] = useState(NO_ROOM);
  const [existing, setExisting] = useState('');
  const state = rt.state;
  const disabled = rt.status !== 'connected';

  async function run(body: EventCommandBody) {
    setError(null);
    try {
      rt.applyState((await sendEventCommand(eventId, body)).state);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Command failed');
    }
  }
  async function guarded(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
    }
  }

  if (!state) {
    return (
      <EventFrame eventId={eventId} view="dashboard" rt={rt} now={now}>
        <main className={ev.page} aria-busy>
          <p className={styles.muted}>Loading Event…</p>
        </main>
      </EventFrame>
    );
  }

  const tz = state.event.timeZone;
  const buckets: { id: string | null; name: string; status: string; locked: boolean }[] = [
    ...state.rooms.map((r) => ({ id: r.id, name: r.name, status: r.status, locked: r.locked })),
    { id: null, name: 'Event Shows without Room', status: 'active', locked: false },
  ];
  const eventLocked = state.locks.some((l) => l.target.kind === 'event');
  const onlineDevices = state.devices.filter((d) => d.status === 'online').length;

  const actionsFor = (show: EventShowSummary, list: EventShowSummary[], index: number) => (
    <div className={ev.actions}>
      <select
        className={styles.input}
        value=""
        aria-label={`Move ${show.title}`}
        disabled={disabled}
        onChange={(e) => {
          const target = e.target.value;
          if (target === DETACH) void run({ type: 'show.detach', payload: { showId: show.id } });
          else if (target)
            void run({
              type: 'show.place',
              payload: { showId: show.id, roomId: target === NO_ROOM ? null : target },
            });
        }}
      >
        <option value="">Move to…</option>
        {state.rooms
          .filter((r) => r.id !== show.roomId)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        {show.roomId !== null && <option value={NO_ROOM}>No Room (stay in Event)</option>}
        <option value={DETACH}>Detach from Event</option>
      </select>
      <button
        type="button"
        className={`${styles.button} ${styles.small}`}
        aria-label={`Move up: ${show.title}`}
        disabled={disabled || index === 0}
        onClick={() => {
          void run({
            type: 'show.place',
            payload: { showId: show.id, roomId: show.roomId, index: index - 1 },
          });
        }}
      >
        ↑
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.small}`}
        aria-label={`Move down: ${show.title}`}
        disabled={disabled || index === list.length - 1}
        onClick={() => {
          void run({
            type: 'show.place',
            payload: { showId: show.id, roomId: show.roomId, index: index + 1 },
          });
        }}
      >
        ↓
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.small}`}
        aria-label={`Duplicate ${show.title}`}
        disabled={disabled}
        onClick={() => {
          void guarded(() => duplicateShow(show.id, { roomId: show.roomId }));
        }}
      >
        Duplicate
      </button>
    </div>
  );

  return (
    <EventFrame eventId={eventId} view="dashboard" rt={rt} now={now}>
      <main className={ev.page}>
        <section className={styles.panel} aria-label="Event">
          <div className={ev.summary}>
            <h1 style={{ margin: 0 }} data-testid="event-name">
              {state.event.name}
            </h1>
            <span className="mono">
              {state.event.startsAt !== null && formatClock(state.event.startsAt, tz)}
              {state.event.endsAt !== null && ` – ${formatClock(state.event.endsAt, tz)}`}
            </span>
            <span className={styles.rowSub}>{tz}</span>
            <select
              className={styles.input}
              style={{ width: 'auto' }}
              value={state.event.status}
              aria-label="Event status"
              disabled={disabled}
              onChange={(e) => {
                void run({
                  type: 'event.update',
                  payload: { status: e.target.value as EventStateSnapshot['event']['status'] },
                });
              }}
            >
              {['draft', 'active', 'completed', 'archived'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${styles.button} ${styles.small}`}
              disabled={disabled}
              onClick={() => {
                void run({
                  type: eventLocked ? 'lock.release' : 'lock.set',
                  payload: { target: { kind: 'event', id: eventId } },
                });
              }}
            >
              {eventLocked ? 'Unlock Event' : 'Lock Event'}
            </button>
            <Link
              className={styles.link}
              href={`/event/${eventId}/devices`}
              data-testid="device-summary"
            >
              {state.devices.length} Device{state.devices.length === 1 ? '' : 's'} · {onlineDevices}{' '}
              online
            </Link>
          </div>
          {eventLocked && (
            <p className={styles.muted}>
              Event locked: structure changes are blocked. Live operation inside Shows continues.
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </section>

        <div className={ev.rooms}>
          {buckets.map((bucket) => {
            const shows = state.shows.filter((s) => s.roomId === bucket.id);
            const live = shows.some((s) => s.runningTimers > 0);
            return (
              <section
                key={bucket.id ?? NO_ROOM}
                className={ev.room}
                data-testid="room-column"
                data-room={bucket.id === null ? NO_ROOM : bucket.name}
                data-status={bucket.status}
                aria-label={bucket.name}
              >
                <div className={ev.roomHead}>
                  {bucket.id ? (
                    <Link className={ev.roomName} href={`/event/${eventId}/room/${bucket.id}`}>
                      {bucket.name}
                    </Link>
                  ) : (
                    <span className={ev.roomName}>{bucket.name}</span>
                  )}
                  <span className={ev.actions}>
                    {live && (
                      <span className={styles.tag} data-kind="running" data-testid="room-live">
                        LIVE
                      </span>
                    )}
                    {bucket.status === 'inactive' && <span className={styles.tag}>INACTIVE</span>}
                    {bucket.id && (
                      <button
                        type="button"
                        className={`${styles.button} ${styles.small}`}
                        aria-label={`${bucket.locked ? 'Unlock' : 'Lock'} room ${bucket.name}`}
                        disabled={disabled}
                        onClick={() => {
                          void run({
                            type: bucket.locked ? 'lock.release' : 'lock.set',
                            payload: { target: { kind: 'room', id: bucket.id ?? '' } },
                          });
                        }}
                      >
                        {bucket.locked ? 'Unlock' : 'Lock'}
                      </button>
                    )}
                  </span>
                </div>
                {shows.length === 0 && <p className={styles.muted}>No Shows.</p>}
                {shows.map((show, index) => (
                  <ShowCard key={show.id} show={show} now={now} eventTimeZone={tz}>
                    {actionsFor(show, shows, index)}
                  </ShowCard>
                ))}
              </section>
            );
          })}
        </div>

        <div className={ev.forms}>
          <form
            className={styles.panel}
            onSubmit={(e) => {
              e.preventDefault();
              const name = roomName.trim();
              if (!name) return;
              // Clear at once: text typed while the request runs must not be wiped afterwards.
              setRoomName('');
              void run({ type: 'room.create', payload: { name } });
            }}
          >
            <span className="label">Add Room / Area</span>
            <div className={ev.inlineForm}>
              <input
                className={styles.input}
                value={roomName}
                maxLength={80}
                placeholder="Main Stage"
                aria-label="New Room name"
                onChange={(e) => {
                  setRoomName(e.target.value);
                }}
              />
              <button
                type="submit"
                className={styles.button}
                disabled={disabled || !roomName.trim()}
              >
                + Room
              </button>
            </div>
          </form>
          <form
            className={styles.panel}
            onSubmit={(e) => {
              e.preventDefault();
              const title = showTitle.trim();
              if (!title) return;
              setShowTitle('');
              void guarded(async () => {
                await createShowInEvent(eventId, {
                  title,
                  roomId: showRoom === NO_ROOM ? null : showRoom,
                });
              });
            }}
          >
            <span className="label">New Show in this Event</span>
            <div className={ev.inlineForm}>
              <input
                className={styles.input}
                value={showTitle}
                maxLength={120}
                placeholder="Keynote"
                aria-label="New Show title"
                onChange={(e) => {
                  setShowTitle(e.target.value);
                }}
              />
              <select
                className={styles.input}
                value={showRoom}
                aria-label="Room for new Show"
                onChange={(e) => {
                  setShowRoom(e.target.value);
                }}
              >
                <option value={NO_ROOM}>No Room</option>
                {state.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className={styles.button}
                disabled={disabled || !showTitle.trim()}
              >
                + Show
              </button>
            </div>
            <p className={styles.muted}>New Shows use the Event timezone ({tz}).</p>
          </form>
          <form
            className={styles.panel}
            onSubmit={(e) => {
              e.preventDefault();
              const id = existing.trim().split('/').filter(Boolean).at(-1) ?? '';
              setExisting('');
              void guarded(async () => {
                await attachShow(eventId, id, null);
              });
            }}
          >
            <span className="label">Add an existing Show</span>
            <div className={ev.inlineForm}>
              <input
                className={`${styles.input} mono`}
                value={existing}
                placeholder="Show link or ID (created in this browser)"
                aria-label="Existing Show ID"
                onChange={(e) => {
                  setExisting(e.target.value);
                }}
              />
              <button
                type="submit"
                className={styles.button}
                disabled={disabled || !existing.trim()}
              >
                Add
              </button>
            </div>
          </form>
        </div>
        <p className={styles.muted}>
          A Show can be standalone, in the Event without a Room, or in exactly one Room. Need the
          same content in two Rooms? Duplicate it — a copy starts clean and idle.
        </p>
      </main>
    </EventFrame>
  );
}
