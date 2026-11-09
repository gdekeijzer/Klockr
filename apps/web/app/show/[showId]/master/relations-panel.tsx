'use client';

import type {
  AudienceDto,
  QueueItemSnapshot,
  QueueSnapshot,
  ShowStateSnapshot,
} from '@klockr/contracts';
import type { ShowScheduleProjection } from '@klockr/domain';
import { formatClock, formatOffset } from '@klockr/ui';
import { useState } from 'react';
import type { QueueCommandBody } from '../../../../lib/api';
import styles from '../show.module.css';
import editor from './editor.module.css';

type Run = (body: QueueCommandBody) => void;

const AUDIENCES: readonly AudienceDto[] = [
  'stage',
  'production',
  'backstage',
  'public',
  'broadcast',
];

/** Parse a signed offset like "-00:30", "+1:00", "45" (seconds). */
export function parseOffset(text: string): number | null {
  const t = text.trim();
  const m = /^([+-])?(\d{1,3})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const ms = m[3] === undefined ? Number(m[2]) * 1000 : (Number(m[2]) * 60 + Number(m[3])) * 1000;
  return sign * ms;
}

/**
 * Cross-Queue relations of the selected item: marker list (direction, other Queue, offset,
 * preserve, conflict), add / adjust / break. A relation is never ownership.
 */
export function RelationsSection(props: {
  item: QueueItemSnapshot;
  state: ShowStateSnapshot;
  projection: ShowScheduleProjection | undefined;
  disabled: boolean;
  onCommand: Run;
}) {
  const { item, state, disabled, onCommand } = props;
  const tz = state.queues[0]?.showSchedule.timeZone ?? 'UTC';
  const queueOf = (itemId: string) =>
    state.queues.find((q) => q.items.some((i) => i.id === itemId));
  const itemOf = (itemId: string) => queueOf(itemId)?.items.find((i) => i.id === itemId);
  const own = queueOf(item.id);
  const related = state.relations.filter(
    (r) => r.sourceItemId === item.id || r.targetItemId === item.id,
  );
  const candidates = state.queues
    .filter((q) => q.id !== own?.id)
    .flatMap((q) => q.items.map((i) => ({ q, i })));
  const [target, setTarget] = useState(candidates[0]?.i.id ?? '');
  const [offset, setOffset] = useState('00:00');
  const [preserve, setPreserve] = useState(true);
  const offsetMs = parseOffset(offset);

  return (
    <div className={editor.section} data-testid="relations-section">
      <span className="label">Related across Queues</span>
      {related.length === 0 && <p className={styles.muted}>No relations.</p>}
      <ul className={styles.list}>
        {related.map((r) => {
          const outgoing = r.sourceItemId === item.id;
          const otherId = outgoing ? r.targetItemId : r.sourceItemId;
          const other = itemOf(otherId);
          const conflict =
            props.projection?.relations.find((x) => x.relationId === r.id)?.conflict ?? false;
          const desired =
            props.projection?.relations.find((x) => x.relationId === r.id)?.desiredStart ?? null;
          return (
            <li
              key={r.id}
              className={styles.row}
              data-testid="relation-row"
              data-conflict={conflict}
            >
              <span className={styles.rowIndex}>{outgoing ? '→' : '←'}</span>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {queueOf(otherId)?.name}: {other?.title}
                </span>
                <span className={`${styles.rowSub} mono`}>
                  {formatOffset(r.offsetMs)} {r.preserveOffset ? 'preserve offset' : 'marker only'}
                  {desired !== null && ` · linked ${formatClock(desired, tz)}`}
                </span>
              </span>
              <span className={styles.rowMeta}>
                {conflict && (
                  <span
                    className={styles.tag}
                    data-testid="relation-conflict"
                    style={{ color: 'var(--k-state-warning)' }}
                  >
                    CONFLICT
                  </span>
                )}
              </span>
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.small}`}
                  disabled={disabled}
                  aria-label={`Break relation with ${other?.title ?? ''}`}
                  onClick={() => {
                    onCommand({ type: 'relation.delete', payload: { relationId: r.id } });
                  }}
                >
                  Break
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {candidates.length > 0 && (
        <form
          className={editor.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!target || offsetMs === null) return;
            onCommand({
              type: 'relation.create',
              payload: {
                sourceItemId: item.id,
                targetItemId: target,
                offsetMs,
                preserveOffset: preserve,
              },
            });
          }}
        >
          <label className={editor.field}>
            <span className="label">This item → follows in</span>
            <select
              className={styles.input}
              value={target}
              aria-label="Relation target"
              onChange={(e) => {
                setTarget(e.target.value);
              }}
            >
              {candidates.map(({ q, i }) => (
                <option key={i.id} value={i.id}>
                  {q.name}: {i.title}
                </option>
              ))}
            </select>
          </label>
          <label className={editor.field}>
            <span className="label">Offset (±mm:ss, relative to this item&apos;s start)</span>
            <input
              className={`${styles.input} mono`}
              value={offset}
              aria-label="Relation offset"
              aria-invalid={offsetMs === null}
              onChange={(e) => {
                setOffset(e.target.value);
              }}
            />
          </label>
          <label className={editor.checkbox}>
            <input
              type="checkbox"
              checked={preserve}
              onChange={(e) => {
                setPreserve(e.target.checked);
              }}
            />
            Preserve offset (the related item&apos;s projected start follows this one)
          </label>
          <button
            type="submit"
            className={styles.button}
            disabled={disabled || offsetMs === null || !target}
          >
            Add relation
          </button>
        </form>
      )}
    </div>
  );
}

/** Audience visibility of the item, and (separately) of its notes property. */
export function VisibilitySection(props: {
  item: QueueItemSnapshot;
  disabled: boolean;
  onCommand: Run;
}) {
  const { item, disabled, onCommand } = props;
  const all = item.visibility === null;
  const set = (
    visibility: AudienceDto[] | null,
    notesAudiences: AudienceDto[] = item.notesAudiences,
  ) => {
    onCommand({
      type: 'item.setVisibility',
      payload: { queueItemId: item.id, visibility, notesAudiences },
    });
  };
  return (
    <div className={editor.section} data-testid="visibility-section">
      <span className="label">Visible on Boards</span>
      <label className={editor.checkbox}>
        <input
          type="checkbox"
          checked={all}
          disabled={disabled}
          aria-label="Visible to all audiences"
          onChange={(e) => {
            set(e.target.checked ? null : ['production']);
          }}
        />
        All audiences
      </label>
      {!all && (
        <div className={styles.audiences}>
          {AUDIENCES.map((a) => (
            <label key={a} className={editor.checkbox}>
              <input
                type="checkbox"
                checked={item.visibility?.includes(a) ?? false}
                disabled={disabled}
                aria-label={`Visible to ${a}`}
                onChange={(e) => {
                  const current = item.visibility ?? [];
                  set(e.target.checked ? [...current, a] : current.filter((x) => x !== a));
                }}
              />
              {a}
            </label>
          ))}
        </div>
      )}
      <span className="label">Publish notes to (default: nobody)</span>
      <div className={styles.audiences}>
        {AUDIENCES.map((a) => (
          <label key={a} className={editor.checkbox}>
            <input
              type="checkbox"
              checked={item.notesAudiences.includes(a)}
              disabled={disabled}
              aria-label={`Publish notes to ${a}`}
              onChange={(e) => {
                set(
                  item.visibility === null ? null : [...item.visibility],
                  e.target.checked
                    ? [...item.notesAudiences, a]
                    : item.notesAudiences.filter((x) => x !== a),
                );
              }}
            />
            {a}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Explicit move of a not-live item to another Queue (never Current, never running). */
export function MoveToQueue(props: {
  item: QueueItemSnapshot;
  queue: QueueSnapshot;
  state: ShowStateSnapshot;
  disabled: boolean;
  onCommand: Run;
}) {
  const others = props.state.queues.filter((q) => q.id !== props.queue.id);
  const live =
    props.item.lifecycle === 'current' ||
    props.item.timer?.status === 'running' ||
    props.item.timer?.status === 'paused';
  if (others.length === 0) return null;
  return (
    <label className={editor.field}>
      <span className="label">Move to Queue</span>
      <select
        className={styles.input}
        value=""
        disabled={props.disabled || live}
        aria-label="Move to Queue"
        title={live ? 'The Current or a running item cannot move to another Queue' : undefined}
        onChange={(e) => {
          if (!e.target.value) return;
          props.onCommand({
            type: 'item.moveToQueue',
            payload: {
              queueItemId: props.item.id,
              queueId: e.target.value,
              groupId: null,
              index: 500,
            },
          });
        }}
      >
        <option value="">— choose —</option>
        {others.map((q) => (
          <option key={q.id} value={q.id}>
            {q.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Queue settings: name, discipline, Primary, reorder, delete (safe only). */
export function QueuePanel(props: {
  queue: QueueSnapshot;
  state: ShowStateSnapshot;
  disabled: boolean;
  onCommand: Run;
}) {
  const { queue, disabled, onCommand } = props;
  const [name, setName] = useState(queue.name);
  const [discipline, setDiscipline] = useState(queue.discipline ?? '');
  const [confirm, setConfirm] = useState(false);
  return (
    <section className={styles.panel} aria-label="Queue settings" data-testid="queue-panel">
      <div className={styles.panelHead}>
        <span className="label">Queue</span>
        {queue.isPrimary ? (
          <span className={styles.tag} data-testid="queue-primary">
            ★ PRIMARY
          </span>
        ) : (
          <button
            type="button"
            className={`${styles.button} ${styles.small}`}
            disabled={disabled}
            onClick={() => {
              onCommand({ type: 'queue.setPrimary', payload: { queueId: queue.id } });
            }}
          >
            Make Primary
          </button>
        )}
      </div>
      <form
        className={editor.form}
        onSubmit={(e) => {
          e.preventDefault();
          onCommand({
            type: 'queue.update',
            payload: { queueId: queue.id, name, discipline: discipline || null },
          });
        }}
      >
        <label className={editor.field}>
          <span className="label">Queue name</span>
          <input
            className={styles.input}
            value={name}
            maxLength={60}
            aria-label="Queue name"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Discipline label</span>
          <input
            className={styles.input}
            value={discipline}
            maxLength={40}
            aria-label="Discipline"
            onChange={(e) => {
              setDiscipline(e.target.value);
            }}
          />
        </label>
        <button type="submit" className={styles.button} disabled={disabled || !name.trim()}>
          Save queue
        </button>
      </form>
      <p className={styles.muted}>
        Primary is the default source for Show-level status and the Speaker Board — not a parent of
        other Queues.
      </p>
      {!queue.isPrimary && (
        <div className={editor.danger}>
          {confirm ? (
            <div className={styles.buttons}>
              <button
                type="button"
                className={`${styles.button} ${editor.destructive}`}
                disabled={disabled}
                onClick={() => {
                  onCommand({ type: 'queue.delete', payload: { queueId: queue.id } });
                }}
              >
                Delete queue and its {queue.items.length} items
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  setConfirm(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.button} ${editor.destructiveOutline}`}
              disabled={disabled}
              onClick={() => {
                setConfirm(true);
              }}
            >
              Delete queue…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
