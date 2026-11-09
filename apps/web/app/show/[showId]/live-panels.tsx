'use client';

import type {
  AudienceDto,
  QueueSnapshot,
  ShowStateSnapshot,
  TimerSnapshot,
} from '@klockr/contracts';
import { deriveTimer } from '@klockr/domain';
import { formatTimer } from '@klockr/ui';
import { useState } from 'react';
import type { QueueCommandBody } from '../../../lib/api';
import styles from './show.module.css';

/** Peer Queue selector. Primary is marked ★; running timers and pending suggestions are flagged. */
export function QueueTabs(props: {
  state: ShowStateSnapshot;
  selected: string;
  timers: Readonly<Record<string, TimerSnapshot>>;
  onSelect: (queueId: string) => void;
}) {
  const { state } = props;
  if (state.queues.length < 2) return null;
  return (
    <nav className={styles.queueTabs} aria-label="Queues" data-testid="queue-tabs">
      {state.queues.map((q) => {
        const running = q.items.some((i) => {
          const t = props.timers[i.id];
          return t?.status === 'running' || t?.status === 'paused';
        });
        const suggestion = state.suggestions.some((s) => s.targetQueueId === q.id);
        return (
          <button
            key={q.id}
            type="button"
            className={styles.queueTab}
            aria-pressed={q.id === props.selected}
            data-testid="queue-tab"
            data-queue={q.name}
            onClick={() => {
              props.onSelect(q.id);
            }}
          >
            {q.isPrimary && (
              <span aria-label="Primary" title="Primary Queue">
                ★
              </span>
            )}
            <span>{q.name}</span>
            {running && <span className={styles.runningDot} aria-label="running timer" />}
            {suggestion && (
              <span className={styles.suggestionBadge} aria-label="pending suggestion">
                SUGGESTED
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Suggested follow into the selected Queue: clear but calm. GO makes the suggested item Current
 * (no timer starts by itself); IGNORE keeps Current. Nothing happens without the operator.
 */
export function SuggestionBanner(props: {
  state: ShowStateSnapshot;
  queue: QueueSnapshot;
  disabled: boolean;
  onCommand: (body: QueueCommandBody) => void;
}) {
  const suggestion = props.state.suggestions.find((s) => s.targetQueueId === props.queue.id);
  if (!suggestion) return null;
  const source = props.state.queues.find((q) => q.id === suggestion.sourceQueueId);
  const sourceItem = source?.items.find((i) => i.id === suggestion.sourceItemId);
  const target = props.queue.items.find((i) => i.id === suggestion.targetItemId);
  return (
    <div className={styles.suggestionBanner} role="status" data-testid="suggestion-banner">
      <span className="label">
        {source?.name ?? 'Queue'} advanced{sourceItem ? ` → ${sourceItem.title}` : ''}
      </span>
      <span>
        Suggested: <strong data-testid="suggestion-target">{target?.title ?? '—'}</strong>
      </span>
      <div className={styles.buttons}>
        <button
          type="button"
          className={`${styles.button} ${styles.goButton}`}
          disabled={props.disabled}
          onClick={() => {
            props.onCommand({
              type: 'suggestion.accept',
              payload: { suggestionId: suggestion.id },
            });
          }}
        >
          GO
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={props.disabled}
          onClick={() => {
            props.onCommand({
              type: 'suggestion.ignore',
              payload: { suggestionId: suggestion.id },
            });
          }}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

/** Running timers of OTHER Queues (multiple timers can run at once). */
export function OtherRunningTimers(props: {
  state: ShowStateSnapshot;
  selected: string;
  timers: Readonly<Record<string, TimerSnapshot>>;
  now: number;
}) {
  const running = props.state.queues
    .filter((q) => q.id !== props.selected)
    .flatMap((q) =>
      q.items.flatMap((i) => {
        const t = props.timers[i.id];
        return t && (t.status === 'running' || t.status === 'paused') ? [{ q, i, t }] : [];
      }),
    );
  if (running.length === 0) return null;
  return (
    <section className={styles.panel} aria-label="Other running timers" data-testid="other-running">
      <span className="label">Running in other Queues</span>
      <ul className={styles.list}>
        {running.map(({ q, i, t }) => (
          <li key={i.id} className={styles.row} data-testid="other-running-row">
            <span className={styles.rowIndex} />
            <span className={styles.rowMain}>
              <span className={styles.rowTitle}>{i.title}</span>
              <span className={styles.rowSub}>{q.name}</span>
            </span>
            <span className="mono">{formatTimer(deriveTimer(t, props.now))}</span>
            <span className={styles.tag} data-kind="running">
              {t.status === 'running' ? 'RUNNING' : 'PAUSED'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PRESETS = ['WRAP UP', 'STOP', '5 MIN', 'THANK YOU'] as const;
const AUDIENCES: readonly AudienceDto[] = [
  'stage',
  'production',
  'backstage',
  'public',
  'broadcast',
];

/**
 * Ad-hoc Messages (NOT Queue Items): send to audiences, optional expiry; active ones can be
 * cleared. Presets are only UI shortcuts.
 */
export function MessagePanel(props: {
  state: ShowStateSnapshot;
  now: number;
  disabled: boolean;
  onCommand: (body: QueueCommandBody) => void;
}) {
  const [text, setText] = useState('');
  const [audiences, setAudiences] = useState<readonly AudienceDto[]>(['stage']);
  const [ttl, setTtl] = useState('0');
  const [urgent, setUrgent] = useState(true);
  const active = props.state.messages.filter(
    (m) => m.expiresAt === null || props.now < m.expiresAt,
  );
  const send = (value: string) => {
    if (!value.trim() || audiences.length === 0) return;
    props.onCommand({
      type: 'message.send',
      payload: {
        text: value.trim(),
        audiences: [...audiences],
        priority: urgent ? 'urgent' : 'normal',
        ttlMs: ttl === '0' ? null : Number(ttl) * 1000,
      },
    });
    setText('');
  };
  return (
    <section className={styles.panel} aria-label="Messages" data-testid="message-panel">
      <span className="label">Messages to boards</span>
      <div className={styles.buttons}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.button} ${styles.small}`}
            disabled={props.disabled || audiences.length === 0}
            onClick={() => {
              send(p);
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <form
        className={styles.messageForm}
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          className={styles.input}
          value={text}
          maxLength={120}
          placeholder="Custom message"
          aria-label="Message text"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <button
          type="submit"
          className={styles.button}
          disabled={props.disabled || !text.trim() || audiences.length === 0}
        >
          Send
        </button>
      </form>
      <fieldset className={styles.audiences}>
        <legend className="label">Audiences</legend>
        {AUDIENCES.map((a) => (
          <label key={a} className={styles.checkbox}>
            <input
              type="checkbox"
              checked={audiences.includes(a)}
              aria-label={`Audience ${a}`}
              onChange={(e) => {
                setAudiences((prev) =>
                  e.target.checked ? [...prev, a] : prev.filter((x) => x !== a),
                );
              }}
            />
            {a}
          </label>
        ))}
      </fieldset>
      <div className={styles.buttons}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={urgent}
            onChange={(e) => {
              setUrgent(e.target.checked);
            }}
          />
          Urgent
        </label>
        <select
          className={styles.input}
          value={ttl}
          aria-label="Expires after"
          onChange={(e) => {
            setTtl(e.target.value);
          }}
        >
          <option value="0">Until cleared</option>
          <option value="30">30 s</option>
          <option value="60">1 min</option>
          <option value="300">5 min</option>
        </select>
      </div>
      {active.length > 0 && (
        <ul className={styles.list}>
          {active.map((m) => (
            <li key={m.id} className={styles.row} data-testid="active-message">
              <span className={styles.rowIndex}>{m.priority === 'urgent' ? '!' : ''}</span>
              <span className={styles.rowTitle}>{m.text}</span>
              <span className={styles.rowSub}>{m.audiences.join(', ')}</span>
              <button
                type="button"
                className={`${styles.button} ${styles.small}`}
                disabled={props.disabled}
                aria-label={`Clear message ${m.text}`}
                onClick={() => {
                  props.onCommand({ type: 'message.clear', payload: { messageId: m.id } });
                }}
              >
                Clear
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
