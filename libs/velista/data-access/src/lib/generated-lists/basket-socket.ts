import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import { ApiUrl } from '../api-url';
import { hasResponse } from '../errors';
import { toRealtimeEvent } from '../realtime/realtime-event-mapper';
import {
  REALTIME_EVENT_NAMES,
  type RealtimeEvent,
} from '../realtime/realtime-events';
import { SOCKET_FACTORY, type SocketLike } from '../realtime/socket-factory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

/** Consecutive failed connects before `degraded` latches and retrying stops. */
const MAX_CONSECUTIVE_FAILURES = 2;

/**
 * How long a connection has to survive before it counts as a good one.
 *
 * `RealtimeSocket`'s reason exactly, and it bites harder here. The server answers a
 * token it will not accept by disconnecting inside `handleConnection` with no error
 * event at all, and it does the same for a **revoked participant**, whose liveness it
 * checks in the same handler. Clearing the failure count on `connect` alone would
 * therefore reset it on the one failure this exists to catch.
 */
const HEALTHY_AFTER_MS = 10_000;

const KNOWN_EVENT_NAMES: ReadonlySet<string> = new Set(REALTIME_EVENT_NAMES);

/**
 * The basket's own live connection: a second socket, held by whoever is on the screen
 * (plan 0048).
 *
 * ## Why it is not the app's socket with another token
 *
 * `RealtimeSocket` authenticates with an account JWT, is bound app wide, and carries
 * every zone and list room in the app. A guest shopping from a link **has no account**,
 * so the one connection this app opened could not be opened for them at all, and that
 * is the whole reason the basket was the only screen in the app with no live updates.
 *
 * Teaching that client a second credential would put "which of two identities am I"
 * inside every existing subscription, to serve one screen. So this is its own client,
 * with its own token source and its own lifetime, and the owner holds **both**: their
 * account room already carries `generatedList.lineSettled` so the dashboard's counts
 * move, and the basket room carries the per line detail that room does not.
 *
 * ## There is nothing to subscribe to
 *
 * No room registry, no reconciliation, no acks, which is what makes this a third of
 * `RealtimeSocket`'s size. The token names exactly one basket in its audience, and the
 * server joins the socket to `generated:{id}` and `generated:{id}:presence` inside its
 * connection handler, for the same reason it joins `user:{id}` there: the token is the
 * claim, and asking whether this participant may hear about this basket would be a
 * round trip to answer a tautology.
 *
 * So a reconnect needs no resubscribe. It needs a **fresh token**, which is the
 * interesting half.
 *
 * ## The token refresh is the revocation check
 *
 * A participant token is short lived and cannot be revoked, so what carries revocation
 * is the call that renews it: it presents the participant credential, which is a
 * database read that refuses somebody who has been removed (backend `0051`, section 9).
 * Every connect mints a new one, so a revoked participant stops reconnecting within one
 * backoff rather than on their next write, and {@link revoked} says so.
 *
 * That token **never joins `TokenStore`**. It is not an account identity, and
 * `gatewayInterceptor` attaches what is in that store to every request, so a
 * participant token in it would be a credential confusion bug of the kind that is hard
 * to see and easy to write.
 *
 * ## Two rules inherited whole
 *
 * - **The library's own reconnection stays off.** It fires from inside the engine and
 *   cannot await a promise, so it would reconnect with the token that was just
 *   rejected, forever. This class owns the backoff because only this class can await
 *   the refresh.
 * - **Nothing here may import `@angular/core/rxjs-interop`.** It is a secondary entry
 *   point module federation does not dedupe, so `toSignal` and `takeUntilDestroyed`
 *   throw `NG0203` against a perfectly correct DI graph. The signals are written by
 *   hand and the teardown is a plain method call.
 *
 * ## What closes it
 *
 * {@link BasketStore.leave}, called by the page when the component is destroyed. Not
 * this class's own `DestroyRef`, which never fires in the running app: see the
 * constructor.
 */
// Provided by the basket route, not the app and not root: it is one screen's
// connection and its lifetime is that screen's (rule D5, plan 0004 section 9).
@Injectable()
export class BasketSocket {
  private readonly _service = inject<BasketServiceI>(BASKET_SERVICE);
  private readonly _urls = inject(ApiUrl);
  private readonly _factory = inject(SOCKET_FACTORY);

  private readonly _events = new Subject<RealtimeEvent>();
  private readonly _connected = signal(false);
  private readonly _degraded = signal(false);
  private readonly _revoked = signal(false);

  /** Which basket this socket is for, or null before {@link open} and after close. */
  private _id: string | null = null;

  private _socket: SocketLike | null = null;

  /**
   * Bumped whenever the current attempt stops mattering: a close, a lost connection,
   * a teardown, a move to another basket.
   *
   * Every handler and every awaited token captures it and bails if it has moved on.
   * Without it, a refresh that resolves after the screen was left opens a socket for a
   * basket nobody is looking at, and a `disconnect` fired by our own teardown schedules
   * a reconnect nobody asked for.
   */
  private _generation = 0;

  private _connecting = false;
  private _failures = 0;

  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _healthyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Every mapped event off the basket's room. */
  readonly events: Observable<RealtimeEvent> = this._events.asObservable();

  /** Whether the basket is live right now, which the screen says out loud. */
  readonly connected = this._connected.asReadonly();

  /**
   * Whether the client has given up.
   *
   * Distinct from being offline, and it must never reach `ConnectionState`: that
   * service raises `0003`'s blocking screen and is fed by requests that got no answer
   * at all. A basket with no socket is a **working screen** that refetches, which is
   * `0044`'s behaviour, so blocking somebody whose every REST call succeeds would be
   * the specific harm.
   */
  readonly degraded = this._degraded.asReadonly();

  /**
   * Whether the server refused to renew this participant, which means removed.
   *
   * The screen says so and stays readable. A basket that vanished mid shop with no
   * sentence would be indistinguishable from a crash, and the person holding the phone
   * is standing in a shop with a trolley.
   */
  readonly revoked = this._revoked.asReadonly();

  constructor() {
    // A backstop, and **not** what closes this socket when the shopper leaves. This
    // class is provided by the basket route, and Angular caches a route's environment
    // injector on the route config, destroying it only under
    // `withExperimentalAutoCleanupInjectors()`, which this app does not enable. So in
    // the running app this hook never fires at all, and it read for a while as though
    // it did: the connection survived the screen by the whole session, holding the
    // room and taking a broadcast for a basket nobody was looking at. `BasketPage`
    // calls `BasketStore.leave()` from its own teardown, which is a component's and
    // therefore real. This stays for the injectors that *are* destroyed, `TestBed`'s
    // among them.
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /**
   * Hold a live connection to one basket.
   *
   * Idempotent for the basket already held, so a page that calls it twice does not open
   * two sockets. Naming a different basket closes the first, since a participant token
   * names exactly one and a socket carrying it can reach nothing else.
   */
  open(generatedListId: string): void {
    if (this._id === generatedListId) {
      return;
    }

    this.close();
    this._id = generatedListId;
    this._degraded.set(false);
    this._revoked.set(false);
    this._failures = 0;
    this._start();
  }

  /** Let the connection go. The screen has been left, or the session has ended. */
  close(): void {
    this._generation += 1;
    this._id = null;
    this._clearTimer('_retryTimer');
    this._clearTimer('_healthyTimer');
    this._connecting = false;
    this._connected.set(false);

    const socket = this._socket;
    this._socket = null;
    socket?.disconnect();
  }

  private _start(): void {
    if (this._connecting || this._socket !== null || this._id === null) {
      return;
    }
    void this._connect();
  }

  private async _connect(): Promise<void> {
    this._connecting = true;
    const generation = this._generation;
    const id = this._id;

    if (id === null) {
      this._connecting = false;
      return;
    }

    try {
      // Every connect mints a fresh one, rather than caching until it expires. It is
      // one request per connection, and it is the read that carries revocation: a token
      // held over a reconnect would let a removed participant keep a live socket until
      // it happened to expire.
      const session = await this._service.refreshSocketToken(id);
      if (generation !== this._generation) {
        return;
      }

      const socket = this._factory(this._urls.realtime('/'), {
        auth: { token: session.socketToken },
        // R10, and the server refuses the alternative outright: the gateway is declared
        // `transports: ['websocket']`, so an opening poll is rejected rather than
        // upgraded.
        transports: ['websocket'],
        reconnection: false,
        autoConnect: false,
      });

      this._wire(socket, generation);
      this._socket = socket;
      socket.connect();
    } catch (error) {
      if (generation !== this._generation) {
        return;
      }

      this._socket = null;

      if (hasResponse(error) && (error as { status: number }).status === 401) {
        // Not a transient. The credential this browser holds no longer names a live
        // participant, and no number of retries changes that answer, so this latches
        // rather than backing off.
        this._revoked.set(true);
        this._degraded.set(true);
        return;
      }

      this._onAttemptFailed();
    } finally {
      this._connecting = false;
    }
  }

  private _wire(socket: SocketLike, generation: number): void {
    socket.on('connect', () => {
      if (generation === this._generation) {
        this._onConnected();
      }
    });

    // Both endings, handled the same way. A handshake rejection raises `connect_error`
    // and no disconnect; a drop after the handshake raises the disconnect and no error.
    // `_onConnectionLost` is idempotent, so a transport that raised both counts once.
    socket.on('connect_error', () => {
      if (generation === this._generation) {
        this._onConnectionLost();
      }
    });
    socket.on('disconnect', () => {
      if (generation === this._generation) {
        this._onConnectionLost();
      }
    });

    // One listener, not six. A new server event costs a union member and a mapper
    // case, and touches nothing in this file.
    socket.onAny((name, ...args) => {
      if (generation === this._generation) {
        this._onServerEvent(name, args[0]);
      }
    });
  }

  private _onConnected(): void {
    this._connected.set(true);

    // Deliberately **not** `_failures = 0`. See HEALTHY_AFTER_MS: the server drops a
    // revoked participant by connecting and immediately disconnecting, with no error.
    this._clearTimer('_healthyTimer');
    this._healthyTimer = setTimeout(() => {
      this._healthyTimer = null;
      this._failures = 0;
    }, HEALTHY_AFTER_MS);
  }

  private _onConnectionLost(): void {
    if (this._socket === null) {
      return;
    }

    this._socket = null;
    this._connected.set(false);
    this._clearTimer('_healthyTimer');
    this._onAttemptFailed();
  }

  private _onAttemptFailed(): void {
    this._failures += 1;

    if (this._failures >= MAX_CONSECUTIVE_FAILURES) {
      // Stop rather than retry. The client cannot tell a rejected token from a dropped
      // network, and against the former no number of retries ever succeeds. The screen
      // keeps working and says it is not live.
      this._degraded.set(true);
      return;
    }

    // Exponential from a second, capped, full jitter. The jitter matters because every
    // phone in a shop whose wifi just came back would otherwise retry in step.
    const ceiling = Math.min(
      BACKOFF_CAP_MS,
      BACKOFF_BASE_MS * 2 ** (this._failures - 1)
    );
    this._clearTimer('_retryTimer');
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._start();
    }, Math.random() * ceiling);
  }

  private _onServerEvent(name: string, payload: unknown): void {
    if (!KNOWN_EVENT_NAMES.has(name)) {
      return;
    }

    let event: RealtimeEvent | null;
    try {
      event = toRealtimeEvent(name, payload);
    } catch {
      event = null;
    }

    if (event === null) {
      return;
    }

    try {
      this._events.next(event);
    } catch {
      // A subscriber threw. Swallowing it is what keeps the connection usable for
      // everybody else listening, and an exception raised inside a socket handler
      // would otherwise take the whole subscription down.
    }
  }

  private _clearTimer(which: '_retryTimer' | '_healthyTimer'): void {
    const timer = this[which];
    if (timer !== null) {
      clearTimeout(timer);
      this[which] = null;
    }
  }
}
