import { DestroyRef, inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { BrowserFacade } from './browser-facade';
import { ReloadBlocker } from './reload-blocker';

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
 * **Inert without a worker**, which is every development build and every run under
 * the portfolio shell: `provideServiceWorker` lives in `app.config.ts` alone (plan
 * 0013 D4), so in those modes `isEnabled` is false and the constructor returns before
 * subscribing to anything.
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

  constructor() {
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
    if (!this._updates?.isEnabled || this._checkInFlight !== null) {
      return;
    }

    this._checkInFlight = this._updates.checkForUpdate();
    void this._checkInFlight
      .catch(() => false)
      .finally(() => {
        this._checkInFlight = null;
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
