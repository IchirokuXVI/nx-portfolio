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
 * ## It is the top half of the dock, not a card on the page
 *
 * It spent its whole life at the top of the dashboard's scrolling content, above the
 * groups, while **Get shopping list** sat pinned at the other end of the screen. Two
 * things about that were wrong at once. The smaller one is that a couple of groups
 * scroll it out of sight, so the one control whose entire purpose is a fast way back
 * into a trip was the first thing to leave the screen. The larger one is that the
 * dashboard's two answers to "I want my shopping list" were as far apart as a phone
 * allows, and nothing said they were about the same thing.
 *
 * So it moved down and joined the bar: same ground, no gap, no card of its own, with
 * `BottomActionBar`'s existing top rule doing the work of the divider between the strip
 * and the buttons. Getting back into the basket you have and composing a new one are
 * now one object on the screen, read top to bottom, and the strip's progress hairline
 * runs the full width of it to say so.
 *
 * **What the move cost is a row of chrome, and that was the right thing to spend.** The
 * section header, which carried the label and a History link, is gone: a docked element
 * takes its height off the dashboard permanently rather than off a scroll, so a heading
 * that repeats what the strip plainly is could not earn its place. History survives on
 * the "and N more" link when there is more than one live basket, and otherwise through
 * the sheet the button below opens, which carries that link for precisely this case and
 * says so in its own template.
 *
 * It replaces `ResumeListCard`, and the replacement is the whole argument rather than a
 * change of layout. "Pick up where you left off" answered "what was I doing" from a
 * list id this **device** happened to remember, so it had to be talked out of showing a
 * list the person had been removed from, one written by an older build, or one they
 * merely glanced at. This card cannot show a stale thing at all: an `ACTIVE` generated
 * list either exists for this account or does not, and the server is the one saying so.
 *
 * ## Who else is shopping it, and what it cost to say so
 *
 * The mock shows a presence row and plan 0045 refused it, naming the price: the
 * listing carried no participants, so drawing it meant a request per card on every
 * dashboard load to render something usually absent, which is the cost plan 0022
 * refused for zone presence on the same argument. Velista `0049` section 4 held it
 * back for the same reason and said what would change it — the field arriving on a
 * summary the card already reads, rather than a request of its own.
 *
 * Backend `0053` put `presentCount` there, so the row is drawn now and it did indeed
 * cost one field and one line of template. It is a **count and never names**: the
 * summary carries a number, and `0044`'s participant surface answers a different
 * question anyway, which is who may open this basket rather than who has it open.
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
