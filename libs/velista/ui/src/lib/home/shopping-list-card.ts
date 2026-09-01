import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ShoppingListCardVm } from '@portfolio/velista/models';
import { ChevronRightIcon } from '../icons/icons';

/**
 * The basket being shopped right now, and the fastest path back into it (plan 0045,
 * section 3.2).
 *
 * It replaces `ResumeListCard`, and the replacement is the whole argument rather than a
 * change of layout. "Pick up where you left off" answered "what was I doing" from a
 * list id this **device** happened to remember, so it had to be talked out of showing a
 * list the person had been removed from, one written by an older build, or one they
 * merely glanced at. This card cannot show a stale thing at all: an `ACTIVE` generated
 * list either exists for this account or does not, and the server is the one saying so.
 *
 * ## What it deliberately does not draw
 *
 * **Who else is shopping it.** The mock shows a presence row, and the data for it is
 * not in this screen's read: `generatedList.listMine` answers summaries, which carry a
 * name, a date and two counts and no participants. Drawing it would mean a request per
 * card on every dashboard load to render a row that is usually absent, which is the
 * cost plan 0022 refused for zone presence for the same reason. Section 3.2's state
 * table does not ask for it either. When `0044`'s participant surface lands it is one
 * field on the view model and one row here.
 *
 * The card takes a **resolved** name. An unnamed basket displays as its localized
 * generation date with a same-day number appended, and that cannot be computed from one
 * basket in isolation, so `displayNames` does it over the whole set and the container
 * hands the answer down. See that function for why.
 */
@Component({
  selector: 'lib-shopping-list-card',
  imports: [RokuTranslatorPipe, ChevronRightIcon],
  templateUrl: './shopping-list-card.html',
  styleUrl: './shopping-list-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListCard {
  readonly list = input.required<ShoppingListCardVm>();

  /** Whether the basket was generated today, which changes the date to a word. */
  readonly generatedToday = input(false);

  /** The generation date, already formatted in the reader's locale by the container. */
  readonly generatedOn = input('');

  /** Open this basket. The container owns where that goes. */
  readonly open = output<string>();

  /** Go to the history. A **separate** output, because it is a separate destination. */
  readonly openHistory = output<void>();

  /**
   * How far through the trip somebody is, as a percentage.
   *
   * Null when there is nothing to be a fraction of, which is a basket composed with no
   * lines. Every other count is real: unlike the resume card's, these two are not
   * optional, because the listing that feeds this card always carries them.
   */
  readonly progress = computed<number | null>(() => {
    const { lineCount, settledLineCount } = this.list();
    return lineCount === 0
      ? null
      : Math.round((settledLineCount / lineCount) * 100);
  });

  /**
   * What a screen reader says instead of reading the card's parts in order.
   *
   * Section 7 asks for the name plus the outstanding count, and outstanding is the
   * subtraction rather than the settled number: somebody deciding whether to open this
   * wants to know what is **left**, and "4 of 12 got" makes them do the arithmetic.
   */
  readonly outstanding = computed(
    () => this.list().lineCount - this.list().settledLineCount
  );
}
