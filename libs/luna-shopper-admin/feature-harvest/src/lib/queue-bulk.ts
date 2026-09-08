import type {
  QueueBulkResult,
  QueueStore,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import type { QueueReport } from '@portfolio/luna-shopper-admin/ui';

/**
 * One bulk action, as a screen states it (plan 0020, sections 4 and 6).
 *
 * `applies` is the part worth naming. A bulk action is offered only where the
 * row already carries everything the call needs, and a selection is allowed to
 * hold rows that do not: an entry with no proposal cannot be accepted as
 * proposed. Those rows are never attempted rather than attempted and refused,
 * because "I did not try" and "I tried and it was refused" are different
 * sentences and an operator has to be able to tell them apart.
 */
export interface QueueBulkAct<T> {
  /** What to do to one row. `null` for a row that leaves the queue. */
  readonly act: (item: T) => Promise<T | null>;
  /** Which rows the act can be applied to at all. Every row, by default. */
  readonly applies?: (item: T) => boolean;
  /** What a row is called, for the report. Never an id, where there is a name. */
  readonly nameOf: (item: T) => string;
}

/**
 * Run one act over the selection and say what happened, by name.
 *
 * The names are taken **before** the run, because a row that succeeds leaves the
 * queue and a report built afterwards would have nothing left to read a name
 * off. Everything else about the run belongs to `QueueStore.decideMany`, which
 * is where the four at a time, the stop and the partial failure rule live.
 */
export async function runQueueBulk<T>(
  queue: QueueStore<T>,
  bulk: QueueBulkAct<T>
): Promise<QueueReport> {
  const selected = queue.selected();
  const names = new Map<string, string>();
  for (const item of queue.items()) {
    const id = queue.idOf(item);
    if (selected.has(id)) {
      names.set(id, bulk.nameOf(item));
    }
  }

  const result = await queue.decideMany(bulk.act, bulk.applies);
  return queueReport(result, names);
}

/** What a bulk run did, with each row named rather than counted. */
export function queueReport(
  result: QueueBulkResult,
  names: ReadonlyMap<string, string>
): QueueReport {
  const name = (id: string): string => names.get(id) ?? id;

  return {
    done: result.succeeded.length + result.failed.length,
    total: result.total,
    succeeded: result.succeeded.length,
    stopped: result.stopped,
    failed: result.failed.map((failure) => ({
      name: name(failure.id),
      reasonKey: gatewayErrorKey(failure.error) ?? 'resource.error.unknown',
    })),
    skipped: result.skipped.map((id) => ({ name: name(id), reasonKey: '' })),
  };
}

/**
 * A bulk action the operator asked for and has not confirmed yet.
 *
 * Every bulk action confirms first, naming the action and the exact count it
 * will act on, so the count reaches the dialog rather than only the report. A
 * count that appears after the run is a count that arrives too late to change
 * the decision.
 */
export interface PendingBulk {
  readonly headingKey: string;
  readonly bodyKey: string;
  readonly confirmKey: string;
  /** What the progress line says while it runs. Names the act, not the time. */
  readonly progressKey: string;
  /** How many rows it will act on, which is the selection minus what it skips. */
  readonly count: number;
  /** How many it will leave alone, so the sentence can say so before it runs. */
  readonly leftAlone: number;
  readonly tone: 'danger' | 'primary';
  readonly run: () => Promise<void>;
}
