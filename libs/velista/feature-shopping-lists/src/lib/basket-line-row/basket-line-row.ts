import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  basketLineState,
  basketMatchRange,
  inLocale,
  offerAt,
  outstanding,
  QUANTITY_REEL_CLICK_SHIELD_MS,
  type BasketLine,
  type BasketLineOrigin,
  type BasketParticipant,
  type BasketProduct,
  type BasketRowMark,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import {
  CheckFilledIcon,
  CircleIcon,
  HalfCircleIcon,
  QuantityReel,
  SlashCircleIcon,
} from '@portfolio/velista/ui';
import {
  addedCaption,
  listShareCaption,
  originsCaption,
  outstandingCaption,
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
 * What pressing the status control does, per shape, for its accessible name.
 *
 * The **act** and not the state, because a control announced only by what it is
 * leaves somebody guessing what pressing it does. Which state it is performing the
 * act from is in the copy too: colour is never the difference between these four
 * (`0044`, section 7), so the shape carries it for a reader who sees the row and the
 * name carries it for one who hears it.
 */
const ACTS_ON_STATUS: Readonly<Record<BasketStatusGlyph, string>> = {
  wanted: 'basket.status.got',
  partly: 'basket.status.rest',
  bought: 'basket.status.undoGot',
  unavailable: 'basket.status.undoNone',
};

/**
 * What the line **is**, per shape, for a glyph that is not a control.
 *
 * The same pairs without the act, for the two cases where nothing may be pressed: a
 * finished line on a build with no reopen route behind it, and any line at all once
 * the whole trip is finished (velista `0057`). There is nothing to promise about
 * pressing it, so the name says what the row says.
 */
const STATES_ON_STATUS: Readonly<Record<BasketStatusGlyph, string>> = {
  wanted: 'basket.status.isWanted',
  partly: 'basket.status.isPartly',
  bought: 'basket.status.isGot',
  unavailable: 'basket.status.isNone',
};

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
 * ## The number is the control (plan 0054, amended by `0073`)
 *
 * The trailing number stopped being a readout and became a `QuantityReel` bound to
 * what is still to get. Dragging it **down** records that many bought; dragging it
 * **up** takes that many back. It runs from zero to what the lists asked for, so a
 * basket can no longer be raised above that, and a line of six dragged to zero and
 * brought back to four is two bought and four still to get.
 *
 * `0054` section 5 read the raise as "this basket will buy more" and is retired
 * rather than worked around: nobody standing in a shop read it that way. One call
 * still carries both directions, because the client never decides which of the two a
 * gesture was: two phones moving one line is exactly when it would decide wrongly.
 *
 * The row still opens the sheet on a tap. The reel is a separate target inside it
 * and takes the drag, the words take the tap, and `line-row` on the list page has
 * lived with that arrangement since `0043`, so it is an interaction somebody has
 * already met.
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
 * ## The product is named, and priced when there is a price
 *
 * Backend `0050` picks the first option added rather than the cheapest, so the
 * mock's "best price at your shops" caption is still not drawn: it would be a
 * claim nothing computes. What is drawn since velista `0062` is the pick's own
 * price, as a suffix on the caption line, wherever the run's scopes have one.
 * In staging and production the harvester is off and every offer is null, so
 * the row there is exactly the row it was; no layout depends on a price
 * existing, and there is no placeholder where one is missing (section 2).
 */
@Component({
  selector: 'lib-basket-line-row',
  imports: [
    CheckFilledIcon,
    CircleIcon,
    HalfCircleIcon,
    NgTemplateOutlet,
    QuantityReel,
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

  /**
   * The one list this row is about, or null for a row about the whole line
   * (velista `0077`, section 4.1).
   *
   * Set only under the list grouping, where a line two households asked for is drawn
   * twice, once under each heading. It changes **what the numbers on this row mean**
   * and nothing about what the row says: the ceiling, the value and the progress
   * caption all become this list's, and the status glyph stays the line's.
   *
   * That split is deliberate and it is section 4.1's whole point. A tick beside "6
   * of 6 got" under one household while the other household's six are still to get
   * would be a contradiction on one row, so the glyph reads the line, the number
   * reads the origin, and the caption between them says which is which.
   */
  readonly origin = input<BasketLineOrigin | null>(null);

  /**
   * The price scope this row quotes, or null for the cheapest anywhere
   * (velista `0078`, section 5).
   *
   * An input rather than a store read, exactly as {@link canReopen} and
   * {@link ownName} are: one basket has a dozen of these components and the answer
   * is the same for every one of them.
   *
   * It changes **which** number the caption carries and nothing else about the row:
   * a row priced at Mercadona and a row priced at the cheapest of five shops are the
   * same shape, which is `0062` section 2's rule and holds here too.
   */
  readonly shop = input<string | null>(null);

  /**
   * What this row says about that shop, beside the number, or null.
   *
   * Composed by the pipeline rather than here, because the **sink** is decided
   * there: the line that says "not listed at Mercadona" is the line that moved to
   * the end of the list, and a component working the first half out for itself would
   * be a second place for the two to disagree.
   */
  readonly mark = input<BasketRowMark | null>(null);

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

  /**
   * Whether the trip this line belongs to is over (velista `0057`, section 6).
   *
   * A fact about the **basket** and not about the line, which is why it arrives as an
   * input beside {@link canReopen} rather than being read off `line()`: the page holds
   * the store, and a component constructed once per line has no business asking the
   * same question a dozen times.
   *
   * What it removes is every control: the status glyph stops being a button and the
   * reel goes back to being the readout it was before plan 0054. What it keeps is
   * everything the row **says** — the words, the product, who settled it, which
   * household it came from — because a finished basket is the receipt for a trip
   * somebody took, and the most likely reason to open one is to see what was bought.
   * The row still opens the sheet, where the settlement history is.
   *
   * Absent rather than disabled, per `0030`. Every one of these writes is refused by
   * the server on a finished basket, so a drawn control is an invitation that cannot
   * be honoured.
   */
  readonly finished = input(false);

  /**
   * A sentence about the **last move of the number on this row**, or null.
   *
   * A key and the count it takes, rather than a rendered string, because the page
   * that owns the failure has no business composing copy and this component already
   * holds the translator. The count is the true number after the store refetched,
   * which is the whole of the stale answer: "somebody else changed this line, it
   * says 3 now" is only worth saying if the 3 is right (plan 0054, section 4.1).
   *
   * Held by the page and not here, because there is one of these at a time across
   * the whole basket and a row is constructed once per line.
   */
  readonly notice = input<{
    readonly key: string;
    readonly count: number;
  } | null>(null);

  /**
   * Whether this line was sent to a list that has not accepted it yet (`0056`).
   *
   * An input rather than something read off the line, because **no field of the line
   * carries it**: `GeneratedListLineOriginView` holds no approval state, so after a
   * reload nothing can say a bound line is waiting. What fills it is
   * `BasketStore.pendingTargets`, which is what this session's own bind was told, and
   * that is the case where somebody is standing there waiting to be told something.
   *
   * False everywhere else, which is honest rather than optimistic: the row says
   * nothing rather than guessing at a state it has no source for. When the origin
   * view carries it the row reads the line and this input goes.
   */
  readonly awaitingApproval = input(false);

  /**
   * What the basket is being searched for, already folded (velista `0074`,
   * section 4.5).
   *
   * Folded by the page and not here, because the answer is the same for every row
   * and this component is constructed once per line, which is the reasoning
   * {@link ownName} and {@link canReopen} already follow.
   *
   * Empty whenever nothing is being searched for, which is the ordinary state of
   * this screen: an empty highlight draws no mark and the row is exactly the row it
   * was.
   */
  readonly highlight = input('');

  /**
   * The line's own words, split around the first match, or null for no match.
   *
   * The **content only**. The product caption below it is matched too, so a line is
   * found by its pick's name or brand, but it is 12px muted text and a mark on it
   * competes with the name it sits beside. So a line found that way is drawn
   * unhighlighted, which is why this is null rather than a range into some other
   * string.
   *
   * Nothing else about the row changes, so a highlighted row and an ordinary one
   * are the same height.
   */
  protected readonly highlighted = computed(() => {
    const content = this.line().content;
    const range = basketMatchRange(content, this.highlight());
    if (range === null) {
      return null;
    }
    return {
      before: content.slice(0, range.start),
      match: content.slice(range.start, range.end),
      after: content.slice(range.end),
    };
  });

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

  /**
   * The reel was let go somewhere other than where it started (plan 0054).
   *
   * Absolute numbers in both halves rather than a delta, and `from` is not
   * decoration: a stale gesture would invert its own meaning, so the server refuses
   * a write whose origin no longer matches instead of applying it as the opposite
   * act (backend `0056`, section 3.2). What the move **means** is the server's to
   * decide and never this row's.
   */
  readonly outstanding = output<{ from: number; to: number }>();

  protected readonly state = computed(() => basketLineState(this.line()));

  /**
   * How many are still to get, which is what the reel is bound to.
   *
   * **The origin's, on a row drawn under one** (velista `0077`, section 4.1): a
   * household that asked for six and got two has four still to get, whatever the
   * other households on the same line have done. The line's own outstanding amount
   * everywhere else, which is what this row has always drawn.
   *
   * Not called `outstanding`: the output that reports a move of it has that name,
   * and it belongs to the thing a caller listens for rather than to a number they
   * could read off the line themselves.
   */
  protected readonly stillToGet = computed(() => {
    const origin = this.origin();
    return origin === null
      ? outstanding(this.line())
      : Math.max(0, origin.quantity - origin.settled);
  });

  /**
   * What the reel shows while a write is out.
   *
   * The basket is not optimistic (plan 0053, section 7), so the line still says the
   * old number until the server answers. Showing it would snap the reel back to
   * where the gesture started for as long as the request takes, which on a shop's
   * connection is long enough to be read as the gesture having failed. Consulted
   * only while {@link busy}, so a value left behind by a refused write is never
   * drawn: the row goes back to what the line now says, which is what section 4.1
   * asks for.
   */
  private readonly _sent = signal<number | null>(null);

  protected readonly shownOutstanding = computed(() =>
    this.busy() ? (this._sent() ?? this.stillToGet()) : this.stillToGet()
  );

  /**
   * The ceiling: **what the lists asked for**, and nothing above it (velista `0073`).
   *
   * This was `LINE_QUANTITY_MAX` minus what is settled, which let the number run past
   * the line's own quantity and made the raise a decision to buy more than anybody
   * wanted. A shopper who puts a tin back reaches for the same number expecting to
   * undo what they just did, so the reel now runs from zero to the line's quantity
   * and up takes purchases back. A line of six dragged to zero offers a reel from
   * zero to six.
   */
  protected readonly ceiling = computed(
    () => this.origin()?.quantity ?? this.line().quantity
  );

  /**
   * What the reel is counting: how many are still to get, not how many to buy.
   *
   * **Under a list heading it names the list first**, "Flat, Eggs, still to get",
   * which is the shape `0073` gave the settle sheet's per list reels and is the only
   * thing that tells two identically named reels apart for somebody who hears the
   * row rather than seeing which heading it sits under.
   *
   * A list with no name falls back to the reel's ordinary name rather than drawing a
   * leading comma, which is the rule `originsCaption` and the filter sheet's rows
   * already follow for the same data. The pipeline heads no section for such a list,
   * so this is a guard and not a case anybody meets.
   */
  protected readonly reelLabel = computed(() => {
    const name = this.line().content;
    const origin = this.origin();
    const list =
      origin === null ? '' : (this.listNames().get(origin.listId) ?? '');

    return this._translator.t(
      list === '' ? 'basket.outstanding.label' : 'basket.outstanding.listLabel',
      undefined,
      this._locale(),
      { list, name }
    );
  });

  /** Where the thumb is, while it is down. Null the moment the overlay closes. */
  private readonly _preview = signal<number | null>(null);

  /**
   * What the gesture is about to do, said while the thumb is still down.
   *
   * The confirmation is this caption and letting go is the commit, which is section
   * 3 and is not negotiable into a dialog: a dialog on a gesture done one handed
   * over a trolley is the thing `0043` took off the list page.
   */
  protected readonly caption = computed(() =>
    outstandingCaption(
      this.stillToGet(),
      this._preview(),
      this._translator,
      this._locale()
    )
  );

  private readonly _reel = viewChild(QuantityReel);

  /**
   * Until when a tap on the words is the end of a reel gesture rather than a tap.
   *
   * The same beat `line-row` keeps for the same reason: the overlay closes on its
   * own after an idle window, and a finger already falling towards the row does not
   * stop when the thing under it disappears.
   */
  private _deafUntil = 0;

  protected onReelAutoClosed(): void {
    this._deafUntil = Date.now() + QUANTITY_REEL_CLICK_SHIELD_MS;
  }

  protected onPreview(next: number | null): void {
    this._preview.set(next);
  }

  /**
   * The reel was let go. Report it, and hold the number it landed on.
   *
   * The preview is cleared here rather than waited for: the reel emits its own null
   * a beat later, and a caption that outlived the gesture by a frame would flicker
   * under the number the request is already about.
   */
  protected onCommitted(change: { from: number; to: number }): void {
    this._preview.set(null);
    this._sent.set(change.to);
    this.outstanding.emit(change);
  }

  /**
   * A tap on the words, which opens the sheet, unless it was really about the reel.
   *
   * Two cases and both are `line-row`'s. An open overlay is dismissed by the tap
   * that lands beside it rather than opening a screen over the number somebody was
   * reading; and a tap inside the beat after the overlay closed itself is the tail
   * of that gesture, so it does nothing at all.
   */
  protected onBody(): void {
    const reel = this._reel();
    if (reel?.open()) {
      // Closed here rather than left to the blur. A tap on a span that cannot take
      // focus moves focus nowhere, which is the ordinary case on a touch screen.
      reel.close();
      return;
    }

    if (Date.now() < this._deafUntil) {
      return;
    }

    this.open.emit();
  }

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

  /**
   * Whether the glyph is a control, or only a statement of what the line is.
   *
   * Three ways to be a statement rather than a button, and they are three different
   * facts: the line is finished and this build has no route to reopen one; or the
   * whole trip is finished, so nothing about this line may change at all. In both
   * cases what is drawn is what the line **is**, which is why they share a treatment.
   */
  protected readonly statusIsButton = computed(
    () => !this.finished() && (this.state() !== 'done' || this.canReopen())
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
    const glyph = this.statusGlyph();
    // The act it performs, or, where there is no act, the state it is in. The pair
    // is keyed off the same question the template asks, so a glyph that is drawn as
    // a statement can never be announced as a promise (velista `0057`, section 6).
    const key = this.statusIsButton()
      ? ACTS_ON_STATUS[glyph]
      : STATES_ON_STATUS[glyph];

    return this._translator.t(key, undefined, this._locale(), {
      name: this.line().content,
    });
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

  /**
   * The picked product's name, with its price after it when there is one, or
   * null for a free text line (velista `0062`, section 4).
   *
   * One string and not two fields, so a row with a price and a row without are
   * the same shape: the price is a suffix on the caption line, joined by the
   * separator the app already uses, and when the offer is null the caption is
   * exactly the string it was before. No unit price here; it is a second number
   * in a place with room for one, and its whole value is comparison, which is
   * the pick sheet's job.
   *
   * A line with options and no pick draws no price (section 4.1): quoting the
   * cheapest option there would put a number on a product nobody has chosen.
   */
  protected readonly productName = computed<string | null>(() => {
    const product = this._product();
    // A pick catalog no longer has: the basket outlives the catalog it was built
    // from, and a line with an unnameable product is still a line to buy.
    return product === null ? null : inLocale(product.name, this._locale());
  });

  /** The pick, or null for a free text line and for a pick catalog cannot resolve. */
  private readonly _product = computed<BasketProduct | null>(() => {
    const pickId = this.line().pickId;
    return pickId === null ? null : (this.products().get(pickId) ?? null);
  });

  /**
   * The price after the product's name, or null where there is none.
   *
   * **The chosen shop's**, when one is in use (velista `0078`, section 5), and the
   * cheapest at the run's scopes otherwise, which is what `0062` drew and what the
   * default still draws. A scope that carries the product with no number on it draws
   * nothing, which is the same blank a product nobody has priced leaves: the row has
   * no way to say "listed, price unknown" in the space it has, and the pick sheet is
   * where that distinction is worth drawing (`0062`, section 5.3).
   */
  protected readonly productPrice = computed<string | null>(() => {
    const product = this._product();
    if (product === null) {
      return null;
    }

    const shop = this.shop();
    const offer = shop === null ? product.offer : offerAt(product, shop);
    if (offer === null || offer.price === null) {
      return null;
    }
    return formatMoney(offer.price, offer.currency, this._locale());
  });

  /**
   * The mark's own sentence, composed, or null when the row carries none.
   *
   * One string and not two spans, because the unlisted mark is genuinely two
   * clauses about one thing — "not listed at Mercadona · 2.85 € at Dia" — and
   * drawing them as separate pieces would let a line break fall between a price and
   * the shop it belongs to. The separator is the one this row already joins its
   * captions with.
   */
  protected readonly markCaption = computed<string | null>(() => {
    const mark = this.mark();
    if (mark === null) {
      return null;
    }

    const locale = this._locale();
    if (mark.kind === 'cheaper') {
      return this._translator.t('basket.price.cheaperAt', undefined, locale, {
        price: formatMoney(mark.price, mark.currency, locale),
        chain: mark.chain,
      });
    }

    const missing = this._translator.t(
      'basket.price.notListedAt',
      undefined,
      locale,
      { chain: mark.chain }
    );
    const elsewhere = mark.elsewhere;
    if (elsewhere === null) {
      return missing;
    }

    const at = this._translator.t('basket.price.cheaperAt', undefined, locale, {
      price: formatMoney(elsewhere.price, elsewhere.currency, locale),
      chain: elsewhere.chain,
    });
    return `${missing} · ${at}`;
  });

  protected readonly quantity = computed(() =>
    quantityCaption(this.line(), this._translator, this._locale())
  );

  /**
   * The sentence under the number: the line's, or this list's share of it.
   *
   * One slot and not two, because they answer the same question about the same
   * number and a row that drew both would say it twice. The line's version is drawn
   * only for a partly settled line, which is what {@link quantity} has always done;
   * the list's is drawn on every row under a list heading, because the number beside
   * it is a household's share and nothing else on the row says so.
   */
  protected readonly progressCaption = computed(() => {
    const origin = this.origin();
    return origin === null
      ? this.quantity()
      : listShareCaption(this.line(), origin, this._translator, this._locale());
  });

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

  /**
   * Null for a reader who may not see origins, and null under a list heading.
   *
   * The second is velista `0077`, section 4.1: "from Weekly shop" is not drawn on a
   * row that sits under Weekly shop's own heading, because the heading already says
   * it. Drawing both would put the same three words on every row of the section.
   */
  protected readonly from = computed(() =>
    this.origin() !== null
      ? null
      : originsCaption(
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
      this.progressCaption(),
      // The product, its price and what the row says about the shop, each a
      // sentence of its own: a mark is words beside a number and a reader who
      // hears the row hears it (velista `0078`, section 7).
      this.productName() ?? '',
      this.productPrice() ?? '',
      this.markCaption() ?? '',
      this.touched() ?? '',
      this.added() ?? '',
      this.from() ?? '',
      // Announced with the rest of the row rather than only drawn, because a reader
      // moving by button hears this string and nothing else about the line.
      this.awaitingApproval()
        ? this._translator.t('basket.send.pending', undefined, this._locale())
        : '',
    ];
    return parts.filter((part) => part !== '').join('. ');
  });
}
