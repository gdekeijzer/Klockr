'use client';

import {
  REALTIME_PATH,
  realtimeEvents,
  type BoardStateSnapshot,
  type ClockAck,
  type ClientToServerEvents,
  type RealtimeAuth,
  type ServerToClientEvents,
  type ShowStateSnapshot,
  type TimerSnapshot,
} from '@klockr/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { acceptTimer, ClockOffsetEstimator } from './timer-sync';

/**
 * `connected` means: socket open AND a fresh authoritative snapshot received after (re)connect.
 * `reconnecting` covers the first seconds of an outage; `offline` a longer one.
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const OFFLINE_AFTER_MS = 10_000;
const CLOCK_PING_INTERVAL_MS = 15_000;

type KlockrClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RealtimeState<TSnapshot> {
  readonly status: ConnectionStatus;
  readonly snapshot: TSnapshot | null;
  readonly timer: TimerSnapshot | null;
  /** serverTime - localTime, for rendering in server time. */
  readonly offsetMs: number;
  /** Set when the credential is rejected; reconnecting will not help. */
  readonly denied: boolean;
  /** Feed an authoritative timer received via HTTP (command response); revision-gated. */
  readonly applyTimer: (timer: TimerSnapshot) => void;
}

export function useRealtime<TSnapshot extends ShowStateSnapshot | BoardStateSnapshot>(
  auth: RealtimeAuth,
  snapshotEvent: 'show.snapshot' | 'board.snapshot',
): RealtimeState<TSnapshot> {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null);
  const [timer, setTimer] = useState<TimerSnapshot | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [denied, setDenied] = useState(false);
  const estimator = useRef(new ClockOffsetEstimator());
  const authKey = JSON.stringify(auth);

  const applyTimer = useCallback((incoming: TimerSnapshot) => {
    setTimer((current) => acceptTimer(current, incoming));
  }, []);

  useEffect(() => {
    const parsedAuth = JSON.parse(authKey) as RealtimeAuth;
    const socket: KlockrClientSocket = io({
      path: REALTIME_PATH,
      auth: parsedAuth,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
      timeout: 5_000,
    });
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;

    const ping = () => {
      const sentAt = Date.now();
      socket
        .timeout(3_000)
        .emitWithAck(realtimeEvents.clock)
        .then(({ serverTime }: ClockAck) => {
          setOffsetMs(estimator.current.addSample(sentAt, serverTime, Date.now()));
        })
        .catch(() => {
          // A lost ping is harmless; the previous offset stays in use.
        });
    };

    const onSnapshot = (s: ShowStateSnapshot | BoardStateSnapshot) => {
      clearTimeout(offlineTimer);
      setOffsetMs(estimator.current.seedFromServerTime(s.timer.serverTime, Date.now()));
      setSnapshot(s as TSnapshot);
      setTimer((current) => acceptTimer(current, s.timer));
      setStatus('connected');
      ping();
    };

    socket.on(snapshotEvent, onSnapshot);
    socket.on(realtimeEvents.timer, (t) => {
      setTimer((current) => acceptTimer(current, t));
    });
    socket.on('disconnect', (reason) => {
      setStatus('reconnecting');
      clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => {
        setStatus('offline');
      }, OFFLINE_AFTER_MS);
      // A server-initiated disconnect is not retried automatically by Socket.IO.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'unauthorized' || error.message === 'invalid_auth') {
        setDenied(true);
        socket.disconnect();
      }
    });

    const interval = setInterval(() => {
      if (socket.connected) ping();
    }, CLOCK_PING_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(offlineTimer);
      socket.disconnect();
    };
  }, [authKey, snapshotEvent]);

  return { status, snapshot, timer, offsetMs, denied, applyTimer };
}
