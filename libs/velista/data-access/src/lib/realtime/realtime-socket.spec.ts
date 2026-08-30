import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import {
  AppResumed,
  ConnectionState,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { TokenStore } from '../auth/token-store';
import type { RealtimeEvent } from './realtime-events';
import { RealtimeSocket } from './realtime-socket';
import {
  SOCKET_FACTORY,
  type SocketConnectOptions,
  type SocketEmitter,
  type SocketLifecycleEvent,
  type SocketLike,
} from './socket-factory';

/**
 * A socket driven entirely by hand.
 *
 * No `socket.io-client` anywhere in this file, which is the point of `SocketLike`: a
 * spec that stubbed the real thing would end up stubbing the reconnection engine the
 * transport deliberately turns off, and would then be a test of the library rather than
 * of the lifecycle.
 */
class FakeSocket implements SocketLike {
  connected = false;

  readonly emitted: { readonly message: string; readonly body: unknown }[] = [];

  /** What to answer per message, in order. `'timeout'` never answers at all. */
  readonly answers = new Map<
    string,
    ('ok' | 'refused' | 'timeout' | unknown)[]
  >();

  private readonly _handlers = new Map<
    SocketLifecycleEvent,
    ((payload?: unknown) => void)[]
  >();
  private _any: ((event: string, ...args: readonly unknown[]) => void) | null =
    null;

  connect(): void {
    // Deliberately inert. Every spec decides for itself whether this connection came
    // up, was refused, or was dropped, by calling the three drivers below.
  }

  disconnect(): void {
    this.connected = false;
  }

  on(event: SocketLifecycleEvent, handler: (payload?: unknown) => void): void {
    const existing = this._handlers.get(event) ?? [];
    existing.push(handler);
    this._handlers.set(event, existing);
  }

  onAny(handler: (event: string, ...args: readonly unknown[]) => void): void {
    this._any = handler;
  }

  timeout(): SocketEmitter {
    return {
      emitWithAck: (message: string, body: unknown) => {
        this.emitted.push({ message, body });

        const queue = this.answers.get(message);
        const answer =
          queue === undefined || queue.length === 0 ? 'ok' : queue.shift();

        if (answer === 'timeout') {
          return Promise.reject(new Error('operation has timed out'));
        }
        if (answer === 'ok') {
          return Promise.resolve({ ok: true });
        }
        if (answer === 'refused') {
          return Promise.resolve({ ok: false });
        }
        return Promise.resolve(answer);
      },
    };
  }

  // ------------------------------------------------------------------ the drivers

  driveConnect(): void {
    this.connected = true;
    this._fire('connect');
  }

  driveDisconnect(): void {
    this.connected = false;
    this._fire('disconnect');
  }

  driveConnectError(): void {
    this.connected = false;
    this._fire('connect_error');
  }

  driveEvent(name: string, payload: unknown): void {
    this._any?.(name, payload);
  }

  /** Every emit of one message, oldest first. */
  bodiesFor(message: string): unknown[] {
    return this.emitted
      .filter((entry) => entry.message === message)
      .map((entry) => entry.body);
  }

  private _fire(event: SocketLifecycleEvent): void {
    for (const handler of this._handlers.get(event) ?? []) {
      handler();
    }
  }
}

/** A membership payload the mapper accepts, so a good event can be asserted on. */
const MEMBERSHIP = {
  id: 'm1',
  zoneId: 'z1',
  userId: 'u1',
  username: 'Ines',
  role: 'MEMBER',
  status: 'APPROVED',
};

describe('RealtimeSocket', () => {
  let sockets: FakeSocket[];
  let options: SocketConnectOptions[];
  /** A real signal, not a getter: the transport drives its lifecycle off an effect. */
  let authenticated: WritableSignal<boolean>;
  /** The resume counter `AppResumed` publishes. Bumped by hand, never by a browser. */
  let resumes: WritableSignal<number>;
  let token: string | null;
  let tokenCalls: number;

  /** When set, `ensureFreshToken` hangs until `releaseToken` is called. */
  let holdToken: boolean;
  let releaseToken: (() => void) | null;

  function socket(): FakeSocket {
    const last = sockets.at(-1);
    if (last === undefined) {
      throw new Error('no socket was created');
    }
    return last;
  }

  function build(): RealtimeSocket {
    const client = TestBed.inject(RealtimeSocket);
    TestBed.tick();
    return client;
  }

  /**
   * Drain the microtask queue.
   *
   * Generously, and on purpose: a reconcile is an async function awaiting a
   * `Promise.all` of async functions each awaiting an emit, so the chain is a good many
   * turns deep and counting them exactly would make every spec here hostage to one more
   * `await` appearing inside the transport. Microtasks are unaffected by fake timers, so
   * this works in both halves of the file.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 40; turn += 1) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    sockets = [];
    options = [];
    authenticated = signal(true);
    resumes = signal(0);
    token = 'fresh-token';
    tokenCalls = 0;
    holdToken = false;
    releaseToken = null;

    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(),
        // The resume edge, faked rather than driven through a document: what this
        // transport reacts to is the count moving, and how the browser said so is
        // `app-resumed.spec.ts`'s business.
        { provide: AppResumed, useValue: { resumes } },
        ConnectionState,
        ApiUrl,
        RealtimeSocket,
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: 'http://gateway.test',
            realtimeBaseUrl: 'http://realtime.test',
          },
        },
        {
          provide: TokenStore,
          useValue: {
            ensureFreshToken: async () => {
              tokenCalls += 1;
              if (holdToken) {
                await new Promise<void>((resolve) => {
                  releaseToken = resolve;
                });
              }
              return token;
            },
            // R1's authentication check. It reads the pair here rather than through
            // the session store, so the socket stays below the session in the DI
            // graph: the session injects `ProfileStore`, which listens to this client.
            hasSession: () => authenticated(),
          },
        },
        {
          provide: SOCKET_FACTORY,
          useValue: (_url: string, connectOptions: SocketConnectOptions) => {
            options.push(connectOptions);
            const created = new FakeSocket();
            sockets.push(created);
            return created;
          },
        },
      ],
    });
  });

  describe('R1, no socket while anonymous', () => {
    it('never calls the factory for an anonymous caller', async () => {
      // The server verifies the token in `handleConnection` and drops the connection
      // on failure, so an anonymous connect is a guaranteed disconnect.
      authenticated.set(false);

      build();
      await settle();

      expect(sockets).toEqual([]);
      expect(tokenCalls).toBe(0);
    });

    it('drops everything on sign out', async () => {
      const client = build();
      await settle();
      socket().driveConnect();
      client.subscribeZone('z1');
      await settle();

      authenticated.set(false);
      TestBed.tick();

      expect(client.connected()).toBe(false);
      expect(client.degraded()).toBe(false);
      expect(client.refusedZones().size).toBe(0);
    });
  });

  describe('R2, a fresh token before every connect', () => {
    it('passes the refreshed token as the handshake auth', async () => {
      // The auth payload is the first place the server looks for it.
      build();
      await settle();

      expect(tokenCalls).toBe(1);
      expect(options[0].auth).toEqual({ token: 'fresh-token' });
    });

    it('turns the library reconnection off and forces the websocket transport', async () => {
      // R2 and R10. The engine's own reconnect cannot await a refresh, and long polling
      // needs session affinity the two-replica deployment does not have.
      build();
      await settle();

      expect(options[0].reconnection).toBe(false);
      expect(options[0].autoConnect).toBe(false);
      expect(options[0].transports).toEqual(['websocket']);
    });

    it('does not open a socket for a session that ended while the token was in flight', async () => {
      holdToken = true;
      build();
      await settle();

      authenticated.set(false);
      TestBed.tick();
      releaseToken?.();
      await settle();

      expect(sockets).toEqual([]);
    });
  });

  describe('R3, the degraded latch', () => {
    it('latches after two consecutive failed connects and stops calling the factory', async () => {
      jest.useFakeTimers();
      try {
        const client = build();
        await settle();

        socket().driveConnectError();
        expect(client.degraded()).toBe(false);

        jest.runOnlyPendingTimers();
        await settle();
        expect(sockets.length).toBe(2);

        socket().driveConnectError();
        expect(client.degraded()).toBe(true);

        jest.runOnlyPendingTimers();
        await settle();
        expect(sockets.length).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('counts a connect that is dropped straight away, which is what a bad token looks like', async () => {
      // The server answers a bad token by disconnecting inside `handleConnection`, with
      // no error at all. Clearing the counter on `connect` would reset it on exactly the
      // failure the counter exists to catch, and the client would loop forever.
      jest.useFakeTimers();
      try {
        const client = build();
        await settle();

        socket().driveConnect();
        socket().driveDisconnect();
        jest.runOnlyPendingTimers();
        await settle();

        socket().driveConnect();
        socket().driveDisconnect();

        expect(client.degraded()).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('re-arms on retry()', async () => {
      jest.useFakeTimers();
      try {
        const client = build();
        await settle();
        socket().driveConnectError();
        jest.runOnlyPendingTimers();
        await settle();
        socket().driveConnectError();
        expect(client.degraded()).toBe(true);

        client.retry();
        await settle();

        expect(client.degraded()).toBe(false);
        expect(sockets.length).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it('re-arms when the app comes back from the background', async () => {
      // Plan 0035, section 3. Regaining the network used to be the only re-arm, and a
      // backgrounded app never lost it: the browser froze the page, closed the socket
      // and stopped the timers, so the app came back latched `degraded` waiting for an
      // `online` event that will never fire. `onLine` is deliberately untouched here,
      // because that is the whole of the bug.
      jest.useFakeTimers();
      try {
        const client = build();
        await settle();
        socket().driveConnectError();
        jest.runOnlyPendingTimers();
        await settle();
        socket().driveConnectError();
        expect(client.degraded()).toBe(true);

        resumes.set(1);
        TestBed.tick();
        await settle();

        expect(client.degraded()).toBe(false);
        expect(sockets.length).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it('opens no second socket when a resume finds a healthy one', async () => {
      // Unconditional and close to free: `_start` returns immediately when a socket is
      // already open, so a person glancing at their phone costs nothing.
      const client = build();
      await settle();
      socket().driveConnect();
      await settle();

      resumes.set(1);
      TestBed.tick();
      await settle();

      expect(sockets.length).toBe(1);
      expect(client.connected()).toBe(true);
    });
  });

  describe('R4, ConnectionState is never touched', () => {
    it('reports nothing to it on any path', async () => {
      // `ConnectionState.offline` raises the blocking screen, which is for a lost
      // network. Blocking a user whose every REST call succeeds is the specific harm,
      // so this is asserted on calls that must not happen rather than on a return.
      const connection = TestBed.inject(ConnectionState);
      const failure = jest.spyOn(connection, 'reportNetworkFailure');
      const reachable = jest.spyOn(connection, 'reportReachable');

      jest.useFakeTimers();
      try {
        const client = build();
        await settle();
        socket().driveConnect();
        client.subscribeZone('z1');
        await settle();
        socket().driveDisconnect();
        jest.runOnlyPendingTimers();
        await settle();
        socket().driveConnectError();

        expect(client.degraded()).toBe(true);
        expect(failure).not.toHaveBeenCalled();
        expect(reachable).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('R5, a token refresh never reconnects', () => {
    it('keeps the same socket when the token changes under it', async () => {
      // The socket reads the token at connect time, so the next reconnect uses the
      // current one by itself. Tearing down a healthy connection every fifteen minutes
      // buys a full resubscribe cycle and nothing else.
      const client = build();
      await settle();
      socket().driveConnect();

      token = 'a-newer-token';
      TestBed.tick();
      await settle();

      expect(sockets.length).toBe(1);
      expect(client.connected()).toBe(true);
    });
  });

  /**
   * Plan 0017. The intents ride on the subscriptions, so the ordering between the two
   * is the whole of what can go wrong here.
   */
  describe('presence', () => {
    it('announces the view only after the subscribe it depends on is answered', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      client.viewList('l1');
      await settle();

      // The server refuses `presence.view` from a socket that is not in the room, so
      // the order is not a preference: the other way round is a refusal.
      const messages = socket().emitted.map((entry) => entry.message);
      expect(messages).toEqual(['list.subscribe', 'presence.view']);
      expect(socket().bodiesFor('presence.view')).toEqual([{ listId: 'l1' }]);
    });

    it('takes the list room for a viewer, so a caller holds one thing', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      const release = client.viewList('l1');
      await settle();
      release();
      await settle();

      expect(socket().bodiesFor('list.unsubscribe')).toEqual([
        { listId: 'l1' },
      ]);
      // Nothing said about presence: `list.unsubscribe` clears the viewer and the
      // editor entries on the server, so saying it again buys two acks for nothing.
      expect(socket().bodiesFor('presence.unview')).toEqual([]);
    });

    it('unviews without leaving the room when an observer still holds it', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      client.subscribeList('l1');
      const viewer = client.viewList('l1');
      await settle();
      viewer();
      await settle();

      expect(socket().bodiesFor('presence.unview')).toEqual([{ listId: 'l1' }]);
      expect(socket().bodiesFor('list.unsubscribe')).toEqual([]);
    });

    it('sends the edited line, and moves it with no stop in between', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      client.viewList('l1');
      await settle();

      client.setEditingLine('l1', 'line-1');
      await settle();
      client.setEditingLine('l1', 'line-2');
      await settle();

      expect(socket().bodiesFor('presence.edit')).toEqual([
        { listId: 'l1', lineId: 'line-1' },
        { listId: 'l1', lineId: 'line-2' },
      ]);
      expect(socket().bodiesFor('presence.stopEdit')).toEqual([]);

      client.setEditingLine('l1', null);
      await settle();
      expect(socket().bodiesFor('presence.stopEdit')).toEqual([
        { listId: 'l1' },
      ]);
    });

    it('re-announces every view and the edited line on the next connection', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      client.viewList('l1');
      await settle();
      client.setEditingLine('l1', 'line-1');
      await settle();

      const first = socket();
      jest.useFakeTimers();
      try {
        first.driveDisconnect();
        jest.runOnlyPendingTimers();
        await settle();
      } finally {
        jest.useRealTimers();
      }

      socket().driveConnect();
      await settle();

      // Presence is per connection on both ends: the new socket is present nowhere,
      // however sure the registry is that this client is viewing and editing.
      expect(socket()).not.toBe(first);
      expect(socket().bodiesFor('presence.view')).toEqual([{ listId: 'l1' }]);
      expect(socket().bodiesFor('presence.edit')).toEqual([
        { listId: 'l1', lineId: 'line-1' },
      ]);
    });

    it('does not repeat a refused view, and never calls it a stale zone', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      socket().answers.set('presence.view', ['refused', 'ok']);
      client.viewList('l1');
      await settle();

      // Whatever the disagreement is, asking again on this connection gets the same
      // answer. And it is not a zone going stale: an unheard intent costs an avatar,
      // not an update, so the badge that means "this group is not live" stays off.
      client.viewList('l1');
      await settle();

      expect(socket().bodiesFor('presence.view')).toEqual([{ listId: 'l1' }]);
      expect([...client.refusedZones()]).toEqual([]);
    });

    it('retries an intent that timed out', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      socket().answers.set('presence.view', ['timeout']);

      jest.useFakeTimers();
      try {
        client.viewList('l1');
        await settle();
        expect(socket().bodiesFor('presence.view')).toEqual([{ listId: 'l1' }]);

        // A timeout is not a refusal, here for the sharper version of R7's reason: an
        // unsent stop leaves the server telling everybody else that this client is
        // still editing a line it walked away from.
        jest.runOnlyPendingTimers();
        await settle();
      } finally {
        jest.useRealTimers();
      }

      expect(socket().bodiesFor('presence.view')).toEqual([
        { listId: 'l1' },
        { listId: 'l1' },
      ]);
    });
  });

  describe('R6, resubscribing from the registry', () => {
    it('re-issues every held subscription on the next connect', async () => {
      const client = build();
      await settle();
      socket().driveConnect();
      client.subscribeZone('z1', { staff: true });
      client.subscribeZone('z2');
      await settle();

      const first = socket();
      expect(first.bodiesFor('zone.subscribe')).toEqual([
        { zoneId: 'z1' },
        { zoneId: 'z2' },
      ]);

      jest.useFakeTimers();
      try {
        first.driveDisconnect();
        jest.runOnlyPendingTimers();
        await settle();
      } finally {
        jest.useRealTimers();
      }

      socket().driveConnect();
      await settle();

      expect(socket()).not.toBe(first);
      expect(socket().bodiesFor('zone.subscribe')).toEqual([
        { zoneId: 'z1' },
        { zoneId: 'z2' },
      ]);
    });

    it('subscribes once for two holders of the same zone', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      client.subscribeZone('z1');
      const release = client.subscribeZone('z1', { staff: true });
      await settle();

      // One refcount, whatever the staff intents. The second holder promotes the ask
      // rather than opening a second one.
      expect(socket().bodiesFor('zone.subscribe')).toEqual([{ zoneId: 'z1' }]);

      release();
      await settle();

      // R-S3: the demotion is a bare re-subscribe, with no unsubscribe in between.
      expect(socket().bodiesFor('zone.subscribe')).toEqual([
        { zoneId: 'z1' },
        { zoneId: 'z1' },
      ]);
      expect(socket().bodiesFor('zone.unsubscribe')).toEqual([]);
    });

    it('unsubscribes when the last holder releases', async () => {
      const client = build();
      await settle();
      socket().driveConnect();
      const release = client.subscribeZone('z1');
      await settle();

      release();
      await settle();

      expect(socket().bodiesFor('zone.unsubscribe')).toEqual([
        { zoneId: 'z1' },
      ]);
    });
  });

  describe('R7 and R8, acknowledgements', () => {
    it('leaves a timed-out zone out of refusedZones and asks again', async () => {
      // A slow answer means core was busy, not that the caller was declined. Latching
      // one would paint a permanent "not live" badge on a group that was merely slow.
      jest.useFakeTimers();
      try {
        const client = build();
        await settle();
        socket().driveConnect();
        socket().answers.set('zone.subscribe', ['timeout']);

        client.subscribeZone('z1');
        await settle();

        expect(client.refusedZones().size).toBe(0);

        jest.runOnlyPendingTimers();
        await settle();

        expect(socket().bodiesFor('zone.subscribe')).toEqual([
          { zoneId: 'z1' },
          { zoneId: 'z1' },
        ]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('treats an unrecognisable acknowledgement as a failure, not a refusal', async () => {
      // Rule D4 applies to an ack as much as to a response body, and ambiguity has to
      // fall on the side that recovers.
      const client = build();
      await settle();
      socket().driveConnect();
      socket().answers.set('zone.subscribe', [{ status: 'maybe' }]);

      client.subscribeZone('z1');
      await settle();

      expect(client.refusedZones().size).toBe(0);
    });

    it('latches a refusal and clears it on the next connect', async () => {
      const client = build();
      await settle();
      socket().driveConnect();
      socket().answers.set('zone.subscribe', ['refused']);

      client.subscribeZone('z1');
      await settle();
      expect([...client.refusedZones()]).toEqual(['z1']);

      // Not asked again on this connection: core would give the same answer.
      const asked = socket().bodiesFor('zone.subscribe').length;
      client.subscribeZone('z1');
      await settle();
      expect(socket().bodiesFor('zone.subscribe').length).toBe(asked);

      jest.useFakeTimers();
      try {
        socket().driveDisconnect();
        jest.runOnlyPendingTimers();
        await settle();
      } finally {
        jest.useRealTimers();
      }
      socket().driveConnect();
      await settle();

      expect(client.refusedZones().size).toBe(0);
    });
  });

  describe('R9, nothing throws out of a handler', () => {
    it('drops an unmapped payload, counts it, and keeps delivering', async () => {
      // A silent drop is the one realtime failure with no symptom at all, so the
      // counter is the only thing that would ever reveal a backend payload change.
      const client = build();
      await settle();
      socket().driveConnect();

      const seen: RealtimeEvent[] = [];
      client.events.subscribe((event) => seen.push(event));

      socket().driveEvent('member.joined', { nonsense: true });
      socket().driveEvent('member.joined', MEMBERSHIP);

      expect(client.droppedEvents().get('member.joined')).toBe(1);
      expect(seen.map((event) => event.type)).toEqual(['member.joined']);
    });

    it('ignores an event name it does not know, without counting it', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      socket().driveEvent('zone.somethingNew', {});

      expect(client.droppedEvents().size).toBe(0);
    });

    it('survives a subscriber that throws', async () => {
      const client = build();
      await settle();
      socket().driveConnect();

      const seen: RealtimeEvent[] = [];
      client.events.subscribe(() => {
        throw new Error('a page blew up');
      });
      client.events.subscribe((event) => seen.push(event));

      expect(() =>
        socket().driveEvent('member.joined', MEMBERSHIP)
      ).not.toThrow();
      expect(seen.length).toBe(1);
    });
  });
});
