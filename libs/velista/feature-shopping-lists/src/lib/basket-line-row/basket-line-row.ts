import { NgTemplateOutlet } from '@angular/common';
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
  CheckFilledIcon,
  CircleIcon,
  HalfCircleIcon,
  SlashCircleIcon,
} from '@portfolio/velista/ui';
import {
  addedCaption,
  originsCaption,
  quantityCaption,
  touchedCaption,
} from '../basket-labels';

/**
 * Which of the four shapes the status control draws.
 *
 * Four and not three, because a `done` line has two readings that must not share a
 * glyph: `NOT_AVAILABLE` closes the outstanding amount exactly as a purchase does, so
 * a tick on one would claim a purchase that never happened, which is the same
 * distinction `touchedCaption` keeps a separate sentence for.
 */
export type BasketStatusGlyph = 'wanted' | 'partly' | 'bought' | 'unavailable';

/**
 * One line of the basket, as it is read in an aisle (plan 0044, section 4).
 *
 * ## A status control, and the row beside it
 *
 * `0043` took the checkbox off the list page and this screen never had one: a line is
 * not ticked, it is settled, and settling is a sheet because it asks how many. That
 * held, and plan 0052 section 6 amends it rather than taking it back: settling **a
 * number** is still the sheet, and what the leading control adds is the answer to the
 * one question the sheet does not need to be opened for, "all of it", which is the
 * common case in a shop and used to cost a tap, a sheet, a tap and a dismissal.
 *
 * A button cannot contain a button, so the row is a `div` holding two: the status
 * control, whose accessible name is the act it performs, and the body, which is the
 * control this component always was, with the composed label it always had.
 *
 * The status control is drawn for **everybody**. Every participant may settle and
 * every participant may reopen (luna `0054`, section 3.5), so there is no reader for
 * whom it is drawn and refused, and no `@if` guarding it. That is the same absence
 * rule the "from" caption follows: the data decides, and here the data says everybody.
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
  imports: [
    CheckFilledIcon,
    CircleIcon,
    HalfCircleIcon,
    NgTemplateOutlet,
    RokuTranslatorPipe,
    SlashCircleIcon,
  ],
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

  /** The reader's own participant id, so their own edits can be named. */
  readonly meId = input<string | null>(null);

  /**
   * The reader's own account name, for the caption on a line they settled themselves.
   *
   * An input beside {@link meId} rather than a `SessionStore` injected here, and that
   * is deliberate: this component is constructed once per line of the basket, and a
   * store injection in it would be a dozen resolutions of the same signal to answer
   * one question the page already knows the answer to.
   *
   * Null for a guest, who has no account and whose own row the server does name.
   */
  readonly ownName = input<string | null>(null);

  /** Whether a write on this line is in flight, which the row says quietly. */
  readonly busy = input(false);

  /**
   * Whether a finished line's status control may actually be pressed.
   *
   * `BASKET_REOPEN_AVAILABLE` from the caller rather than imported here, so the row
   * takes it like every other fact about the world: a component that reached for a
   * build constant of its own would be a second place the answer lives, and the page
   * is where the store already is.
   */
  readonly canReopen = input(false);

  readonly open = output<void>();

  /**
   * Settle this line's whole outstanding amount as bought.
   *
   * The same body the sheet's primary button sends, `{ outcome: 'BOUGHT' }` with no
   * quantity, which is "the whole outstanding amount" (backend `0051`, section 6). It
   * does not open the allocation pane and it asks nothing about zones: it is the one
   * tap gesture, and the system allocates oldest origin first exactly as it does when
   * the sheet sends the same body.
   */
  readonly settle = output<void>();

  /** Take this line back to fully outstanding (luna `0054`, section 3). */
  readonly reopen = output<void>();

  protected readonly state = computed(() => basketLineState(this.line()));
  protected readonly outstanding = computed(() => outstanding(this.line()));

  /** Which of the four shapes to draw. See {@link BasketStatusGlyph}. */
  protected readonly statusGlyph = computed<BasketStatusGlyph>(() => {
    const state = this.state();
    if (state === 'wanted') {
      return 'wanted';
    }
    if (state === 'partly') {
      return 'partly';
    }
    return this.line().lastOutcome === 'NOT_AVAILABLE'
      ? 'unavailable'
      : 'bought';
  });

  /** Whether the glyph is a control, or only a statement of what the line is. */
  protected readonly statusIsButton = computed(
    () => this.state() !== 'done' || this.canReopen()
  );

  /**
   * The status control's accessible name: **the act it performs**, and which state it
   * is performing it from.
   *
   * Both halves matter and neither is decoration. Colour is never the difference
   * between these four (`0044` section 7), so the shape carries it visually and the
   * name carries it for a reader who hears the row rather than seeing it; and a
   * control announced only by its state would leave somebody guessing what pressing
   * it does.
   *
   * The static indicator takes a name too, which is the pair without the act: it is
   * what the line **is**, and there is nothing to promise about pressing it.
   */
  protected readonly statusLabel = computed(() => {
    const name = this.line().content;
    const glyph = this.statusGlyph();
    const key =
      glyph === 'wanted'
        ? 'basket.status.got'
        : glyph === 'partly'
          ? 'basket.status.rest'
          : this.canReopen()
            ? glyph === 'unavailable'
              ? 'basket.status.undoNone'
              : 'basket.status.undoGot'
            : glyph === 'unavailable'
              ? 'basket.status.isNone'
              : 'basket.status.isGot';

    return this._translator.t(key, undefined, this._locale(), { name });
  });

  /**
   * One tap, in whichever direction the line is facing.
   *
   * The row reports the act and does not perform it: the store is the page's, and a
   * component rendered once per line has no business holding one. The page also owns
   * what happens **after**, which the row could not draw anyway — a write that comes
   * back with a skipped origin has a paragraph to report, and a paragraph belongs on
   * the sheet (plan 0052, section 6.4).
   */
  protected toggle(): void {
    if (this.state() === 'done') {
      this.reopen.emit();
      return;
    }
    this.settle.emit();
  }

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
      this.meId(),
      this.ownName()
    )
  );

  /**
   * "Who put this here", for a line nobody has touched yet (plan 0053, section 5).
   *
   * Null for every line the run composed, so a basket that nobody has typed into
   * draws exactly what it drew before: the data decides, as it does for the "from"
   * caption beside it.
   */
  protected readonly added = computed(() =>
    addedCaption(
      this.line(),
      this.people(),
      this._translator,
      this._locale(),
      this.meId(),
      this.ownName()
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
      this.added() ?? '',
      this.from() ?? '',
    ];
    return parts.filter((part) => part !== '').join('. ');
  });
}
