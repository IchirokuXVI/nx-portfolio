import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  TRIPS_REFETCH_QUIET_MS,
  type DueLine,
} from '@portfolio/velista/models';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { DUE_LINE_SERVICE, type DueLineServiceI } from './due-line-service';

/**
 * The due lines of the zone list on screen (velista `0089`, section 3).
 *
 * ## Never in front of the lines, and silent when it fails
 *
 * The page opens this once its lines have arrived. A failed read draws no section and
 * says nothing: the list works without suggestions, and a sentence about a feature
 * somebody did not ask for is noise on the one screen used in an aisle. So a failure
 * keeps whatever was held, which on a first read is nothing.
 *
 * ## The trips' signal, coalesced the same way
 *
 * `list.tripsChanged`, `line.settled` for a line of this list and `line.claimChanged`
 * naming one are what change the answer: a settle moves a period, and the end of a
 * basket frees the lines it held. A burst is one read after
 * {@link TRIPS_REFETCH_QUIET_MS} of quiet, the same window `TripStore` waits, so both
 * reads go out together.
 *
 * A line raised above zero needs no read at all: the page stops drawing a due line
 * whose line is above zero, which is what makes an add feel instant.
 *
 * ## An answer a newer read overtook is dropped
 *
 * Every read takes a generation, so a slow read that started before a settle cannot put
 * back a suggestion the settle took away.
 */
@Injectable()
export class DueLineStore {
  private readonly _service = inject<DueLineServiceI>(DUE_LINE_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _listId = signal<string | null>(null);
  private readonly _lines = signal<readonly DueLine[]>([]);

  /** The list whose due lines are held, or null. */
  readonly listId = this._listId.asReadonly();

  /** Every due line of the open list, most due first. Empty until the first answer. */
  readonly lines = this._lines.asReadonly();

  private _generation = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );
    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      this.leave();
    });
  }

  /** The page opened a list, after its lines. Reads its due lines. */
  open(listId: string): void {
    if (this._listId() === listId) {
      return;
    }

    this.leave();
    this._listId.set(listId);
    void this._read();
  }

  /** Give the list back. Every read still out is dropped when it answers. */
  leave(): void {
    this._clearTimer();
    this._generation += 1;
    this._listId.set(null);
    this._lines.set([]);
  }

  /** Read again after a short quiet. A burst of calls is one read. */
  refetch(): void {
    if (this._listId() === null) {
      return;
    }

    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._read();
    }, TRIPS_REFETCH_QUIET_MS);
  }

  private async _read(): Promise<void> {
    const listId = this._listId();
    if (listId === null) {
      return;
    }

    const generation = (this._generation += 1);
    try {
      const lines = await this._service.listDueLines(listId);
      if (generation === this._generation) {
        this._lines.set(lines);
      }
    } catch {
      // Quiet on purpose: see the class note. What is held stays.
    }
  }

  private _apply(event: RealtimeEvent): void {
    const listId = this._listId();
    if (listId === null) {
      return;
    }

    switch (event.type) {
      case 'list.tripsChanged':
        if (event.listId === listId) {
          this.refetch();
        }
        return;
      case 'line.settled':
        if (event.line.listId === listId) {
          this.refetch();
        }
        return;
      case 'line.claimChanged':
        if (event.lines.some((ref) => ref.listId === listId)) {
          this.refetch();
        }
        return;
      default:
        return;
    }
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
