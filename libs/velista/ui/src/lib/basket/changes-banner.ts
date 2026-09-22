import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronRightIcon } from '../icons/icons';

/**
 * How many changes are new to this viewer, and the way into reading them
 * (velista `0093`, section 5).
 *
 * ## The count is the server's, and this component cannot change it
 *
 * One input and one output, which is the whole surface. It never decrements,
 * never hides itself after a tap and never remembers what it drew: the count
 * reaches zero because a basket read said so. A banner that took itself away
 * optimistically would be telling somebody they had read something they had not.
 *
 * ## One button, announced once
 *
 * The wrapper is the live region and the button is inside it, so the sentence is
 * announced politely when the number appears or moves, and not on every redraw
 * of the page around it. The dot is a shape beside a sentence rather than the
 * sentence itself, so it is `aria-hidden`: colour and shape are never the only
 * carriers here (velista `0052`, section 6.3).
 *
 * No animation on the way in or out. An announcement and a layout shift at once
 * is two interruptions, and this lands on a screen somebody is reading in an
 * aisle (velista `0093`, section 10).
 */
@Component({
  selector: 'lib-changes-banner',
  imports: [ChevronRightIcon, RokuTranslatorPipe],
  template: `
    <div role="status">
      <button (click)="opened.emit()" class="banner" type="button">
        <span aria-hidden="true" class="dot"></span>
        <span class="words">
          {{ 'basket.changes.banner' | rokuT: { count: count() } }}
        </span>
        <lib-chevron-right-icon aria-hidden="true" class="chevron" />
      </button>
    </div>
  `,
  styleUrl: './changes-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangesBanner {
  /**
   * How many changes this viewer has not seen. The caller draws nothing at zero.
   *
   * Guarded by the caller rather than by an `@if` here, because a component that
   * renders nothing still occupies a line of the page's template and the page is
   * where the question "is there anything to say" belongs.
   */
  readonly count = input.required<number>();

  /** Open the changes sheet. */
  readonly opened = output<void>();
}
