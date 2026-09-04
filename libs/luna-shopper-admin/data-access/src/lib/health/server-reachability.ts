import {
  computed,
  DestroyRef,
  DOCUMENT,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { ADMIN_REACHABILITY_POLICY } from '@portfolio/luna-shopper-admin/models';
import { HEALTH_SERVICE } from './health-service';

/**
 * Whether the gateway is answering, as the one signal the app draws a cover for
 * (plan 0008).
 *
 * Everything that notices an outage reports it here, and one thing decides:
 * {@link check} asks the health endpoint, and its answer is the whole state.
 * Nothing else writes {@link down}.
 *
 * **One probe at a time, however many callers ask.** A screenful of requests
 * that fail together, the retry button and the automatic timer will all want to
 * ask at the same moment. They share the one in flight promise, so an outage
 * produces one probe rather than one per failed request. Without it a dead
 * gateway is asked once per request the app was making when it died.
 *
 * The service holds no knowledge of the session and none of any screen. It
 * answers one question, and `AppRoot` decides what that means.
 */
@Injectable()
export class ServerReachability {
  private readonly _health = inject(HEALTH_SERVICE);
  private readonly _policy = inject(ADMIN_REACHABILITY_POLICY);
  private readonly _document = inject(DOCUMENT);

  private readonly _down = signal(false);
  private readonly _checking = signal(false);
  private readonly _automaticAttempts = signal(0);

  /** The one probe that may be in flight, and what every other caller awaits. */
  private _probing: Promise<boolean> | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastProbeAt = 0;
  private _started = false;

  /**
   * Whether the last probe failed.
   *
   * `false` until something goes wrong, which is the safe direction: an app that
   * has not established anything must draw itself rather than an outage.
   */
  readonly down = this._down.asReadonly();

  /** Whether a probe is in flight. What the retry button renders while waiting. */
  readonly checking = this._checking.asReadonly();

  /**
   * How many probes the app will still make on its own.
   *
   * Shown on the cover, because an operator who can see the app is still
   * checking does not need to press anything, and one who can see it stopped
   * knows the button is now the only thing that asks.
   */
  readonly automaticAttemptsLeft = computed(() =>
    Math.max(this._policy.maxAutomaticAttempts - this._automaticAttempts(), 0)
  );

  /** Whether the app has stopped asking on its own. */
  readonly exhausted = computed(() => this.automaticAttemptsLeft() === 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /**
   * Begin watching for a tab that comes back (plan 0008, section 6).
   *
   * Called from an environment initializer rather than lazily, for the reason
   * `SessionLifecycle.start` is: nothing injects this service until something
   * fails, and by then the listener it needed has missed everything.
   */
  start(): void {
    if (this._started) {
      return;
    }
    this._started = true;
    this._document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Stop watching. Only the app's teardown calls this. */
  stop(): void {
    this._started = false;
    this.stopTimer();
    this._document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * Ask whether the gateway answers, and record what it said.
   *
   * The interceptor calls this for a request that produced no response, the
   * bootstrap calls it for an environment read that never arrived, and the timer
   * calls it while an outage lasts. All three share one probe.
   */
  async check(): Promise<boolean> {
    this._probing ??= this.probe().finally(() => {
      this._probing = null;
    });

    return this._probing;
  }

  /**
   * The retry button, and a tab that became visible again.
   *
   * It does **not** spend the automatic budget. Those ten are what the app is
   * allowed to ask unasked; an operator who pressed the button asked, and that
   * stays available for as long as the cover is up. It restarts the wait, so a
   * press one second before an automatic probe does not produce two a second
   * apart.
   */
  async retry(): Promise<boolean> {
    const reachable = await this.check();
    if (!reachable) {
      this.arm();
    }
    return reachable;
  }

  private async probe(): Promise<boolean> {
    this._checking.set(true);
    try {
      const reachable = await this._health.probe();
      this._lastProbeAt = Date.now();

      if (reachable) {
        this.recovered();
      } else {
        this.fell();
      }

      return reachable;
    } finally {
      this._checking.set(false);
    }
  }

  /** The server answered. Everything the outage started is undone. */
  private recovered(): void {
    this.stopTimer();
    this._automaticAttempts.set(0);
    this._down.set(false);
  }

  /** The server did not answer. The cover goes up, and the clock starts. */
  private fell(): void {
    if (!this._down()) {
      this._automaticAttempts.set(0);
      this._down.set(true);
    }
    this.arm();
  }

  /**
   * Arm the next automatic probe, unless the budget is spent.
   *
   * One `setTimeout` that re-arms itself rather than an interval, so a probe
   * that takes four seconds does not stack up behind the next one, and so
   * stopping is one `clearTimeout` from anywhere.
   */
  private arm(): void {
    this.stopTimer();

    if (!this._down() || this.exhausted()) {
      return;
    }

    this._timer = setTimeout(() => {
      this._automaticAttempts.update((spent) => spent + 1);
      void this.check();
    }, this._policy.retryIntervalMs);
  }

  private stopTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private readonly onVisibility = (): void => {
    // A page hidden for an hour must not cost the operator two more minutes to
    // learn that the server came back. The interval guard is what stops a
    // flapping window manager from turning that into a request loop.
    if (this._document.visibilityState === 'hidden' || !this._down()) {
      return;
    }

    if (Date.now() - this._lastProbeAt >= this._policy.retryIntervalMs) {
      void this.retry();
    }
  };
}
