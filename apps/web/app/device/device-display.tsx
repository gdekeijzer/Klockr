'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { BoardView } from '../../components/board/BoardView';
import { claimPairing, startPairing } from '../../lib/api';
import { useDeviceRealtime } from '../../lib/use-realtime';
import { useServerNow } from '../../lib/use-server-now';
import styles from '../b/[token]/board.module.css';
import dv from './device.module.css';

const TOKEN_KEY = 'klockr:device-token';
const CLAIM_POLL_MS = 2_000;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Blocked storage: pairing works for this page load only.
  }
}

/**
 * A managed display. Unpaired: shows a short pairing code — no password is ever entered on the
 * screen. Paired: renders its assigned Board with the same renderer as share links; keeps
 * running through short outages and resynchronizes; shows DEVICE UNPAIRED once revoked.
 */
const noSubscription = () => () => undefined;

export function DeviceDisplay() {
  // Stored credential (client only; undefined during server rendering), overridden after
  // pairing / unpairing in this page.
  const stored = useSyncExternalStore(noSubscription, readToken, () => undefined);
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const token = override !== undefined ? override : stored;
  const onPaired = useCallback((t: string) => {
    writeToken(t);
    setOverride(t);
  }, []);
  const onUnpair = useCallback(() => {
    writeToken(null);
    setOverride(null);
  }, []);

  if (token === undefined) return <main className={styles.board} aria-busy />;
  return token ? (
    <PairedDevice token={token} onUnpair={onUnpair} />
  ) : (
    <Pairing onPaired={onPaired} />
  );
}

function Pairing({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startPairing().then(
      (pairing) => {
        if (stopped) return;
        setFailed(false);
        setCode(pairing.code);
        const poll = () => {
          void claimPairing(pairing.pairingSecret).then((claim) => {
            if (stopped) return;
            if (claim.status === 'paired') onPaired(claim.deviceToken);
            // Expired: start over with a fresh code.
            else if (claim.status === 'expired') {
              setCode(null);
              setRound((r) => r + 1);
            } else timer = setTimeout(poll, CLAIM_POLL_MS);
          });
        };
        timer = setTimeout(poll, CLAIM_POLL_MS);
      },
      () => {
        if (!stopped) {
          setFailed(true);
          timer = setTimeout(() => {
            setRound((r) => r + 1);
          }, 5_000);
        }
      },
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [round, onPaired]);

  return (
    <main className={styles.board}>
      <div className={dv.center} data-testid="device-pairing">
        <span className={dv.brand}>KLOCKR</span>
        <h1 className={dv.heading}>PAIR DEVICE</h1>
        {code ? (
          <>
            <span className={dv.codeLabel}>Code</span>
            <span className={`${dv.code} mono`} data-testid="pairing-code">
              {code}
            </span>
            <p className={dv.hint}>
              Enter this code in KLOCKR → Devices → Pair Device. Waiting for pairing…
            </p>
          </>
        ) : (
          <p className={dv.hint}>{failed ? 'No connection. Retrying…' : 'Requesting a code…'}</p>
        )}
      </div>
    </main>
  );
}

function PairedDevice({ token, onUnpair }: { token: string; onUnpair: () => void }) {
  const rt = useDeviceRealtime(token);
  const now = useServerNow(rt.offsetMs);

  if (rt.revoked || rt.denied) {
    return (
      <main className={styles.board}>
        <div className={dv.center} data-testid="device-unpaired">
          <span className={dv.brand}>KLOCKR</span>
          <h1 className={dv.heading}>DEVICE UNPAIRED</h1>
          <p className={dv.hint}>This screen is no longer paired with KLOCKR.</p>
          <button type="button" className={dv.again} onClick={onUnpair}>
            Pair again
          </button>
        </div>
      </main>
    );
  }
  if (rt.unassigned || !rt.board) {
    return (
      <main className={styles.board}>
        <div className={dv.center} data-testid="device-unassigned">
          <span className={dv.brand}>KLOCKR</span>
          <h1 className={dv.heading}>{rt.device?.name ?? 'Device'}</h1>
          <p className={dv.hint}>{rt.device ? 'Paired. No Board assigned yet.' : 'Connecting…'}</p>
        </div>
      </main>
    );
  }
  return (
    <div data-testid="device-board" data-device={rt.device?.name ?? ''}>
      <BoardView
        board={rt.board}
        timers={rt.timers}
        now={now}
        reconnecting={rt.status !== 'connected'}
      />
    </div>
  );
}
