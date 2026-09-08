import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { BackendReadiness } from './backend-readiness';
import { BrowserFacade } from './browser-facade';
import { ReloadBlocker } from './reload-blocker';
import { StorageKeys } from './storage-keys';

/**
 * How long an app left open in the foreground may go without asking whether it is
 * still current (plan 0034 D1).
 *
 * A check is one conditional GET of `ngsw.json`, so this is not a cost being
 * economised. It is a floor under the trigger that actually matters, which is the
 * window becoming visible again.
 */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * How long a demanded update waits for a version the worker said existed
 * (plan 0072 D5).
 *
 * A backstop and not the main answer. The main answer is `checkForUpdate()` resolving
 * `false`, which is the worker saying there is nothing newer and is immediate. This
 * covers the other shape: a check that found something, and a download that then
 * stalled on the connection that is already failing every request. Without it the
 * updating face would sit there for as long as the tab stayed open.
 */
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 20_000;

/**
 * The shape this app writes into `ngsw-config.json`'s `appData` (plan 0034 D3).
 *
 * Angular types `appData` as a bare `object`, because it is whatever the application
 * put there, so nothing is known about it until it is checked. Rule D4 applies to it
 * exactly as it applies to a response body.
 */
export interface VelistaAppData {
  /**
   * Whether this version should replace the running one without waiting for the user
   * to finish what they are doing. False is the resting value.
   */
  readonly critical?: boolean;
}

/** True only for an `appData` that actually says so. Anything else is not critical. */
export function isCriticalUpdate(appData: object | undefined): boolean {
  return (appData as VelistaAppData | undefined)?.critical === true;
}

/**
 * Keeps the installed app from running a bundle older than the one being served.
 *
 * The service worker checks for a new version at exactly two moments: when it
 * registers, which is once per app load, and when something calls
 * `checkForUpdate()`. Before plan 0034 nothing called it, so the only check velista
 * ever performed was at a cold start. That is the thing an installed PWA does least:
 * the window is backgrounded and resumed for days, and a user could sit on a bundle
 * from several releases ago while the app believed it was current.
 *
 * This is a listener, not a dependency. Nothing injects it, so `appProviders` starts
 * it with an environment initializer, the same way `ConnectionRecovery` is started.
 *
 * It is also where a build the deployment refuses replaces itself (plan 0072). That
 * is the same mechanism pointed at a different trigger: `demandUpdate` sets the latch
 * a `critical` release sets, so the reload still happens on `VERSION_READY` and only
 * there, and it is bounded to one attempt per document.
 *
 * **Almost inert without a worker**, which is every development build and every run
 * under the portfolio shell: `provideServiceWorker` lives in `app.config.ts` alone
 * (plan 0013 D4), so in those modes `isEnabled` is false, nothing is checked and
 * nothing is scheduled. The one thing that still runs there is the refusal watch,
 * because a build with no update channel still has an answer for a server that
 * refuses it, and that answer is a plain reload (plan 0072 D6).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  // Optional because the worker is registered only in the standalone production
  // build. `isEnabled` covers the case where the class resolves but no worker is
  // controlling the page, which is the same "do nothing" outcome.
  private readonly _updates = inject(SwUpdate, { optional: true });
  private readonly _router = inject(Router);
  private readonly _reload = inject(ReloadBlocker);
  private readonly _browser = inject(BrowserFacade);
  private readonly _readiness = inject(BackendReadiness);
  private readonly _destroyRef = inject(DestroyRef);

  /**
   * Set when a new version is downloaded and the reload is waiting for the user to
   * leave the screen they are on (plan 0013, section 6.4).
   */
  private _reloadAtNextNavigation = false;

  /**
   * The check currently in flight, if any.
   *
   * `checkForUpdate()` is called from a timer, from a visibility change and from the
   * gateway interceptor, and the interceptor's call happens once per response, so a
   * page that fires a burst of requests against a deployment that has moved its floor
   * would otherwise start a check per request. Holding the promise collapses them.
   */
  private _checkInFlight: Promise<boolean> | null = null;

  /**
   * Whether this document is already replacing itself because the server refuses it.
   *
   * Latched rather than recomputed, so the reload path is entered once however many
   * refusals arrive: every request a refused build makes comes back the same way, so
   * without this a page firing a burst of them would start a burst of attempts.
   */
  private _demanded = false;

  /** The D5 backstop, running only while a demanded download is outstanding. */
  private _downloadTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _updateFailed = signal(false);

  /**
   * Whether the app has given up on replacing itself.
   *
   * True on any of the three dead ends in plan 0072: the worker found nothing newer
   * (D5), the version it found never arrived (D5), or this document already spent its
   * one reload (D4). The screen reads it to choose between its two faces, and it is
   * the only thing this service tells the outside world about a refused build.
   */
  readonly updateFailed: Signal<boolean> = this._updateFailed.asReadonly();

  constructor() {
    // Watched whether or not there is a worker, because D6's answer for a build with
    // no update channel is still an answer: a plain reload fetches a fresh
    // `index.html` and a fresh bundle, and it is bounded by the same one attempt.
    this._watchRefusals();

    if (!this._updates?.isEnabled) {
      return;
    }

    this._watchForNewVersions();
    this._scheduleChecks();
  }

  /**
   * Ask whether a newer version exists, now.
   *
   * Called by the schedule, and by `gatewayInterceptor` when the gateway says this
   * client is behind. **It never reloads on its own**, and that is plan 0034 D7
   * rather than an omission: the reload happens on `VERSION_READY` and only there, so
   * it cannot happen unless a new version is genuinely downloaded and cached. A
   * client that reloaded because the server said it was old, in the seconds before
   * the new bundle was actually reachable, would come back identical, be told the
   * same thing, and reload again with no way out.
   *
   * Fire and forget by design. A check that fails is a check that did not happen, and
   * the next trigger will try again; there is nothing here a caller could usefully do
   * with a rejection.
   */
  checkNow(): void {
    void this._check();
  }

  /**
   * Replace this build as soon as a new one is cached, because the server will not
   * serve this one (plan 0072 D2).
   *
   * The mechanism is the one a `critical` release already uses, with the reload moved
   * off `ReloadBlocker` (D7): a blocker protects a form, and every request that form
   * could send is refused, so waiting costs the user time and saves them nothing.
   *
   * **It still does not reload on the refusal itself.** Plan 0034 D7 is unchanged and
   * this plan does not reverse it: the reload happens on `VERSION_READY` and only
   * there, so a client told it is old in the window before the new bundle is reachable
   * cannot come back identical and be told the same thing forever. What changes is
   * that the reload no longer waits for a navigation that may never come.
   *
   * Called once per document, from the state this service watches rather than by a
   * caller, so there is one place that decides what `too-old` means.
   */
  demandUpdate(): void {
    if (this._demanded) {
      return;
    }
    this._demanded = true;

    // D4, and the reason it is checked before anything else: this document has
    // already reloaded once for this, and come back refused. Another check and
    // another twenty seconds would only delay the same screen.
    if (this._attemptSpent()) {
      this._giveUp();
      return;
    }

    // A version is already downloaded and waiting for the navigation a user who is
    // not navigating never makes, which is the exact case D3 is about. Take it now,
    // and do not ask the worker: `checkForUpdate` answers about what is newer than
    // the latest it holds, so it would say `false` and this would give up on a bundle
    // that is sitting in the cache.
    if (this._reloadAtNextNavigation) {
      this._reloadAtNextNavigation = false;
      this._reloadOnce();
      return;
    }

    // D6. No worker means no update channel, and a plain reload is what fetches a
    // fresh `index.html` and a fresh bundle. Every development build and every run
    // under the portfolio shell is here.
    if (!this._updates?.isEnabled) {
      this._reloadOnce();
      return;
    }

    void this._check().then((found) => {
      if (!this._demanded) {
        return;
      }

      // D5. `false` is the worker saying there is nothing newer, which is the honest
      // answer to "the server refuses this build and there is nothing to install".
      if (!found) {
        this._giveUp();
        return;
      }

      this._downloadTimer = setTimeout(
        () => this._giveUp(),
        UPDATE_DOWNLOAD_TIMEOUT_MS
      );
    });
  }

  /**
   * The Try again button on the dead end screen.
   *
   * Bypasses the attempt counter, because the counter exists to stop the **app**
   * looping and this is a person choosing. It goes straight through `BrowserFacade`
   * for D7's reason as well: there is nothing behind this screen to protect.
   */
  reloadByHand(): void {
    this._browser.reload();
  }

  /**
   * The check in flight, started if there is none.
   *
   * Shared rather than started per caller: the interceptor calls `checkNow` once per
   * response, so a page firing a burst of requests against a deployment that moved
   * its floor would otherwise start a check per request. A rejected check resolves
   * `false` here, which is the same answer as finding nothing and is treated the
   * same way everywhere.
   */
  private _check(): Promise<boolean> {
    if (!this._updates?.isEnabled) {
      return Promise.resolve(false);
    }

    if (this._checkInFlight === null) {
      this._checkInFlight = this._updates.checkForUpdate().catch(() => false);
      void this._checkInFlight.finally(() => {
        this._checkInFlight = null;
      });
    }

    return this._checkInFlight;
  }

  /**
   * Move to the dead end face, and stop waiting for anything.
   *
   * One place, because all three ways in are the same conclusion: this document is
   * not going to become a build the server will serve.
   */
  private _giveUp(): void {
    this._clearDownloadTimer();
    this._updateFailed.set(true);
  }

  /** Spend the one reload this document gets, or give up if it is already spent. */
  private _reloadOnce(): void {
    if (this._attemptSpent()) {
      this._giveUp();
      return;
    }

    this._clearDownloadTimer();
    this._browser.writeSessionStorage(StorageKeys.updateAttempt, '1');
    this._browser.reload();
  }

  private _attemptSpent(): boolean {
    return this._browser.readSessionStorage(StorageKeys.updateAttempt) !== null;
  }

  private _clearDownloadTimer(): void {
    if (this._downloadTimer !== null) {
      clearTimeout(this._downloadTimer);
      this._downloadTimer = null;
    }
  }

  /**
   * The one place that turns a readiness state into an update.
   *
   * `AppUpdates` watches rather than being called (plan 0072, section 3), because the
   * service that owns the worker is the one that should decide what `too-old` means,
   * and because both ways into that state — the boot probe and any later request —
   * already write it.
   */
  private _watchRefusals(): void {
    effect(() => {
      const state = this._readiness.state();

      untracked(() => {
        if (state === 'too-old') {
          this.demandUpdate();
          return;
        }

        // D4: cleared the moment the backend serves this build again, so a floor
        // moved later in a long lived tab gets an attempt of its own.
        if (state === 'ready') {
          this._browser.removeSessionStorage(StorageKeys.updateAttempt);
        }
      });
    });
  }

  private _watchForNewVersions(): void {
    const updates = this._updates;
    if (!updates) {
      return;
    }

    const ready = updates.versionUpdates
      .pipe(filter((event) => event.type === 'VERSION_READY'))
      .subscribe((event) => {
        // A refused build is treated as a critical release whatever `appData` says
        // (plan 0072 D2), and it bypasses `ReloadBlocker` for the reason
        // `unrecoverable` does below (D7): the form a blocker protects cannot be
        // submitted by a client every one of whose requests is refused.
        if (this._demanded) {
          this._reloadOnce();
          return;
        }

        // A release that says so replaces the running one as soon as nothing is
        // holding a reload, rather than waiting for a navigation that may never come
        // (plan 0034 D3). This is the switch for the case the whole plan exists for:
        // a change the old bundle is actively wrong about.
        if (isCriticalUpdate(event.latestVersion.appData)) {
          this._reload.reloadWhenIdle();
          return;
        }

        this._reloadAtNextNavigation = true;
      });

    // Nothing to protect: the cached state is already broken, so waiting for a polite
    // moment only prolongs an app that cannot work. Deliberately not through
    // `ReloadBlocker`, which would strand the user here for as long as a blocker was
    // held, in an app that has nothing left to lose.
    const broken = updates.unrecoverable.subscribe(() =>
      this._browser.reload()
    );

    const navigated = this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        if (!this._reloadAtNextNavigation) {
          return;
        }

        // Cleared before the request rather than after it, so a reload deferred by
        // `ReloadBlocker` is not re-proposed on every subsequent navigation. The
        // blocker already remembers that one is pending.
        this._reloadAtNextNavigation = false;
        this._reload.reloadWhenIdle();
      });

    this._destroyRef.onDestroy(() => {
      ready.unsubscribe();
      broken.unsubscribe();
      navigated.unsubscribe();
      this._clearDownloadTimer();
    });
  }

  private _scheduleChecks(): void {
    const document = this._browser.document;

    // The trigger that matters. An installed window is resumed far more often than
    // it is cold started, and before this the resume was the one moment the app was
    // guaranteed *not* to ask.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        this.checkNow();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // A plain `setInterval` rather than an rxjs `interval`. The worker registers with
    // `registerWhenStable:30000`, and a repeating timer the framework can see is a
    // good way to build an app that is never stable.
    const timer = setInterval(() => this.checkNow(), UPDATE_CHECK_INTERVAL_MS);

    this._destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    });
  }
}
