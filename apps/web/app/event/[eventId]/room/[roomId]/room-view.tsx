'use client';

import { formatClock, formatSpan } from '@klockr/ui';
import Link from 'next/link';
import { useEventRealtime } from '../../../../../lib/use-realtime';
import { useServerNow } from '../../../../../lib/use-server-now';
import styles from '../../../../show/[showId]/show.module.css';
import { EventFrame } from '../../event-frame';
import ev from '../../event.module.css';
import { ShowCard } from '../../show-card';

/**
 * Room View: one Room's Shows (current one first in attention), Primary Queue Current, planned vs
 * projected timing, the room-level agenda (a VIEW over Show/Queue data — no agenda database),
 * and the Boards and Devices that serve this Room.
 */
export function RoomView({ eventId, roomId }: { eventId: string; roomId: string }) {
  const rt = useEventRealtime(eventId);
  const now = useServerNow(rt.offsetMs, 250);
  const state = rt.state;
  const room = state?.rooms.find((r) => r.id === roomId);

  if (!state || !room) {
    return (
      <EventFrame eventId={eventId} view="room" rt={rt} now={now}>
        <main className={ev.page} aria-busy={!state}>
          <p className={styles.muted}>{state ? 'Room not found.' : 'Loading Room…'}</p>
        </main>
      </EventFrame>
    );
  }

  const tz = state.event.timeZone;
  const shows = state.shows.filter((s) => s.roomId === roomId);
  const current =
    shows.find((s) => s.runningTimers > 0) ??
    shows.find((s) => s.agenda.some((a) => a.state !== 'completed')) ??
    shows.at(-1);
  const roomBoards = [
    ...state.boards
      .filter((b) => b.sources.kind === 'room' && b.sources.roomId === roomId)
      .map((b) => ({ id: b.id, name: b.name, owner: 'Room' })),
    ...shows.flatMap((s) => s.boards.map((b) => ({ id: b.id, name: b.name, owner: s.title }))),
  ];
  const boardIds = new Set(roomBoards.map((b) => b.id));
  const devices = state.devices.filter((d) => d.assignedBoardId && boardIds.has(d.assignedBoardId));

  return (
    <EventFrame eventId={eventId} view="room" rt={rt} now={now} roomName={room.name}>
      <main className={ev.page} data-testid="room-view" data-room={room.name}>
        <section className={styles.panel} aria-label="Room">
          <div className={ev.summary}>
            <h1 style={{ margin: 0 }}>{room.name}</h1>
            {room.status === 'inactive' && <span className={styles.tag}>INACTIVE</span>}
            {room.locked && <span className={styles.tag}>LOCKED</span>}
            <span className={styles.rowSub}>
              {shows.length} Show{shows.length === 1 ? '' : 's'}
            </span>
          </div>
          {room.description && <p className={styles.muted}>{room.description}</p>}
        </section>

        <div className={ev.rooms}>
          {shows.map((show) => (
            <div key={show.id} data-current-show={show.id === current?.id}>
              {show.id === current?.id && (
                <span className="label" data-testid="room-current-show">
                  Current Show
                </span>
              )}
              <ShowCard show={show} now={now} eventTimeZone={tz} />
            </div>
          ))}
        </div>

        <section className={styles.panel} aria-label="Room agenda" data-testid="room-agenda">
          <span className="label">Room agenda (planned · projected)</span>
          {shows.map((show) => (
            <div key={show.id}>
              <strong>
                <Link className={styles.link} href={`/show/${show.id}/master`}>
                  {show.title}
                </Link>
              </strong>
              <ol className={ev.agenda}>
                {show.agenda.map((a) => (
                  <li key={a.id} data-state={a.state} data-testid="room-agenda-item">
                    <span className="mono">{formatClock(a.plannedStart, show.timeZone)}</span>
                    <span className="mono">{formatClock(a.projectedStart, show.timeZone)}</span>
                    <span>
                      {a.title}
                      {a.fixedAnchor && <span className={styles.tag}> FIXED</span>}
                    </span>
                    <span className="mono">
                      {a.durationMs !== null ? formatSpan(a.durationMs) : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>

        <section className={styles.panel} aria-label="Boards and Devices of this Room">
          <span className="label">Boards & Devices</span>
          <ul className={styles.list}>
            {roomBoards.map((b) => (
              <li key={b.id} className={styles.rowSub}>
                {b.owner}: {b.name} —{' '}
                {devices
                  .filter((d) => d.assignedBoardId === b.id)
                  .map((d) => `${d.name} (${d.status.replace('_', ' ')})`)
                  .join(', ') || 'no Device'}
              </li>
            ))}
          </ul>
          <Link className={styles.link} href={`/event/${eventId}/devices`}>
            Manage Devices & Boards
          </Link>
        </section>
      </main>
    </EventFrame>
  );
}
