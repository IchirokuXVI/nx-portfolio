import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  basketMatchRange,
  type LineRowVm,
  type QuantityStep,
} from '@portfolio/velista/models';
import { LineRow, type LineRowAction } from './line-row';

/**
 * The lines, in order.
 *
 * ## No live region here
 *
 * The page that draws these lists owns the one polite region they are spoken about
 * through (velista `0192`). A region per row would mean twelve competing regions on a
 * loaded list, and a region per list was removed together with its list in the render
 * that emptied it, so the sentence about the last row was never heard.
 *
 * ## Rows are tracked by id
 *
 * Including the client key an optimistic add carries until its response returns, which
 * is the whole reason that key exists. Tracking by index would rebuild every row below
 * an insert, losing the composer's focus mid run, and tracking by object identity would
 * rebuild a row on every reconciliation.
 */
@Component({
  selector: 'lib-line-list',
  imports: [LineRow],
  template: `
    <ul class="lines">
      @for (line of lines(); track line.id) {
        <li
          [attr.data-line-id]="line.id"
          [class.marked]="markedId() === line.id"
          class="line"
        >
          <lib-line-row
            (act)="act.emit($event)"
            (chooseProduct)="chooseProduct.emit($event)"
            (dismiss)="dismiss.emit($event)"
            (opened)="opened.emit($event)"
            (quantityStepped)="quantityStepped.emit($event)"
            (retry)="retry.emit($event)"
            [line]="line"
            [match]="matchOf(line)"
            [pending]="pending().get(line.id) ?? null"
            [took]="tookIds().has(line.id)"
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

  /**
   * The line a link asked for, marked while somebody finds it (plan 0032, section 8).
   *
   * Presentation only, and briefly: it says "this is the one", not "this one is
   * different". The container decides which and for how long, because it is the thing
   * that read the URL; `data-line-id` on the row is how it then finds the element to
   * scroll to, which is a fact about the DOM that only this template can state.
   */
  readonly markedId = input<string | null>(null);

  /**
   * The lines an add just raised or met, whose quantity takes an amber edge while
   * they are set (velista `0170`, target 4; velista `0185`, decision E). The
   * container clears them, as it clears the mark.
   */
  readonly tookIds = input<ReadonlySet<string>>(new Set());

  /**
   * The amount of each line with an open run of presses (velista `0188`, decision H):
   * the page's `quantityRuns.pending()`. A row not in it draws its stored amount.
   */
  readonly pending = input<ReadonlyMap<string, number>>(new Map());

  /**
   * The search, folded, or the empty string (velista `0082`, section 6).
   *
   * Each row gets the range of its first match in its own name, worked out here with
   * the basket's `basketMatchRange` so both screens paint the same fragment.
   */
  readonly highlight = input('');

  protected matchOf(line: LineRowVm): { start: number; end: number } | null {
    return basketMatchRange(line.content, this.highlight());
  }

  /** A row was tapped, which opens its detail sheet. */
  readonly opened = output<string>();

  /**
   * Every step of a row's stepper (velista `0188`).
   *
   * Passed straight up. This component owns the **order** of the rows and nothing
   * about what is on one.
   */
  readonly quantityStepped = output<{ lineId: string; step: QuantityStep }>();
  readonly act = output<{ action: LineRowAction; lineId: string }>();
  readonly retry = output<string>();
  readonly dismiss = output<string>();

  /** A row with no product asked to choose one (velista `0145`, section 5). */
  readonly chooseProduct = output<string>();
}
