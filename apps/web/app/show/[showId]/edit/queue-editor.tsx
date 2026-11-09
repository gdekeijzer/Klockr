'use client';

import type { GroupSnapshot, QueueItemSnapshot, QueueSnapshot } from '@klockr/contracts';
import { formatDuration } from '@klockr/ui';
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
import { useShowRealtime } from '../../../../lib/use-realtime';
import { useServerNow } from '../../../../lib/use-server-now';
import { ShowFrame } from '../show-frame';
import styles from '../show.module.css';
import editor from './editor.module.css';
import { ThresholdEditor } from './threshold-editor';

/** UI presets. They all create the same universal Queue Item (no separate domain types). */
const PRESETS = [
  { label: 'Timer', title: 'Timer', durationMs: 10 * 60_000 },
  { label: 'Speaker', title: 'Speaker', durationMs: 20 * 60_000 },
  { label: 'Note', title: 'Note', durationMs: null },
  { label: 'Break', title: 'Break', durationMs: 15 * 60_000 },
] as const;

type Selection = { readonly kind: 'item' | 'group'; readonly id: string } | null;

/**
 * Queue Editor for the Program Queue: structure and content (add, edit, delete, duplicate,
 * reorder, Groups, active/inactive, overrides). Drag & drop only ever moves structure; it never
 * makes an item current or touches a timer. Live operation stays in the Operator View.
 */
export function QueueEditor({ showId }: { showId: string }) {
  const rt = useShowRealtime(showId);
  const now = useServerNow(rt.offsetMs, 1_000);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      return result.createdId;
    } catch (e) {
      setError(`Not applied: ${e instanceof ApiError ? e.message : 'unknown error'}`);
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

  function itemRow(item: QueueItemSnapshot, nested: boolean) {
    if (!queue) return null;
    const up = stepMove(queue, item.id, -1);
    const down = stepMove(queue, item.id, 1);
    return (
      <li
        key={item.id}
        className={`${styles.row} ${editor.editRow}`}
        data-lifecycle={item.lifecycle}
        data-selected={selection?.id === item.id}
        data-testid="editor-row"
        data-title={item.title}
        data-nested={nested}
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
            {[item.subtitle, item.timer ? formatDuration(item.timer.durationMs) : 'No timer']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </button>
        <span className={styles.rowMeta}>
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
            <span className={editor.groupTitle}>{group.title}</span>
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
    <ShowFrame showId={showId} view="editor" rt={rt} now={now}>
      <main className={editor.grid}>
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

          {queue ? (
            <>
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
          {selectedItem && queue && (
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
          )}
          {selectedGroup && (
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
          )}
          {!selectedItem && !selectedGroup && (
            <section className={styles.panel}>
              <span className="label">Edit</span>
              <p className={styles.muted}>
                Select an item or group to edit it. Drag rows (or use ↑ ↓) to reorder; drop an item
                on a group header to move it into that group.
              </p>
            </section>
          )}
          {queue && <SettingsPanel queue={queue} disabled={disabled} onCommand={command} />}
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
            onChange={(e) => {
              setStartMode(e.target.value as typeof startMode);
            }}
          >
            <option value="manual">Manual start</option>
            <option value="on_previous_end">Start on previous END + NEXT</option>
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
