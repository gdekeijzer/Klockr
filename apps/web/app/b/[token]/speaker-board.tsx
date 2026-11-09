'use client';

import type { BoardStateSnapshot } from '@klockr/contracts';
import { deriveTimer, timerPhase } from '@klockr/domain';
import { colorVar, formatTimer, remainingFraction, timerDigitColor } from '@klockr/ui';
import { useEffect, useState } from 'react';
import { ProgressBar } from '../../../components/ProgressBar';
import { useRealtime } from '../../../lib/use-realtime';
import { useServerNow } from '../../../lib/use-server-now';
import styles from './board.module.css';

/**
 * Read-only Speaker/Confidence Board. Renders the last authoritative timer locally; a brief
 * disconnect never blanks or replaces the display — only a subtle RECONNECTING marker appears.
 */
export function SpeakerBoard({ token }: { token: string }) {
  const rt = useRealtime<BoardStateSnapshot>(
    { role: 'board', boardShareToken: token },
    'board.snapshot',
  );
  const now = useServerNow(rt.offsetMs);
  useWakeLock();
  const controlsVisible = usePointerActivity();

  if (rt.denied) {
    return (
      <main className={styles.board}>
        <p className={styles.message}>This board link is not valid.</p>
      </main>
    );
  }

  // Only before the very first snapshot; never after the board has been synchronized.
  if (!rt.timer) {
    return (
      <main className={styles.board} aria-busy>
        <p className={styles.message}>Connecting…</p>
      </main>
    );
  }

  const view = deriveTimer(rt.timer, now);
  const phase = timerPhase(view);
  const target = rt.timer.durationMs + rt.timer.adjustmentMs;
  const label =
    rt.timer.status === 'paused' ? 'PAUSED' : rt.timer.status === 'stopped' ? 'STOPPED' : null;

  return (
    <main className={styles.board} data-phase={phase} data-connection={rt.status}>
      <div className={styles.topbar}>
        <span className={styles.brand}>KLOCKR</span>
        {rt.status !== 'connected' && (
          <span className={styles.reconnecting} data-testid="board-connection" role="status">
            RECONNECTING
          </span>
        )}
      </div>

      <div
        className={`${styles.digits} mono`}
        style={{ color: timerDigitColor(phase) }}
        data-testid="board-timer"
        data-status={rt.timer.status}
        data-revision={rt.timer.revision}
      >
        {formatTimer(view)}
      </div>
      <div className={styles.state}>
        {label && <span data-testid="board-state-label">{label}</span>}
        {phase === 'overtime' && (
          <span style={{ color: colorVar('state-critical') }}>OVERTIME</span>
        )}
      </div>

      <div className={styles.progress}>
        <ProgressBar
          fraction={remainingFraction(view, target)}
          color={phase === 'normal' ? colorVar('text-secondary') : timerDigitColor(phase)}
        />
      </div>

      <button
        type="button"
        className={styles.fullscreen}
        data-visible={controlsVisible}
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
        }}
      >
        Fullscreen
      </button>
    </main>
  );
}

/** Keep a display awake while the board is open (where supported). */
function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      navigator.wakeLock.request('screen').then(
        (l) => {
          lock = l;
        },
        () => undefined,
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, []);
}

/** Show the fullscreen control only briefly after pointer movement, to keep the board clean. */
function usePointerActivity(hideAfterMs = 2_500): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setVisible(false);
      }, hideAfterMs);
    };
    window.addEventListener('pointermove', show);
    return () => {
      window.removeEventListener('pointermove', show);
      clearTimeout(timer);
    };
  }, [hideAfterMs]);
  return visible;
}
