import { computed, inject, Injectable, signal } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * Whether the app currently believes it can reach the backend.
 *
 * Two inputs, and the second is the one that makes this work at all
 * (plan 0004, section 8):
 *
 * - `BrowserFacade.onLine`, fed by the window `online` and `offline` events.
 * - Requests that got no response, reported by the gateway interceptor.
 *
 * `navigator.onLine` describes the **network interface**, not whether anything is
 * reachable, so a phone attached to a captive portal reports online while nothing
 * works. That is a completely ordinary situation in a supermarket, which is where
 * this product is used, so a failed request has to be able to say "offline" over the
 * top of a browser insisting otherwise.
 *
 * This service holds state and nothing else. It does no HTTP, because it lives in
 * `platform` so that `ui` can read it without importing `data-access` (section 3.2).
 * The recovery probe that clears `_requestsFailing` lives in `data-access`.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionState {
  private readonly _browser = inject(BrowserFacade);

  /** Set when a request came back with no response, cleared when one succeeds. */
  private readonly _requestsFailing = signal(false);

  /**
   * True when the app cannot reach the backend, by either measure.
   *
   * `0003` section 3.1 renders a blocking screen on this. It is deliberately
   * pessimistic: either signal alone is enough, because showing the screen wrongly
   * costs a reload and hiding it wrongly costs the user their trust in every number
   * on the page.
   */
  readonly offline = computed(
    () => !this._browser.onLine() || this._requestsFailing()
  );

  /**
   * Called by the gateway interceptor when a request produced no response.
   *
   * Deliberately not called for an HTTP error status. A 500 means the server is
   * there and answering, which is a different problem with a different screen.
   */
  reportNetworkFailure(): void {
    this._requestsFailing.set(true);
  }

  /**
   * Called when any request completes, whatever its status.
   *
   * A 503 from a deploying backend still proves the network works, so this clears
   * the failing flag. Treating a 503 as "still offline" would strand the user on the
   * blocking screen through an ordinary deploy (plan 0004, section 8).
   */
  reportReachable(): void {
    this._requestsFailing.set(false);
  }
}
