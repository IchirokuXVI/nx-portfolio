import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { isTerminalRun } from '@portfolio/luna-shopper-admin/models';
import { toGatewayError, type GatewayError } from '../gateway-error';
import { RUN_POLL_INTERVAL_MS } from '../harvest/run-watch';
import { DASHBOARD_SERVICE, type DashboardDocument } from './dashboard-service';

/**
 * How often the dashboard reads itself again.
 *
 * A minute, because a dashboard left open on a second monitor is the common case
 * and an operator glancing at it expects it to be roughly now. Every number on
 * it is an aggregate over a table, so a faster poll would buy seconds of
 * freshness on counts that move in hours.
 *
 * Beside {@link RUN_POLL_INTERVAL_MS} on purpose: the two are the same decision
 * asked about two different things, and a run in flight is drawn at the second
 * of them.
 */
export const DASHBOARD_POLL_INTERVAL_MS = 60_000;

/**
 * The dashboard's document, kept current (admin plan 0016, section 1).
 *
 * Two rules govern when it reads, and both are in `_schedule`:
 *
 * - **Only while the tab is visible.** The same `document.visibilityState` gate
 *   `RunWatch` uses and for the same reason: a backgrounded tab asking a gateway
 *   for four services' aggregates every minute is a request nobody is reading
 *   the answer to. Coming back reads at once rather than waiting out the
 *   interval, because the numbers from before the tab was hidden would otherwise
 *   be read as now.
 * - **Faster while a run is in flight.** Once a minute is the wrong cadence for
 *   a progress bar, so the interval drops to the run screen's while
 *   `harvest.running` is a run that has not finished, and goes back when it has.
 *
 * **A re-read that fails keeps the last document.** The numbers on screen were
 * true a minute ago, and a screen that blanks every time the gateway hiccups is
 * one that is never trusted. Only a first read with nothing to keep leaves the
 * screen with an error on it.
 *
 * `providedIn: 'root'`, so a navigation away and back does not throw the
 * document away and draw an empty screen while the first read is in flight. The
 * page starts the watch and stops it on its own teardown, which is a component's
 * `DestroyRef` and therefore one that actually runs.
 */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly _service = inject(DASHBOARD_SERVICE);
  private readonly _document = inject(DOCUMENT);

  private readonly _dashboard = signal<DashboardDocument | null>(null);
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _loading = signal(true);

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _watching = false;

  /** The whole document, or `null` before a read has ever answered. */
  readonly document = this._dashboard.asReadonly();

  /** The first read has not answered yet. Only ever true before one has. */
  readonly loading = this._loading.asReadonly();

  /**
   * The last failure, kept even when there is a document to draw.
   *
   * The header says a re-read failed and how old the numbers under it are, which
   * is a different sentence from an error page and is the one an operator can
   * act on.
   */
  readonly failed = this._error.asReadonly();

  /** When the numbers were taken, as the gateway stamped them. */
  readonly measuredAt = computed(() => this._dashboard()?.measuredAt ?? null);

  /** Nothing is drawable: the first read failed and there is nothing to keep. */
  readonly empty = computed(
    () => this._error() !== null && this._dashboard() === null
  );

  /**
   * Whether the harvester is part way through a run.
   *
   * The gateway answers `running` as the `RUNNING` run, else the `PENDING` one,
   * and `null` when there is neither, so a finished run leaves this false on the
   * next read. The terminal check is here anyway, because a run that finished
   * between the query and the response would otherwise hold the fast poll open
   * until something else changed.
   */
  readonly runInFlight = computed(() => {
    const running = this._dashboard()?.harvest?.running ?? null;
    return running !== null && !isTerminalRun(running);
  });

  /** How long until the next read, which is one of two numbers. */
  readonly interval = computed(() =>
    this.runInFlight() ? RUN_POLL_INTERVAL_MS : DASHBOARD_POLL_INTERVAL_MS
  );

  /** Start reading, and keep reading. Called once, by the screen that owns this. */
  watch(): void {
    if (this._watching) {
      return;
    }
    this._watching = true;
    this._document.addEventListener('visibilitychange', this._onVisibility);
    void this.load();
  }

  /** Stop reading. The screen's teardown calls this. */
  stop(): void {
    this._watching = false;
    this._clearTimer();
    this._document.removeEventListener('visibilitychange', this._onVisibility);
  }

  /** Read now, whatever the timer was going to do. The refresh button calls it. */
  async load(): Promise<void> {
    this._clearTimer();

    try {
      this._dashboard.set(await this._service.read());
      this._error.set(null);
    } catch (error) {
      // The document already on screen is still the document, so a failed
      // re-read is a line beside the timestamp rather than the loss of
      // everything the operator had.
      this._error.set(toGatewayError(error));
    } finally {
      this._loading.set(false);
      this._schedule();
    }
  }

  private _schedule(): void {
    this._clearTimer();

    if (!this._watching || !this._visible()) {
      return;
    }

    this._timer = setTimeout(() => void this.load(), this.interval());
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _visible(): boolean {
    // Anything other than an explicit `hidden` counts as visible, so a document
    // that does not implement the API is not treated as permanently
    // backgrounded and left never reading at all.
    return this._document.visibilityState !== 'hidden';
  }

  /**
   * Both directions, and both of them matter.
   *
   * **Going away cancels the pending read.** `_schedule` declines to set a new
   * timer while the tab is hidden, but a timer set while it was visible is
   * already ticking, so without this the tab would go to the background and fire
   * exactly one more read anyway.
   *
   * **Coming back reads immediately**, because waiting out a minute would show
   * numbers from before the tab was hidden under a timestamp the operator has to
   * read to notice.
   */
  private readonly _onVisibility = (): void => {
    if (!this._watching) {
      return;
    }

    if (this._visible()) {
      void this.load();
    } else {
      this._clearTimer();
    }
  };
}
