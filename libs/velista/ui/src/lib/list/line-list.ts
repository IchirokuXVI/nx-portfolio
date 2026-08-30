import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
import { LineRow, type LineRowAction } from './line-row';

/** Where a row is, at the moment a drag starts. Read once; the drag never remeasures. */
interface RowBand {
  readonly top: number;
  readonly height: number;
}

/**
 * The lines, in order, and the one live region they all announce through.
 *
 * ## Why the live region is here and not on the row
 *
 * There is exactly one of it. A live region per row would mean twelve regions on a
 * loaded list, and a screen reader given twelve competing polite regions announces them
 * in an order nobody chose. One region, owned by the thing that owns the collection, is
 * the only arrangement that produces a single sentence per event (section 7).
 *
 * ## Rows are tracked by id
 *
 * Including the client key an optimistic add carries until its response returns, which
 * is the whole reason that key exists. Tracking by index would rebuild every row below
 * an insert, losing the composer's focus mid run, and tracking by object identity would
 * rebuild a row on every reconciliation.
 *
 * ## Reorder mode is a property of the list, not of a row
 *
 * It is passed down rather than discovered, because ticking off is off for **all** rows
 * while it lasts. A row deciding for itself would let two rows disagree about what a
 * tap means, which on this screen is destructive of somebody's attention in an aisle.
 *
 * ## The drag lives here, and it has to
 *
 * The grip drew a handle and answered only its two arrows, so the manual order was
 * reachable by tapping up or down a dozen times and by no other means: the gesture the
 * grip advertises went to the browser, which read it as a scroll. `LineRow` now hands
 * the pointer up rather than running the drag, because a drag is a question about where
 * one row sits among the others and a row knows nothing about the others. This
 * component owns the order, so it owns the geometry.
 *
 * The rows are measured once, when the finger goes down, and never again while it is
 * moving: every row's position during a drag is a transform, so remeasuring would read
 * back the offsets the drag itself applied and the list would chase its own tail.
 */
@Component({
  selector: 'lib-line-list',
  imports: [RokuTranslatorPipe, LineRow],
  template: `
    <!--
      One polite region for the whole list. Failed and overwritten notices, and each
      step of a keyboard reorder, are announced here once and are not repeated on a
      re-render: the container sets the message and clears it.
    -->
    <p aria-atomic="true" aria-live="polite" class="live">
      {{ announcement() }}
    </p>

    @if (reordering()) {
      <p class="reorder-note">{{ 'list.reorder.body' | rokuT }}</p>
    }

    <ul class="lines">
      @for (line of lines(); track line.id; let first = $first, last = $last) {
        <li
          [attr.data-line-id]="line.id"
          [class.lifted]="draggingId() === line.id"
          [class.marked]="markedId() === line.id"
          [class.shifting]="draggingId() !== null && draggingId() !== line.id"
          [style.transform]="transformOf($index)"
          class="line"
        >
          <lib-line-row
            (act)="act.emit($event)"
            (dismiss)="dismiss.emit($event)"
            (grab)="startDrag($event)"
            (retry)="retry.emit($event)"
            (ticked)="ticked.emit($event)"
            [canMoveDown]="!last"
            [canMoveUp]="!first"
            [line]="line"
            [reordering]="reordering()"
          />
        </li>
      }
    </ul>
  `,
  styleUrl: './line-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // On the host rather than on the grip, because the finger leaves the grip on the
    // first millimetre of the gesture. The grip captures the pointer, so these still
    // arrive here by bubbling even once it is halfway down the list.
    '(pointermove)': 'onDrag($event)',
    '(pointerup)': 'endDrag()',
    '(pointercancel)': 'cancelDrag()',
  },
})
export class LineList {
  readonly lines = input.required<readonly LineRowVm[]>();

  readonly reordering = input(false);

  /** What the live region currently says. Empty announces nothing. */
  readonly announcement = input('');

  /**
   * The line a link asked for, marked while somebody finds it (plan 0032, section 8).
   *
   * Presentation only, and briefly: it says "this is the one", not "this one is
   * different". The container decides which and for how long, because it is the thing
   * that read the URL; `data-line-id` on the row is how it then finds the element to
   * scroll to, which is a fact about the DOM that only this template can state.
   */
  readonly markedId = input<string | null>(null);

  readonly ticked = output<string>();
  readonly act = output<{ action: LineRowAction; lineId: string }>();
  readonly retry = output<string>();
  readonly dismiss = output<string>();

  /**
   * A row was dragged to a new index, once, when the finger came off.
   *
   * The whole move and not each row it passed. `line.reorder` takes the finished order,
   * so a drag across four rows is one request rather than four, and the intermediate
   * orders it passed through were never anything anybody asked for.
   */
  readonly reorderTo = output<{ lineId: string; to: number }>();

  /** The row under the finger, or null when nothing is being dragged. */
  readonly draggingId = signal<string | null>(null);

  /** How far that row has been pulled from where it started, in pixels. */
  private readonly _offset = signal(0);

  /** Where it started, and where it would land if the finger came off now. */
  private readonly _from = signal(0);
  private readonly _to = signal(0);

  /** Every row's position when the finger went down. Never remeasured mid drag. */
  private _bands: RowBand[] = [];

  /** The dragged row's height plus the gap under it: what a displaced row moves by. */
  private _step = 0;

  /** Where the pointer was when it went down. */
  private _pointerFrom = 0;

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The dragged row's centre, in the coordinates the bands were measured in. */
  private readonly _centre = computed(() => {
    const band = this._bands[this._from()];

    return band === undefined ? 0 : band.top + band.height / 2 + this._offset();
  });

  /**
   * Where row `index` is drawn right now.
   *
   * The dragged row follows the finger. Every row between where it came from and where
   * it would land moves one step the other way, which is what makes the gap open ahead
   * of it and close behind it. Everything else is where it was, and returns null so the
   * declaration is absent rather than an identity transform on every row of a long list.
   */
  transformOf(index: number): string | null {
    if (this.draggingId() === null) {
      return null;
    }

    if (index === this._from()) {
      return `translateY(${this._offset()}px)`;
    }

    const from = this._from();
    const to = this._to();

    if (from < to && index > from && index <= to) {
      return `translateY(${-this._step}px)`;
    }

    if (from > to && index >= to && index < from) {
      return `translateY(${this._step}px)`;
    }

    return null;
  }

  /**
   * A pointer went down on a row's grip.
   *
   * The pointer is captured on the grip itself, so the rest of the gesture keeps
   * arriving even though the finger is over a different row within a few pixels. The
   * measurement happens here and only here: see the note on the class.
   */
  startDrag({ event, lineId }: { event: PointerEvent; lineId: string }): void {
    const from = this.lines().findIndex((line) => line.id === lineId);
    if (from < 0) {
      return;
    }

    const rows = Array.from(
      this._host.nativeElement.querySelectorAll<HTMLElement>('.line')
    );
    this._bands = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });

    const target = event.target;
    if (target instanceof Element) {
      target.setPointerCapture(event.pointerId);
    }

    // The distance between two rows' tops, which is a row plus the list's gap. Taken
    // from the rows rather than from the gap token, so the two cannot disagree.
    const next = this._bands[from + 1];
    const previous = this._bands[from - 1];
    const band = this._bands[from];
    this._step =
      next !== undefined
        ? next.top - band.top
        : previous !== undefined
          ? band.top - previous.top
          : band.height;

    this._pointerFrom = event.clientY;
    this._from.set(from);
    this._to.set(from);
    this._offset.set(0);
    this.draggingId.set(lineId);
  }

  /**
   * The row follows the finger, and the index it would land on is recomputed.
   *
   * The landing index is decided by comparing the dragged row's centre against the
   * **original** midpoints of its neighbours, walking outward from where it started.
   * Comparing against their current positions would be circular: they are where they
   * are because of this calculation.
   */
  onDrag(event: PointerEvent): void {
    if (this.draggingId() === null) {
      return;
    }

    this._offset.set(event.clientY - this._pointerFrom);

    const from = this._from();
    const centre = this._centre();
    let to = from;

    while (to < this._bands.length - 1 && centre > this._midpoint(to + 1)) {
      to += 1;
    }
    while (to > 0 && centre < this._midpoint(to - 1)) {
      to -= 1;
    }

    this._to.set(to);
  }

  /**
   * The finger comes off, and the move is asked for once.
   *
   * Nothing is emitted when the row landed where it started, which is the common ending
   * of an accidental drag and of a deliberate one somebody changed their mind about.
   * The transforms are dropped in the same breath: the container answers by reordering
   * the lines, and a row that kept its offset would be drawn a row away from where its
   * new index puts it until the response landed.
   */
  endDrag(): void {
    const lineId = this.draggingId();
    if (lineId === null) {
      return;
    }

    const from = this._from();
    const to = this._to();
    this._reset();

    if (to !== from) {
      this.reorderTo.emit({ lineId, to });
    }
  }

  /** The browser took the pointer over. A drag that did not happen moves nothing. */
  cancelDrag(): void {
    this._reset();
  }

  private _midpoint(index: number): number {
    const band = this._bands[index];

    return band === undefined ? 0 : band.top + band.height / 2;
  }

  private _reset(): void {
    this.draggingId.set(null);
    this._offset.set(0);
    this._bands = [];
  }
}
