'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip } from '../../../components/Chip';
import { connectionChip } from '../../../components/connection';
import type { EventRealtime } from '../../../lib/use-realtime';
import styles from '../../show/[showId]/show.module.css';
import ev from './event.module.css';

/**
 * Frame of the Event views (Dashboard, Room View, Devices & Boards): brand, Event context,
 * connection state and clock. Event → Room → Show Master is the navigation path; the Show
 * Master stays the Show's own editor.
 */
export function EventFrame(props: {
  eventId: string;
  view: 'dashboard' | 'devices' | 'room';
  rt: EventRealtime;
  now: number;
  roomName?: string | undefined;
  children: ReactNode;
}) {
  const { eventId, rt, now } = props;
  if (rt.denied) {
    return (
      <main className={styles.denied}>
        <div className={styles.brand}>KLOCKR</div>
        <h1>No access to this Event in this browser</h1>
        <p>
          This Event can only be managed from the browser that created it.{' '}
          <Link href="/">Create a Quick Timer</Link> or <Link href="/event/new">plan an Event</Link>
          .
        </p>
      </main>
    );
  }
  const live = rt.status === 'connected';
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>KLOCKR</div>
        <nav className={styles.tabs} aria-label="Event views">
          <Link
            className={styles.tab}
            href={`/event/${eventId}`}
            aria-current={props.view === 'dashboard' ? 'page' : undefined}
          >
            Event Dashboard
          </Link>
          <Link
            className={styles.tab}
            href={`/event/${eventId}/devices`}
            aria-current={props.view === 'devices' ? 'page' : undefined}
          >
            Devices &amp; Boards
          </Link>
        </nav>
        <div className={styles.showName} data-testid="event-context">
          <Link href={`/event/${eventId}`} className={ev.crumb}>
            {rt.state?.event.name ?? 'Event'}
          </Link>
          {props.roomName && (
            <>
              <span aria-hidden> / </span>
              <span>{props.roomName}</span>
            </>
          )}
        </div>
        <div className={styles.headerRight}>
          <Chip spec={connectionChip(rt.status)} testId="connection-status" />
          <div className={styles.clock}>
            <span className="label">Current time</span>
            <span className="mono">
              {new Date(now).toLocaleTimeString([], {
                hour12: false,
                ...(rt.state ? { timeZone: rt.state.event.timeZone } : {}),
              })}
            </span>
          </div>
        </div>
      </header>
      {!live && rt.status !== 'connecting' && (
        <div role="alert" className={styles.offlineBanner} data-testid="offline-banner">
          <strong>Connection to the KLOCKR server lost.</strong> Changes are disabled until the
          connection is restored. Live values continue from the last confirmed state.
        </div>
      )}
      {props.children}
    </div>
  );
}
