import { serviceToken } from '@portfolio/shared/data-access';
import { io } from 'socket.io-client';

/** A socket-side handler for one of the three lifecycle events. */
export type SocketLifecycleEvent = 'connect' | 'disconnect' | 'connect_error';

/** What an emit with an acknowledgement looks like once a timeout is attached. */
export interface SocketEmitter {
  emitWithAck(event: string, body: unknown): Promise<unknown>;
}

/**
 * The socket, as **this app** needs it, and no wider.
 *
 * Six members instead of `Socket`'s several dozen, for two reasons and the second is
 * the one that pays:
 *
 * 1. Rule D4's spirit applied to a library boundary. No `socket.io-client` type
 *    crosses this file, so the SSE implementation plan 0004 section 6.1 defers is a new
 *    class rather than a refactor, and it satisfies an interface it can actually read.
 * 2. **No spec imports `socket.io-client`.** A transport spec that has to stub a real
 *    socket ends up stubbing its reconnection engine, which is precisely the machinery
 *    the transport turns off; the test would then be about the library's behaviour
 *    rather than the transport's. If a spec ever has to reach for the real thing, this
 *    interface is the wrong shape.
 */
export interface SocketLike {
  /** Whether the transport is up right now. */
  readonly connected: boolean;

  connect(): void;
  disconnect(): void;

  on(event: SocketLifecycleEvent, handler: (payload?: unknown) => void): void;

  /** One listener for every server event. See `RealtimeSocket`: one, not twenty five. */
  onAny(handler: (event: string, ...args: readonly unknown[]) => void): void;

  /** `timeout(ms).emitWithAck(...)`. An ack that never comes must not wait forever. */
  timeout(ms: number): SocketEmitter;
}

/**
 * How the socket is opened. Only the options the transport actually sets.
 *
 * All four are load bearing and each is argued in plan 0016 section 6, so none of them
 * has a sensible default worth omitting here.
 */
export interface SocketConnectOptions {
  /** The bearer token, the first place the server looks (`realtime.gateway.ts:194`). */
  readonly auth: { readonly token: string };

  /** `['websocket']`, always. R10: the service runs at two replicas with no affinity. */
  readonly transports: readonly string[];

  /** `false`, always. R2: only the transport can await a token refresh before retrying. */
  readonly reconnection: boolean;

  /** `false`, always. The transport connects when it has decided to, not on construction. */
  readonly autoConnect: boolean;
}

export type SocketFactory = (
  url: string,
  options: SocketConnectOptions
) => SocketLike;

/**
 * Makes the socket. Overridden in specs with a hand-driven fake.
 *
 * A token rather than a bare import so the transport's lifecycle can be tested without
 * a network, a timer, or the library's own reconnection engine in the way.
 */
export const SOCKET_FACTORY = serviceToken<SocketFactory>(
  'SOCKET_FACTORY',
  () => (url, options) =>
    io(url, {
      ...options,
      // Copied out of the readonly interface, which is the one place a mutable array
      // has to be handed over: the library's own option type wants one.
      transports: [...options.transports],
    }) as unknown as SocketLike
);
