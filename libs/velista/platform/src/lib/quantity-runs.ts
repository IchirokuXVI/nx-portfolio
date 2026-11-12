import {
  DestroyRef,
  DOCUMENT,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import {
  QUANTITY_STEP_QUIET_MS,
  type QuantityStep,
} from '@portfolio/velista/models';

/** One run of steps on one key, as a feature writes it (velista `0188`, section 4). */
export interface QuantityRun {
  /** The amount the run started from, as the control drew it. */
  readonly from: number;
  /** The amount the last step reached. */
  readonly to: number;
}

/** Collect the steps of each key into one run, and send it after the quiet beat. */
export interface QuantityRuns<K> {
  /** The amount to draw for each key with an open run. */
  readonly pending: Signal<ReadonlyMap<K, number>>;
  /** What to draw for a key: the open run's amount, or the stored one. */
  shown(key: K, stored: number): number;
  step(key: K, step: QuantityStep): void;
  /** Send a key's open run now (a unit change, a sheet that opens). */
  flush(key: K): void;
}

interface OpenRun {
  readonly from: number;
  to: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The wait before a save, for the pages that write a line's amount (velista `0188`,
 * section 4 and decision S12). The stepper emits every press and saves nothing; this
 * gathers the presses on one key into one run, and after `quietMs` with no step on
 * that key calls `send` once with where the run started and where it ended.
 *
 * At the timer or a flush the run leaves `pending` and `send` runs in the same task,
 * so the store's optimistic write and the end of the run land in one render and the
 * row never draws the stored amount for a frame. A run back to its start sends
 * nothing.
 *
 * Call in an injection context. Every open run is sent when the context is destroyed,
 * because a number the person watched move is written, and when the page is hidden,
 * because an Android app in the background may never run the timer.
 */
export function quantityRuns<K>(
  send: (key: K, run: QuantityRun) => void,
  quietMs: number = QUANTITY_STEP_QUIET_MS
): QuantityRuns<K> {
  const runs = new Map<K, OpenRun>();
  const pending = signal<ReadonlyMap<K, number>>(new Map());

  const publish = () => {
    const next = new Map<K, number>();
    for (const [key, run] of runs) {
      next.set(key, run.to);
    }
    pending.set(next);
  };

  const flush = (key: K) => {
    const run = runs.get(key);
    if (run === undefined) {
      return;
    }
    clearTimeout(run.timer);
    runs.delete(key);
    publish();
    if (run.to !== run.from) {
      send(key, { from: run.from, to: run.to });
    }
  };

  const flushAll = () => {
    for (const key of [...runs.keys()]) {
      flush(key);
    }
  };

  const doc = inject(DOCUMENT, { optional: true });
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') {
      flushAll();
    }
  };
  doc?.addEventListener?.('visibilitychange', onVisibility);

  inject(DestroyRef).onDestroy(() => {
    doc?.removeEventListener?.('visibilitychange', onVisibility);
    flushAll();
  });

  return {
    pending: pending.asReadonly(),
    // Read through the signal, so a template that draws `shown` follows the run.
    shown: (key, stored) => pending().get(key) ?? stored,
    step: (key, step) => {
      const open = runs.get(key);
      if (open !== undefined) {
        clearTimeout(open.timer);
      }
      const run: OpenRun = {
        from: open?.from ?? step.from,
        to: step.to,
        timer: setTimeout(() => flush(key), quietMs),
      };
      runs.set(key, run);
      publish();
    },
    flush,
  };
}
