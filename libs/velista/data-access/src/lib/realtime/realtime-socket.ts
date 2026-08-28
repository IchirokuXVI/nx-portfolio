import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { BrowserFacade } from '@portfolio/velista/platform';
import { Subject, type Observable } from 'rxjs';
import { ApiUrl } from '../api-url';
import { SessionStore } from '../auth/session-store';
import { TokenStore } from '../auth/token-store';
import type {
  RealtimeClientI,
  RealtimeSubscribeOptions,
} from './realtime-client';
import { toRealtimeEvent } from './realtime-event-mapper';
import {
  REALTIME_CLIENT_MESSAGES,
  REALTIME_EVENT_NAMES,
  type RealtimeEvent,
} from './realtime-events';
import { RoomRegistry, type ZoneAsk } from './room-registry';
import { SOCKET_FACTORY, type SocketLike } from './socket-factory';

/**
 * How long to wait for an acknowledgement before giving up on one ask.
 *
 * `zone.subscribe` costs a round trip to core over NATS (`realtime.gateway.ts:100`),
 * so a slow answer is an ordinary event rather than a broken one, and Socket.IO would
 * otherwise wait for it forever. Five seconds covers that with room to spare; it has
 * not been measured against a cold core under load, which is open question 2 of plan
 * 0016 and worth revisiting once there is a number.
 */
const ACK_TIMEOUT_MS = 5_000;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

/** Consecutive failed connects before `degraded` latches and retrying stops. */
const MAX_CONSECUTIVE_FAILURES = 2;

/**
 * How long a connection has to survive before it counts as a good one.
 *
 * Not decoration. The server answers a bad token by disconnecting inside
 * `handleConnection` (`realtime.gateway.ts:79-87`), which reaches the client as a
 * `connect` immediately followed by a `disconnect` and no error at all. Clearing the
 * failure counter on `connect` alone would therefore reset it on the exact failure it
 * exists to catch, and the client would connect, be dropped and reconnect forever
 * against a token that will never be accepted. A connection is good when it has lasted,
 * or when the server has answered something.
 */
const HEALTHY_AFTER_MS = 10_000;

const KNOWN_EVENT_NAMES: ReadonlySet<string> = new Set(REALTIME_EVENT_NAMES);

/** How one ask ended. A refusal latches; a failure is retried. */
type AskOutcome = 'ok' | 'refused' | 'failed';

/**
 * The Socket.IO transport. Bound to `REALTIME_CLIENT` by the app, never by the library.
 *
 * The lifecycle is the whole of this class, and every part of it is a rule with a
 * failure behind it (plan 0016, section 6). Three are worth knowing before editing:
 *
 * - **The library's own reconnection is off, and must stay off.** It fires from inside
 *   the engine and cannot await a promise, so it would reconnect with the token that
 *   was just rejected, against a server that answers a bad token by disconnecting
 *   silently, forever. This class owns the backoff because only this class can await
 *   the refresh. It is the least obvious decision here and the one most likely to be
 *   undone by somebody tidying up.
 * - **`degraded` never reaches `ConnectionState`.** That service raises `0003`'s
 *   blocking screen and is fed by HTTP requests that got no response at all. Realtime
 *   being unavailable is a different condition with a much smaller treatment, and
 *   blocking a user whose every REST call succeeds is the specific harm. Nothing here
 *   injects it, which is the cheapest way to keep that true.
 * - **A token refresh never reconnects.** The socket reads the token at connect time,
 *   so the next reconnect uses the current one by itself. Tearing down a healthy
 *   connection every fifteen minutes buys a full resubscribe cycle and nothing else.
 *
 * **Nothing in this file may import `@angular/core/rxjs-interop`.** It is a secondary
 * entry point module federation does not dedupe, so `toSignal` and `takeUntilDestroyed`
 * throw `NG0203` from a service several remotes provide, with a perfectly correct DI
 * graph. The signals here are written by hand and the teardown goes through `DestroyRef`
 * for that reason, as `RealtimeMemory` already does.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class RealtimeSocket implements RealtimeClientI {
  private readonly _urls = inject(ApiUrl);
  private readonly _tokens = inject(TokenStore);
  private readonly _session = inject(SessionStore);
  private readonly _browser = inject(BrowserFacade);
  private readonly _factory = inject(SOCKET_FACTORY);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _events = new Subject<RealtimeEvent>();
  private readonly _connected = signal(false);
  private readonly _degraded = signal(false);
  private readonly _refused = signal<ReadonlySet<string>>(new Set());
  private readonly _dropped = signal<ReadonlyMap<string, number>>(new Map());

  private readonly _registry = new RoomRegistry();

  private _socket: SocketLike | null = null;

  /**
   * Bumped whenever the current attempt stops mattering: a sign out, a lost
   * connection, a teardown.
   *
   * Every handler and every awaited ack captures it and bails if it has moved on.
   * Without it, a token refresh that resolves after the user signed out opens a socket
   * for a session that no longer exists, and a `disconnect` fired by our own teardown
   * schedules a reconnect nobody asked for.
   */
  private _generation = 0;

  private _connecting = false;
  private _failures = 0;

  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _healthyTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  private _reconciling = false;
  private _reconcileAgain = false;

  readonly events: Observable<RealtimeEvent> = this._events.asObservable();
  readonly connected: Signal<boolean> = this._connected.asReadonly();
  readonly degraded: Signal<boolean> = this._degraded.asReadonly();
  readonly refusedZones: Signal<ReadonlySet<string>> =
    this._refused.asReadonly();
  readonly droppedEvents: Signal<ReadonlyMap<string, number>> =
    this._dropped.asReadonly();

  constructor() {
    // R1. No socket while anonymous: the server verifies the token in
    // `handleConnection` and drops the connection on failure, so an anonymous connect
    // is a guaranteed disconnect rather than a degraded session.
    effect(() => {
      const authenticated = this._session.isAuthenticated();
      untracked(() => (authenticated ? this._start() : this._stop()));
    });

    // R3's re-arm. A latched `degraded` is a user permanently and invisibly stale, and
    // regaining the network is the most common reason the thing that failed would now
    // work. `retry()` is the same door with a handle on it, for a UI to call.
    effect(() => {
      const online = this._browser.onLine();
      untracked(() => {
        if (online) {
          this.retry();
        }
      });
    });

    this._destroyRef.onDestroy(() => {
      this._stop();
      this._events.complete();
    });
  }

  subscribeZone(
    zoneId: string,
    options?: RealtimeSubscribeOptions
  ): () => void {
    const release = this._registry.acquireZone(zoneId, options?.staff === true);
    void this._reconcile();

    return () => {
      release();
      // The registry drops a refusal with the last holder, so republish before the
      // reconcile: a group nobody is subscribed to must not go on reading as stale.
      this._publishRefused();
      void this._reconcile();
    };
  }

  subscribeList(listId: string): () => void {
    const release = this._registry.acquireList(listId);
    void this._reconcile();

    return () => {
      release();
      void this._reconcile();
    };
  }

  viewList(listId: string): () => void {
    // The room comes with it. A view without its room is not a weaker subscription,
    // it is a refused one (plan 0017, section 3.2).
    const release = this._registry.acquireListView(listId);
    void this._reconcile();

    return () => {
      release();
      void this._reconcile();
    };
  }

  setEditingLine(listId: string, lineId: string | null): void {
    this._registry.setEditingLine(listId, lineId);
    void this._reconcile();
  }

  retry(): void {
    this._failures = 0;
    this._degraded.set(false);
    this._clearTimer('_retryTimer');
    this._start();
  }

  // ------------------------------------------------------------------ connecting

  private _start(): void {
    // A server render has no socket to open and no window to open it from. R1's
    // authentication check is the other half of the same guard.
    if (!this._browser.isBrowser || !this._session.isAuthenticated()) {
      return;
    }

    if (this._degraded() || this._socket !== null || this._connecting) {
      return;
    }

    void this._connect();
  }

  /**
   * R2. Get a fresh token, then open the socket with it.
   *
   * The await is the reason the library's reconnection is off: this step cannot happen
   * inside the engine's own retry, so a retry that skipped it would send a token the
   * server has already rejected.
   */
  private async _connect(): Promise<void> {
    this._connecting = true;
    const generation = this._generation;

    try {
      const token = await this._tokens.ensureFreshToken();
      if (generation !== this._generation) {
        return;
      }

      if (token === null) {
        // No token to offer. Counted like a rejection rather than retried freely:
        // connecting without one is a guaranteed drop, so an uncounted retry here is
        // the same forever-loop R2 exists to prevent, just one step earlier.
        this._onAttemptFailed();
        return;
      }

      const socket = this._factory(this._urls.realtime('/'), {
        auth: { token },
        // R10. The realtime service runs at two replicas behind an `HTTPRoute` with no
        // session persistence, and Socket.IO's default long polling needs affinity: its
        // requests would land on either pod and the handshake would fail intermittently,
        // which is the worst shape of failure to debug. A WebSocket is one connection
        // pinned to one pod after the upgrade.
        transports: ['websocket'],
        reconnection: false,
        autoConnect: false,
      });

      this._wire(socket, generation);
      this._socket = socket;
      socket.connect();
    } catch {
      if (generation === this._generation) {
        this._socket = null;
        this._onAttemptFailed();
      }
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
    // `_onConnectionLost` is idempotent so a transport that raised both counts once.
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

    // **One listener, not twenty five.** A new server event then costs a union member
    // and a mapper case, and touches nothing in this file.
    socket.onAny((name, ...args) => {
      if (generation === this._generation) {
        this._onServerEvent(name, args[0]);
      }
    });
  }

  private _onConnected(): void {
    this._connected.set(true);

    // R6 and R8 together. Rooms are per connection and server side, so a new socket is
    // in none of them however confident the refcounts are; and a refusal is core's
    // answer for one connection, while authorization can change between them.
    this._registry.onConnected();
    this._publishRefused();

    // Deliberately **not** `_failures = 0`. See HEALTHY_AFTER_MS.
    this._clearTimer('_healthyTimer');
    this._healthyTimer = setTimeout(
      () => this._markHealthy(),
      HEALTHY_AFTER_MS
    );

    void this._reconcile();
  }

  private _onConnectionLost(): void {
    if (this._socket === null) {
      return;
    }

    this._socket = null;
    this._connected.set(false);
    this._clearTimer('_healthyTimer');
    this._registry.onDisconnected();
    this._onAttemptFailed();
  }

  /** The connection has proved itself, so the failure count starts again from zero. */
  private _markHealthy(): void {
    this._clearTimer('_healthyTimer');
    this._failures = 0;
    this._degraded.set(false);
  }

  private _onAttemptFailed(): void {
    this._failures += 1;

    if (this._failures >= MAX_CONSECUTIVE_FAILURES) {
      // R3. Stop rather than retry: the client cannot tell a rejected token from a
      // dropped network, and against the former no number of retries ever succeeds.
      this._degraded.set(true);
      return;
    }

    // Exponential from a second, capped, full jitter. The jitter matters because every
    // client of a service that just came back would otherwise retry in step.
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

  private _stop(): void {
    this._generation += 1;
    this._clearTimer('_retryTimer');
    this._clearTimer('_healthyTimer');
    this._clearTimer('_reconcileTimer');

    const socket = this._socket;
    this._socket = null;
    socket?.disconnect();

    this._connecting = false;
    this._failures = 0;
    this._connected.set(false);
    this._degraded.set(false);
    this._registry.clear();
    this._publishRefused();
  }

  // ------------------------------------------------------------------ subscriptions

  /**
   * Say whatever the registry says is missing, and record every answer.
   *
   * Re-entrant by design: an acquire or a release during an outstanding ack sets the
   * flag and the loop picks it up, rather than starting a second conversation that
   * would ask for the same rooms again.
   */
  private async _reconcile(): Promise<void> {
    const socket = this._socket;
    if (socket === null || !this._connected()) {
      return;
    }

    if (this._reconciling) {
      this._reconcileAgain = true;
      return;
    }

    this._reconciling = true;
    const generation = this._generation;

    try {
      do {
        this._reconcileAgain = false;
        const plan = this._registry.reconcile();

        const outcomes = await Promise.all([
          ...plan.zonesToSubscribe.map((ask) =>
            this._subscribeZone(socket, ask)
          ),
          ...plan.listsToSubscribe.map((listId) =>
            this._subscribeList(socket, listId)
          ),
          ...plan.zonesToUnsubscribe.map((zoneId) =>
            this._emit(socket, REALTIME_CLIENT_MESSAGES.zoneUnsubscribe, {
              zoneId,
            })
          ),
          ...plan.listsToUnsubscribe.map((listId) =>
            this._emit(socket, REALTIME_CLIENT_MESSAGES.listUnsubscribe, {
              listId,
            })
          ),
        ]);

        if (generation !== this._generation) {
          return;
        }

        this._publishRefused();

        // Presence second, in the same pass and never in a loop. An intent is only
        // sendable once its room is joined, and the rooms above have just been
        // answered; folding this into the do/while instead would re-ask a room whose
        // subscribe had merely timed out, turning R7's deliberate five second retry
        // into a tight loop against a slow core (plan 0017, section 5.1).
        const presence = await this._announcePresence(socket);

        if (generation !== this._generation) {
          return;
        }

        // R7. A timed-out ask left its room unjoined, and something has to be the
        // "next reconcile" that retries it, or a group stays quietly not live until
        // the user happens to navigate. A presence intent is retried for the sharper
        // reason: an unsent stop leaves the server telling everybody else that this
        // client is still editing a line it walked away from.
        if (outcomes.includes('failed') || presence.includes('failed')) {
          this._scheduleReconcile();
        }
      } while (this._reconcileAgain);
    } finally {
      this._reconciling = false;
    }
  }

  private async _subscribeZone(
    socket: SocketLike,
    ask: ZoneAsk
  ): Promise<AskOutcome> {
    // The body carries the zone and nothing else: the staff room is joined by the
    // server's own check inside this handler, so the intent is not ours to send. What
    // the ask's `staff` flag decides is when to re-issue this message at all.
    const outcome = await this._emit(
      socket,
      REALTIME_CLIENT_MESSAGES.zoneSubscribe,
      { zoneId: ask.zoneId }
    );

    if (outcome === 'ok') {
      this._registry.onZoneSubscribed(ask.zoneId, ask.staff);
      this._markHealthy();
    } else if (outcome === 'refused') {
      this._registry.onZoneRefused(ask.zoneId);
      this._markHealthy();
    } else {
      this._registry.onZoneAskFailed(ask.zoneId);
    }

    return outcome;
  }

  private async _subscribeList(
    socket: SocketLike,
    listId: string
  ): Promise<AskOutcome> {
    const outcome = await this._emit(
      socket,
      REALTIME_CLIENT_MESSAGES.listSubscribe,
      { listId }
    );

    if (outcome === 'ok') {
      this._registry.onListSubscribed(listId);
      this._markHealthy();
    } else if (outcome === 'refused') {
      this._registry.onListRefused(listId);
      this._markHealthy();
    } else {
      this._registry.onListAskFailed(listId);
    }

    return outcome;
  }

  /**
   * Say whatever presence intents the rooms now permit, and record every answer.
   *
   * Every ask here is about a list this client is already in, so a `{ ok: false }` is a
   * disagreement rather than an ordinary no, and the registry latches it for the
   * connection instead of spinning on it. None of it touches `refusedZones`: that
   * signal is about a group going stale, and a presence intent going unheard costs an
   * avatar, not an update.
   */
  private async _announcePresence(socket: SocketLike): Promise<AskOutcome[]> {
    const plan = this._registry.reconcilePresence();

    return Promise.all([
      ...plan.viewsToStart.map(async (listId) => {
        const outcome = await this._emit(
          socket,
          REALTIME_CLIENT_MESSAGES.listView,
          { listId }
        );
        if (outcome === 'ok') {
          this._registry.onViewStarted(listId);
        } else if (outcome === 'refused') {
          this._registry.onViewRefused(listId);
        } else {
          this._registry.onPresenceAskFailed(listId);
        }
        return outcome;
      }),
      ...plan.viewsToStop.map(async (listId) => {
        const outcome = await this._emit(
          socket,
          REALTIME_CLIENT_MESSAGES.listUnview,
          { listId }
        );
        // A refusal to a stop is a stop: the server acknowledges an unview whatever
        // state it was in, so anything but a timeout means it is not counting us.
        if (outcome === 'failed') {
          this._registry.onPresenceAskFailed(listId);
        } else {
          this._registry.onViewStopped(listId);
        }
        return outcome;
      }),
      ...plan.editsToStart.map(async ({ listId, lineId }) => {
        const outcome = await this._emit(
          socket,
          REALTIME_CLIENT_MESSAGES.lineEdit,
          { listId, lineId }
        );
        if (outcome === 'ok') {
          this._registry.onEditStarted(listId, lineId);
        } else if (outcome === 'refused') {
          this._registry.onEditRefused(listId);
        } else {
          this._registry.onPresenceAskFailed(listId);
        }
        return outcome;
      }),
      ...plan.editsToStop.map(async (listId) => {
        const outcome = await this._emit(
          socket,
          REALTIME_CLIENT_MESSAGES.lineStopEdit,
          { listId }
        );
        if (outcome === 'failed') {
          this._registry.onPresenceAskFailed(listId);
        } else {
          this._registry.onEditStopped(listId);
        }
        return outcome;
      }),
    ]);
  }

  /**
   * R7. Every emit is acknowledged, and every acknowledgement has a deadline.
   *
   * Anything that is not a recognisable `{ ok: false }` counts as a failure rather than
   * a refusal, deliberately: a failure is retried and a refusal latches, so ambiguity
   * has to fall on the side that recovers. Rule D4 applies to an ack exactly as it
   * applies to a response body.
   */
  private async _emit(
    socket: SocketLike,
    message: string,
    body: unknown
  ): Promise<AskOutcome> {
    try {
      const ack = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(message, body);
      if (isAck(ack, true)) {
        return 'ok';
      }
      return isAck(ack, false) ? 'refused' : 'failed';
    } catch {
      // A timeout, or the socket went away under the ask. Neither is a refusal.
      return 'failed';
    }
  }

  private _scheduleReconcile(): void {
    if (this._reconcileTimer !== null) {
      return;
    }

    this._reconcileTimer = setTimeout(() => {
      this._reconcileTimer = null;
      void this._reconcile();
    }, ACK_TIMEOUT_MS);
  }

  private _publishRefused(): void {
    this._refused.set(this._registry.refusedZones());
  }

  // ------------------------------------------------------------------ events

  /**
   * R9. Nothing throws out of here.
   *
   * An exception raised inside a Socket.IO listener propagates out of the emit loop, so
   * one malformed payload would cost the user every subsequent event on the connection.
   * The mapper is already total; this is the belt for everything around it.
   */
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
      this._countDropped(name);
      return;
    }

    try {
      this._events.next(event);
    } catch {
      // A subscriber threw. The payload was fine, so this is not a dropped event and
      // must not be counted as one; swallowing it is what keeps the connection usable
      // for everybody else listening.
    }
  }

  private _countDropped(name: string): void {
    this._dropped.update((current) =>
      new Map(current).set(name, (current.get(name) ?? 0) + 1)
    );
  }

  private _clearTimer(
    which: '_retryTimer' | '_healthyTimer' | '_reconcileTimer'
  ): void {
    const timer = this[which];
    if (timer !== null) {
      clearTimeout(timer);
      this[which] = null;
    }
  }
}

/** Whether an acknowledgement is exactly `{ ok: <expected> }`, trusting nothing. */
function isAck(value: unknown, expected: boolean): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok: unknown }).ok === expected
  );
}
