import { inject, Injectable, signal } from '@angular/core';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { TimeoutError } from 'rxjs';
import { NetworkError } from './errors';

/**
 * The single place every write in the app passes through (rule D2).
 *
 * Plan 0001 D6 promises an offline queue can be added later without touching a
 * component, and that is only true if there is exactly one function all writes go
 * through. The queue itself is out of scope for this phase; the choke point is not,
 * because retrofitting one across every call site later is the expensive version of
 * this decision.
 *
 * It also owns the optimistic overlay lifecycle from plan 0004 section 7.2, which is
 * the only place in the app where two writers are reconciled.
 */

/** A pending local change, held until its request resolves. */
export interface Overlay<T> {
  readonly key: string;
  readonly apply: (current: T) => T;
  /** The fields this overlay claims, so a realtime event knows what not to touch. */
  readonly fields: readonly string[];
}

/** What happened to a mutation, for the caller's visible failure path. */
export type MutationOutcome<T> =
  | { readonly state: 'succeeded'; readonly value: T }
  | { readonly state: 'failed'; readonly error: unknown }
  | {
      /**
       * The write landed, but a concurrent one had already changed the record.
       * `0001` D6 requires the UI show when a change was overwritten by someone else.
       */
      readonly state: 'overwritten';
      readonly value: T;
    };

/**
 * How to send a dropped write again (velista `0159`). Kept only when the first attempt
 * is known not to have left the device, because the write routes take no idempotency
 * key and a second delta on top of one that landed is a double increment.
 */
export interface DroppedWriteReplay {
  readonly kind: 'line-quantity';
  readonly lineId: string;
  readonly delta: number;
}

/**
 * What a caller tells {@link Mutations.run} to write down if the network drops the
 * write (velista `0159`).
 */
export interface DroppedWriteDraft {
  /** The page that draws the notice, from {@link listWritesPage}. */
  readonly page: string;
  /** The record and field, so a later write of the same change that lands clears it. */
  readonly subject: string;
  /**
   * The line the write was made on, so the page can draw its name whether or not a
   * replay was kept.
   */
  readonly lineId: string;
  /** A translation key that names the change in the person's words. */
  readonly key: string;
  readonly args: Readonly<Record<string, string>>;
  /** The replay, which `run` keeps only when the attempt never left. */
  readonly replay: DroppedWriteReplay | null;
}

/** One entry of the ledger, as the page reads it. */
export interface DroppedWrite extends DroppedWriteDraft {
  readonly id: string;
}

/** How many entries the ledger keeps. The oldest goes first. */
export const DROPPED_WRITES_KEPT = 5;

/** The page key of a list page, which is where a quantity write is made. */
export function listWritesPage(listId: string): string {
  return `list:${listId}`;
}

/**
 * The writes this tab lost to the network, in `sessionStorage` (velista `0159`).
 *
 * The reconnect reloads the page, and the inline note of a row that did not save goes
 * with that document. This is what survives it. It is not an outbox (plan `0001` D6):
 * nothing here sends anything, and the page reads its entries once and clears them.
 *
 * Every storage call is caught. A private window may refuse storage, and losing the
 * ledger costs a notice, never the write it sits beside.
 */
@Injectable({ providedIn: 'root' })
export class DroppedWrites {
  private readonly _browser = inject(BrowserFacade);
  private _next = 0;

  /** Write one entry, keeping the last {@link DROPPED_WRITES_KEPT}. */
  record(draft: DroppedWriteDraft): void {
    const entry: DroppedWrite = {
      ...draft,
      id: `${Date.now().toString(36)}-${(this._next++).toString(36)}`,
    };
    this._write([...this._read(), entry].slice(-DROPPED_WRITES_KEPT));
  }

  /** Every entry for a page, removed from the ledger as it is returned. */
  take(page: string): readonly DroppedWrite[] {
    const all = this._read();
    const mine = all.filter((entry) => entry.page === page);
    if (mine.length > 0) {
      this._write(all.filter((entry) => entry.page !== page));
    }
    return mine;
  }

  /** Forget a change that has since landed. */
  settle(subject: string): void {
    const all = this._read();
    const rest = all.filter((entry) => entry.subject !== subject);
    if (rest.length !== all.length) {
      this._write(rest);
    }
  }

  private _read(): DroppedWrite[] {
    try {
      const raw = this._browser.readSessionStorage(StorageKeys.droppedWrites);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isDroppedWrite) : [];
    } catch {
      return [];
    }
  }

  private _write(entries: readonly DroppedWrite[]): void {
    try {
      if (entries.length === 0) {
        this._browser.removeSessionStorage(StorageKeys.droppedWrites);
      } else {
        this._browser.writeSessionStorage(
          StorageKeys.droppedWrites,
          JSON.stringify(entries)
        );
      }
    } catch {
      // See the class comment: the notice is lost, nothing else.
    }
  }
}

/** Read from `unknown`, because another build of this app may have written the ledger. */
function isDroppedWrite(value: unknown): value is DroppedWrite {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  const args = entry['args'];
  const replay = entry['replay'];
  return (
    typeof entry['id'] === 'string' &&
    typeof entry['page'] === 'string' &&
    typeof entry['subject'] === 'string' &&
    typeof entry['lineId'] === 'string' &&
    typeof entry['key'] === 'string' &&
    typeof args === 'object' &&
    args !== null &&
    Object.values(args).every((arg) => typeof arg === 'string') &&
    (replay === null || isReplay(replay))
  );
}

function isReplay(value: unknown): value is DroppedWriteReplay {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const replay = value as Record<string, unknown>;
  const delta = replay['delta'];
  return (
    replay['kind'] === 'line-quantity' &&
    typeof replay['lineId'] === 'string' &&
    typeof delta === 'number' &&
    Number.isInteger(delta) &&
    delta !== 0
  );
}

/**
 * Whether a failure carried no answer at all, which is the one kind a reconnect reload
 * hides. A 4xx or a 5xx proves the network works, so no reload follows and the inline
 * note on the row stays to say so.
 */
function droppedByNetwork(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof TimeoutError;
}

@Injectable({ providedIn: 'root' })
export class Mutations {
  private readonly _dropped = inject(DroppedWrites);

  /** Overlays in flight, keyed by `${recordId}:${field}`. Reads see these applied. */
  private readonly _overlays = signal<ReadonlyMap<string, Overlay<unknown>>>(
    new Map()
  );

  readonly overlays = this._overlays.asReadonly();

  /** How many writes are in flight. Drives a quiet saving indicator, never a blocker. */
  private readonly _inFlight = signal(0);
  readonly inFlight = this._inFlight.asReadonly();

  /**
   * Run a write with an optimistic overlay, and reconcile the result.
   *
   * The three outcomes are section 7.2's, and the ordering matters: the overlay is
   * dropped **before** the outcome is reported, so a caller that re-reads the store in
   * its handler sees the reconciled record rather than its own guess.
   *
   * @param overlay what the UI should show while the request is in flight
   * @param send the request itself
   * @param versionOf reads the concurrency version off the result, when the record has
   *   one. Only lines do (plan 0004, section 7.2), so this is optional and a record
   *   without one can never report `overwritten`.
   * @param dropped what to write down if the network drops this write (velista
   *   `0159`). Its replay is kept only when the failure is a {@link NetworkError}
   *   whose `refusedOffline` is true: the interceptor saw the browser offline at the
   *   moment it handed the request on, so the request was refused before it left and
   *   the server cannot have applied it. `onLine` is not read here, because the
   *   request can leave later than `run` starts (a token refresh comes first). Any
   *   other failure, a timeout included, may have lost only the answer, so the entry
   *   then keeps no replay.
   */
  async run<T>(
    overlay: Overlay<unknown> | null,
    send: () => Promise<T>,
    versionOf?: (value: T) => number,
    expectedVersion?: number,
    dropped?: DroppedWriteDraft
  ): Promise<MutationOutcome<T>> {
    if (overlay !== null) {
      this._addOverlay(overlay);
    }
    this._inFlight.update((n) => n + 1);

    try {
      const value = await send();
      if (dropped !== undefined) {
        this._dropped.settle(dropped.subject);
      }

      if (
        versionOf !== undefined &&
        expectedVersion !== undefined &&
        versionOf(value) > expectedVersion + 1
      ) {
        // The server moved further than this write alone would have, so somebody
        // else's change landed in between and this one wrote over it.
        return { state: 'overwritten', value };
      }

      return { state: 'succeeded', value };
    } catch (error) {
      // The record snaps back. Never silently: plan 0003 requires a visible failure
      // path on every mutation, and the component that failed is often not the
      // component that should show it, which is why the outcome is returned rather
      // than swallowed here.
      if (dropped !== undefined && droppedByNetwork(error)) {
        const replay =
          error instanceof NetworkError && error.refusedOffline
            ? dropped.replay
            : null;
        this._dropped.record({ ...dropped, replay });
      }
      return { state: 'failed', error };
    } finally {
      if (overlay !== null) {
        this._removeOverlay(overlay.key);
      }
      this._inFlight.update((n) => Math.max(0, n - 1));
    }
  }

  /**
   * Whether a field currently has a pending local change.
   *
   * A realtime event wins for every field an overlay does **not** touch, and loses for
   * the ones it does, until the overlay's own request resolves. Without this the
   * user's half-typed change is overwritten by an echo of the state they are editing.
   */
  claims(key: string): boolean {
    return this._overlays().has(key);
  }

  /** Applies every pending overlay for a record, in insertion order. */
  applyOverlays<T>(recordId: string, value: T): T {
    let result = value;
    for (const [key, overlay] of this._overlays()) {
      if (key.startsWith(`${recordId}:`)) {
        result = (overlay as Overlay<T>).apply(result);
      }
    }
    return result;
  }

  private _addOverlay(overlay: Overlay<unknown>): void {
    this._overlays.update((current) => {
      const next = new Map(current);
      next.set(overlay.key, overlay);
      return next;
    });
  }

  private _removeOverlay(key: string): void {
    this._overlays.update((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }
}

/** Builds the key an overlay is stored under. One per record and field. */
export function overlayKey(recordId: string, field: string): string {
  return `${recordId}:${field}`;
}
