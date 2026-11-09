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
import {
  applyBoardSnapshot,
  applyBoardTimer,
  applyShowState,
  applyTimerUpdate,
  emptyBoardState,
  emptyManagementState,
  type BoardState,
  type ManagementState,
} from './live-state';
import { ClockOffsetEstimator } from './timer-sync';

/**
 * `connected` means: socket open AND a fresh authoritative snapshot received after (re)connect.
 * `reconnecting` covers the first seconds of an outage; `offline` a longer one.
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const OFFLINE_AFTER_MS = 10_000;
const CLOCK_PING_INTERVAL_MS = 15_000;

type KlockrClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Connection {
  readonly status: ConnectionStatus;
  /** serverTime - localTime, for rendering in server time. */
  readonly offsetMs: number;
  /** Set when the credential is rejected; reconnecting will not help. */
  readonly denied: boolean;
}

/**
 * One read-only Socket.IO subscription with reconnect, offline detection and clock-offset
 * estimation. `register` attaches the event handlers; `onSnapshot` must be called by the
 * snapshot handler (it marks the connection live and seeds the clock offset).
 */
function useSocket(
  auth: RealtimeAuth,
  register: (socket: KlockrClientSocket, onSnapshot: (serverTime: number) => void) => void,
): Connection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [offsetMs, setOffsetMs] = useState(0);
  const [denied, setDenied] = useState(false);
  const estimator = useRef(new ClockOffsetEstimator());
  const registerRef = useRef(register);
  const authKey = JSON.stringify(auth);

  useEffect(() => {
    const socket: KlockrClientSocket = io({
      path: REALTIME_PATH,
      auth: JSON.parse(authKey) as RealtimeAuth,
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

    registerRef.current(socket, (serverTime) => {
      clearTimeout(offlineTimer);
      setOffsetMs(estimator.current.seedFromServerTime(serverTime, Date.now()));
      setStatus('connected');
      ping();
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
  }, [authKey]);

  return { status, offsetMs, denied };
}

export interface ShowRealtime extends Connection, ManagementState {
  readonly show: ShowStateSnapshot['show'] | null;
  /** Feed an authoritative Show state received via HTTP (command response); revision-gated. */
  readonly applyState: (state: ShowStateSnapshot) => void;
  /** Feed an authoritative timer received via HTTP (command response); revision-gated. */
  readonly applyTimer: (timer: TimerSnapshot) => void;
}

/** Operator / Master / Boards admin subscription (owner cookie): the whole Show. */
export function useShowRealtime(showId: string): ShowRealtime {
  const [state, setState] = useState<ManagementState>(emptyManagementState);

  const connection = useSocket({ role: 'operator', showId }, (socket, onSnapshot) => {
    socket.on(realtimeEvents.showSnapshot, (s) => {
      setState((current) => applyShowState(current, s));
      onSnapshot(s.serverTime);
    });
    socket.on(realtimeEvents.show, (s) => {
      setState((current) => applyShowState(current, s));
    });
    socket.on(realtimeEvents.timer, (t) => {
      setState((current) => applyTimerUpdate(current, t));
    });
  });

  const applyState = useCallback((s: ShowStateSnapshot) => {
    setState((current) => applyShowState(current, s));
  }, []);
  const applyTimer = useCallback((timer: TimerSnapshot) => {
    setState((current) => applyTimerUpdate(current, timer));
  }, []);

  return { ...connection, ...state, show: state.state?.show ?? null, applyState, applyTimer };
}

export type BoardRealtime = Connection & BoardState;

/** Board subscription (board token): only this Board's scoped projection. */
export function useBoardRealtime(token: string): BoardRealtime {
  const [state, setState] = useState<BoardState>(emptyBoardState);
  const connection = useSocket({ role: 'board', boardShareToken: token }, (socket, onSnapshot) => {
    socket.on(realtimeEvents.boardSnapshot, (s: BoardStateSnapshot) => {
      setState((current) => applyBoardSnapshot(current, s));
      onSnapshot(s.serverTime);
    });
    socket.on(realtimeEvents.timer, (t) => {
      setState((current) => applyBoardTimer(current, t));
    });
  });
  return { ...connection, ...state };
}
