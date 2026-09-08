import { HttpClient } from '@angular/common/http';
import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  untracked,
} from '@angular/core';
import {
  AppResumed,
  BackendReadiness,
  BrowserFacade,
} from '@portfolio/velista/platform';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiUrl } from './api-url';
import { anonymous } from './auth/http-context';

/**
 * How long one attempt may go unanswered before it counts as no response
 * (plan 0071 D7).
 *
 * `HttpClient` has no deadline of its own, so a socket that is opened and never
 * answered produces no error and no timeout. Without this the app sits on the startup
 * screen forever with nothing retrying behind it, which is the exact failure the
 * screen exists to replace.
 */
export const STARTUP_PROBE_TIMEOUT_MS = 8_000;

/**
 * How long to wait after each unanswered attempt, in order, then every ten seconds.
 *
 * Fast at first because the common case is a phone that has just found its network,
 * and slow afterwards because the uncommon case is a backend that is down and does
 * not benefit from being asked twice a second.
 */
export const STARTUP_PROBE_BACKOFF_MS = [1_000, 2_000, 5_000] as const;

/** What the backoff settles at once the list above runs out. */
export const STARTUP_PROBE_INTERVAL_MS = 10_000;

/**
 * Asks the backend whether it is there, before the app acts on the answer.
 *
 * The app used to find this out by trying to use the backend: every screen fired its
 * own request, and the first one that got no answer tripped `ConnectionState` and
 * covered a page that had already rendered. This asks the question once, at startup,
 * so the gate in `AppLayout` has an answer to read (plan 0071).
 *
 * It lives here because it makes an HTTP request, and it writes into
 * `BackendReadiness` over in `platform`, which is the same split `ConnectionRecovery`
 * and `ConnectionState` already are: `ui` renders the startup screen off the state,
 * and may not import this library (plan 0004, section 3.2).
 *
 * ## One request, two answers
 *
 * `GET /health/ready` is the same URL `ConnectionRecovery` already probes, and
 * `MinClientVersionGuard` is a global `APP_GUARD` on the gateway, so it runs for the
 * health routes too. One probe therefore comes back carrying the advertised floor, and
 * comes back **refused** with `client_too_old` when this build is below it. The
 * refusal is noticed by `gatewayInterceptor`, which reports it to `BackendReadiness`
 * for us: this class never has to read a status code to find out.
 *
 * ## What it does not do
 *
 * It reports nothing to `ConnectionState`. The request goes through
 * `gatewayInterceptor` like any other gateway call, so a failure with no response
 * already calls `reportNetworkFailure` and a success already calls `reportReachable`.
 * A second report here would be two things writing one flag.
 *
 * And it stops at the first success. Once the answer is `ready` the running app is
 * owned by the services that already own it, and no second poller is introduced
 * (plan 0071 D11).
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// `ApiUrl` and this app's `HttpClient`, which exist only in the app's injector.
@Injectable()
export class StartupProbe {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _readiness = inject(BackendReadiness);
  private readonly _browser = inject(BrowserFacade);
  private readonly _resumed = inject(AppResumed);
  private readonly _destroyRef = inject(DestroyRef);

  private _attempts = 0;
  private _inFlight = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The counts the effect below has already reacted to. Both start level with their
   * signals, so the effect's own first run is never read as a request to retry.
   */
  private _seenResumes = 0;
  private _seenRetries = 0;

  constructor() {
    if (!this._browser.isBrowser) {
      return;
    }

    void this._attempt();

    effect(() => {
      const resumes = this._resumed.resumes();
      const retries = this._readiness.retryRequested();

      untracked(() => {
        const asked =
          resumes !== this._seenResumes || retries !== this._seenRetries;
        this._seenResumes = resumes;
        this._seenRetries = retries;

        if (!asked || this._readiness.state() === 'ready') {
          return;
        }

        // A resume is the moment a phone comes back onto a working network, and a
        // press of Try again is somebody saying so themselves. Neither should wait
        // out the ten second backoff it landed in, so both cancel it and ask now.
        this._stopTimer();
        this._attempts = 0;
        void this._attempt();
      });
    });

    this._destroyRef.onDestroy(() => this._stopTimer());
  }

  /**
   * One attempt, and the scheduling of the next one if this fails.
   *
   * `anonymous()` sets `SKIP_AUTH` (plan 0071 D10). Without it the interceptor
   * refreshes the token first, so the startup answer costs two serial round trips, the
   * first of which is a refresh sent at the exact moment the backend is least likely
   * to answer. Plan `0067` is about what a refresh in that window used to cost.
   */
  private async _attempt(): Promise<void> {
    if (this._inFlight) {
      return;
    }
    this._inFlight = true;
    this._attempts += 1;

    try {
      await firstValueFrom(
        this._http
          .get(this._urls.gateway('/health/ready'), {
            context: anonymous('startup-probe'),
            responseType: 'text',
          })
          .pipe(timeout(STARTUP_PROBE_TIMEOUT_MS))
      );

      // Only a 2xx is ready. A 503 proves the network works, which is why
      // `ConnectionState` reads it as reachable, and it also says the gateway cannot
      // serve this app, which is why the gate keeps waiting (plan 0071 D6).
      this._readiness.reportReady();
    } catch {
      // A timeout, no response, and every other status all land here and all mean the
      // same thing to the gate. The one answer that is not `unreachable` is
      // `client_too_old`, and the interceptor has already reported that by now, which
      // is why this asks the state rather than the error.
      if (this._readiness.state() !== 'too-old') {
        this._readiness.reportUnreachable();
        this._scheduleRetry();
      }
    } finally {
      this._inFlight = false;
    }
  }

  private _scheduleRetry(): void {
    if (this._timer !== null) {
      return;
    }

    const index = this._attempts - 1;
    const delay = STARTUP_PROBE_BACKOFF_MS[index] ?? STARTUP_PROBE_INTERVAL_MS;

    this._timer = setTimeout(() => {
      this._timer = null;
      void this._attempt();
    }, delay);
  }

  private _stopTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
