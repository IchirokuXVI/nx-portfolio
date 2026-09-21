import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LiveBasketCardVm } from '@portfolio/velista/models';
import { ChevronRightIcon } from '../icons/icons';

/**
 * The way into the basket that is always there (velista `0091`, section 5.1).
 *
 * ## It is drawn for everybody, always
 *
 * `ShoppingListCard` beside it is absent when there is no basket being shopped,
 * which is right for a trip somebody composed: a slot where one would go says
 * nothing. This one is the **door**, and a door that disappears when the room
 * behind it is empty is a bug report. So it is drawn at "Nothing to buy" too,
 * and while its numbers are still loading it holds a skeleton of its own height
 * rather than appearing under the reader's thumb a moment later.
 *
 * A guest gets it like anybody else. Every account has one of these baskets, and
 * a guest account is an account (velista product rules: a guest is never shown a
 * register prompt in place of a feature).
 *
 * ## Two lines and nothing else
 *
 * No date, because it has none. No presence, because the server keeps no
 * presence room for this basket (backend `0130`, section 7). No progress
 * hairline, because there is no trip to be a fraction of: the bar above the
 * strip beside it measures a thing that ends.
 *
 * It sits **first** in the dock, above that strip, and draws the same ground,
 * the same top rule and the same tap target, so the two read as one surface with
 * a divider between them rather than as two cards that happen to touch.
 */
@Component({
  selector: 'lib-live-basket-card',
  imports: [RokuTranslatorPipe, ChevronRightIcon],
  templateUrl: './live-basket-card.html',
  styleUrl: './live-basket-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveBasketCard {
  /**
   * The numbers, or null while they are still being read.
   *
   * Null is **not** "there is no basket": there is always one, and the card is
   * tappable either way. It is the sentence that waits, and a failed read leaves
   * it null for good, which draws the title alone rather than a number that
   * would be a guess.
   */
  readonly summary = input<LiveBasketCardVm | null>(null);

  /** Whether the first read is still out, which is the skeleton's whole cue. */
  readonly loading = input(false);

  /** Open the basket. The container owns where that goes. */
  readonly open = output<void>();
}
