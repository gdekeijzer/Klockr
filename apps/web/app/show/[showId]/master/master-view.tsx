'use client';

import type {
  GroupSnapshot,
  LockTargetDto,
  QueueItemSnapshot,
  QueueSnapshot,
} from '@klockr/contracts';
import { effectiveLock, type ItemSchedule, type QueueAggregate } from '@klockr/domain';
import { formatClock, formatDuration, formatOffset, formatSpan } from '@klockr/ui';
import { useState, type DragEvent } from 'react';
import { ApiError, sendQueueCommand, type QueueCommandBody } from '../../../../lib/api';
import { parseDurationInput } from '../../../../lib/duration-input';
import {
  moveFor,
  rowsOf,
  stepMove,
  stepMoveGroup,
  type Dragged,
  type DropTarget,
} from '../../../../lib/queue-layout';
import { LockIcon } from '../../../../components/LockIcon';
import { ScheduleBar } from '../../../../components/ScheduleBar';
import { aggregateFromSnapshot } from '../../../../lib/schedule-view';
import { useShowRealtime } from '../../../../lib/use-realtime';
import { useSchedule } from '../../../../lib/use-schedule';
import { useServerNow } from '../../../../lib/use-server-now';
import { ShowFrame } from '../show-frame';
import styles from '../show.module.css';
import editor from './editor.module.css';
import {
  AuditPanel,
  LockedNotice,
  LockSection,
  ScheduleSection,
  ShowSchedulePanel,
} from './schedule-panels';
import { ThresholdEditor } from './threshold-editor';

/** UI presets. They all create the same universal Queue Item (no separate domain types). */
const PRESETS = [
  { label: 'Timer', title: 'Timer', durationMs: 10 * 60_000 },
  { label: 'Speaker', title: 'Speaker', durationMs: 20 * 60_000 },
  { label: 'Note', title: 'Note', durationMs: null },
  { label: 'Break', title: 'Break', durationMs: 15 * 60_000 },
] as const;

type Selection = { readonly kind: 'item' | 'group' | 'queue' | 'show'; readonly id: string } | null;

interface Blocked {
  readonly body: QueueCommandBody;
  readonly message: string;
  readonly target: LockTargetDto | null;
}

/**
 * Master View (M3) for one Show with its Program Queue: structure tree, a dense planning /
 * rundown workspace (planned vs projected, status, anchors, locks) and an inspector with
 * Planned / Projected / Actual, locks and the audit trail. It also hosts the M2 Queue editing
 * (one editing system). Drag & drop and planning edits never change live runtime state: Current
 * does not change, timers do not start or stop; the projection is simply recalculated.
 */
export function MasterView({ showId }: { showId: string }) {
  const rt = useShowRealtime(showId);
  const now = useServerNow(rt.offsetMs, 1_000);
  const schedule = useSchedule(rt.queue, rt.timers, now);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const live = rt.status === 'connected';
  const queue = rt.queue;
  const disabled = !live || pending;

  async function run(body: QueueCommandBody): Promise<string | null> {
    if (!live) return null;
    setPending(true);
    setError(null);
    try {
      const result = await sendQueueCommand(showId, body);
      rt.applyQueue(result.queue);
      setBlocked(null);
      return result.createdId;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'locked') {
        const lock = e.details.lock as { target?: LockTargetDto } | undefined;
        setBlocked({ body, message: e.message, target: lock?.target ?? null });
      } else {
        setError(`Not applied: ${e instanceof ApiError ? e.message : 'unknown error'}`);
      }
      return null;
    } finally {
      setPending(false);
    }
  }

  const command = (body: QueueCommandBody) => {
    void run(body);
  };

  function dropProps(target: DropTarget, key: string) {
    return {
      'data-drop': dropKey === key,
      onDragOver: (e: DragEvent) => {
        if (!dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropKey !== key) setDropKey(key);
      },
      onDragLeave: () => {
        if (dropKey === key) setDropKey(null);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDropKey(null);
        if (!queue || !dragged) return;
        const move = moveFor(queue, dragged, target);
        setDragged(null);
        if (move) command(move);
      },
    };
  }

  function dragProps(item: Dragged) {
    return {
      draggable: !disabled,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
        setDragged(item);
      },
      onDragEnd: () => {
        setDragged(null);
        setDropKey(null);
      },
    };
  }

  const selectedItem =
    selection?.kind === 'item' ? queue?.items.find((i) => i.id === selection.id) : undefined;
  const selectedGroup =
    selection?.kind === 'group' ? queue?.groups.find((g) => g.id === selection.id) : undefined;
  const order = new Map(queue?.items.map((item, index) => [item.id, index + 1]));
  const aggregate: QueueAggregate | null = queue ? aggregateFromSnapshot(queue, rt.timers) : null;
  const scheduleOf = new Map<string, ItemSchedule>(
    schedule?.projection.items.map((i) => [i.id, i]) ?? [],
  );
  const tz = queue?.showSchedule.timeZone ?? 'UTC';
  const tolerance = queue?.showSchedule.toleranceMs ?? 30_000;
  const lockedTarget = (target: LockTargetDto) =>
    aggregate ? effectiveLock(aggregate, target) : null;

  function itemRow(item: QueueItemSnapshot, nested: boolean) {
    if (!queue) return null;
    const up = stepMove(queue, item.id, -1);
    const down = stepMove(queue, item.id, 1);
    const plan = scheduleOf.get(item.id);
    const locked = lockedTarget({ kind: 'item', id: item.id });
    const updated = schedule?.updated.get(item.id);
    const shift = plan?.startShiftMs ?? null;
    const showShift =
      shift !== null && Math.abs(shift) > tolerance && item.lifecycle !== 'completed';
    const duration = item.timer?.durationMs ?? item.plannedDurationMs;
    return (
      <li
        key={item.id}
        className={`${styles.row} ${editor.editRow}`}
        data-lifecycle={item.lifecycle}
        data-selected={selection?.id === item.id}
        data-testid="editor-row"
        data-title={item.title}
        data-nested={nested}
        data-planned-start={plan?.plannedStart ?? ''}
        data-projected-start={plan?.projectedStart ?? ''}
        data-shift={plan?.startShiftMs ?? ''}
        data-locked={locked !== null}
        data-anchor={item.fixedAnchor}
        {...dragProps({ kind: 'item', id: item.id })}
        {...dropProps({ kind: 'item', id: item.id }, `item:${item.id}`)}
      >
        <span className={`${styles.rowIndex} mono`}>
          <span className={editor.handle} aria-hidden>
            ⋮⋮
          </span>
          {String(order.get(item.id) ?? 0).padStart(2, '0')}
        </span>
        <button
          type="button"
          className={editor.rowButton}
          aria-label={`Edit ${item.title}`}
          onClick={() => {
            setSelection({ kind: 'item', id: item.id });
          }}
        >
          <span className={styles.rowTitle}>{item.title}</span>
          <span className={styles.rowSub}>
            {[item.subtitle, item.timer ? null : 'No timer'].filter(Boolean).join(' · ') ||
              '\u00a0'}
          </span>
        </button>
        <span
          className={`${editor.cell} mono`}
          data-explicit={plan?.explicitStart ?? false}
          title={
            plan?.explicitStart ? 'Planned start (set)' : 'Planned start (after previous item)'
          }
        >
          {plan?.skipped ? '—' : formatClock(plan?.plannedStart ?? null, tz)}
        </span>
        <span className={`${editor.cell} ${editor.projected} mono`} title="Projected start">
          {plan?.skipped || item.lifecycle === 'completed'
            ? formatClock(item.actualStartAt, tz)
            : formatClock(plan?.projectedStart ?? null, tz)}
        </span>
        <span className={`${editor.cell} mono`}>
          {duration === null ? '—' : formatDuration(duration)}
        </span>
        <span className={`${styles.rowMeta} ${editor.rowMetaCell}`}>
          {showShift && (
            <span
              className={editor.shift}
              data-direction={shift > 0 ? 'later' : 'earlier'}
              title="Projected start vs planned start"
            >
              {formatOffset(Math.round(shift / 60_000) * 60_000)}
            </span>
          )}
          {updated && (
            <span
              className={editor.updated}
              data-testid="row-updated"
              title="Projection just changed"
            >
              UPDATED {formatOffset(updated.deltaMs)}
            </span>
          )}
          {plan?.shouldHaveStartedMs !== null && plan?.shouldHaveStartedMs !== undefined && (
            <span className={editor.overdue} data-testid="should-have-started">
              SHOULD HAVE STARTED {formatSpan(plan.shouldHaveStartedMs)} AGO
            </span>
          )}
          {item.fixedAnchor && (
            <span className={editor.anchor} title="Fixed-time anchor">
              FIXED
            </span>
          )}
          {item.startMode === 'scheduled' && <span className={styles.tag}>SCHED</span>}
          {locked && (
            <span
              className={editor.locked}
              title={locked.inheritedFrom ? 'Locked (inherited)' : 'Locked'}
            >
              <LockIcon /> LOCKED
            </span>
          )}
          {item.lifecycle === 'current' && <span className={styles.tag}>CURRENT</span>}
          {item.id === queue.nextItemId && (
            <span className={styles.tag} data-kind="next">
              NEXT
            </span>
          )}
          {item.lifecycle === 'completed' && <span className={styles.tag}>DONE</span>}
          {item.lifecycle === 'inactive' && <span className={styles.tag}>INACTIVE</span>}
          {item.startMode === 'on_previous_end' && item.timer && (
            <span
              className={styles.tag}
              title="Starts automatically on END + NEXT of the previous item"
            >
              AUTO
            </span>
          )}
          {item.warning && (
            <span
              className={styles.source}
              data-override="true"
              title="Warning thresholds overridden on this item"
            >
              OVR
            </span>
          )}
        </span>
        <span className={styles.rowActions}>
          <label
            className={editor.toggle}
            title={item.active ? 'Active' : 'Inactive (skipped by NEXT)'}
          >
            <input
              type="checkbox"
              checked={item.active}
              disabled={disabled || item.lifecycle === 'current'}
              aria-label={`Active: ${item.title}`}
              onChange={(e) => {
                command({
                  type: 'item.setActive',
                  payload: { queueItemId: item.id, active: e.target.checked },
                });
              }}
            />
          </label>
          <button
            type="button"
            className={`${styles.button} ${styles.small}`}
            disabled={disabled || !up}
            aria-label={`Move up: ${item.title}`}
            onClick={() => {
              if (up) command(up);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.small}`}
            disabled={disabled || !down}
            aria-label={`Move down: ${item.title}`}
            onClick={() => {
              if (down) command(down);
            }}
          >
            ↓
          </button>
        </span>
      </li>
    );
  }

  function groupBlock(group: GroupSnapshot, items: readonly QueueItemSnapshot[]) {
    if (!queue) return null;
    const isCollapsed = collapsed.has(group.id);
    const up = stepMoveGroup(queue, group.id, -1);
    const down = stepMoveGroup(queue, group.id, 1);
    return (
      <li
        key={group.id}
        className={editor.group}
        data-testid="editor-group"
        data-title={group.title}
      >
        <div
          className={`${editor.groupHead}`}
          data-selected={selection?.id === group.id}
          {...dragProps({ kind: 'group', id: group.id })}
          {...dropProps({ kind: 'group', id: group.id }, `group:${group.id}`)}
        >
          <button
            type="button"
            className={`${styles.button} ${styles.small}`}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} group ${group.title}`}
            onClick={() => {
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(group.id)) next.delete(group.id);
                else next.add(group.id);
                return next;
              });
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className={editor.rowButton}
            aria-label={`Edit group ${group.title}`}
            onClick={() => {
              setSelection({ kind: 'group', id: group.id });
            }}
          >
            <span className={editor.groupTitle}>
              {group.title}
              {lockedTarget({ kind: 'group', id: group.id }) && (
                <span className={editor.locked}>
                  {' '}
                  <LockIcon /> LOCKED
                </span>
              )}
            </span>
            <span className={styles.rowSub}>
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          </button>
          <span className={styles.rowActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.small}`}
              disabled={disabled || !up}
              aria-label={`Move group up: ${group.title}`}
              onClick={() => {
                if (up) command(up);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.small}`}
              disabled={disabled || !down}
              aria-label={`Move group down: ${group.title}`}
              onClick={() => {
                if (down) command(down);
              }}
            >
              ↓
            </button>
          </span>
        </div>
        {!isCollapsed && (
          <ol className={`${styles.list} ${editor.children}`}>
            {items.map((item) => itemRow(item, true))}
            {items.length === 0 && <li className={editor.emptyGroup}>Drop items here</li>}
          </ol>
        )}
      </li>
    );
  }

  return (
    <ShowFrame showId={showId} view="master" rt={rt} now={now}>
      {queue && schedule && <ScheduleBar queue={queue} schedule={schedule} />}
      <main className={editor.masterGrid}>
        {queue && aggregate && (
          <StructureTree
            queue={queue}
            aggregate={aggregate}
            title={rt.show?.title ?? 'Show'}
            selection={selection}
            onSelect={setSelection}
          />
        )}
        <section className={styles.panel} aria-label="Program queue">
          <div className={styles.panelHead}>
            <span className="label">Program queue</span>
            {queue && (
              <span className={`${styles.muted} mono`}>
                {queue.items.length} items · rev {queue.revision}
              </span>
            )}
          </div>
          <div className={editor.addBar} role="group" aria-label="Add to queue">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={styles.button}
                disabled={disabled}
                aria-label={`Add ${preset.label}`}
                onClick={() => {
                  void run({
                    type: 'item.add',
                    payload: { title: preset.title, durationMs: preset.durationMs },
                  }).then((id) => {
                    if (id) setSelection({ kind: 'item', id });
                  });
                }}
              >
                + {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={styles.button}
              disabled={disabled}
              aria-label="Add Group"
              onClick={() => {
                void run({ type: 'group.add', payload: { title: 'Group' } }).then((id) => {
                  if (id) setSelection({ kind: 'group', id });
                });
              }}
            >
              + Group
            </button>
          </div>

          {blocked && (
            <LockedNotice
              key={JSON.stringify(blocked.body)}
              message={blocked.message}
              target={blocked.target}
              disabled={disabled}
              onRequestUnlock={(target) => {
                void run({ type: 'lock.requestUnlock', payload: { target, reason: null } });
              }}
              onOverride={(reason) => {
                void run({ ...blocked.body, override: { reason } });
              }}
              onDismiss={() => {
                setBlocked(null);
              }}
            />
          )}
          {queue ? (
            <>
              <div className={editor.columns} aria-hidden>
                <span>#</span>
                <span>Item</span>
                <span title="Planned start">Plan</span>
                <span title="Projected start">Proj.</span>
                <span>Dur</span>
                <span>Status</span>
                <span />
              </div>
              <ol className={styles.list} data-testid="editor-list">
                {rowsOf(queue).map((row) =>
                  row.kind === 'item' ? itemRow(row.item, false) : groupBlock(row.group, row.items),
                )}
              </ol>
              <div
                className={editor.endZone}
                data-testid="drop-end"
                {...dropProps({ kind: 'end' }, 'end')}
              >
                Drop here to move to the end of the queue
              </div>
            </>
          ) : (
            <p className={styles.muted}>Loading Queue…</p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </section>

        <aside className={styles.side}>
          {selectedItem && queue && aggregate && (
            <>
              <ItemInspector
                key={`${selectedItem.id}:${String(selectedItem.revision)}`}
                item={selectedItem}
                queue={queue}
                disabled={disabled}
                onCommand={command}
                onClose={() => {
                  setSelection(null);
                }}
              />
              <section className={styles.panel} aria-label="Item schedule">
                <ScheduleSection
                  key={`schedule:${selectedItem.id}:${String(selectedItem.revision)}`}
                  item={selectedItem}
                  queue={queue}
                  schedule={scheduleOf.get(selectedItem.id)}
                  now={now}
                  disabled={disabled}
                  onCommand={command}
                />
                <LockSection
                  target={{ kind: 'item', id: selectedItem.id }}
                  aggregate={aggregate}
                  queue={queue}
                  disabled={disabled}
                  onCommand={command}
                />
              </section>
            </>
          )}
          {selectedGroup && queue && aggregate && (
            <>
              <GroupInspector
                key={`${selectedGroup.id}:${selectedGroup.title}`}
                group={selectedGroup}
                queue={queue}
                disabled={disabled}
                onCommand={command}
                onClose={() => {
                  setSelection(null);
                }}
              />
              <section className={styles.panel} aria-label="Group lock">
                <LockSection
                  target={{ kind: 'group', id: selectedGroup.id }}
                  aggregate={aggregate}
                  queue={queue}
                  disabled={disabled}
                  onCommand={command}
                />
              </section>
            </>
          )}
          {!selectedItem && !selectedGroup && queue && aggregate && (
            <>
              <section className={styles.panel}>
                <span className="label">Edit</span>
                <p className={styles.muted}>
                  Select an item or group to edit it. Drag rows (or use ↑ ↓) to reorder; drop an
                  item on a group header to move it into that group. Reordering recalculates the
                  projection; it never changes Planned times, Current or timers.
                </p>
              </section>
              <ShowSchedulePanel
                key={JSON.stringify(queue.showSchedule)}
                queue={queue}
                disabled={disabled}
                onCommand={command}
              />
              <section className={styles.panel} aria-label="Show and queue locks">
                <LockSection
                  target={
                    selection?.kind === 'show'
                      ? { kind: 'show', id: queue.showId }
                      : { kind: 'queue', id: queue.id }
                  }
                  aggregate={aggregate}
                  queue={queue}
                  disabled={disabled}
                  onCommand={command}
                />
              </section>
            </>
          )}
          {queue && !selectedItem && !selectedGroup && (
            <SettingsPanel queue={queue} disabled={disabled} onCommand={command} />
          )}
          {queue && <AuditPanel showId={showId} revision={queue.revision} timeZone={tz} />}
        </aside>
      </main>
    </ShowFrame>
  );
}

function ItemInspector(props: {
  item: QueueItemSnapshot;
  queue: QueueSnapshot;
  disabled: boolean;
  onCommand: (body: QueueCommandBody) => void;
  onClose: () => void;
}) {
  const { item, queue, disabled, onCommand } = props;
  const [title, setTitle] = useState(item.title);
  const [subtitle, setSubtitle] = useState(item.subtitle ?? '');
  const [duration, setDuration] = useState(item.timer ? formatDuration(item.timer.durationMs) : '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [startMode, setStartMode] = useState(item.startMode);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const durationMs = duration.trim() === '' ? null : parseDurationInput(duration);
  const durationValid = duration.trim() === '' || durationMs !== null;
  const live = item.timer?.status === 'running' || item.timer?.status === 'paused';
  const isCurrent = item.lifecycle === 'current';

  const patch: Record<string, unknown> = {};
  if (title.trim() !== item.title) patch.title = title;
  if ((subtitle.trim() || null) !== item.subtitle) patch.subtitle = subtitle;
  if ((notes.trim() ? notes : null) !== item.notes) patch.notes = notes;
  const tagList = tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tagList.join(',') !== item.tags.join(',')) patch.tags = tagList;
  if (startMode !== item.startMode) patch.startMode = startMode;
  if (durationValid && durationMs !== (item.timer?.durationMs ?? null))
    patch.durationMs = durationMs;
  const dirty = Object.keys(patch).length > 0;

  return (
    <section className={styles.panel} aria-label="Edit item" data-testid="item-inspector">
      <div className={styles.panelHead}>
        <span className="label">Edit item</span>
        <button
          type="button"
          className={`${styles.button} ${styles.small}`}
          onClick={props.onClose}
        >
          Close
        </button>
      </div>
      <form
        className={editor.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && title.trim() && durationValid) {
            onCommand({ type: 'item.update', payload: { queueItemId: item.id, patch } });
          }
        }}
      >
        <label className={editor.field}>
          <span className="label">Title</span>
          <input
            className={styles.input}
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Subtitle</span>
          <input
            className={styles.input}
            value={subtitle}
            maxLength={200}
            onChange={(e) => {
              setSubtitle(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Timer duration (empty = no timer)</span>
          <input
            className={`${styles.input} mono`}
            value={duration}
            placeholder="mm:ss"
            aria-invalid={!durationValid}
            disabled={live}
            title={live ? 'Stop the timer to change its duration' : undefined}
            onChange={(e) => {
              setDuration(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Start</span>
          <select
            className={styles.input}
            value={startMode}
            aria-label="Start mode"
            onChange={(e) => {
              setStartMode(e.target.value as typeof startMode);
            }}
          >
            <option value="manual">Manual start</option>
            <option value="on_previous_end">Start on previous END + NEXT</option>
            <option value="scheduled">Scheduled (soft: warn when late, never auto-start)</option>
          </select>
        </label>
        <label className={editor.field}>
          <span className="label">Notes (operator only, never on boards)</span>
          <textarea
            className={`${styles.input} ${editor.textarea}`}
            value={notes}
            maxLength={4000}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Tags (comma separated)</span>
          <input
            className={styles.input}
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          className={styles.button}
          disabled={disabled || !dirty || !title.trim() || !durationValid}
        >
          Save item
        </button>
      </form>

      <div className={editor.inline}>
        <label className={editor.field}>
          <span className="label">Group</span>
          <select
            className={styles.input}
            value={item.groupId ?? ''}
            disabled={disabled}
            aria-label="Group"
            onChange={(e) => {
              const groupId = e.target.value || null;
              onCommand({
                type: 'item.move',
                payload: { queueItemId: item.id, groupId, index: 500 },
              });
            }}
          >
            <option value="">— Top level —</option>
            {queue.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <label className={editor.checkbox}>
          <input
            type="checkbox"
            checked={item.active}
            disabled={disabled || isCurrent}
            onChange={(e) => {
              onCommand({
                type: 'item.setActive',
                payload: { queueItemId: item.id, active: e.target.checked },
              });
            }}
          />
          Active (inactive items are skipped by NEXT)
        </label>
      </div>

      {item.timer && (
        <div className={editor.section}>
          <span className="label">Warning thresholds</span>
          <ThresholdEditor
            key={JSON.stringify(item.effectiveWarning)}
            level="item"
            resolved={item.effectiveWarning}
            own={item.warning}
            disabled={disabled}
            testId="item-warning"
            onSave={(warning) => {
              onCommand({ type: 'item.setWarning', payload: { queueItemId: item.id, warning } });
            }}
            onReset={() => {
              onCommand({
                type: 'item.setWarning',
                payload: { queueItemId: item.id, warning: null },
              });
            }}
          />
        </div>
      )}

      <div className={editor.section}>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          onClick={() => {
            onCommand({ type: 'item.duplicate', payload: { queueItemId: item.id } });
          }}
        >
          Duplicate item
        </button>
      </div>

      {/* Destructive actions are separated and need an explicit second step. */}
      <div className={editor.danger}>
        {isCurrent || live ? (
          <p className={styles.muted}>
            {isCurrent
              ? 'The current item cannot be deleted. END it or make another item current first.'
              : 'Stop the running timer before deleting this item.'}
          </p>
        ) : confirmDelete ? (
          <div className={styles.buttons}>
            <button
              type="button"
              className={`${styles.button} ${editor.destructive}`}
              disabled={disabled}
              onClick={() => {
                onCommand({ type: 'item.delete', payload: { queueItemId: item.id } });
                props.onClose();
              }}
            >
              Confirm delete
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setConfirmDelete(false);
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
              setConfirmDelete(true);
            }}
          >
            Delete item…
          </button>
        )}
      </div>
    </section>
  );
}

function GroupInspector(props: {
  group: GroupSnapshot;
  queue: QueueSnapshot | null;
  disabled: boolean;
  onCommand: (body: QueueCommandBody) => void;
  onClose: () => void;
}) {
  const { group, disabled, onCommand } = props;
  const [title, setTitle] = useState(group.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const children = props.queue?.items.filter((i) => i.groupId === group.id) ?? [];
  const protectedGroup = children.some(
    (i) =>
      i.lifecycle === 'current' || i.timer?.status === 'running' || i.timer?.status === 'paused',
  );

  return (
    <section className={styles.panel} aria-label="Edit group" data-testid="group-inspector">
      <div className={styles.panelHead}>
        <span className="label">Edit group</span>
        <button
          type="button"
          className={`${styles.button} ${styles.small}`}
          onClick={props.onClose}
        >
          Close
        </button>
      </div>
      <form
        className={editor.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && title.trim() !== group.title) {
            onCommand({ type: 'group.rename', payload: { groupId: group.id, title } });
          }
        }}
      >
        <label className={editor.field}>
          <span className="label">Group title</span>
          <input
            className={styles.input}
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          className={styles.button}
          disabled={disabled || !title.trim() || title.trim() === group.title}
        >
          Save group
        </button>
      </form>
      <div className={editor.section}>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          onClick={() => {
            onCommand({ type: 'group.duplicate', payload: { groupId: group.id } });
          }}
        >
          Duplicate group with {children.length} {children.length === 1 ? 'item' : 'items'}
        </button>
      </div>
      <div className={editor.danger}>
        {protectedGroup ? (
          <p className={styles.muted}>
            This group contains the current item or a running timer and cannot be deleted.
          </p>
        ) : confirmDelete ? (
          <div className={styles.buttons}>
            <button
              type="button"
              className={`${styles.button} ${editor.destructive}`}
              disabled={disabled}
              onClick={() => {
                onCommand({ type: 'group.delete', payload: { groupId: group.id } });
                props.onClose();
              }}
            >
              Delete group and {children.length} {children.length === 1 ? 'item' : 'items'}
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setConfirmDelete(false);
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
              setConfirmDelete(true);
            }}
          >
            Delete group…
          </button>
        )}
      </div>
    </section>
  );
}

const KLOCKR_DEFAULT = { kind: 'percent', warningPercent: 20, criticalPercent: 5 } as const;

/** Inherited timer settings at Show and Queue level, with visible sources. */
function SettingsPanel(props: {
  queue: QueueSnapshot;
  disabled: boolean;
  onCommand: (body: QueueCommandBody) => void;
}) {
  const { queue, disabled, onCommand } = props;
  const isKlockrDefault =
    queue.showWarning.kind === 'percent' &&
    queue.showWarning.warningPercent === 20 &&
    queue.showWarning.criticalPercent === 5;
  const showResolved = {
    rule: queue.showWarning,
    source: 'show' as const,
    inherited: { rule: queue.showWarning, source: 'show' as const },
  };
  return (
    <section className={styles.panel} aria-label="Timer warning settings">
      <span className="label">Timer warnings</span>
      <p className={styles.muted}>
        Show default → Queue override → Item override. The effective value and its source are always
        shown.
      </p>
      <div className={editor.section}>
        <span className="label">Show default</span>
        <ThresholdEditor
          key={`show:${JSON.stringify(queue.showWarning)}`}
          level="show"
          resolved={showResolved}
          own={queue.showWarning}
          disabled={disabled}
          testId="show-warning"
          onSave={(warning) => {
            onCommand({ type: 'show.setWarning', payload: { warning } });
          }}
        />
        {!isKlockrDefault && (
          <button
            type="button"
            className={`${styles.button} ${styles.small}`}
            disabled={disabled}
            onClick={() => {
              onCommand({ type: 'show.setWarning', payload: { warning: KLOCKR_DEFAULT } });
            }}
          >
            Reset to KLOCKR default (20 % / 5 %)
          </button>
        )}
      </div>
      <div className={editor.section}>
        <span className="label">Program queue</span>
        <ThresholdEditor
          key={`queue:${JSON.stringify(queue.effectiveWarning)}`}
          level="queue"
          resolved={queue.effectiveWarning}
          own={queue.warning}
          disabled={disabled}
          testId="queue-warning"
          onSave={(warning) => {
            onCommand({ type: 'queue.setWarning', payload: { warning } });
          }}
          onReset={() => {
            onCommand({ type: 'queue.setWarning', payload: { warning: null } });
          }}
        />
      </div>
    </section>
  );
}

/** Left zone: Show -> Queue -> Groups -> Queue Items, with lock state and current marker. */
function StructureTree(props: {
  queue: QueueSnapshot;
  aggregate: QueueAggregate;
  title: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const { queue, aggregate, selection, onSelect } = props;
  const lockMark = (target: LockTargetDto) =>
    effectiveLock(aggregate, target) ? (
      <span className={editor.locked} aria-label="locked">
        <LockIcon />
      </span>
    ) : null;
  const node = (
    kind: NonNullable<Selection>['kind'],
    id: string,
    label: string,
    depth: number,
    extra?: string,
  ) => (
    <li key={`${kind}:${id}`}>
      <button
        type="button"
        className={editor.treeNode}
        style={{ paddingLeft: `${String(8 + depth * 14)}px` }}
        data-selected={selection?.kind === kind && selection.id === id}
        aria-label={`Select ${kind} ${label}`}
        onClick={() => {
          onSelect(kind === 'show' || kind === 'queue' ? { kind, id } : { kind, id });
        }}
      >
        <span className={editor.treeLabel}>{label}</span>
        {extra && <span className={styles.tag}>{extra}</span>}
        {lockMark({ kind, id })}
      </button>
    </li>
  );
  return (
    <nav className={styles.panel} aria-label="Structure" data-testid="structure-tree">
      <span className="label">Structure</span>
      <ul className={editor.tree}>
        {node('show', queue.showId, props.title, 0)}
        {node('queue', queue.id, queue.name, 1)}
        {rowsOf(queue).flatMap((row) =>
          row.kind === 'item'
            ? [
                node(
                  'item',
                  row.item.id,
                  row.item.title,
                  2,
                  row.item.lifecycle === 'current' ? 'CURRENT' : undefined,
                ),
              ]
            : [
                node('group', row.group.id, row.group.title, 2),
                ...row.items.map((i) =>
                  node('item', i.id, i.title, 3, i.lifecycle === 'current' ? 'CURRENT' : undefined),
                ),
              ],
        )}
      </ul>
    </nav>
  );
}
