import { computed, inject, Injectable, signal } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { HARVEST_SERVICE } from '../harvest/harvest-service';

/**
 * The postal code queue at a glance, read once and shared.
 *
 * Two screens want the same four numbers (admin plan 0021, sections 4.1 and 6):
 * the list draws a banner when nothing drains the queue, and the dashboard draws
 * a card saying how many codes are waiting and how long the oldest has waited.
 * Both are the same call, so both read this rather than asking twice.
 *
 * **A failure is silence.** Neither reader is showing the summary as the answer
 * to the question its screen exists for: the list's rows and the dashboard's
 * document arrive by other calls. So a summary that did not answer draws no
 * banner and no card, which is the decoration rule plan 0074 section 3 states,
 * rather than an error over a screen that is otherwise working.
 */
@Injectable({ providedIn: 'root' })
export class PostalCodeSummaryStore {
  private readonly _harvest = inject(HARVEST_SERVICE);

  private readonly _summary =
    signal<Wire.HarvestPostalCodeDiscoverySummaryView | null>(null);
  private readonly _loading = signal(false);

  /** The counts, or `null` before the first answer and after a failure. */
  readonly summary = this._summary.asReadonly();
  readonly loading = this._loading.asReadonly();

  /**
   * Whether the queue has somebody to drain it.
   *
   * `false` **only** when the summary said so. A summary that has not arrived
   * answers null, because "we did not ask" is not "nothing is running", and a
   * banner drawn on the difference would appear for a second on every load.
   */
  readonly draining = computed<boolean | null>(
    () => this._summary()?.draining ?? null
  );

  /**
   * Read it, at most once per instance unless asked again.
   *
   * The store is at root and both readers call this on arrival, so the second
   * screen of a session gets the numbers with no request. `force` is the refresh
   * button, and a write that changes the queue.
   */
  async load(force = false): Promise<void> {
    if (this._loading()) {
      return;
    }
    if (!force && this._summary() !== null) {
      return;
    }

    this._loading.set(true);
    try {
      this._summary.set(await this._harvest.postalCodeSummary());
    } catch {
      // Deliberately swallowed. See the class comment: nothing here is the
      // reason either screen exists, so a failure costs a banner and a card.
      this._summary.set(null);
    } finally {
      this._loading.set(false);
    }
  }
}
