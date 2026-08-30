/**
 * A pool of workers draining one shared queue (plan 0038, section 6.3).
 *
 * **Non-overlap is structural, not coordinated.** Every worker pulls from one
 * shared queue, and a queue hands each item to exactly one caller. There is no
 * partitioning scheme to get wrong, no range assignment, no modulo of a worker
 * index, and therefore no way for two workers to fetch the same product: a work
 * item is taken once because taking it removes it.
 *
 * **Workers are async tasks in one process, not processes.** One Node process was
 * measured sustaining 202 requests per second at 10% of one core, fifty times the
 * working rate, at 7.6 µs of CPU per response. There is nothing for a second
 * process or a `worker_thread` to relieve. The knob is named `workers` rather
 * than `concurrency` so it keeps the option open without claiming an
 * implementation.
 *
 * If they ever must become processes, the shared queue becomes a table and the
 * claim becomes `SELECT ... FOR UPDATE SKIP LOCKED`: the same "taking it removes
 * it" property enforced by Postgres instead of by the event loop. That is the
 * migration path, and it is deliberately not built now. Building coordination for
 * a contention that does not exist is how a twenty minute job acquires a
 * distributed lock manager.
 */
export interface WorkerPoolOptions<T> {
  items: Iterable<T>;
  workers: number;
  /**
   * Called once per item. **A worker that throws does not fail the run**: the
   * error is handed to `onError` and the worker takes the next item.
   */
  handle: (item: T, index: number) => Promise<void>;
  onError?: (error: unknown, item: T, index: number) => void | Promise<void>;
  /**
   * Checked before each item is taken. Abort stops the pool from starting new
   * work; the in flight requests are cancelled by the `AbortSignal` the clients
   * hold, and every worker then drains together.
   */
  signal?: AbortSignal;
}

export interface WorkerPoolResult {
  processed: number;
  failed: number;
  aborted: boolean;
}

export async function runWorkerPool<T>(
  options: WorkerPoolOptions<T>
): Promise<WorkerPoolResult> {
  const queue = [...options.items];
  const workers = Math.max(1, Math.floor(options.workers));
  let cursor = 0;
  let processed = 0;
  let failed = 0;
  let aborted = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }
      // Taking the item removes it. This single line is the whole non-overlap
      // guarantee: `cursor++` is atomic with respect to other tasks because
      // nothing awaits between reading it and incrementing it.
      const index = cursor++;
      if (index >= queue.length) {
        return;
      }
      const item = queue[index];
      try {
        await options.handle(item, index);
        processed += 1;
      } catch (error) {
        failed += 1;
        await options.onError?.(error, item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));

  return { processed, failed, aborted: aborted || Boolean(options.signal?.aborted) };
}
