'use client';

import { useEffect, useState } from 'react';
import { BoardView } from '../../../components/board/BoardView';
import { useBoardRealtime } from '../../../lib/use-realtime';
import { useServerNow } from '../../../lib/use-server-now';
import styles from './board.module.css';

/**
 * Read-only Board display. Renders the Board's scoped projection (its sources, its audience, its
 * components) with the shared constrained renderer. Timers run locally from the last
 * authoritative state; a brief disconnect never blanks the display — only a subtle RECONNECTING
 * marker appears, and messages still expire locally.
 */
export function SpeakerBoard({ token }: { token: string }) {
  const rt = useBoardRealtime(token);
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
  if (!rt.board) {
    return (
      <main className={styles.board} aria-busy>
        <p className={styles.message}>Connecting…</p>
      </main>
    );
  }

  return (
    <>
      <BoardView
        board={rt.board}
        timers={rt.timers}
        now={now}
        reconnecting={rt.status !== 'connected'}
      />
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
    </>
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
