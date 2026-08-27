import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
import { LineRow, type LineRowAction } from './line-row';

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
    <p aria-atomic="true" aria-live="polite" class="live">{{ announcement() }}</p>

    @if (reordering()) {
      <p class="reorder-note">{{ 'list.reorder.body' | rokuT }}</p>
    }

    <ul class="lines">
      @for (line of lines(); track line.id; let first = $first, last = $last) {
        <li class="line">
          <lib-line-row
            (act)="act.emit($event)"
            (dismiss)="dismiss.emit($event)"
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
})
export class LineList {
  readonly lines = input.required<readonly LineRowVm[]>();

  readonly reordering = input(false);

  /** What the live region currently says. Empty announces nothing. */
  readonly announcement = input('');

  readonly ticked = output<string>();
  readonly act = output<{ action: LineRowAction; lineId: string }>();
  readonly retry = output<string>();
  readonly dismiss = output<string>();
}
