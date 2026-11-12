import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { type LineUnit } from '@portfolio/velista/models';
import {
  exactAmount,
  shortAmount,
  type AmountWords,
} from '@portfolio/velista/platform';

/**
 * An amount as a number over its unit symbol (velista `0188`, S3): "750" over "g",
 * "1,25" over "kg", "12" alone for a count under a thousand.
 *
 * The figure and the symbol are hidden from a screen reader, which hears the exact
 * amount in words instead ("750 gramos"), because "1,28 kg" read aloud is not the
 * 1275 g the line holds. A control that already names the amount (the sheets'
 * spinbutton) turns {@link speak} off.
 */
@Component({
  selector: 'lib-amount-figure',
  template: `
    <span aria-hidden="true" class="number">{{ words().figure }}</span>
    @if (words().symbol) {
      <span aria-hidden="true" class="symbol">{{ words().symbol }}</span>
    }
    @if (speak()) {
      <span class="visually-hidden">{{ words().spoken }}</span>
    }
  `,
  styleUrl: './amount-figure.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-long]': 'words().long',
    '[class.is-bare]': '!words().symbol',
    '[class.is-zero]': 'quantity() === 0',
  },
})
export class AmountFigure {
  /** The amount, in base units. */
  readonly quantity = input.required<number>();
  readonly unit = input<LineUnit>('UNIT');
  /** The short form in rows, cards and tables; the exact form in the two sheets. */
  readonly form = input<'short' | 'exact'>('short');
  /** Whether it carries its own visually hidden spoken words. Off inside a control that names it. */
  readonly speak = input(true);

  private readonly _localeStore = inject(RokuLocaleStore, { optional: true });

  readonly words = computed<AmountWords>(() => {
    const locale = this._localeStore?.locale() ?? 'en';
    return this.form() === 'exact'
      ? exactAmount(this.quantity(), this.unit(), locale)
      : shortAmount(this.quantity(), this.unit(), locale);
  });
}
