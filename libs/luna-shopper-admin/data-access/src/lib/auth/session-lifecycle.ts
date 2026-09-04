import {
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import {
  ADMIN_SESSION_POLICY,
  decideKeepalive,
  type SignInFailure,
} from '@portfolio/luna-shopper-admin/models';
import { SessionStore } from './session-store';

/**
 * The events that mean a person is there (plan 0003, section 2).
 *
 * Real interaction, and nothing else: not a timer, not an open tab, not a
 * request the app made by itself. `touchstart` is listed beside `pointerdown`
 * rather than assumed to be covered by it, because a browser that does not
 * synthesize pointer events from touch would otherwise make every phone look
 * idle while it was being used.
 */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'scroll',
] as const;

/**
 * How finely activity is recorded. A scroll fires far more often than a session
 * decision could ever need, and re-deciding on every frame of one is work for
 * nothing.
 */
const ACTIVITY_RESOLUTION_MS = 1000;

/**
 * The session that keeps itself alive, and asks for a password when it cannot
 * (plan 0003).
 *
 * Two halves, and they are the plan's two halves: **while somebody is working
 * the token renews before it expires, indefinitely**, and **when it does expire
 * nothing is lost** — an overlay goes up over the screen exactly as it stands,
 * nothing unmounts, nothing navigates, and no form state is captured or
 * replayed because none of it is ever touched.
 *
 * All of the timing lives in `decideKeepalive`, which is pure. What is here is
 * the machinery a pure function cannot have: one timer, four listeners, a
 * promise everybody waiting on a password shares, and the two signals the
 * chrome renders.
 *
 * **One `setTimeout`, never a poll.** Each decision names the instant to ask
 * again at. The exception a poll would exist for, a page the OS froze and thawed
 * with its timers unfired, is answered better by `visibilitychange`: coming back
 * to the foreground re-decides immediately against the real clock rather than
 * against a timer that slept through the interesting part.
 */
@Injectable()
export class SessionLifecycle {
  private readonly _sessions = inject(SessionStore);
  private readonly _policy = inject(ADMIN_SESSION_POLICY);
  private readonly _document = inject(DOCUMENT);

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;

  /**
   * The last real interaction, or zero for "not yet".
   *
   * Zero rather than the moment this was constructed, for two reasons that
   * point the same way. A session nobody has touched must read as idle, and
   * dating it from construction would make the app's own startup count as
   * somebody being there. And the throttle below compares against this value,
   * so a construction time would swallow the operator's first keystroke if they
   * were quick.
   *
   * A plain field rather than a signal on purpose. It is written on every
   * keystroke and every scroll, and a signal would make each of those a change
   * detection round for a value nothing renders.
   */
  private _lastActivityAt = 0;

  /** Everybody holding a request that is waiting for a password. */
  private _waiting: ((recovered: boolean) => void)[] = [];

  private readonly _warning = signal(false);
  private readonly _locked = signal(false);
  private readonly _lockedUsername = signal('');

  /**
   * Whether to tell the operator their session is about to end.
   *
   * True only for an idle session inside the warning fraction. Anything they do
   * while it is showing renews the token and clears it, so the warning is never
   * something to dismiss and then keep working around.
   */
  readonly warning = this._warning.asReadonly();

  /**
   * Whether the re-authentication overlay is up.
   *
   * The app below it is untouched and stays mounted. This signal is the only
   * thing that raises the overlay, and the only thing that takes it down is a
   * password or a deliberate sign out.
   */
  readonly locked = this._locked.asReadonly();

  /**
   * Who the overlay asks for. Captured when the session expires rather than read
   * off the store, because a refused password clears the held session and the
   * overlay must not lose the name it is asking about halfway through.
   */
  readonly lockedUsername = this._lockedUsername.asReadonly();

  constructor() {
    // Every session change re-decides: a sign in starts the clock, a renewal
    // restarts it against the new expiry, and a sign out stops it. `untracked`
    // because the decision reads several signals it must not become a dependency
    // of, and re-running this effect on any of them would be a loop.
    effect(() => {
      const session = this._sessions.session();
      untracked(() => (session === null ? this.idle() : this.evaluate()));
    });

    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /**
   * Begin watching (plan 0003, section 2).
   *
   * Called from an environment initializer, because nothing injects this service
   * until a token needs renewing and by then every interaction it should have
   * been counting has already happened.
   */
  start(): void {
    if (this._started) {
      return;
    }
    this._started = true;

    for (const event of ACTIVITY_EVENTS) {
      // Passive and capturing: passive so a scroll listener cannot make the page
      // janky, capturing so an interaction inside a component that stops
      // propagation is still an interaction.
      this._document.addEventListener(event, this.onActivity, {
        capture: true,
        passive: true,
      });
    }
    this._document.addEventListener('visibilitychange', this.onVisibility);

    this.evaluate();
  }

  /** Stop watching. Only the app's teardown calls this. */
  stop(): void {
    this._started = false;
    this.stopTimer();
    for (const event of ACTIVITY_EVENTS) {
      this._document.removeEventListener(event, this.onActivity, {
        capture: true,
      });
    }
    this._document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * "I am still here" (plan 0003, section 3).
   *
   * What the warning's own button calls. Dismissing the warning and touching
   * anything are the same act, so this does exactly what a keystroke does and
   * the warning has no dismissal of its own that leaves the session running
   * down.
   */
  keepAlive(): void {
    this._lastActivityAt = Date.now();
    this.evaluate();
  }

  /**
   * A 401 arrived. Get the request a token, or say there will not be one (plan
   * 0003, section 6).
   *
   * This **is** the queue the plan describes, and it is a queue without a queue:
   * every request that 401s awaits this, and each of them retries itself when it
   * resolves. There is no list of paused requests to drain, get wrong, or leak,
   * because every paused request is already holding its own continuation.
   *
   * One refresh is attempted, single-flight, and it is skipped entirely once the
   * overlay is up: the token is known dead by then and asking again would be a
   * request per waiting caller. Resolves `true` when a usable token exists and
   * `false` when the operator abandoned the overlay, which is the one path in
   * this design that loses work and takes a deliberate act.
   */
  async recover(): Promise<boolean> {
    // A 401 with no session held is not an expiry, it is a request made after a
    // sign out. There is nobody to ask for a password and no screen worth
    // covering, so it fails and the route guard does the rest.
    if (this._sessions.session() === null) {
      return false;
    }

    if (!this._locked() && (await this._sessions.refresh())) {
      this.evaluate();
      return true;
    }

    this.lock();
    return new Promise<boolean>((resolve) => this._waiting.push(resolve));
  }

  /**
   * The password from the overlay (plan 0003, section 5).
   *
   * On success the overlay comes down, every request that was waiting is
   * released against the new token, and the app is exactly where it was,
   * including a half filled form. Answers a {@link SignInFailure} otherwise, for
   * the overlay to render with the same copy the login screen uses.
   */
  async reauthenticate(password: string): Promise<SignInFailure | null> {
    const failure = await this._sessions.signIn(
      this._lockedUsername(),
      password
    );
    if (failure !== null) {
      return failure;
    }

    this._locked.set(false);
    // Typing a password is interaction, and without recording it the renewed
    // session would count as idle from birth and warn at a fifth of its life.
    this._lastActivityAt = Date.now();
    this.settle(true);
    this.evaluate();
    return null;
  }

  /**
   * Give up the session (plan 0003, sections 6 and 7).
   *
   * One method for two things that are the same thing: abandoning the overlay
   * and signing out deliberately. Both clear the token, fail everything that was
   * waiting for one, and leave the caller to navigate to the login screen. There
   * is nothing to revoke on the server, so this is entirely a local act.
   *
   * The waiters are failed **before** the session is cleared, so a request
   * released by this cannot find a token that is on its way out and retry
   * against it.
   */
  signOut(): void {
    this._locked.set(false);
    this._warning.set(false);
    this.settle(false);
    this._sessions.signOut();
  }

  /** Decide, act, and arm the one timer. */
  private evaluate(): void {
    this.stopTimer();

    // Nothing to decide while the overlay is up: the token is dead, and the only
    // thing that changes that is a password.
    if (this._locked()) {
      return;
    }

    const session = this._sessions.session();
    if (session === null) {
      this._warning.set(false);
      return;
    }

    const decision = decideKeepalive({
      now: Date.now(),
      receivedAt: session.receivedAt.getTime(),
      expiresAt: session.expiresAt.getTime(),
      lastActivityAt: this._lastActivityAt,
      visible: this.visible(),
      policy: this._policy,
    });

    switch (decision.kind) {
      case 'renew':
        this._warning.set(false);
        // Armed *before* the renewal, not after it. A request that never
        // settles would otherwise leave the session with no timer at all: the
        // token would die in silence, the overlay would never appear, and the
        // next click would 401 into a screen that looked signed in.
        this.sleepUntil(session.expiresAt.getTime());
        void this.renew(session.expiresAt.getTime());
        return;
      case 'warn':
        this._warning.set(true);
        this.sleepUntil(decision.at);
        return;
      case 'wait':
        this._warning.set(false);
        this.sleepUntil(decision.at);
        return;
      case 'expire':
        this._warning.set(false);
        this.lock();
        return;
    }
  }

  /**
   * Renew, and decide again against whatever came back.
   *
   * `expiredAt` is the expiry that prompted this. A "successful" renewal that
   * did not move it is treated as a failure, because deciding again against an
   * unchanged expiry would decide to renew, forever, at whatever rate the
   * network allows. That is a server bug this app cannot fix and must not
   * amplify into a request loop against production.
   */
  private async renew(expiredAt: number): Promise<void> {
    const renewed = await this._sessions.refresh();
    const session = this._sessions.session();

    if (session === null) {
      return;
    }

    if (renewed && session.expiresAt.getTime() > expiredAt) {
      this.evaluate();
      return;
    }

    // A blink, a gateway restart, or a refusal. The token is still live, so the
    // session is not over: wait and try again, but never past the expiry, which
    // is what raises the overlay.
    this.sleepUntil(
      Math.min(
        Date.now() + this._policy.renewRetryMs,
        session.expiresAt.getTime()
      )
    );
  }

  /** Raise the overlay, once. */
  private lock(): void {
    if (this._locked()) {
      return;
    }
    this.stopTimer();
    this._warning.set(false);
    this._lockedUsername.set(this._sessions.session()?.username ?? '');
    this._locked.set(true);
  }

  /** No session: nothing to time, and nothing to warn about. */
  private idle(): void {
    this.stopTimer();
    this._warning.set(false);
  }

  private settle(recovered: boolean): void {
    const waiting = this._waiting;
    this._waiting = [];
    for (const resolve of waiting) {
      resolve(recovered);
    }
  }

  private sleepUntil(at: number): void {
    this.stopTimer();
    // Never negative, and never so far out that a browser clamps it oddly: the
    // longest wait here is one token lifetime.
    this._timer = setTimeout(
      () => this.evaluate(),
      Math.max(at - Date.now(), 0)
    );
  }

  private stopTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private visible(): boolean {
    // Anything other than an explicit `hidden` counts as visible, so a document
    // that does not implement the API does not look permanently backgrounded and
    // refuse to renew a session somebody is using.
    return this._document.visibilityState !== 'hidden';
  }

  private readonly onActivity = (): void => {
    const now = Date.now();
    if (now - this._lastActivityAt < ACTIVITY_RESOLUTION_MS) {
      return;
    }
    this._lastActivityAt = now;

    // Interacting with a screen that is covered by the overlay is not activity
    // that renews anything: the token is dead, and only the password brings it
    // back.
    if (!this._locked()) {
      this.evaluate();
    }
  };

  private readonly onVisibility = (): void => {
    // The freeze and thaw case (plan 0003, section 2). A page the OS suspended
    // resumes with timers that did not fire, so coming back to the foreground
    // re-decides against the real clock rather than trusting one that slept.
    this.evaluate();
  };
}
