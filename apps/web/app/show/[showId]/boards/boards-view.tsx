'use client';

import type {
  AudienceDto,
  BoardComponentDto,
  BoardConfigDto,
  BoardPresetDto,
  BoardStateSnapshot,
  ShowStateSnapshot,
} from '@klockr/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BoardView } from '../../../../components/board/BoardView';
import { DeviceManager } from '../../../../components/devices/DeviceManager';
import { ShareManager } from '../../../../components/devices/ShareManager';
import {
  ApiError,
  createBoardShare,
  fetchBoardPreview,
  sendQueueCommand,
  type QueueCommandBody,
} from '../../../../lib/api';
import { useShowRealtime } from '../../../../lib/use-realtime';
import { useServerNow } from '../../../../lib/use-server-now';
import { MessagePanel } from '../live-panels';
import { ShowFrame } from '../show-frame';
import styles from '../show.module.css';
import boards from './boards.module.css';

const PRESETS: readonly { value: BoardPresetDto; label: string }[] = [
  { value: 'speaker_confidence', label: 'Speaker Confidence' },
  { value: 'stage_manager', label: 'Stage Manager' },
  { value: 'production', label: 'FOH / Production' },
  { value: 'backstage', label: 'Backstage' },
  { value: 'room_agenda', label: 'Room Agenda' },
  { value: 'public_agenda', label: 'Public Agenda / Signage' },
  { value: 'custom', label: 'Custom' },
];
const AUDIENCES: readonly AudienceDto[] = [
  'stage',
  'production',
  'backstage',
  'public',
  'broadcast',
];
const COMPONENT_LABEL: Readonly<Record<BoardComponentDto['kind'], string>> = {
  message: 'Message overlay',
  current_title: 'Current title',
  subtitle: 'Speaker / subtitle',
  timer: 'Timer',
  progress: 'Progress',
  next_item: 'Next item',
  wall_clock: 'Wall clock',
  show_offset: 'Show offset',
  queue_current_next: 'Queue Current / Next',
  running_timers: 'Running timers',
  agenda: 'Agenda / rundown',
  anchor: 'Fixed anchor / recovery',
  notes: 'Notes (only explicitly published)',
};

/**
 * Board management: create from a preset, configure within the constrained model (name,
 * audience, sources, ordered components with a few settings, low-light), preview with the real
 * renderer on the real scoped projection, and share a read-only link. Boards are presentation
 * only; they never hold timer state.
 */
export function BoardsView({ showId }: { showId: string }) {
  const rt = useShowRealtime(showId);
  const now = useServerNow(rt.offsetMs, 250);
  const [selected, setSelected] = useState<string | null>(null);
  const [preset, setPreset] = useState<BoardPresetDto>('speaker_confidence');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = rt.status === 'connected';
  const disabled = !live || pending;
  const state = rt.state;
  const board = state?.boards.find((b) => b.id === selected) ?? state?.boards[0] ?? null;

  async function run(body: QueueCommandBody): Promise<string | null> {
    if (!live) return null;
    setPending(true);
    setError(null);
    try {
      const result = await sendQueueCommand(showId, body);
      rt.applyState(result.state);
      return result.createdId;
    } catch (e) {
      setError(`Not applied: ${e instanceof ApiError ? e.message : 'unknown error'}`);
      return null;
    } finally {
      setPending(false);
    }
  }

  return (
    <ShowFrame showId={showId} view="boards" rt={rt} now={now}>
      <main className={boards.grid}>
        <section className={styles.panel} aria-label="Boards">
          <span className="label">Boards</span>
          <ul className={boards.boardList}>
            {state?.boards.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className={boards.boardItem}
                  aria-pressed={b.id === board?.id}
                  data-testid="board-list-item"
                  data-name={b.name}
                  onClick={() => {
                    setSelected(b.id);
                  }}
                >
                  <strong>{b.name}</strong>
                  <span className={styles.rowSub}>
                    {PRESETS.find((p) => p.value === b.preset)?.label} · {b.audience}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label className={boards.field}>
            <span className="label">New Board from preset</span>
            <select
              className={styles.input}
              value={preset}
              aria-label="Board preset"
              onChange={(e) => {
                setPreset(e.target.value as BoardPresetDto);
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => {
              void run({ type: 'board.create', payload: { preset } }).then((id) => {
                if (id) setSelected(id);
              });
            }}
          >
            + Create Board
          </button>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </section>

        <section className={styles.panel} aria-label="Preview">
          <span className="label">Preview</span>
          {board && state ? (
            <BoardPreview showId={showId} board={board} revision={state.show.revision} now={now} />
          ) : (
            <p className={styles.muted}>No Board selected.</p>
          )}
          {state && (
            <MessagePanel
              state={state}
              now={now}
              disabled={disabled}
              onCommand={(b) => void run(b)}
            />
          )}
        </section>

        <aside className={styles.side}>
          {state && (
            <ShareManager
              scope={{ kind: 'show', id: showId }}
              boards={state.boards.map((b) => ({ id: b.id, name: b.name }))}
              disabled={!live}
            />
          )}
          {state?.show.context && (
            <section className={styles.panel} aria-label="Event Devices">
              <p className={styles.muted}>
                This Show is part of an Event; Event-wide Devices are managed there:{' '}
                <Link className={styles.link} href={`/event/${state.show.context.eventId}/devices`}>
                  Devices &amp; Boards of {state.show.context.eventName}
                </Link>
              </p>
            </section>
          )}
          {state && (
            <DeviceManager
              scope={{ kind: 'show', id: showId }}
              disabled={!live}
              pushed={rt.devices}
            />
          )}
          {board && state && (
            <BoardConfig
              key={`${board.id}:${String(board.revision)}`}
              board={board}
              state={state}
              disabled={disabled}
              showId={showId}
              onCommand={(b) => void run(b)}
              onDeleted={() => {
                setSelected(null);
              }}
            />
          )}
        </aside>
      </main>
    </ShowFrame>
  );
}

function BoardPreview(props: {
  showId: string;
  board: BoardConfigDto;
  revision: number;
  now: number;
}) {
  const [snapshot, setSnapshot] = useState<BoardStateSnapshot | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    let cancelled = false;
    fetchBoardPreview(props.showId, props.board.id).then(
      (s) => {
        if (!cancelled) setSnapshot(s);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [props.showId, props.board.id, props.board.revision, props.revision]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setScale(el.clientWidth / 1600);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  const timers = Object.fromEntries(
    snapshot?.queues.flatMap((q) => q.timers.map((t) => [t.queueItemId, t] as const)) ?? [],
  );
  return (
    <div className={boards.previewFrame} ref={frame} data-testid="board-preview">
      {snapshot && (
        <div className={boards.previewInner} style={{ transform: `scale(${String(scale)})` }}>
          <BoardView board={snapshot} timers={timers} now={props.now} />
        </div>
      )}
    </div>
  );
}

function BoardConfig(props: {
  board: BoardConfigDto;
  state: ShowStateSnapshot;
  showId: string;
  disabled: boolean;
  onCommand: (body: QueueCommandBody) => void;
  onDeleted: () => void;
}) {
  const { board, state, disabled } = props;
  const [name, setName] = useState(board.name);
  const [audience, setAudience] = useState<AudienceDto>(board.audience);
  const [sourceMode, setSourceMode] = useState<'primary' | 'all' | 'selected'>(
    board.sources.kind === 'selected' || board.sources.kind === 'all'
      ? board.sources.kind
      : 'primary',
  );
  const [queueIds, setQueueIds] = useState<readonly string[]>(
    board.sources.kind === 'selected' ? board.sources.queueIds : [state.show.primaryQueueId],
  );
  const [components, setComponents] = useState<readonly BoardComponentDto[]>(board.components);
  const [lowLight, setLowLight] = useState(board.presentation.lowLight);
  const [showTimes, setShowTimes] = useState(board.presentation.showTimes);
  const [share, setShare] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const move = (index: number, delta: number) => {
    const next = [...components];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    setComponents(next);
  };
  const patch = (index: number, change: Partial<BoardComponentDto>) => {
    setComponents(components.map((c, i) => (i === index ? { ...c, ...change } : c)));
  };

  return (
    <section className={styles.panel} aria-label="Board configuration" data-testid="board-config">
      <span className="label">Configure Board</span>
      <form
        className={boards.form}
        onSubmit={(e) => {
          e.preventDefault();
          props.onCommand({
            type: 'board.update',
            payload: {
              boardId: board.id,
              name,
              audience,
              sources:
                sourceMode === 'selected'
                  ? { kind: 'selected', queueIds: [...queueIds] }
                  : sourceMode === 'all'
                    ? { kind: 'all' }
                    : { kind: 'primary' },
              components: components.map((c) => ({ ...c })),
              presentation: { lowLight, showTimes },
            },
          });
        }}
      >
        <label className={boards.field}>
          <span className="label">Board name</span>
          <input
            className={styles.input}
            value={name}
            maxLength={100}
            aria-label="Board name"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className={boards.field}>
          <span className="label">Audience</span>
          <select
            className={styles.input}
            value={audience}
            aria-label="Board audience"
            onChange={(e) => {
              setAudience(e.target.value as AudienceDto);
            }}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <fieldset className={boards.field}>
          <legend className="label">Sources</legend>
          <select
            className={styles.input}
            value={sourceMode}
            aria-label="Board sources"
            onChange={(e) => {
              setSourceMode(e.target.value as 'primary' | 'all' | 'selected');
            }}
          >
            <option value="primary">Primary Queue (follows Primary changes)</option>
            <option value="all">All Queues (new Queues appear automatically)</option>
            <option value="selected">Selected Queues</option>
          </select>
          {sourceMode === 'selected' &&
            state.queues.map((q) => (
              <label key={q.id} className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={queueIds.includes(q.id)}
                  aria-label={`Source ${q.name}`}
                  onChange={(e) => {
                    setQueueIds(
                      e.target.checked ? [...queueIds, q.id] : queueIds.filter((x) => x !== q.id),
                    );
                  }}
                />
                {q.name}
              </label>
            ))}
        </fieldset>
        <div className={boards.field}>
          <span className="label">Components (order = presentation order)</span>
          <ul className={boards.components}>
            {components.map((c, i) => (
              <li
                key={c.kind}
                className={boards.componentRow}
                data-enabled={c.enabled}
                data-testid="component-row"
                data-kind={c.kind}
              >
                <input
                  type="checkbox"
                  checked={c.enabled}
                  aria-label={`Show ${COMPONENT_LABEL[c.kind]}`}
                  onChange={(e) => {
                    patch(i, { enabled: e.target.checked });
                  }}
                />
                <span>{COMPONENT_LABEL[c.kind]}</span>
                <select
                  className={styles.input}
                  value={c.size}
                  aria-label={`Size ${COMPONENT_LABEL[c.kind]}`}
                  onChange={(e) => {
                    patch(i, { size: e.target.value as BoardComponentDto['size'] });
                  }}
                >
                  <option value="small">S</option>
                  <option value="medium">M</option>
                  <option value="large">L</option>
                </select>
                {['agenda', 'next_item', 'queue_current_next'].includes(c.kind) ? (
                  <input
                    className={`${styles.input} ${boards.numberInput}`}
                    type="number"
                    min={0}
                    max={20}
                    value={c.upcoming}
                    aria-label={`Upcoming ${COMPONENT_LABEL[c.kind]}`}
                    onChange={(e) => {
                      patch(i, {
                        upcoming: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                      });
                    }}
                  />
                ) : (
                  <span />
                )}
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    disabled={i === 0}
                    aria-label={`Move up ${COMPONENT_LABEL[c.kind]}`}
                    onClick={() => {
                      move(i, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    disabled={i === components.length - 1}
                    aria-label={`Move down ${COMPONENT_LABEL[c.kind]}`}
                    onClick={() => {
                      move(i, 1);
                    }}
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={lowLight}
            aria-label="Low light"
            onChange={(e) => {
              setLowLight(e.target.checked);
            }}
          />
          Low-light (dim for dark stages)
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={showTimes}
            onChange={(e) => {
              setShowTimes(e.target.checked);
            }}
          />
          Show times in agenda
        </label>
        <button
          type="submit"
          className={styles.button}
          disabled={
            disabled || !name.trim() || (sourceMode === 'selected' && queueIds.length === 0)
          }
        >
          Save Board
        </button>
      </form>

      <div className={boards.field}>
        <span className="label">Share (read-only link)</span>
        {share ? (
          <input
            className={`${styles.input} mono`}
            readOnly
            value={share}
            aria-label="Board share link"
            data-testid="board-share-link"
          />
        ) : (
          <p className={styles.muted}>Create a link for a display. It can only show this Board.</p>
        )}
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          onClick={() => {
            void createBoardShare(props.showId, board.id).then((s) => {
              setShare(`${window.location.origin}/b/${s.boardShareToken}`);
            });
          }}
        >
          {share ? 'New link' : 'Create link'}
        </button>
      </div>

      <div className={styles.buttons}>
        {confirm ? (
          <>
            <button
              type="button"
              className={styles.button}
              disabled={disabled}
              onClick={() => {
                props.onCommand({ type: 'board.delete', payload: { boardId: board.id } });
                props.onDeleted();
              }}
            >
              Confirm delete (its links stop working)
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
          </>
        ) : (
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => {
              setConfirm(true);
            }}
          >
            Delete Board…
          </button>
        )}
      </div>
    </section>
  );
}
