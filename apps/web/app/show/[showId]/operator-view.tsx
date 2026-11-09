'use client';

import type { ShowStateSnapshot, TimerSnapshot } from '@klockr/contracts';
import { deriveTimer, timerPhase } from '@klockr/domain';
import {
  colorVar,
  formatDuration,
  formatTimer,
  remainingFraction,
  timerDigitColor,
  timerPhaseChip,
  timerStatusChip,
} from '@klockr/ui';
import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Chip } from '../../../components/Chip';
import { connectionChip } from '../../../components/connection';
import { ProgressBar } from '../../../components/ProgressBar';
import { ApiError, createBoardShare, sendTimerCommand } from '../../../lib/api';
import { parseDurationInput } from '../../../lib/duration-input';
import { recallBoardToken, rememberBoardToken } from '../../../lib/storage';
import { useRealtime } from '../../../lib/use-realtime';
import { useServerNow } from '../../../lib/use-server-now';
import styles from './operator.module.css';

type Command =
  | { type: 'timer.start' | 'timer.pause' | 'timer.resume' | 'timer.stop' }
  | { type: 'timer.adjust'; deltaMs: number }
  | { type: 'timer.configure'; durationMs: number };

const ADJUSTMENTS = [-30_000, -10_000, 10_000, 30_000];

const noSubscription = () => () => undefined;

/**
 * Focused Operator View for the Quick Timer. All timer values are projections of the last
 * authoritative snapshot via the domain's `deriveTimer`; controls only send commands and the
 * UI changes when the server confirms (HTTP response or realtime update), never optimistically.
 */
export function OperatorView({ showId }: { showId: string }) {
  const rt = useRealtime<ShowStateSnapshot>({ role: 'operator', showId }, 'show.snapshot');
  const now = useServerNow(rt.offsetMs);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function run(command: Command) {
    if (!rt.timer || !live) return;
    setPending(command.type);
    setError(null);
    try {
      const base = { payload: { queueItemId: rt.timer.queueItemId } };
      const timer = await sendTimerCommand(
        showId,
        command.type === 'timer.adjust'
          ? { type: 'timer.adjust', payload: { ...base.payload, deltaMs: command.deltaMs } }
          : command.type === 'timer.configure'
            ? {
                type: 'timer.configure',
                payload: { ...base.payload, mode: 'countdown', durationMs: command.durationMs },
              }
            : { type: command.type, ...base },
      );
      rt.applyTimer(timer);
    } catch (e) {
      setError(`Not applied: ${e instanceof ApiError ? e.message : 'unknown error'}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>KLOCKR</div>
        <div className="label">Operator view</div>
        <div className={styles.showName}>
          {rt.snapshot?.show.title ?? 'Quick Timer'}
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
          connection is restored. The timer shown continues from the last confirmed state.
        </div>
      )}

      <main className={styles.grid}>
        {rt.timer ? (
          <TimerPanel timer={rt.timer} now={now} />
        ) : (
          <section className={styles.panel} aria-busy>
            <span className="label">Current timer</span>
            <p className={styles.muted}>Loading Show State…</p>
          </section>
        )}

        <aside className={styles.side}>
          <SharePanel showId={showId} disabled={!live} />
          {rt.snapshot && (
            <section className={styles.panel}>
              <span className="label">Anonymous show</span>
              <p className={styles.muted}>
                Kept until {new Date(rt.snapshot.show.expiresAt).toLocaleDateString()} (7 days).
                Only this browser can control it.
              </p>
            </section>
          )}
        </aside>

        {rt.timer && (
          <Controls
            timer={rt.timer}
            disabled={!live || pending !== null}
            pending={pending}
            error={error}
            onCommand={(c) => void run(c)}
          />
        )}
      </main>
    </div>
  );
}

function TimerPanel({ timer, now }: { timer: TimerSnapshot; now: number }) {
  const view = deriveTimer(timer, now);
  const phase = timerPhase(view);
  const phaseChip = timerPhaseChip(phase);
  const target = timer.durationMs + timer.adjustmentMs;
  return (
    <section className={`${styles.panel} ${styles.timerPanel}`} aria-label="Current timer">
      <div className={styles.timerTop}>
        <span className="label">Current timer</span>
        <div className={styles.chips}>
          {phaseChip && <Chip spec={phaseChip} testId="timer-phase" />}
          <Chip spec={timerStatusChip(timer.status)} testId="timer-status" />
        </div>
      </div>
      <div
        className={`${styles.digits} mono`}
        style={{ color: timerDigitColor(phase) }}
        data-testid="operator-timer"
        data-phase={phase}
        aria-live="off"
      >
        {formatTimer(view)}
      </div>
      <ProgressBar fraction={remainingFraction(view, target)} color={colorVar('accent-blue')} />
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
    </section>
  );
}

function Controls(props: {
  timer: TimerSnapshot;
  disabled: boolean;
  pending: string | null;
  error: string | null;
  onCommand: (c: Command) => void;
}) {
  const { timer, disabled, onCommand } = props;
  const status = timer.status;
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

  return (
    <section className={`${styles.panel} ${styles.controls}`} aria-label="Timer controls">
      <div className={styles.transport}>
        <span className="label">Transport</span>
        <div className={styles.buttons}>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            data-kind={primary.type}
            disabled={disabled}
            onClick={() => {
              onCommand({ type: primary.type });
            }}
          >
            {primary.label}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={disabled || !canStop}
            title="Stop this timer only. Does not end the item or trigger anything else."
            onClick={() => {
              onCommand({ type: 'timer.stop' });
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
                onCommand({ type: 'timer.adjust', deltaMs: d });
              }}
            >
              {d > 0 ? '+' : '−'}
              {String(Math.abs(d) / 1000)}s
            </button>
          ))}
        </div>
      </div>
      {canConfigure && <DurationForm disabled={disabled} timer={timer} onCommand={onCommand} />}
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
  timer: TimerSnapshot;
  disabled: boolean;
  onCommand: (c: Command) => void;
}) {
  const [text, setText] = useState(() => formatDuration(props.timer.durationMs));
  const ms = parseDurationInput(text);
  return (
    <form
      className={styles.duration}
      onSubmit={(e) => {
        e.preventDefault();
        if (ms !== null) props.onCommand({ type: 'timer.configure', durationMs: ms });
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
        Read-only link for the presenter display. It cannot control the timer.
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
