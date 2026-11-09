'use client';

import type { BoardPresetDto, BoardStateSnapshot } from '@klockr/contracts';
import { useEffect, useState } from 'react';
import { BoardView } from '../../../../components/board/BoardView';
import { DeviceManager } from '../../../../components/devices/DeviceManager';
import { ShareManager } from '../../../../components/devices/ShareManager';
import { ApiError, fetchEventBoardPreview, sendEventCommand } from '../../../../lib/api';
import { applyBoardSnapshot, emptyBoardState } from '../../../../lib/live-state';
import { useEventRealtime } from '../../../../lib/use-realtime';
import { useServerNow } from '../../../../lib/use-server-now';
import styles from '../../../show/[showId]/show.module.css';
import { EventFrame } from '../event-frame';
import ev from '../event.module.css';

const EVENT_WIDE = '__event';
const PRESETS: readonly { value: BoardPresetDto; label: string }[] = [
  { value: 'room_agenda', label: 'Room Agenda' },
  { value: 'public_agenda', label: 'Central / Public Agenda' },
  { value: 'production', label: 'Production overview' },
  { value: 'backstage', label: 'Backstage' },
];

/**
 * Event Boards (Room Agenda, Central Agenda, Production overview — the same Board object and
 * renderer, with Room/Event sources), their share links, and the Event's persistent Devices.
 */
export function EventDevices({ eventId }: { eventId: string }) {
  const rt = useEventRealtime(eventId);
  const now = useServerNow(rt.offsetMs);
  const [preset, setPreset] = useState<BoardPresetDto>('room_agenda');
  const [source, setSource] = useState(EVENT_WIDE);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<BoardStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = rt.state;
  const disabled = rt.status !== 'connected';
  const boardId = selected ?? state?.boards[0]?.id ?? null;

  // Preview refreshes with every Event state (live values of the source Shows).
  const serverTime = state?.serverTime;
  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    fetchEventBoardPreview(eventId, boardId).then(
      (p) => {
        if (!cancelled) setPreview(p);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, boardId, serverTime]);

  if (!state) {
    return (
      <EventFrame eventId={eventId} view="devices" rt={rt} now={now}>
        <main className={ev.page} aria-busy>
          <p className={styles.muted}>Loading…</p>
        </main>
      </EventFrame>
    );
  }
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? 'Room';
  const previewState = preview ? applyBoardSnapshot(emptyBoardState, preview) : null;

  return (
    <EventFrame eventId={eventId} view="devices" rt={rt} now={now}>
      <main className={ev.page}>
        <div className={ev.forms}>
          <section className={styles.panel} aria-label="Event Boards" data-testid="event-boards">
            <span className="label">Event Boards</span>
            <ul className={styles.list}>
              {state.boards.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={styles.button}
                    aria-pressed={b.id === boardId}
                    data-testid="event-board"
                    data-name={b.name}
                    onClick={() => {
                      setSelected(b.id);
                    }}
                  >
                    {b.name} ·{' '}
                    {b.sources.kind === 'room' ? roomName(b.sources.roomId) : 'Whole Event'} ·{' '}
                    {b.audience}
                  </button>
                </li>
              ))}
            </ul>
            <div className={ev.inlineForm}>
              <select
                className={styles.input}
                value={preset}
                aria-label="Event Board preset"
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
              <select
                className={styles.input}
                value={source}
                aria-label="Event Board source"
                onChange={(e) => {
                  setSource(e.target.value);
                }}
              >
                <option value={EVENT_WIDE}>Whole Event (current Show per Room)</option>
                {state.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room: {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.button}
                disabled={disabled}
                onClick={() => {
                  setError(null);
                  sendEventCommand(eventId, {
                    type: 'board.create',
                    payload: { preset, roomId: source === EVENT_WIDE ? null : source },
                  }).then(
                    (r) => {
                      rt.applyState(r.state);
                      if (r.createdId) setSelected(r.createdId);
                    },
                    (e: unknown) => {
                      setError(e instanceof ApiError ? e.message : 'Could not create the Board');
                    },
                  );
                }}
              >
                + Event Board
              </button>
            </div>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </section>
          <section className={styles.panel} aria-label="Preview">
            <span className="label">Preview</span>
            <div className={ev.preview} data-testid="event-board-preview">
              {previewState?.board ? (
                <BoardView board={previewState.board} timers={previewState.timers} now={now} />
              ) : (
                <p className={styles.muted}>No Event Board yet.</p>
              )}
            </div>
          </section>
        </div>
        <ShareManager
          scope={{ kind: 'event', id: eventId }}
          boards={state.boards.map((b) => ({ id: b.id, name: b.name }))}
          disabled={disabled}
        />
        <DeviceManager
          scope={{ kind: 'event', id: eventId }}
          disabled={disabled}
          pushed={state.devices}
        />
      </main>
    </EventFrame>
  );
}
