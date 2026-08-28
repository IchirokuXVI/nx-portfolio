import { HttpClient } from '@angular/common/http';
import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import {
  BrowserFacade,
  ConnectionState,
  ReloadBlocker,
} from '@portfolio/velista/platform';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from './api-url';

/**
 * Gets the app back on its feet once the connection returns.
 *
 * `0001` D6 and `0003` section 3.1: one blocking screen, and the app reloads itself
 * when the connection comes back. Both plans record that behaviour as deliberately
 * weak and temporary, and the first thing the PWA work should replace. Nothing here
 * changes that; this is only the wiring.
 *
 * It lives in `data-access` because it makes an HTTP request, while the state it
 * reports into lives in `platform` so that `ui` can render the blocking screen without
 * importing `data-access` (plan 0004, section 3.2).
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class ConnectionRecovery {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _connection = inject(ConnectionState);
  private readonly _reload = inject(ReloadBlocker);
  private readonly _browser = inject(BrowserFacade);
  private readonly _destroyRef = inject(DestroyRef);

  private _probing = false;
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this._connection.offline()) {
        this._startProbing();
      } else {
        this._stopProbing();
      }
    });

    this._destroyRef.onDestroy(() => this._stopProbing());
  }

  /**
   * Ask the backend whether it is there.
   *
   * **The test is "did any HTTP response come back", not "was it a 200".**
   * `GET /health/ready` returns 503 when a dependency is unhealthy or during a
   * graceful shutdown, and a 503 proves the network works perfectly well. Treating one
   * as still offline would strand the user on the blocking screen through an ordinary
   * backend deploy, which is the opposite of what that screen is for.
   *
   * The endpoint is unversioned and unguarded
   * (`libs/luna-shopper/platform/src/lib/health/health.module.ts:64`), so this costs
   * nothing and needs no token.
   */
  async probe(): Promise<boolean> {
    try {
      await firstValueFrom(
        this._http.get(this._urls.gateway('/health/ready'), {
          responseType: 'text',
        })
      );
      return true;
    } catch (error) {
      return hasResponse(error);
    }
  }

  private _startProbing(): void {
    if (this._timer !== null || !this._browser.isBrowser) {
      return;
    }

    // Every ten seconds. The `online` window event is the fast path; this is the one
    // that catches a captive portal, where the interface never reported a change
    // because it never lost one.
    this._timer = setInterval(() => void this._tick(), 10_000);
  }

  private async _tick(): Promise<void> {
    if (this._probing) {
      return;
    }
    this._probing = true;

    try {
      if (await this.probe()) {
        this._connection.reportReachable();
        // Deferred until nothing holds unsaved state. With no offline queue in this
        // phase, reloading over a half-typed field loses it permanently.
        this._reload.reloadWhenIdle();
      }
    } finally {
      this._probing = false;
    }
  }

  private _stopProbing(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

/**
 * Whether the failure carried an HTTP response at all. Angular reports a request that
 * never reached a server as status 0.
 */
function hasResponse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number' &&
    (error as { status: number }).status !== 0
  );
}
