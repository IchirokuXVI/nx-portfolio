import { Injectable, signal } from '@angular/core';

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

@Injectable({ providedIn: 'root' })
export class Mutations {
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
   */
  async run<T>(
    overlay: Overlay<unknown> | null,
    send: () => Promise<T>,
    versionOf?: (value: T) => number,
    expectedVersion?: number
  ): Promise<MutationOutcome<T>> {
    if (overlay !== null) {
      this._addOverlay(overlay);
    }
    this._inFlight.update((n) => n + 1);

    try {
      const value = await send();

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
