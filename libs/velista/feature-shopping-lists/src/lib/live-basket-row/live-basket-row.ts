import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronRightIcon } from '@portfolio/velista/ui';

/**
 * The live basket's row at the top of the history (velista `0111`).
 *
 * Its own component rather than a {@link ShoppingListRow}, because it is not a trip:
 * it has no date, no Shopping now or Finished badge and no bought breakdown, and a
 * view model that faked those fields would be a row claiming things about a basket
 * that has none of them. It wears the history row's stylesheet, so the two are the
 * same row to the eye.
 *
 * What it says is the pending count, the one number the live basket carries. Null is
 * a summary that has not arrived or would not load, and the row is then its title
 * alone, still tappable: the basket page is where a failure gets words.
 */
@Component({
  selector: 'lib-live-basket-row',
  imports: [RokuTranslatorPipe, ChevronRightIcon],
  templateUrl: './live-basket-row.html',
  styleUrl: '../shopping-list-row/shopping-list-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveBasketRow {
  /** How many lines are still to get, or null when the summary is not in hand. */
  readonly pending = input<number | null>(null);

  readonly open = output<void>();
}
