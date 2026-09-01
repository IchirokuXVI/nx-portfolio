import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  basketLineState,
  inLocale,
  outstanding,
  type BasketLine,
  type BasketParticipant,
  type BasketProduct,
} from '@portfolio/velista/models';
import {
  originsCaption,
  quantityCaption,
  touchedCaption,
} from '../basket-labels';

/**
 * One line of the basket, as it is read in an aisle (plan 0044, section 4).
 *
 * ## It is a button, not a checkbox
 *
 * `0043` took the checkbox off the list page and this screen never had one: a
 * line is not ticked, it is settled, and settling is a sheet because it asks how
 * many. So the row is one large `button` and its accessible name carries
 * everything the visual rows carries, because a screen reader user gets the
 * caption from the name rather than from the three lines under it.
 *
 * ## Absence, again
 *
 * The "from" caption is drawn **only** when {@link BasketLine.origins} is present.
 * A guest's line has no such key at all, so there is nothing to hide and no
 * `@if (seesZoneData)` guarding it: the data decides, which is one fewer place
 * for the rule to be got wrong. Section 4.1's whole point is that a control or a
 * caption you may not have is not drawn rather than disabled.
 *
 * ## The product is named, and never priced
 *
 * Backend `0050` picks the first option added rather than the cheapest, so the
 * mock's "best price at your shops" caption and its price are not drawn: they
 * would be claims nothing computes (section 9). The name is drawn, and tapping
 * the row is what leads to changing it.
 */
@Component({
  selector: 'lib-basket-line-row',
  imports: [RokuTranslatorPipe],
  templateUrl: './basket-line-row.html',
  styleUrl: './basket-line-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketLineRow {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly line = input.required<BasketLine>();

  /** Everybody on the basket, so `touchedBy` can be resolved to a name. */
  readonly people = input.required<ReadonlyMap<string, BasketParticipant>>();

  /** Every product the basket named, so the pick can be named. */
  readonly products = input.required<ReadonlyMap<string, BasketProduct>>();

  /** List names for the "from" caption. Empty for a reader who has no origins. */
  readonly listNames = input<ReadonlyMap<string, string>>(new Map());

  /** The reader's own participant id, so their own edits read as "you". */
  readonly meId = input<string | null>(null);

  /** Whether a write on this line is in flight, which the row says quietly. */
  readonly busy = input(false);

  readonly open = output<void>();

  protected readonly state = computed(() => basketLineState(this.line()));
  protected readonly outstanding = computed(() => outstanding(this.line()));

  /** The picked product's name, or null for a free text line. */
  protected readonly productName = computed<string | null>(() => {
    const pickId = this.line().pickId;
    if (pickId === null) {
      return null;
    }
    const product = this.products().get(pickId);
    // A pick catalog no longer has: the basket outlives the catalog it was built
    // from, and a line with an unnameable product is still a line to buy.
    return product ? inLocale(product.name, this._locale()) : null;
  });

  protected readonly quantity = computed(() =>
    quantityCaption(this.line(), this._translator, this._locale())
  );

  protected readonly touched = computed(() =>
    touchedCaption(
      this.line(),
      this.people(),
      this._translator,
      this._locale(),
      this.meId()
    )
  );

  /** Null for a reader who may not see origins. See the class comment. */
  protected readonly from = computed(() =>
    originsCaption(
      this.line(),
      this.listNames(),
      this._translator,
      this._locale()
    )
  );

  /**
   * The accessible name of the row's button.
   *
   * Everything the row shows, in one string, because the visual layout puts the
   * quantity and the attribution on separate lines and a reader moving by button
   * would otherwise hear only the content.
   */
  protected readonly label = computed(() => {
    const parts = [
      this.line().content,
      this.quantity(),
      this.productName() ?? '',
      this.touched() ?? '',
      this.from() ?? '',
    ];
    return parts.filter((part) => part !== '').join('. ');
  });
}
