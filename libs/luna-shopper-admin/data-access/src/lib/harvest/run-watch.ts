import { DOCUMENT } from '@angular/common';
import {
  computed,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import {
  canAbort,
  canRevert,
  isTerminalRun,
  runProgress,
  type HarvestRun,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError, toGatewayError } from '../gateway-error';
import { HARVEST_SERVICE } from './harvest-service';

/**
 * How often a watched run is read again.
 *
 * Backlog `0001` section 6.6's own phasing is "every couple of seconds", and two
 * is the number that phrase names. A full catalog discovery is eighteen minutes,
 * so this is roughly five hundred reads of one small row over a run, against a
 * gateway on the same machine as the operator. The cost of going slower is that
 * an abort looks like it did nothing for several seconds, which is the moment an
 * operator is most likely to press it again.
 */
export const RUN_POLL_INTERVAL_MS = 2_000;

/**
 * One run, kept current by polling (plan 0006, section 2).
 *
 * There is no socket, and adding one is the thing the plan explicitly says not
 * to do. The realtime `admin:harvest` room stays deferred, and the absence of a
 * client for it is what keeps this app free of `LUNA_REALTIME_URL` and of a
 * second origin in the backend's CORS list.
 *
 * Three rules govern when it reads, and all three are in `_schedule`:
 *
 * - **Only while a run screen is open.** The watch is started by the screen and
 *   stopped when it goes away.
 * - **Only while the tab is visible.** The same `document.visibilityState` gate
 *   `0003` uses for the keepalive, for the same reason: a backgrounded tab
 *   polling a route every two seconds for eighteen minutes is a request nobody
 *   is reading the answer to.
 * - **Never after a terminal status.** A finished run cannot change, so the
 *   first terminal read is the last read.
 *
 * A run is long and is watched intermittently, so **correct on arrival** is the
 * property that matters more than smooth movement: the first read draws the
 * whole state, and nothing here accumulates anything across polls that a fresh
 * arrival would be missing. That is why the counters come from the run rather
 * than from a running total this class keeps.
 *
 * Not an `@Injectable` per screen but a class the screen constructs, for the
 * reason `ResourceListStore` is one: a route's providers injector is never
 * destroyed, so a route-scoped service's teardown never runs and the timer would
 * outlive the screen that started it.
 */
export class RunWatch {
  private readonly _run = signal<HarvestRun | null>(null);
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _loading = signal(true);
  private readonly _aborting = signal(false);
  private readonly _reverting = signal(false);

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;
  /** Set the moment `stop` runs, so a read already in flight cannot restart it. */
  private _stopped = false;

  constructor(
    private readonly _service: RunReader,
    private readonly _document: Pick<
      Document,
      'visibilityState' | 'addEventListener' | 'removeEventListener'
    >,
    private readonly _id: string
  ) {}

  readonly run: Signal<HarvestRun | null> = this._run.asReadonly();
  readonly error: Signal<GatewayError | null> = this._error.asReadonly();

  /** The first read has not answered yet. Only ever true before one has. */
  readonly loading: Signal<boolean> = this._loading.asReadonly();

  readonly aborting: Signal<boolean> = this._aborting.asReadonly();

  readonly reverting: Signal<boolean> = this._reverting.asReadonly();

  /** Nothing was drawable: the first read failed and there is no run to show. */
  readonly failed = computed(
    () => this._error() !== null && this._run() === null
  );

  readonly finished = computed(() => isTerminalRun(this._run()));

  readonly canAbort = computed(
    () => canAbort(this._run()) && !this._aborting()
  );

  /**
   * Whether the revert control belongs on the screen (backend plan 0082).
   *
   * A finished run of a price writing mode that has not been reverted already.
   * The three conditions are the server's own refusals, asked here so the
   * button is absent rather than present and answered with a 409.
   */
  readonly canRevert = computed(
    () => canRevert(this._run()) && !this._reverting()
  );

  readonly progress = computed(() => {
    const run = this._run();
    return run === null ? null : runProgress(run);
  });

  /**
   * Whether polling is paused rather than over.
   *
   * A different sentence from "finished", and the screen says which. A tab that
   * has been in the background for ten minutes shows numbers from ten minutes
   * ago, and an operator who is told the run is still going but not told the
   * screen stopped asking would read those numbers as current.
   */
  readonly paused = computed(
    () => this._started && !this.finished() && !this._visible()
  );

  /** Start reading. Called once, by the screen that owns this. */
  start(): void {
    if (this._started) {
      return;
    }
    this._started = true;
    this._document.addEventListener('visibilitychange', this._onVisibility);
    void this._read();
  }

  /** Stop reading, for good. The screen's teardown calls this. */
  stop(): void {
    this._stopped = true;
    this._started = false;
    this._clearTimer();
    this._document.removeEventListener('visibilitychange', this._onVisibility);
  }

  /** Read now, whatever the timer was going to do. The retry button calls it. */
  refresh(): Promise<void> {
    return this._read();
  }

  /**
   * Ask the run to stop.
   *
   * The answer is the run as the abort left it, so the screen updates from the
   * reply rather than waiting up to two seconds for the next poll to notice. The
   * poll carries on afterwards, because the abort is graceful: the run flushes
   * what it has and finalizes, so the status the button produced is not
   * necessarily the last one.
   */
  async abort(): Promise<void> {
    if (!this.canAbort()) {
      return;
    }

    this._aborting.set(true);
    try {
      this._apply(await this._service.abortRun(this._id));
    } catch (error) {
      this._error.set(toGatewayError(error));
    } finally {
      this._aborting.set(false);
    }
  }

  /**
   * Take back everything the run wrote.
   *
   * The answer is the run with `revertedAt` and the counts the operation
   * produced, and it is applied straight away rather than waited for: the run
   * is finished, so the poll has already stopped and there is no next read to
   * notice. That is the difference from {@link abort}, where the poll carries
   * on because the abort is graceful and the status is not yet final.
   *
   * A failure leaves the run exactly as it was on screen, with the error under
   * it. Nothing here half applies a revert: the counts come from the reply.
   */
  async revert(): Promise<void> {
    if (!this.canRevert()) {
      return;
    }

    this._reverting.set(true);
    try {
      this._apply(await this._service.revertRun(this._id));
    } catch (error) {
      this._error.set(toGatewayError(error));
    } finally {
      this._reverting.set(false);
    }
  }

  private async _read(): Promise<void> {
    this._clearTimer();

    try {
      this._apply(await this._service.readRun(this._id));
    } catch (error) {
      // The rows already on screen are still true, so a failed poll is a line
      // under them rather than the loss of everything the operator had. Only a
      // failure with nothing to draw takes the screen over.
      this._error.set(toGatewayError(error));
      this._loading.set(false);
      this._schedule();
    }
  }

  private _apply(run: HarvestRun): void {
    this._run.set(run);
    this._error.set(null);
    this._loading.set(false);
    this._schedule();
  }

  private _schedule(): void {
    this._clearTimer();

    if (
      this._stopped ||
      !this._started ||
      this.finished() ||
      !this._visible()
    ) {
      return;
    }

    this._timer = setTimeout(() => void this._read(), RUN_POLL_INTERVAL_MS);
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
    // backgrounded and left never polling at all.
    return this._document.visibilityState !== 'hidden';
  }

  /**
   * Both directions, and both of them matter.
   *
   * **Going away cancels the pending read.** `_schedule` declines to set a new
   * timer while the tab is hidden, but a timer set while it was visible is
   * already ticking, so without this the tab would go to the background and fire
   * exactly one more read anyway. Rescheduling clears it.
   *
   * **Coming back reads immediately.** Waiting out the interval would show
   * numbers from before the tab was hidden, which is exactly the arrival case
   * section 2 says has to be correct.
   */
  private readonly _onVisibility = (): void => {
    if (!this._started || this.finished()) {
      return;
    }

    if (this._visible()) {
      void this._read();
    } else {
      this._schedule();
    }
  };
}

/** The three calls a watch makes, so a spec can supply them without the rest. */
export interface RunReader {
  readRun(id: string): Promise<HarvestRun>;
  abortRun(id: string): Promise<HarvestRun>;
  revertRun(id: string): Promise<HarvestRun>;
}

/**
 * Builds a watch in an injection context.
 *
 * The screen needs the service and the document, and a component field
 * initializer is an injection context while a `setTimeout` callback is not. So
 * the dependencies are gathered once, here, and the watch itself is a plain
 * object with no injector of its own.
 */
@Injectable({ providedIn: 'root' })
export class RunWatches {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _document = inject(DOCUMENT);

  for(id: string): RunWatch {
    return new RunWatch(this._service, this._document, id);
  }
}
