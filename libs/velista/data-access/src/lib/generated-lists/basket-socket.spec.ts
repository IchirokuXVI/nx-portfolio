import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG, type BasketSession } from '@portfolio/velista/models';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import type { RealtimeEvent } from '../realtime/realtime-events';
import {
  SOCKET_FACTORY,
  type SocketConnectOptions,
  type SocketEmitter,
  type SocketLifecycleEvent,
  type SocketLike,
} from '../realtime/socket-factory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSocket } from './basket-socket';

/**
 * The basket's own connection (plan 0048).
 *
 * `basket-store.spec.ts` deliberately drives a fake in this class's place, because
 * what it asserts is what the **store** does with an event. This file is the other
 * half: the connection itself, its credential, and the two things it latches.
 *
 * Three of them have no visible symptom until somebody is standing in a shop:
 *
 * - **The token is minted per connect**, never held over a reconnect, because that
 *   call is the only thing that carries revocation. A cached token would let a
 *   removed participant keep a live socket until it happened to expire.
 * - **A refused refresh latches** rather than backing off. No number of retries turns
 *   a 401 into a connection, and the person needs to be told rather than watched.
 * - **A connection that comes up and immediately drops does not clear the failure
 *   count.** That is exactly what the server does to a token it will not accept, and
 *   to a revoked participant, with no error event at all, so counting a `connect` as
 *   success would reset the counter on the one failure the counter exists to catch.
 *
 * Nothing here imports `socket.io-client`, for `SocketLike`'s reason: a spec that
 * stubbed the real thing would end up stubbing the reconnection engine this class
 * turns off, and would be a test of the library rather than of the lifecycle.
 */

/** A socket driven entirely by hand. `RealtimeSocket`'s fake, minus the acks. */
class FakeSocket implements SocketLike {
  connected = false;

  disconnects = 0;

  private readonly _handlers = new Map<
    SocketLifecycleEvent,
    ((payload?: unknown) => void)[]
  >();
  private _any: ((event: string, ...args: readonly unknown[]) => void) | null =
    null;

  connect(): void {
    // Inert. Every spec decides for itself whether this connection came up, was
    // refused, or was dropped.
  }

  disconnect(): void {
    this.connected = false;
    this.disconnects += 1;
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
    // The basket's socket only listens. There is nothing to subscribe to, because
    // the token names the basket and the server joins the room on connect.
    throw new Error('the basket socket emits nothing');
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

  private _fire(event: SocketLifecycleEvent): void {
    for (const handler of this._handlers.get(event) ?? []) {
      handler();
    }
  }
}

function session(token: string): BasketSession {
  return {
    generatedListId: 'basket-saturday',
    participantId: 'p-guest-9',
    secret: 'the-secret',
    socketToken: token,
    socketTokenExpiresAt: null,
  };
}

function unauthorized(): GatewayError {
  return new GatewayError({
    code: 'unauthorized',
    status: 401,
    correlationId: 'spec',
  });
}

describe('BasketSocket', () => {
  let sockets: FakeSocket[];
  let options: SocketConnectOptions[];
  let urls: string[];

  /** Which basket each refresh was asked for, oldest first. */
  let refreshes: string[];
  /** What the next refresh answers: a token, or a thrown error. */
  let refreshAnswer: () => Promise<BasketSession>;

  function socket(): FakeSocket {
    const last = sockets.at(-1);
    if (last === undefined) {
      throw new Error('no socket was created');
    }
    return last;
  }

  /**
   * Drain the microtask queue.
   *
   * `_connect` awaits the token, so every assertion about a connection is one turn
   * behind the call that asked for it. Generously, for `RealtimeSocket`'s reason:
   * counting the turns exactly would make these specs hostage to one more `await`
   * appearing inside the class.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
    sockets = [];
    options = [];
    urls = [];
    refreshes = [];
    refreshAnswer = () => Promise.resolve(session('participant-token'));

    const service: Partial<BasketServiceI> = {
      refreshSocketToken: (generatedListId: string) => {
        refreshes.push(generatedListId);
        return refreshAnswer();
      },
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(),
        ApiUrl,
        TokenStore,
        BasketSocket,
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: 'http://gateway.test',
            realtimeBaseUrl: 'http://realtime.test',
          },
        },
        { provide: BASKET_SERVICE, useValue: service },
        {
          provide: SOCKET_FACTORY,
          useValue: (url: string, connectOptions: SocketConnectOptions) => {
            urls.push(url);
            options.push(connectOptions);
            const created = new FakeSocket();
            sockets.push(created);
            return created;
          },
        },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the credential', () => {
    it('connects with the participant token the refresh answered', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      expect(refreshes).toEqual(['basket-saturday']);
      expect(options[0].auth.token).toBe('participant-token');
      expect(urls[0]).toBe('http://realtime.test/');
    });

    it('opens on the websocket alone, with the library reconnection off', async () => {
      // Both are load bearing and neither has a sensible default: the gateway is
      // declared `transports: ['websocket']` so an opening poll is rejected outright,
      // and the library's reconnection fires from inside the engine, which cannot
      // await a refresh and so would retry forever with the token just rejected.
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      expect(options[0].transports).toEqual(['websocket']);
      expect(options[0].reconnection).toBe(false);
      expect(options[0].autoConnect).toBe(false);
    });

    it('mints a fresh token per connection rather than holding one', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();
      socket().driveConnect();

      // A drop, then the backoff. The reconnect asks again, which is the whole
      // revocation check: a held token would keep a removed participant live.
      socket().driveDisconnect();
      jest.advanceTimersByTime(60_000);
      await settle();

      expect(refreshes).toEqual(['basket-saturday', 'basket-saturday']);
      expect(sockets).toHaveLength(2);
    });

    it('never puts the participant token in TokenStore', async () => {
      // The account identity and this one are different credentials, and
      // `gatewayInterceptor` attaches what is in that store to every gateway
      // request. A participant token in it is a credential confusion bug of the
      // kind that is hard to see and easy to write.
      const tokens = TestBed.inject(TokenStore);
      const client = TestBed.inject(BasketSocket);

      client.open('basket-saturday');
      await settle();
      socket().driveConnect();

      expect(options[0].auth.token).toBe('participant-token');
      expect(tokens.hasSession()).toBe(false);
      expect(tokens.tokens()).toBeNull();
    });
  });

  describe('what arrives off the room', () => {
    it('publishes a mapped event', async () => {
      const client = TestBed.inject(BasketSocket);
      const seen: RealtimeEvent[] = [];
      client.events.subscribe((event) => seen.push(event));

      client.open('basket-saturday');
      await settle();
      socket().driveConnect();
      socket().driveEvent('generatedList.lineSettled', {
        generatedListId: 'basket-saturday',
        line: null,
      });

      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe('generatedList.lineSettled');
    });

    it('ignores an event this app does not know', async () => {
      const client = TestBed.inject(BasketSocket);
      const seen: RealtimeEvent[] = [];
      client.events.subscribe((event) => seen.push(event));

      client.open('basket-saturday');
      await settle();
      socket().driveConnect();
      socket().driveEvent('somethingNobodyShipped', { anything: true });

      expect(seen).toEqual([]);
    });

    it('drops an unreadable payload rather than throwing at the transport', async () => {
      const client = TestBed.inject(BasketSocket);
      const seen: RealtimeEvent[] = [];
      client.events.subscribe((event) => seen.push(event));

      client.open('basket-saturday');
      await settle();
      socket().driveConnect();

      expect(() =>
        socket().driveEvent('generatedList.lineSettled', 'not an object')
      ).not.toThrow();
      expect(seen).toEqual([]);
    });

    it('keeps the connection usable when a subscriber throws', async () => {
      const client = TestBed.inject(BasketSocket);
      client.events.subscribe(() => {
        throw new Error('a screen blew up');
      });

      client.open('basket-saturday');
      await settle();
      socket().driveConnect();

      expect(() =>
        socket().driveEvent('generatedList.lineSettled', {
          generatedListId: 'basket-saturday',
          line: null,
        })
      ).not.toThrow();
      expect(client.connected()).toBe(true);
    });
  });

  describe('degraded, and honest about it', () => {
    it('gives up rather than retrying forever, and says it is not live', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      socket().driveConnectError();
      jest.advanceTimersByTime(60_000);
      await settle();
      socket().driveConnectError();
      await settle();

      expect(client.degraded()).toBe(true);
      expect(client.connected()).toBe(false);

      // Nothing further is attempted: the client cannot tell a rejected token from
      // a dropped network, and against the former no number of retries succeeds.
      const attempts = sockets.length;
      jest.advanceTimersByTime(5 * 60_000);
      await settle();
      expect(sockets).toHaveLength(attempts);
    });

    it('does not count a connection that dropped straight away as a good one', async () => {
      // The server answers a token it will not accept by connecting and immediately
      // disconnecting, with no error event. Clearing the failure count on `connect`
      // alone would reset it on exactly that, and retry forever.
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      socket().driveConnect();
      socket().driveDisconnect();
      jest.advanceTimersByTime(60_000);
      await settle();

      socket().driveConnect();
      socket().driveDisconnect();
      await settle();

      expect(client.degraded()).toBe(true);
    });

    it('forgets the failures once a connection has survived', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      socket().driveConnectError();
      jest.advanceTimersByTime(60_000);
      await settle();

      socket().driveConnect();
      // Long enough to count as a good connection rather than a rejected token.
      jest.advanceTimersByTime(30_000);
      socket().driveDisconnect();
      jest.advanceTimersByTime(60_000);
      await settle();

      expect(client.degraded()).toBe(false);
      expect(sockets).toHaveLength(3);
    });
  });

  describe('revocation', () => {
    it('latches on a refused refresh instead of backing off', async () => {
      refreshAnswer = () => Promise.reject(unauthorized());

      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      expect(client.revoked()).toBe(true);
      expect(client.degraded()).toBe(true);
      expect(sockets).toEqual([]);

      // One refusal, and no retry: the credential this browser holds no longer names
      // a live participant, and asking again cannot change that answer.
      jest.advanceTimersByTime(5 * 60_000);
      await settle();
      expect(refreshes).toHaveLength(1);
    });

    it('treats a refresh that failed for another reason as a retry', async () => {
      // A gateway that was briefly unreachable is not a removal, and telling somebody
      // in a shop that they have been thrown out of the list would be a lie.
      refreshAnswer = () => Promise.reject(new Error('network down'));

      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      expect(client.revoked()).toBe(false);

      jest.advanceTimersByTime(60_000);
      await settle();
      expect(refreshes).toHaveLength(2);
    });
  });

  describe('its lifetime is the screen’s', () => {
    it('holds one socket for a basket asked for twice', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      client.open('basket-saturday');
      await settle();

      expect(sockets).toHaveLength(1);
      expect(refreshes).toHaveLength(1);
    });

    it('drops the first when a different basket is opened', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();
      socket().driveConnect();
      const first = socket();

      client.open('basket-sunday');
      await settle();

      expect(first.disconnects).toBe(1);
      expect(refreshes).toEqual(['basket-saturday', 'basket-sunday']);
    });

    it('closes when the injector holding it is destroyed', async () => {
      // A backstop and nothing more, which is why this test is no longer named after
      // the shopper leaving. The basket route's injector is **not** destroyed by
      // navigating away (Angular keeps it on the route config), so what closes this
      // socket on a real screen is `BasketPage` calling `BasketStore.leave()`, and
      // `basket-page.spec.ts` is where that is asserted. This test only says the hook
      // works where an injector genuinely ends, `TestBed`'s being one.
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();
      socket().driveConnect();
      const held = socket();

      TestBed.resetTestingModule();

      expect(held.disconnects).toBe(1);
      expect(client.connected()).toBe(false);
    });

    it('does not open a socket for a basket that has been left', async () => {
      // The refresh is a round trip, and a screen can be left inside it. Connecting
      // on an answer nobody is waiting for would hold a room the reader has gone from.
      let release: ((value: BasketSession) => void) | null = null;
      refreshAnswer = () =>
        new Promise<BasketSession>((resolve) => {
          release = resolve;
        });

      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();

      client.close();
      release?.(session('participant-token'));
      await settle();

      expect(sockets).toEqual([]);
    });

    it('stops reconnecting once closed', async () => {
      const client = TestBed.inject(BasketSocket);
      client.open('basket-saturday');
      await settle();
      socket().driveConnect();

      client.close();
      jest.advanceTimersByTime(5 * 60_000);
      await settle();

      expect(sockets).toHaveLength(1);
      expect(client.connected()).toBe(false);
    });
  });
});
