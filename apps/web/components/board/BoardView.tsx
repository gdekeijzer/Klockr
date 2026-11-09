'use client';

import type {
  BoardComponentDto,
  BoardItem,
  BoardQueue,
  BoardStateSnapshot,
  TimerSnapshot,
} from '@klockr/contracts';
import { classifyOffset, deriveTimer, selectDominantMessage, timerPhase } from '@klockr/domain';
import {
  colorVar,
  formatClock,
  formatSpan,
  formatTimer,
  offsetChip,
  remainingFraction,
  timerDigitColor,
  timerStatusChip,
} from '@klockr/ui';
import { Chip } from '../Chip';
import { LockIcon } from '../LockIcon';
import { ProgressBar } from '../ProgressBar';
import styles from './board-view.module.css';

/**
 * Generic, constrained Board renderer: draws a Board purely from its scoped projection and its
 * ordered, enabled components (no free canvas). Presets differ only in their component
 * configuration and source/audience. Timers render locally from the last authoritative state;
 * the offset and agenda times extrapolate after `growsAfter` (no ticks from the server).
 */
export function BoardView(props: {
  board: BoardStateSnapshot;
  timers: Readonly<Record<string, TimerSnapshot>>;
  now: number;
  /** Shown subtly when not connected; never a full-screen loader. */
  reconnecting?: boolean;
}) {
  const { board, timers, now } = props;
  const enabled = board.board.components.filter((c) => c.enabled);
  // One dominant Message (priority, then most recent); expiry is evaluated locally (also while
  // disconnected), so the next valid Message takes over without a server round trip.
  const dominant = selectDominantMessage(board.messages, now);
  const message = enabled.some((c) => c.kind === 'message') && dominant ? dominant : undefined;
  const primary = board.queues[0];
  const single = board.board.preset === 'speaker_confidence' || board.board.preset === 'custom';

  return (
    <main
      className={styles.board}
      data-preset={board.board.preset}
      data-low-light={board.board.presentation.lowLight}
      data-message={message !== undefined}
    >
      <div className={styles.topbar}>
        <span className={styles.brand}>KLOCKR</span>
        {props.reconnecting && (
          <span className={styles.reconnecting} data-testid="board-connection" role="status">
            RECONNECTING
          </span>
        )}
      </div>
      {message && (
        <div
          className={styles.message}
          data-priority={message.priority}
          data-testid="board-message"
          role="alert"
        >
          {message.text}
        </div>
      )}
      <div className={single ? styles.stack : styles.flow}>
        {enabled.map((c) => (
          <Component
            key={c.kind}
            config={c}
            board={board}
            primary={primary}
            timers={timers}
            now={now}
            compact={message !== undefined}
            timeZone={board.timeZone}
          />
        ))}
      </div>
    </main>
  );
}

function growth(queue: BoardQueue | undefined, now: number): number {
  return queue?.growsAfter ? Math.max(0, now - queue.growsAfter) : 0;
}

function Component(props: {
  config: BoardComponentDto;
  board: BoardStateSnapshot;
  primary: BoardQueue | undefined;
  timers: Readonly<Record<string, TimerSnapshot>>;
  now: number;
  compact: boolean;
  timeZone: string;
}) {
  const { config, primary, now, timeZone } = props;
  const current = primary?.current ?? null;
  const timer = current ? props.timers[current.id] : undefined;
  switch (config.kind) {
    case 'message':
      return null; // rendered as overlay above
    case 'current_title':
      return (
        <div
          className={styles.title}
          data-size={config.size}
          data-testid="board-title"
          data-has-timer={timer !== undefined}
        >
          {current ? (
            <span className={styles.titleMain}>{current.title}</span>
          ) : primary?.standBy ? (
            <span className={styles.standBy} data-testid="board-standby">
              STAND BY
            </span>
          ) : (
            <span className={styles.titleSub}>—</span>
          )}
        </div>
      );
    case 'subtitle':
      return current?.subtitle ? <div className={styles.titleSub}>{current.subtitle}</div> : null;
    case 'timer':
      return timer && primary ? (
        <TimerDigits
          timer={timer}
          queue={primary}
          now={now}
          size={props.compact ? 'medium' : config.size}
        />
      ) : current ? (
        <div data-testid="board-no-timer" />
      ) : null;
    case 'progress': {
      if (!timer || !primary) return null;
      const view = deriveTimer(timer, now);
      const phase = timerPhase(view, primary.warning);
      return (
        <div className={styles.progress}>
          <ProgressBar
            fraction={remainingFraction(view, timer.durationMs + timer.adjustmentMs)}
            color={phase === 'normal' ? colorVar('text-secondary') : timerDigitColor(phase)}
          />
        </div>
      );
    }
    case 'next_item':
      return primary?.next ? (
        <div className={styles.next} data-testid="board-next">
          <span className="label">Next</span> <strong>{primary.next.title}</strong>
          {primary.next.durationMs !== null && (
            <span className="mono"> · {formatSpan(primary.next.durationMs)}</span>
          )}
        </div>
      ) : null;
    case 'wall_clock':
      return (
        <div className={`${styles.clock} mono`} data-testid="board-clock">
          {formatClock(now, timeZone, true)}
        </div>
      );
    case 'show_offset': {
      if (!primary || primary.offsetMs === null) return null;
      const offset = primary.offsetMs + growth(primary, now);
      const status = classifyOffset(offset, primary.toleranceMs, primary.severeBehindMs);
      return (
        <div data-testid="board-offset">
          <Chip spec={offsetChip(status, offset)} />
        </div>
      );
    }
    case 'anchor':
      return primary?.anchor ? (
        <div className={styles.next} data-testid="board-anchor">
          <span className="label">Next fixed</span> <strong>{primary.anchor.title}</strong>{' '}
          <span className="mono">{formatClock(primary.anchor.plannedStart, timeZone)}</span>
          {primary.anchor.recoveryMs + growth(primary, now) > 0 && (
            <span className="mono">
              {' '}
              · {formatSpan(primary.anchor.recoveryMs + growth(primary, now))} TO RECOVER
            </span>
          )}
        </div>
      ) : null;
    case 'notes':
      return primary?.currentNotes ? (
        <p className={styles.notes} data-testid="board-notes">
          {primary.currentNotes}
        </p>
      ) : null;
    case 'running_timers': {
      const running = props.board.queues.flatMap((q) =>
        q.timers
          .filter((t) => t.status === 'running' || t.status === 'paused')
          .map((t) => ({ q, t: props.timers[t.queueItemId] ?? t })),
      );
      if (running.length === 0) return null;
      return (
        <ul className={styles.running} data-testid="board-running">
          {running.map(({ q, t }) => {
            const item = [q.current, ...q.upcoming].find((i) => i?.id === t.queueItemId);
            return (
              <li key={t.queueItemId}>
                <span>{q.name}</span> <span>{item?.title ?? ''}</span>{' '}
                <span className="mono">{formatTimer(deriveTimer(t, now))}</span>
              </li>
            );
          })}
        </ul>
      );
    }
    case 'queue_current_next':
      return (
        <div className={styles.columns} data-testid="board-queues">
          {props.board.queues.map((q) => (
            <QueueColumn key={q.id} queue={q} timers={props.timers} now={now} />
          ))}
        </div>
      );
    case 'agenda':
      return (
        <ol className={styles.agenda} data-testid="board-agenda">
          {props.board.queues.flatMap((q) =>
            [q.current, ...q.upcoming.slice(0, config.upcoming)]
              .filter((i): i is BoardItem => i !== null)
              .map((i, n) => (
                <li key={`${q.id}:${i.id}`} data-current={n === 0 && q.current !== null}>
                  {props.board.board.presentation.showTimes && (
                    <span className="mono">
                      {formatClock(
                        i.projectedStart === null
                          ? null
                          : i.projectedStart + (n === 0 ? 0 : growth(q, now)),
                        timeZone,
                      )}
                    </span>
                  )}
                  <span>{i.title}</span>
                  {i.subtitle && <span className={styles.titleSub}>{i.subtitle}</span>}
                </li>
              )),
          )}
        </ol>
      );
  }
}

function TimerDigits(props: {
  timer: TimerSnapshot;
  queue: BoardQueue;
  now: number;
  size: string;
}) {
  const view = deriveTimer(props.timer, props.now);
  const phase = timerPhase(view, props.queue.warning);
  const label =
    props.timer.status === 'paused'
      ? 'PAUSED'
      : props.timer.status === 'stopped'
        ? 'STOPPED'
        : null;
  return (
    <>
      <div
        className={`${styles.digits} mono`}
        data-size={props.size}
        style={{ color: timerDigitColor(phase) }}
        data-testid="board-timer"
        data-status={props.timer.status}
        data-revision={props.timer.revision}
        data-phase={phase}
      >
        {formatTimer(view)}
      </div>
      <div className={styles.state}>
        {label && <span data-testid="board-state-label">{label}</span>}
        {phase === 'overtime' && (
          <span style={{ color: colorVar('state-critical') }}>OVERTIME</span>
        )}
      </div>
    </>
  );
}

function QueueColumn(props: {
  queue: BoardQueue;
  timers: Readonly<Record<string, TimerSnapshot>>;
  now: number;
}) {
  const { queue, now } = props;
  const timer = queue.current ? props.timers[queue.current.id] : undefined;
  const view = timer ? deriveTimer(timer, now) : null;
  const phase = view ? timerPhase(view, queue.warning) : 'normal';
  return (
    <section className={styles.column} data-testid="board-queue" data-queue={queue.name}>
      <header className={styles.columnHead}>
        <span className="label">{queue.name}</span>
        {queue.locked && (
          <span className={styles.locked}>
            <LockIcon /> LOCKED
          </span>
        )}
      </header>
      <strong className={styles.columnTitle} data-testid="board-queue-current">
        {queue.current?.title ?? (queue.standBy ? 'STAND BY' : '—')}
      </strong>
      {timer && view ? (
        <div className={styles.columnTimer}>
          <span
            className="mono"
            style={{ color: timerDigitColor(phase) }}
            data-testid="board-queue-timer"
            data-status={timer.status}
          >
            {formatTimer(view)}
          </span>
          <Chip spec={timerStatusChip(timer.status)} />
        </div>
      ) : null}
      <span className={styles.columnNext}>
        <span className="label">Next</span> {queue.next?.title ?? '—'}
      </span>
      {queue.suggestion && (
        <span className={styles.suggestion} data-testid="board-queue-suggestion">
          Suggested: {queue.suggestion.targetTitle} ({queue.suggestion.sourceQueueName})
        </span>
      )}
    </section>
  );
}
