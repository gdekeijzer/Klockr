'use client';

import type { EventShowSummary } from '@klockr/contracts';
import { classifyOffset, deriveTimer, timerPhase } from '@klockr/domain';
import {
  anchorChip,
  formatClock,
  formatTimer,
  offsetChip,
  timerDigitColor,
  timerStatusChip,
} from '@klockr/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip } from '../../../components/Chip';
import styles from '../../show/[showId]/show.module.css';
import ev from './event.module.css';

/**
 * High-level live status of one Show (Event Dashboard / Room View): Primary Queue Current and its
 * timer (derived locally from the authoritative snapshot), Next, Show offset, the next fixed
 * anchor, running timers, conflicts and pending suggestions. Not every Queue Item.
 */
export function ShowCard(props: {
  show: EventShowSummary;
  now: number;
  eventTimeZone: string;
  children?: ReactNode;
}) {
  const { show, now } = props;
  const tz = show.timeZone;
  const timer = show.currentTimer;
  const view = timer ? deriveTimer(timer, now) : null;
  const live = show.runningTimers > 0;
  const offset = show.offsetMs;
  const anchor = show.anchor;
  return (
    <article
      className={ev.card}
      data-testid="show-card"
      data-title={show.title}
      data-live={live}
      aria-label={`Show ${show.title}`}
    >
      <div className={ev.cardHead}>
        <span className={ev.cardTitle}>{show.title}</span>
        <span className={ev.actions}>
          <Link className={styles.link} href={`/show/${show.id}`}>
            Operator
          </Link>
          <Link
            className={styles.link}
            href={`/show/${show.id}/master`}
            aria-label={`Open Master of ${show.title}`}
          >
            Master
          </Link>
        </span>
      </div>
      <div className={ev.facts}>
        <span className="label">{show.primaryQueueName}</span>
        <span data-testid="show-card-current">{show.current?.title ?? '—'}</span>
      </div>
      {timer && view && (
        <div className={ev.facts}>
          <span
            className={`${ev.cardTimer} mono`}
            style={{ color: timerDigitColor(timerPhase(view)) }}
            data-testid="show-card-timer"
            data-status={timer.status}
          >
            {formatTimer(view)}
          </span>
          <Chip spec={timerStatusChip(timer.status)} />
        </div>
      )}
      {show.next && (
        <div className={styles.rowSub}>
          Next: {show.next.title}
          {show.next.plannedStart !== null &&
            ` · planned ${formatClock(show.next.plannedStart, tz)}`}
          {show.next.projectedStart !== null &&
            ` · projected ${formatClock(show.next.projectedStart, tz)}`}
        </div>
      )}
      <div className={ev.facts}>
        {offset !== null && (
          <Chip
            spec={offsetChip(classifyOffset(offset, show.toleranceMs, show.severeBehindMs), offset)}
          />
        )}
        {anchor && anchor.recoveryMs > 0 && (
          <span data-testid="show-card-anchor">
            <Chip
              spec={anchorChip(
                anchor.recoveryMs <= anchor.recoverableMs ? 'risk' : 'missed',
                anchor.recoveryMs,
              )}
            />
          </span>
        )}
        {show.runningTimers > 1 && <span className={styles.tag}>{show.runningTimers} TIMERS</span>}
        {show.conflicts > 0 && (
          <span className={styles.tag} data-testid="show-card-conflicts">
            {show.conflicts} CONFLICT
          </span>
        )}
        {show.pendingSuggestions > 0 && (
          <span className={styles.tag}>{show.pendingSuggestions} SUGGESTED</span>
        )}
        {show.locked && <span className={styles.tag}>LOCKED</span>}
        {show.timeZone !== props.eventTimeZone && (
          <span className={styles.tag} title="This Show keeps its own timezone">
            TZ {show.timeZone}
          </span>
        )}
        <span className={styles.rowSub}>
          {show.boards.length} Board{show.boards.length === 1 ? '' : 's'}
        </span>
      </div>
      {props.children}
    </article>
  );
}
