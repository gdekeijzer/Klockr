'use client';

import type { QueueItemSnapshot, QueueSnapshot, TimerSnapshot } from '@klockr/contracts';
import { deriveTimer, timerPhase } from '@klockr/domain';
import {
  colorVar,
  formatClock,
  formatDuration,
  formatSpan,
  formatThresholds,
  formatTimer,
  remainingFraction,
  thresholdSourceLabel,
  timerDigitColor,
  timerPhaseChip,
  timerStatusChip,
} from '@klockr/ui';
import type { ItemSchedule } from '@klockr/domain';
import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Chip } from '../../../components/Chip';
import { ProgressBar } from '../../../components/ProgressBar';
import { ScheduleBar } from '../../../components/ScheduleBar';
import { useShowSchedule } from '../../../lib/use-schedule';
import { MessagePanel, OtherRunningTimers, QueueTabs, SuggestionBanner } from './live-panels';
import {
  ApiError,
  createBoardShare,
  sendQueueCommand,
  sendTimerCommand,
  type QueueCommandBody,
} from '../../../lib/api';
import { parseDurationInput } from '../../../lib/duration-input';
import { recallBoardToken, rememberBoardToken } from '../../../lib/storage';
import { useShowRealtime } from '../../../lib/use-realtime';
import { useServerNow } from '../../../lib/use-server-now';
import { ShowFrame } from './show-frame';
import styles from './show.module.css';

type TimerAction =
  | { type: 'timer.start' | 'timer.pause' | 'timer.resume' | 'timer.stop' }
  | { type: 'timer.adjust'; deltaMs: number }
  | { type: 'timer.configure'; durationMs: number };

const ADJUSTMENTS = [-30_000, -10_000, 10_000, 30_000];

const noSubscription = () => () => undefined;

/**
 * Operator View: operate, not administer (FUNCTIONAL_DESIGN §24). Current item large with its
 * timer and transport, END / END + NEXT as separate show control, Next and a compact Queue
 * preview. Every value is a projection of the last authoritative state; controls only send
 * commands, and the UI changes when the server confirms — never optimistically.
 */
export function OperatorView({ showId }: { showId: string }) {
  const rt = useShowRealtime(showId);
  const now = useServerNow(rt.offsetMs);
  const showSchedule = useShowSchedule(rt.state, rt.timers, now);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = rt.status === 'connected';
  // Default operating context: the Primary Queue. Every peer Queue has its own Current/Next.
  const queue =
    rt.state?.queues.find((q) => q.id === selectedQueue) ??
    rt.state?.queues.find((q) => q.isPrimary) ??
    null;
  const schedule = queue ? (showSchedule?.forQueue(queue.id) ?? null) : null;

  async function act(label: string, run: () => Promise<void>) {
    if (!live) return;
    setPending(label);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(`Not applied: ${e instanceof ApiError ? e.message : 'unknown error'}`);
    } finally {
      setPending(null);
    }
  }

  const timerAction = (queueItemId: string, action: TimerAction) =>
    act(action.type, async () => {
      const payload = { queueItemId };
      const timer = await sendTimerCommand(
        showId,
        action.type === 'timer.adjust'
          ? { type: 'timer.adjust', payload: { ...payload, deltaMs: action.deltaMs } }
          : action.type === 'timer.configure'
            ? {
                type: 'timer.configure',
                payload: { ...payload, mode: 'countdown', durationMs: action.durationMs },
              }
            : { type: action.type, payload },
      );
      rt.applyTimer(timer);
    });

  const queueAction = (body: QueueCommandBody) =>
    act(body.type, async () => {
      const result = await sendQueueCommand(showId, body);
      rt.applyState(result.state);
    });

  const current = queue?.items.find((i) => i.id === queue.currentItemId) ?? null;
  const next = queue?.items.find((i) => i.id === queue.nextItemId) ?? null;
  const currentTimer = current ? (rt.timers[current.id] ?? null) : null;
  const disabled = !live || pending !== null;

  return (
    <ShowFrame showId={showId} view="operator" rt={rt} now={now}>
      {queue && schedule && <ScheduleBar queue={queue} schedule={schedule} />}
      {rt.state && queue && (
        <QueueTabs
          state={rt.state}
          selected={queue.id}
          timers={rt.timers}
          onSelect={setSelectedQueue}
        />
      )}
      {rt.state && queue && (
        <SuggestionBanner
          state={rt.state}
          queue={queue}
          disabled={disabled}
          onCommand={(body) => void queueAction(body)}
        />
      )}
      <main className={styles.grid}>
        <div className={styles.column}>
          {queue ? (
            <CurrentPanel
              item={current}
              timer={currentTimer}
              now={now}
              plan={
                current ? schedule?.projection.items.find((i) => i.id === current.id) : undefined
              }
              timeZone={queue.showSchedule.timeZone}
            />
          ) : (
            <section className={styles.panel} aria-busy>
              <span className="label">Current</span>
              <p className={styles.muted}>Loading Show State…</p>
            </section>
          )}
          {queue && (
            <Controls
              current={current}
              timer={currentTimer}
              next={next}
              disabled={disabled}
              pending={pending}
              error={error}
              onTimer={(action) => {
                if (current) void timerAction(current.id, action);
              }}
              onQueue={(body) => void queueAction(body)}
            />
          )}
        </div>

        <aside className={styles.side}>
          {queue && (
            <NextPanel
              item={next}
              plan={next ? schedule?.projection.items.find((i) => i.id === next.id) : undefined}
              timeZone={queue.showSchedule.timeZone}
            />
          )}
          {queue && (
            <QueuePreview
              queue={queue}
              timers={rt.timers}
              showId={showId}
              disabled={disabled}
              onQueue={(body) => void queueAction(body)}
              onStopTimer={(id) => void timerAction(id, { type: 'timer.stop' })}
            />
          )}
          {rt.state && queue && (
            <OtherRunningTimers state={rt.state} selected={queue.id} timers={rt.timers} now={now} />
          )}
          {rt.state && (
            <MessagePanel
              state={rt.state}
              now={now}
              disabled={disabled}
              onCommand={(body) => void queueAction(body)}
            />
          )}
          <SharePanel showId={showId} disabled={!live} />
          {rt.show && (
            <section className={styles.panel}>
              <span className="label">Anonymous show</span>
              <p className={styles.muted}>
                Kept until {new Date(rt.show.expiresAt).toLocaleDateString()} (7 days). Only this
                browser can control it.
              </p>
            </section>
          )}
        </aside>
      </main>
    </ShowFrame>
  );
}

function ThresholdLine({ item }: { item: QueueItemSnapshot }) {
  const { rule, source } = item.effectiveWarning;
  return (
    <div className={styles.thresholds} data-testid="current-thresholds">
      <span>{formatThresholds(rule)}</span>
      <span className={styles.source} data-override={source !== 'show'}>
        {thresholdSourceLabel(source)}
      </span>
    </div>
  );
}

/** Planned / Projected / Actual in one compact line set (only when there is a plan or actual). */
function ScheduleFacts(props: { plan: ItemSchedule | undefined; timeZone: string }) {
  const { plan, timeZone } = props;
  if (!plan || (plan.plannedStart === null && plan.actualStart === null)) return null;
  return (
    <dl className={styles.facts} data-testid="current-schedule">
      <div>
        <dt className="label">Planned</dt>
        <dd className="mono">
          {formatClock(plan.plannedStart, timeZone)}–{formatClock(plan.plannedEnd, timeZone)}
        </dd>
      </div>
      <div>
        <dt className="label">Actual start</dt>
        <dd className="mono" data-testid="current-actual-start">
          {formatClock(plan.actualStart, timeZone, true)}
        </dd>
      </div>
      <div>
        <dt className="label">Projected end</dt>
        <dd className="mono" data-testid="current-projected-end">
          {formatClock(plan.projectedEnd, timeZone)}
        </dd>
      </div>
    </dl>
  );
}

function CurrentPanel(props: {
  item: QueueItemSnapshot | null;
  timer: TimerSnapshot | null;
  now: number;
  plan: ItemSchedule | undefined;
  timeZone: string;
}) {
  const { item, timer, now } = props;
  if (!item) {
    return (
      <section className={styles.panel} aria-label="Current item" data-testid="current-panel">
        <span className="label">Current</span>
        <p className={styles.currentTitle} data-testid="current-title">
          —
        </p>
        <p className={styles.muted}>No item is current. Make the next item current to continue.</p>
      </section>
    );
  }

  const view = timer ? deriveTimer(timer, now) : null;
  const phase = view ? timerPhase(view, item.effectiveWarning.rule) : 'normal';
  const phaseChip = timerPhaseChip(phase);
  return (
    <section
      className={`${styles.panel} ${styles.timerPanel}`}
      aria-label="Current item"
      data-testid="current-panel"
    >
      <div className={styles.timerTop}>
        <span className="label">Current</span>
        <div className={styles.chips}>
          {item.completedAt !== null && (
            <Chip spec={{ label: 'ENDED', variant: 'neutral' }} testId="current-ended" />
          )}
          {phaseChip && <Chip spec={phaseChip} testId="timer-phase" />}
          {timer && <Chip spec={timerStatusChip(timer.status)} testId="timer-status" />}
        </div>
      </div>
      <div>
        <h1 className={styles.currentTitle} data-testid="current-title">
          {item.title}
        </h1>
        {item.subtitle && <p className={styles.subtitle}>{item.subtitle}</p>}
      </div>

      {timer && view ? (
        <>
          <div
            className={`${styles.digits} mono`}
            style={{ color: timerDigitColor(phase) }}
            data-testid="operator-timer"
            data-phase={phase}
            aria-live="off"
          >
            {formatTimer(view)}
          </div>
          <ProgressBar
            fraction={remainingFraction(view, timer.durationMs + timer.adjustmentMs)}
            color={colorVar('accent-blue')}
          />
          <dl className={styles.facts}>
            <div>
              <dt className="label">Elapsed</dt>
              <dd className="mono">{formatDuration(view.elapsedMs)}</dd>
            </div>
            <div>
              <dt className="label">Target</dt>
              <dd className="mono">{formatDuration(timer.durationMs)}</dd>
            </div>
            <div>
              <dt className="label">Adjustment</dt>
              <dd className="mono" data-testid="adjustment">
                {timer.adjustmentMs === 0
                  ? '±00:00'
                  : `${timer.adjustmentMs > 0 ? '+' : '−'}${formatDuration(Math.abs(timer.adjustmentMs))}`}
              </dd>
            </div>
          </dl>
          <ThresholdLine item={item} />
          <ScheduleFacts plan={props.plan} timeZone={props.timeZone} />
        </>
      ) : (
        <div className={styles.noTimer} data-testid="current-no-timer">
          No timer
        </div>
      )}
      {item.notes && (
        <p className={styles.notes} data-testid="current-notes">
          {item.notes}
        </p>
      )}
    </section>
  );
}

function Controls(props: {
  current: QueueItemSnapshot | null;
  timer: TimerSnapshot | null;
  next: QueueItemSnapshot | null;
  disabled: boolean;
  pending: string | null;
  error: string | null;
  onTimer: (action: TimerAction) => void;
  onQueue: (body: QueueCommandBody) => void;
}) {
  const { current, timer, next, disabled, onTimer, onQueue } = props;
  const status = timer?.status ?? null;
  const primary =
    status === 'running'
      ? { type: 'timer.pause' as const, label: 'Pause' }
      : status === 'paused'
        ? { type: 'timer.resume' as const, label: 'Resume' }
        : status === 'stopped'
          ? // START on a stopped timer restarts from the full duration: label it RESTART.
            { type: 'timer.start' as const, label: 'Restart' }
          : { type: 'timer.start' as const, label: 'Start' };
  const canStop = status === 'running' || status === 'paused';
  const canAdjust = status === 'idle' || status === 'running' || status === 'paused';
  const canConfigure = status === 'idle' || status === 'stopped';
  const autoStart = next?.startMode === 'on_previous_end' && next.timer !== null;

  return (
    <section className={`${styles.panel} ${styles.controls}`} aria-label="Controls">
      {timer && (
        <>
          <div className={styles.transport}>
            <span className="label">Timer</span>
            <div className={styles.buttons}>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                data-kind={primary.type}
                disabled={disabled}
                onClick={() => {
                  onTimer({ type: primary.type });
                }}
              >
                {primary.label}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={disabled || !canStop}
                title="Stop this timer only. The item stays current; nothing else happens."
                onClick={() => {
                  onTimer({ type: 'timer.stop' });
                }}
              >
                ■ Stop timer
              </button>
            </div>
          </div>
          <div className={styles.adjust}>
            <span className="label">Adjust time</span>
            <div className={styles.buttons}>
              {ADJUSTMENTS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.button} mono`}
                  disabled={disabled || !canAdjust}
                  aria-label={`${d > 0 ? 'Add' : 'Remove'} ${String(Math.abs(d) / 1000)} seconds`}
                  onClick={() => {
                    onTimer({ type: 'timer.adjust', deltaMs: d });
                  }}
                >
                  {d > 0 ? '+' : '−'}
                  {String(Math.abs(d) / 1000)}s
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className={styles.itemControls}>
        <span className="label">Item</span>
        <div className={styles.buttons}>
          {current ? (
            <>
              <button
                type="button"
                className={`${styles.button} ${styles.primary} ${styles.end}`}
                disabled={disabled}
                title="END: mark this item completed (stops a running timer). It stays current."
                onClick={() => {
                  onQueue({ type: 'item.end', payload: { queueItemId: current.id, next: false } });
                }}
              >
                End
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.primary} ${styles.endNext}`}
                disabled={disabled}
                aria-label="End + Next"
                title={
                  autoStart
                    ? 'END this item, make the next item current and START its timer (its start mode).'
                    : 'END this item and make the next item current. Its timer does not start.'
                }
                onClick={() => {
                  onQueue({ type: 'item.end', payload: { queueItemId: current.id, next: true } });
                }}
              >
                End + Next
                <small data-testid="end-next-hint">
                  {next ? `→ ${next.title}${autoStart ? ' · starts timer' : ''}` : '→ end of queue'}
                </small>
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${styles.button} ${styles.primary} ${styles.endNext}`}
              disabled={disabled || !next}
              onClick={() => {
                if (next) onQueue({ type: 'queue.setCurrent', payload: { queueItemId: next.id } });
              }}
            >
              Make next current
            </button>
          )}
        </div>
      </div>

      {timer && canConfigure && (
        <DurationForm
          key={`${timer.queueItemId}:${String(timer.durationMs)}`}
          disabled={disabled}
          durationMs={timer.durationMs}
          onSubmit={(ms) => {
            onTimer({ type: 'timer.configure', durationMs: ms });
          }}
        />
      )}
      {props.pending && <p className={styles.muted}>Waiting for server confirmation…</p>}
      {props.error && (
        <p role="alert" className={styles.error}>
          {props.error}
        </p>
      )}
    </section>
  );
}

function DurationForm(props: {
  durationMs: number;
  disabled: boolean;
  onSubmit: (ms: number) => void;
}) {
  const [text, setText] = useState(() => formatDuration(props.durationMs));
  const ms = parseDurationInput(text);
  return (
    <form
      className={styles.duration}
      onSubmit={(e) => {
        e.preventDefault();
        if (ms !== null) props.onSubmit(ms);
      }}
    >
      <label className="label" htmlFor="set-duration">
        Duration
      </label>
      <input
        id="set-duration"
        className={`${styles.input} mono`}
        value={text}
        aria-invalid={ms === null}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <button type="submit" className={styles.button} disabled={props.disabled || ms === null}>
        Set duration
      </button>
    </form>
  );
}

function NextPanel({
  item,
  plan,
  timeZone,
}: {
  item: QueueItemSnapshot | null;
  plan: ItemSchedule | undefined;
  timeZone: string;
}) {
  return (
    <section className={styles.panel} aria-label="Next item" data-testid="next-panel">
      <div className={styles.panelHead}>
        <span className="label">Next</span>
        {item?.startMode === 'on_previous_end' && item.timer && (
          <Chip spec={{ label: 'AUTO-START', variant: 'info' }} testId="next-autostart" />
        )}
      </div>
      {item ? (
        <>
          <p className={styles.nextTitle} data-testid="next-title">
            {item.title}
          </p>
          {item.subtitle && <p className={styles.subtitle}>{item.subtitle}</p>}
          <span className="mono">
            {item.timer ? formatDuration(item.timer.durationMs) : 'No timer'}
            {plan?.plannedStart !== null && plan?.plannedStart !== undefined && (
              <span data-testid="next-schedule">
                {' · planned '}
                {formatClock(plan.plannedStart, timeZone)}
                {' · projected '}
                {formatClock(plan.projectedStart, timeZone)}
              </span>
            )}
          </span>
          {plan?.shouldHaveStartedMs !== null && plan?.shouldHaveStartedMs !== undefined && (
            <Chip
              spec={{
                label: `SHOULD HAVE STARTED ${formatSpan(plan.shouldHaveStartedMs)} AGO`,
                variant: 'warning',
              }}
              testId="next-should-have-started"
            />
          )}
          {item.notes && <p className={styles.notes}>{item.notes}</p>}
        </>
      ) : (
        <p className={styles.muted} data-testid="next-title">
          End of queue
        </p>
      )}
    </section>
  );
}

/** Compact rundown around Current: a few previous items, Current, and what comes next. */
function QueuePreview(props: {
  queue: QueueSnapshot;
  timers: Readonly<Record<string, TimerSnapshot>>;
  showId: string;
  disabled: boolean;
  onQueue: (body: QueueCommandBody) => void;
  onStopTimer: (queueItemId: string) => void;
}) {
  const { queue, timers } = props;
  const items = queue.items;
  const anchor = Math.max(
    0,
    queue.currentItemId
      ? items.findIndex((i) => i.id === queue.currentItemId)
      : items.findIndex((i) => i.id === queue.nextItemId),
  );
  const from = Math.max(0, anchor - 2);
  const visible = items.slice(from, anchor + 7);

  return (
    <section className={styles.panel} aria-label="Queue">
      <div className={styles.panelHead}>
        <span className="label">Queue</span>
        <Link className={styles.link} href={`/show/${props.showId}/master`}>
          Open Master
        </Link>
      </div>
      <ol className={styles.list} data-testid="queue-preview">
        {visible.map((item) => {
          const index = items.indexOf(item) + 1;
          const timer = timers[item.id];
          const running = timer?.status === 'running' || timer?.status === 'paused';
          const isNext = item.id === queue.nextItemId;
          return (
            <li
              key={item.id}
              className={styles.row}
              data-lifecycle={item.lifecycle}
              data-testid="queue-row"
              data-title={item.title}
            >
              <span className={`${styles.rowIndex} mono`}>{String(index).padStart(2, '0')}</span>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{item.title}</span>
                {item.timer && (
                  <span className={`${styles.rowSub} mono`}>
                    {formatDuration(item.timer.durationMs)}
                  </span>
                )}
              </span>
              <span className={styles.rowMeta}>
                {item.lifecycle === 'current' && <span className={styles.tag}>CURRENT</span>}
                {isNext && (
                  <span className={styles.tag} data-kind="next">
                    NEXT
                  </span>
                )}
                {item.lifecycle === 'completed' && <span className={styles.tag}>DONE</span>}
                {item.lifecycle === 'inactive' && <span className={styles.tag}>SKIP</span>}
                {running && item.lifecycle !== 'current' && (
                  <span className={styles.tag} data-kind="running">
                    {timer.status === 'running' ? 'RUNNING' : 'PAUSED'}
                  </span>
                )}
              </span>
              <span className={styles.rowActions}>
                {running && item.lifecycle !== 'current' && (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    disabled={props.disabled}
                    aria-label={`Stop running timer: ${item.title}`}
                    onClick={() => {
                      props.onStopTimer(item.id);
                    }}
                  >
                    ■
                  </button>
                )}
                {item.lifecycle !== 'current' && item.active && (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    disabled={props.disabled}
                    aria-label={`Make current: ${item.title}`}
                    title="Make this item current (does not start or stop any timer)"
                    onClick={() => {
                      props.onQueue({
                        type: 'queue.setCurrent',
                        payload: { queueItemId: item.id },
                      });
                    }}
                  >
                    Go to
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SharePanel({ showId, disabled }: { showId: string; disabled: boolean }) {
  // The creator's board link lives in this browser's storage (null during server render).
  const stored = useSyncExternalStore(
    noSubscription,
    () => recallBoardToken(showId),
    () => null,
  );
  const [created, setCreated] = useState<string | null>(null);
  const token = created ?? stored;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = useMemo(
    () => (token && typeof window !== 'undefined' ? `${window.location.origin}/b/${token}` : null),
    [token],
  );

  async function newLink() {
    setBusy(true);
    try {
      const share = await createBoardShare(showId);
      rememberBoardToken(showId, share.boardShareToken);
      setCreated(share.boardShareToken);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Share Speaker Board">
      <span className="label">Share Speaker Board</span>
      <p className={styles.muted}>
        Read-only link for the presenter display. It follows the current item and cannot control
        anything.
      </p>
      {url ? (
        <>
          <input
            className={`${styles.input} mono`}
            readOnly
            value={url}
            data-testid="board-link"
            aria-label="Speaker Board link"
          />
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a
              className={styles.button}
              href={url}
              target="_blank"
              rel="noreferrer"
              data-testid="open-board"
            >
              Open board
            </a>
          </div>
        </>
      ) : (
        <button
          type="button"
          className={styles.button}
          disabled={disabled || busy}
          onClick={() => void newLink()}
        >
          Create board link
        </button>
      )}
    </section>
  );
}
