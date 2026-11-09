import { InMemoryIdempotencyStore, InMemoryStore } from '@klockr/application/testing';
import {
  REALTIME_PATH,
  type ClientToServerEvents,
  type RealtimeAuth,
  type ServerToClientEvents,
} from '@klockr/contracts';
import { systemClock, type Clock } from '@klockr/domain';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { buildApp } from '../app';
import { RealtimeHub } from '../realtime/hub';
import { attachRealtime } from '../realtime/socket';
import { createServices, type Persistence } from '../services';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Full server (HTTP + realtime) on an ephemeral port. In-memory persistence unless given. */
export async function startTestServer(options: { clock?: Clock; persistence?: Persistence } = {}) {
  const clock = options.clock ?? systemClock;
  const store = new InMemoryStore();
  const persistence = options.persistence ?? { store, idempotency: new InMemoryIdempotencyStore() };
  const hub = new RealtimeHub(clock);
  const services = createServices({ clock, events: hub, persistence });
  const app = await buildApp({ version: 'test', logLevel: 'silent', clock, services });
  const io = attachRealtime(app.server, services, hub);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(port)}`;

  const clients: ClientSocket[] = [];
  return {
    app,
    io,
    store,
    services,
    baseUrl,
    connect(auth: RealtimeAuth, cookie?: string): ClientSocket {
      const socket: ClientSocket = ioClient(baseUrl, {
        path: REALTIME_PATH,
        auth,
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        ...(cookie ? { extraHeaders: { cookie } } : {}),
      });
      clients.push(socket);
      return socket;
    },
    async close() {
      for (const c of clients) c.disconnect();
      await io.close();
      await app.close();
    },
  };
}

/** Wait for one event without timers-as-sleeps: resolves on the event, rejects on timeout. */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  timeoutMs = 3_000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const listener = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, listener as unknown as ServerToClientEvents[E] as never);
  });
}

export function connectError(socket: ClientSocket, timeoutMs = 3_000): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('expected connect_error'));
    }, timeoutMs);
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      resolve(error);
    });
  });
}

/** Extract `name=value` of the Set-Cookie header for re-sending as a Cookie header. */
export function cookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('no set-cookie');
  return header.split(';')[0] ?? '';
}
