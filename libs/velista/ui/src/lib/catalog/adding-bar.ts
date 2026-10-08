import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronDownIcon } from '../icons/icons';

/**
 * The line that says which list the plus adds to (velista `0134`, section 4.2).
 *
 * "Adding to **Weekly shop**" and a chevron, between the page and the tab bar, on
 * the raised surface with a hairline above it. It answers the question before the
 * first plus is pressed, so no choice comes between a person and their first add.
 *
 * ## Two controls
 *
 * The name opens the sheet of lists, to change where the plus adds. The count at
 * the other end opens the sheet of what this visit added. The count is absent
 * until something was added, because "0 products added" is noise.
 *
 * `compact` draws the name alone, with no bar around it: the heading of Similar
 * products on a product's page, which opens the same sheet (section 5).
 */
@Component({
  selector: 'lib-adding-bar',
  imports: [ChevronDownIcon, RokuTranslatorPipe],
  template: `
    <span class="lead">{{ 'catalog.adding.to' | rokuT }}</span>
    <button
      (click)="listPressed.emit()"
      [attr.aria-label]="'catalog.adding.change' | rokuT: { list: list() }"
      class="list"
      type="button"
      data-adding="list"
    >
      <span class="list-name">{{ list() }}</span>
      <lib-chevron-down-icon class="chevron" />
    </button>
    @if (!compact() && count() > 0) {
      <button
        (click)="countPressed.emit()"
        class="count"
        type="button"
        data-adding="count"
      >
        {{ 'catalog.adding.count' | rokuT: { count: count() } }}
      </button>
    }
  `,
  styleUrl: './adding-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-compact]': 'compact()' },
})
export class AddingBar {
  /** The chosen list's name. */
  readonly list = input.required<string>();

  /** How many products this visit added. Zero draws no count. */
  readonly count = input(0);

  /** The name alone, for a heading. See the class comment. */
  readonly compact = input(false);

  /** The name was pressed: open the sheet of lists. */
  readonly listPressed = output<void>();

  /** The count was pressed: open the sheet of what this visit added. */
  readonly countPressed = output<void>();
}
