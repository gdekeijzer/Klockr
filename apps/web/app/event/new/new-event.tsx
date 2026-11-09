'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, createEvent } from '../../../lib/api';
import styles from '../../home.module.css';

/**
 * Optional: plan an Event (multiple Rooms / Areas and Shows). A Quick Timer never needs one.
 * Dates are entered in this browser's local time; the Event keeps one IANA timezone.
 */
export function NewEvent() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await createEvent({
        name: name.trim(),
        timeZone,
        startsAt: startsAt ? new Date(startsAt).getTime() : null,
        endsAt: endsAt ? new Date(endsAt).getTime() : null,
      });
      router.push(`/event/${created.eventId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the Event');
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.brand}>KLOCKR</div>
      <form
        className={styles.card}
        aria-labelledby="new-event"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h1 id="new-event" className={styles.title}>
          Plan an Event
        </h1>
        <p className={styles.lead}>
          Group Shows into Rooms / Areas with one dashboard. Optional — a Quick Timer works without
          it.
        </p>
        <label className="label" htmlFor="event-name">
          Event name
        </label>
        <input
          id="event-name"
          className={styles.input}
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <label className="label" htmlFor="event-start">
          Starts
        </label>
        <input
          id="event-start"
          type="datetime-local"
          className={styles.input}
          value={startsAt}
          onChange={(e) => {
            setStartsAt(e.target.value);
          }}
        />
        <label className="label" htmlFor="event-end">
          Ends
        </label>
        <input
          id="event-end"
          type="datetime-local"
          className={styles.input}
          value={endsAt}
          onChange={(e) => {
            setEndsAt(e.target.value);
          }}
        />
        <label className="label" htmlFor="event-tz">
          Timezone
        </label>
        <input
          id="event-tz"
          className={`${styles.input} mono`}
          value={timeZone}
          onChange={(e) => {
            setTimeZone(e.target.value);
          }}
        />
        <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>
          Create Event
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <p className={styles.note}>
          <Link href="/">Back to Quick Timer</Link>
        </p>
      </form>
    </main>
  );
}
