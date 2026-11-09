'use client';

import { formatDuration } from '@klockr/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, createQuickTimer } from '../lib/api';
import { parseDurationInput } from '../lib/duration-input';
import { rememberBoardToken } from '../lib/storage';
import styles from './home.module.css';

const PRESET_MINUTES = [1, 5, 10, 15, 20, 30, 45, 60];

/** Quick Timer critical path: choose duration -> create -> Operator. No account, no Event. */
export function NewQuickTimer() {
  const router = useRouter();
  const [input, setInput] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const durationMs = parseDurationInput(input);

  async function create() {
    if (durationMs === null) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createQuickTimer(durationMs);
      rememberBoardToken(created.showId, created.boardShareToken);
      router.push(`/show/${created.showId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the timer');
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.brand}>KLOCKR</div>
      <section className={styles.card} aria-labelledby="new-timer">
        <h1 id="new-timer" className={styles.title}>
          New Quick Timer
        </h1>
        <p className={styles.lead}>Set a duration and start. No account needed.</p>

        <div className={styles.presets} role="group" aria-label="Duration presets">
          {PRESET_MINUTES.map((m) => {
            const value = formatDuration(m * 60_000);
            return (
              <button
                key={m}
                type="button"
                className={styles.preset}
                aria-pressed={input === value}
                onClick={() => {
                  setInput(value);
                }}
              >
                {m} min
              </button>
            );
          })}
        </div>

        <label className="label" htmlFor="duration">
          Duration (mm:ss)
        </label>
        <input
          id="duration"
          className={`${styles.input} mono`}
          value={input}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={durationMs === null}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />

        <button
          type="button"
          className={styles.primary}
          disabled={busy || durationMs === null}
          onClick={() => void create()}
        >
          {busy ? 'Creating…' : 'Create Quick Timer'}
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <p className={styles.note}>
          Anonymous timers are kept for 7 days. Only this browser can control it.
        </p>
      </section>
      <p className={styles.note}>
        Running several rooms or stages?{' '}
        <Link href="/event/new" data-testid="plan-event">
          Plan an Event
        </Link>
        {' · '}
        <Link href="/device">Set up a display Device</Link>
      </p>
    </main>
  );
}
