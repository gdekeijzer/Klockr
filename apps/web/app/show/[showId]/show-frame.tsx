'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip } from '../../../components/Chip';
import { connectionChip } from '../../../components/connection';
import type { ShowRealtime } from '../../../lib/use-realtime';
import styles from './show.module.css';

/**
 * Shared frame of the management views of one Show: brand, view tabs, connection state, clock
 * and the explicit offline banner. Both views share one realtime subscription model and the
 * same application command layer; they differ only in what they let the user do.
 */
export function ShowFrame(props: {
  showId: string;
  view: 'operator' | 'master';
  rt: ShowRealtime;
  now: number;
  children: ReactNode;
}) {
  const { showId, view, rt, now } = props;

  if (rt.denied) {
    return (
      <main className={styles.denied}>
        <div className={styles.brand}>KLOCKR</div>
        <h1>No control access in this browser</h1>
        <p>
          This Show can only be operated from the browser that created it. Ask for the Speaker Board
          link to follow along, or <Link href="/">create a new Quick Timer</Link>.
        </p>
      </main>
    );
  }

  const live = rt.status === 'connected';
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>KLOCKR</div>
        <nav className={styles.tabs} aria-label="Show views">
          <Link
            className={styles.tab}
            href={`/show/${showId}`}
            aria-current={view === 'operator' ? 'page' : undefined}
          >
            Operator
          </Link>
          <Link
            className={styles.tab}
            href={`/show/${showId}/master`}
            aria-current={view === 'master' ? 'page' : undefined}
          >
            Master
          </Link>
        </nav>
        <div className={styles.showName}>
          {rt.show?.title ?? 'Quick Timer'}
          <span className={`${styles.showId} mono`} title={showId} data-testid="show-id">
            {showId.slice(0, 8)}
          </span>
        </div>
        <div className={styles.headerRight}>
          <Chip spec={connectionChip(rt.status)} testId="connection-status" />
          <div className={styles.clock}>
            <span className="label">Current time</span>
            <span className="mono">{new Date(now).toLocaleTimeString([], { hour12: false })}</span>
          </div>
        </div>
      </header>

      {!live && rt.status !== 'connecting' && (
        <div role="alert" className={styles.offlineBanner} data-testid="offline-banner">
          <strong>Connection to the KLOCKR server lost.</strong> Controls are disabled until the
          connection is restored. Timers shown continue from the last confirmed state.
        </div>
      )}

      {props.children}
    </div>
  );
}
