import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { BrowserFacade } from './browser-facade';
import { ConnectionState } from './connection-state';

/**
 * How long the app waits before it says something is wrong (plan 0071 D8).
 *
 * Wall clock from the app starting, never from the current attempt. A per attempt
 * timer resets on every retry, so on the slow connection that needs this sentence
 * most it would arrive late or never.
 */
export const STARTUP_SLOW_AFTER_MS = 3_000;

/**
 * Whether the app has an answer yet about reaching the backend.
 *
 * - `connecting` — the first probe is in flight. This is where the app starts.
 * - `ready` — the backend answered, and the app may draw its pages.
 * - `unreachable` — no answer, a timeout, or any status that is not a 2xx.
 * - `too-old` — the deployment refused to serve this build.
 */
export type ReadinessState = 'connecting' | 'ready' | 'unreachable' | 'too-old';

/**
 * The one answer to "can this app talk to the server", from the first frame onwards.
 *
 * ## Why this exists beside `ConnectionState` rather than inside it
 *
 * `ConnectionState` answers a transport question: did a request come back. It is what
 * the sockets, the room registry and the token store want, and it is deliberately
 * optimistic at startup, where `offline` begins false because nothing has failed yet.
 * That guess is right most of the time and silently wrong on a cold start in a shop
 * basement, so the app used to find out it had no backend from whichever request the
 * user's first tap happened to send. A page rendered, drew its skeletons and then
 * disappeared behind a blocking screen, which reads as breaking rather than waiting,
 * and on the landing page the tap that found out had already created an account.
 *
 * So this holds a **startup** answer, and `ConnectionState` keeps exactly the job it
 * has and becomes one of the inputs here (plan 0071 D1). Two booleans that both mean
 * "can we talk to the server" will disagree, and the one that is wrong strands
 * somebody: everything that draws a screen reads this, and nothing reads both.
 *
 * ## Why it holds no HTTP
 *
 * The same split `ConnectionState` and `ConnectionRecovery` already are, for the same
 * reason: `ui` reads this to decide whether to create the outlet, and `ui` may not
 * import `data-access` (plan 0004, section 3.2). The probe that writes into it is
 * `StartupProbe`, over there.
 *
 * ## The 503 that means two different things
 *
 * `ConnectionState.reportReachable` treats a 503 as reachable, because it proves the
 * network works and stops an ordinary rollout from stranding a running app behind the
 * blocking screen (plan 0004, section 8). Here a 503 means the gateway cannot serve
 * the app, so the state is `unreachable` and the app waits. Only a 2xx is `ready`,
 * and the disagreement is deliberate (plan 0071 D6).
 */
@Injectable({ providedIn: 'root' })
export class BackendReadiness {
  private readonly _browser = inject(BrowserFacade);
  private readonly _connection = inject(ConnectionState);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _state = signal<ReadinessState>('connecting');
  private readonly _settledAt = signal<number | null>(null);
  private readonly _slow = signal(false);
  private readonly _wasReady = signal(false);
  private readonly _retryRequested = signal(0);

  /** Where the app is. Starts `connecting`, and only a probe moves it off that. */
  readonly state: Signal<ReadinessState> = this._state.asReadonly();

  /**
   * Whether the backend has answered at least once in this document.
   *
   * The gate in `AppLayout` reads **this** rather than `state()`, and the difference
   * is the whole of section 5.3. Losing the connection halfway through a session moves
   * the state back to `unreachable`, and a gate that closed on that would destroy the
   * page underneath along with whatever was typed into it — which is exactly what the
   * blocking screen is careful not to do. So the gate is about **starting**: it opens
   * once and does not close, and a connection lost afterwards is `ConnectionState`'s
   * business and `lib-connection-lost`'s screen, unchanged.
   */
  readonly wasReady: Signal<boolean> = this._wasReady.asReadonly();

  /** When the first answer of any kind arrived, or `null` while none has. */
  readonly settledAt: Signal<number | null> = this._settledAt.asReadonly();

  /**
   * True once {@link STARTUP_SLOW_AFTER_MS} has passed and the app is still not
   * `ready`.
   *
   * A `setTimeout` started in the constructor rather than a computed over a clock, so
   * it costs one timer for the life of the app and fires once.
   *
   * **Not ready**, rather than not yet answered. A probe that came back `unreachable`
   * in one second has answered, and a screen that treated that as settled would sit on
   * the word Connecting with no way out while the retries ran invisibly behind it —
   * which is the frozen spinner this plan exists to avoid. The escape text is offered
   * to everybody the app cannot serve after three seconds, whatever the reason.
   */
  readonly slow: Signal<boolean> = this._slow.asReadonly();

  /**
   * How many times somebody has pressed Try again.
   *
   * A counter and not a boolean, for the reason `AppResumed.resumes` is one: asking to
   * retry is an **edge**, and an edge cannot be read back out of a boolean by something
   * that missed the transition. `StartupProbe` watches this, which is how a button in
   * `ui` reaches a request in `data-access` without either library importing the other
   * (plan 0071 D9).
   */
  readonly retryRequested: Signal<number> = this._retryRequested.asReadonly();

  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (this._browser.isBrowser) {
      this._timer = setTimeout(() => {
        this._timer = null;
        // Only while the app still cannot be used. A backend that answered in two
        // seconds must not have the escape text appear over a working app a second
        // later.
        if (untracked(() => this._state()) !== 'ready') {
          this._slow.set(true);
        }
      }, STARTUP_SLOW_AFTER_MS);
    }

    // Losing the connection after startup is reported here as well, so one signal
    // answers "can the app work" from the first frame to the end of the session
    // (plan 0071 D11). No second poller: `ConnectionRecovery` still owns the running
    // app, and moving back to `ready` is a probe's job, not this effect's.
    effect(() => {
      const offline = this._connection.offline();

      untracked(() => {
        if (offline && this._state() === 'ready') {
          this._state.set('unreachable');
        }
      });
    });

    this._destroyRef.onDestroy(() => this._stopTimer());
  }

  /** The backend answered 2xx. The only way into `ready`. */
  reportReady(): void {
    this._settle('ready');
  }

  /** No response, a timeout, or any other status (plan 0071 D6). */
  reportUnreachable(): void {
    this._settle('unreachable');
  }

  /**
   * The deployment refused to serve this build.
   *
   * Terminal within this document, which is `0072`'s subject: the way out is a new
   * bundle and a reload, not another probe.
   */
  reportTooOld(): void {
    this._settle('too-old');
  }

  /** Pressed Try again. See {@link retryRequested} for why this counts. */
  requestRetry(): void {
    this._retryRequested.update((count) => count + 1);
  }

  private _settle(next: ReadinessState): void {
    if (this._state() === 'too-old') {
      return;
    }

    this._state.set(next);

    if (this._settledAt() === null) {
      this._settledAt.set(Date.now());
    }

    // The timer is about being usable, not about having answered: only `ready`
    // retires it. See {@link slow}.
    if (next === 'ready') {
      this._wasReady.set(true);
      this._stopTimer();
    }
  }

  private _stopTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
