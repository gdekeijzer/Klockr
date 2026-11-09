'use client';

import type { DeviceListResponse, DeviceSnapshot } from '@klockr/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  fetchDevices,
  sendDeviceCommand,
  type DeviceCommandBody,
  type Scope,
} from '../../lib/api';
import styles from '../../app/show/[showId]/show.module.css';
import m5 from './devices.module.css';

const STATUS_LABEL: Readonly<Record<DeviceSnapshot['status'], string>> = {
  online: 'ONLINE',
  recently_seen: 'RECENTLY SEEN',
  offline: 'OFFLINE',
  never_connected: 'NOT CONNECTED YET',
  revoked: 'REVOKED',
};

/**
 * Persistent Devices of one scope (an Event or a standalone Show): pair by code, rename,
 * assign / reassign a Board, revoke, remove. A Device only has identity and an assigned Board;
 * the Board decides what is shown. `pushed` carries realtime status updates.
 */
export function DeviceManager(props: {
  scope: Scope;
  disabled?: boolean;
  pushed?: DeviceSnapshot[] | null;
}) {
  const { kind, id } = props.scope;
  const scope = useMemo<Scope>(() => ({ kind, id }), [kind, id]);
  const [list, setList] = useState<DeviceListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [boardId, setBoardId] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDevices(scope).then(
      (l) => {
        if (!cancelled) setList(l);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load Devices');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Realtime status (online / offline, changes by another manager) wins over the last fetch.
  const devices = props.pushed ?? list?.devices ?? [];

  async function run(body: DeviceCommandBody) {
    setError(null);
    try {
      const result = await sendDeviceCommand(scope, body);
      setList(result);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Command failed');
      return false;
    }
  }

  const boards = list?.assignableBoards ?? [];
  const disabled = props.disabled ?? false;
  return (
    <section className={styles.panel} aria-label="Devices" data-testid="device-manager">
      <span className="label">Devices</span>
      <p className={styles.muted}>
        A Device is a fixed screen paired once (name, last seen, revoke). It shows the Board you
        assign. For ad-hoc viewing use a share link instead.
      </p>
      <form
        className={m5.form}
        onSubmit={(e) => {
          e.preventDefault();
          void run({
            type: 'device.pair',
            payload: { code, name, boardId: boardId || null },
          }).then((ok) => {
            if (ok) {
              setCode('');
              setName('');
            }
          });
        }}
      >
        <input
          className={`${styles.input} mono`}
          placeholder="7K4M-P2"
          value={code}
          aria-label="Pairing code"
          onChange={(e) => {
            setCode(e.target.value);
          }}
        />
        <input
          className={styles.input}
          placeholder="Speaker Monitor Main Stage"
          value={name}
          maxLength={80}
          aria-label="Device name"
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <select
          className={styles.input}
          value={boardId}
          aria-label="Board for new Device"
          onChange={(e) => {
            setBoardId(e.target.value);
          }}
        >
          <option value="">— assign later —</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.owner}: {b.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className={styles.button}
          disabled={disabled || !code.trim() || !name.trim()}
        >
          Pair Device
        </button>
      </form>
      <p className={styles.muted}>
        On the screen, open <span className="mono">/device</span> to get a pairing code.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {devices.map((d) => (
          <li key={d.id} className={m5.deviceRow} data-testid="device-row" data-name={d.name}>
            <div className={m5.deviceMain}>
              {editing === d.id ? (
                <span className={m5.inline}>
                  <input
                    className={styles.input}
                    value={newName}
                    aria-label={`Name of ${d.name}`}
                    onChange={(e) => {
                      setNewName(e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    onClick={() => {
                      void run({
                        type: 'device.rename',
                        payload: { deviceId: d.id, name: newName },
                      }).then(() => {
                        setEditing(null);
                      });
                    }}
                  >
                    Save name
                  </button>
                </span>
              ) : (
                <strong>{d.name}</strong>
              )}
              <span className={styles.tag} data-testid="device-status" data-status={d.status}>
                {STATUS_LABEL[d.status]}
              </span>
              <span className={styles.rowSub}>
                {d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleString()}` : ''}
              </span>
            </div>
            {d.status !== 'revoked' ? (
              <div className={m5.inline}>
                <select
                  className={styles.input}
                  value={d.assignedBoardId ?? ''}
                  aria-label={`Board for ${d.name}`}
                  disabled={disabled}
                  onChange={(e) => {
                    void run({
                      type: 'device.assign',
                      payload: { deviceId: d.id, boardId: e.target.value || null },
                    });
                  }}
                >
                  <option value="">— no Board —</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.owner}: {b.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`${styles.button} ${styles.small}`}
                  aria-label={`Rename ${d.name}`}
                  disabled={disabled}
                  onClick={() => {
                    setEditing(d.id);
                    setNewName(d.name);
                  }}
                >
                  Rename
                </button>
                {confirm === d.id ? (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    onClick={() => {
                      void run({ type: 'device.revoke', payload: { deviceId: d.id } });
                      setConfirm(null);
                    }}
                  >
                    Confirm revoke
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.small}`}
                    aria-label={`Revoke ${d.name}`}
                    disabled={disabled}
                    onClick={() => {
                      setConfirm(d.id);
                    }}
                  >
                    Revoke…
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                className={`${styles.button} ${styles.small}`}
                aria-label={`Remove ${d.name}`}
                disabled={disabled}
                onClick={() => {
                  void run({ type: 'device.remove', payload: { deviceId: d.id } });
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {list && devices.length === 0 && <p className={styles.muted}>No Devices paired yet.</p>}
    </section>
  );
}
