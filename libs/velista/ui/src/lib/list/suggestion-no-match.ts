import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * What the composer's panel says when a finished search found nothing (velista
 * `0108`, target 1): one row naming the words, and a second line when they can
 * still be added as written.
 *
 * ## Why it is its own component
 *
 * Only for its stylesheet. `suggestion-list.scss` sits at the `anyComponentStyle`
 * budget, and a partial `@use`d there would still be compiled into that one sheet,
 * so the row's few rules live here instead of raising the budget.
 *
 * ## Said once
 *
 * The status line is **always** in the page while the composer's panel can be, and
 * this fills it, so the sentence lands in a live region that already exists and is
 * announced once, when the row appears. The drawn row is hidden from a screen
 * reader, so it is not said twice.
 */
@Component({
  selector: 'lib-suggestion-no-match',
  imports: [RokuTranslatorPipe],
  template: `
    @if (words(); as quoted) {
      <!-- The keyboard stays up when the row is pressed, as it does for a card. -->
      <div
        (mousedown)="$event.preventDefault()"
        aria-hidden="true"
        class="none"
      >
        <span class="none-h">{{
          'list.add.card.noMatch' | rokuT: { query: quoted }
        }}</span>
        @if (freeText()) {
          <span class="none-p">{{
            'list.add.card.noMatchFreeText' | rokuT
          }}</span>
        }
      </div>
    }
    <span class="sr-only" role="status">
      @if (words(); as quoted) {
        {{ 'list.add.card.noMatch' | rokuT: { query: quoted } }}.
        @if (freeText()) {
          {{ 'list.add.card.noMatchFreeText' | rokuT }}.
        }
      }
    </span>
  `,
  styleUrl: './suggestion-no-match.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionNoMatch {
  /** The words that found nothing, or null for no row. */
  readonly words = input<string | null>(null);

  /** Whether the composer can still add the words as a line of their own. */
  readonly freeText = input(false);
}
