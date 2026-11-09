'use client';

import type { BoardShareSnapshot } from '@klockr/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createScopedShare,
  fetchBoardShares,
  revokeShare,
  type Scope,
} from '../../lib/api';
import styles from '../../app/show/[showId]/show.module.css';
import m5 from './devices.module.css';

/**
 * Board share links of one scope: read-only URLs for ad-hoc use, without a persistent
 * identity. Listed with Board, label and creation time; revocation is immediate (open displays
 * show "link revoked"). The secret itself is only visible right after creation.
 */
export function ShareManager(props: {
  scope: Scope;
  boards: readonly { id: string; name: string }[];
  disabled?: boolean;
}) {
  const { boards } = props;
  const { kind, id } = props.scope;
  const scope = useMemo<Scope>(() => ({ kind, id }), [kind, id]);
  const [shares, setShares] = useState<readonly BoardShareSnapshot[]>([]);
  const [boardId, setBoardId] = useState('');
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const reload = () => {
    setVersion((v) => v + 1);
  };

  useEffect(() => {
    let cancelled = false;
    fetchBoardShares(scope).then(
      (r) => {
        if (!cancelled) setShares(r.shares);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load share links');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scope, version]);

  const selected = boardId || boards[0]?.id || '';
  return (
    <section className={styles.panel} aria-label="Share links" data-testid="share-manager">
      <span className="label">Share links</span>
      <p className={styles.muted}>
        A share link is a read-only URL for quick, temporary use. Revoke it when it is no longer
        needed.
      </p>
      <div className={m5.form}>
        <select
          className={styles.input}
          value={selected}
          aria-label="Board to share"
          onChange={(e) => {
            setBoardId(e.target.value);
          }}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          className={styles.input}
          value={label}
          maxLength={80}
          placeholder="Label (optional)"
          aria-label="Share label"
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
        <button
          type="button"
          className={styles.button}
          disabled={(props.disabled ?? false) || !selected}
          onClick={() => {
            setError(null);
            void createScopedShare(scope, selected, label)
              .then((s) => {
                setCreated(`${window.location.origin}/b/${s.boardShareToken}`);
                setLabel('');
                reload();
              })
              .catch((e: unknown) => {
                setError(e instanceof ApiError ? e.message : 'Could not create the link');
              });
          }}
        >
          New share link
        </button>
      </div>
      {created && (
        <input
          className={`${styles.input} mono`}
          readOnly
          value={created}
          aria-label="New share link"
          data-testid="new-share-link"
        />
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {shares.map((s) => (
          <li
            key={s.id}
            className={m5.deviceRow}
            data-testid="share-row"
            data-label={s.label ?? ''}
            data-revoked={s.revokedAt !== null}
          >
            <div className={m5.deviceMain}>
              <strong>{s.label ?? 'Unlabeled link'}</strong>
              <span className={styles.rowSub}>
                {s.boardName} · created {new Date(s.createdAt).toLocaleString()}
              </span>
              {s.revokedAt !== null && <span className={styles.tag}>REVOKED</span>}
            </div>
            {s.revokedAt === null && (
              <button
                type="button"
                className={`${styles.button} ${styles.small}`}
                aria-label={`Revoke link ${s.label ?? s.boardName}`}
                disabled={props.disabled}
                onClick={() => {
                  void revokeShare(scope, s.id).then(reload, reload);
                }}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
