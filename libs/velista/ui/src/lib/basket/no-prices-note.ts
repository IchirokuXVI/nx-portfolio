import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { BasketTotal } from '@portfolio/velista/models';
import { InfoIcon } from '../icons/icons';

/**
 * The one small row for a basket where no visible line has a price (velista
 * `0132`, section 6, rule T8). It stands where the number and the bar would.
 *
 * ## Small enough to stay
 *
 * No close button, which the owner decided: the row is one line, and it goes by
 * itself when the first line gets a price. That is the caller's `@if`, because
 * the page is where "is there anything to add up" belongs.
 *
 * ## Nothing is remembered
 *
 * Whether the rest is open is a signal here and nowhere else, so the row is
 * closed each time the page opens.
 *
 * ## Two causes, and a guest hears only one
 *
 * Lines that are only words get the three steps that give a line a product.
 * Lines with a product and no price get the sentence about shops, because the
 * steps would send somebody to do what they already did. A guest cannot open a
 * line, so the steps are an invitation a guest cannot accept, and a guest gets
 * the second text in both cases.
 */
@Component({
  selector: 'lib-no-prices-note',
  imports: [InfoIcon, RokuTranslatorPipe],
  templateUrl: './no-prices-note.html',
  styleUrl: './no-prices-note.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoPricesNote {
  /** The sum of the visible lines, read for which cause this is. */
  readonly total = input.required<BasketTotal>();

  /** Whether the basket is read at one shop, which adds where else to look. */
  readonly shopChosen = input(false);

  /** Whether the viewer is a guest, who cannot open a line. */
  readonly guest = input(false);

  protected readonly expanded = signal(false);

  /** Only words on the lines, said to somebody who can give them a product. */
  protected readonly showSteps = computed(
    () => this.total().withProduct === 0 && !this.guest()
  );

  protected toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }
}
