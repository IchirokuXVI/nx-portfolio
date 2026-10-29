import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
  basketMatchRange,
  basketRowProduct,
  isCrossedOutRow,
  QUANTITY_REEL_CLICK_SHIELD_MS,
  shownOffer,
  type BasketListRef,
  type BasketParticipant,
  type BasketPriceMark,
  type BasketProduct,
  type BasketRowEntry,
  type BasketRow as BasketRowModel,
  type BasketRowState,
  type BasketShelfMark,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import {
  CheckFilledIcon,
  CircleIcon,
  ClockIcon,
  HalfCircleIcon,
  ProductPicture,
  QuantityReel,
  SlashCircleIcon,
  SwapIcon,
} from '@portfolio/velista/ui';
import {
  basketRowName,
  crossedOutNoteKey,
  listsCaption,
  outstandingCaption,
  quantityCaption,
  skipCaption,
  touchedCaption,
} from '../basket-labels';

/**
 * Which of the five shapes the status control draws.
 *
 * Five and not six, although a row has six states. `REMOVED` still draws as
 * `wanted` with every control off; velista `0093` gives it its own treatment, and
 * a glyph invented for it here would be a shape that plan has to take back.
 *
 * **Three of the five say a row is closed, and they have to be three** (velista
 * `0092`, section 4). A tick claims a purchase; a stroke through says the shop
 * had none, which is a close with nothing bought; a clock says somebody walked
 * past it today, which closes nothing at all. A shopper standing at a shelf reads
 * these at arm's length, so they are told apart by shape and never by colour
 * (velista `0052`, section 6.3), and the words beside each of them say the same
 * thing again.
 */
/**
 * How many of a row's units the server's newest first revert walk reaches before
 * it meets somebody else's buy, for a revert sent by `meId` (velista `0151`).
 *
 * The walk is the server's: it takes `BOUGHT` settlements back newest first and
 * asks nothing about who made them. So the entries holding units are read newest
 * act first, and the count stops at the first one whose last act is not this
 * person's buy. Zero means the newest units are somebody else's.
 *
 * An entry knows only its last act, so an entry two people bought on counts as
 * the last one's. That mixed entry is the gap the plan leaves to the owner. A row
 * whose entries carry no act at all cannot tell, and answers `bought` as before.
 */
export function ownBoughtUnits(row: BasketRowModel, meId: string): number {
  const held = row.entries.filter((entry) => entry.bought > 0);
  if (held.every((entry) => (entry.act ?? null) === null)) {
    return row.bought;
  }

  const instant = (entry: BasketRowEntry): number => {
    const at = entry.act ? Date.parse(entry.act.at) : Number.NaN;
    return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
  };
  let units = 0;
  for (const entry of [...held].sort((a, b) => instant(b) - instant(a))) {
    if (entry.act?.participantId !== meId || entry.act.outcome !== 'BOUGHT') {
      break;
    }
    units += entry.bought;
  }
  return units;
}

/** What a press on the status control does (velista `0151`). */
type StatusPress = 'settle' | 'revert' | 'open';

export type BasketStatusGlyph =
  | 'wanted'
  | 'partly'
  | 'bought'
  | 'unavailable'
  | 'skipped';

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
  // The same act as on a wanted row, and that is the point: a person who skipped
  // the bread and then found it presses this, and the server ends the skip with
  // the purchase (velista `0092`, section 3.1). Taking the skip back without
  // buying is a different act with a button of its own, on the sheet.
  skipped: 'basket.status.got',
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
  skipped: 'basket.skip.state',
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
 * The "from" caption is drawn **only** for a list this reader was served. A guest
 * is served none, so every entry they hold names none and there is nothing to
 * hide: the data decides, which is one fewer place for the rule to be got wrong.
 * Section 4.1's whole point is that a control or a caption you may not have is not
 * drawn rather than disabled.
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
  selector: 'lib-basket-row',
  imports: [
    CheckFilledIcon,
    CircleIcon,
    ClockIcon,
    HalfCircleIcon,
    NgTemplateOutlet,
    ProductPicture,
    QuantityReel,
    RokuTranslatorPipe,
    SlashCircleIcon,
    SwapIcon,
  ],
  templateUrl: './basket-row.html',
  styleUrl: './basket-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketRow {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly row = input.required<BasketRowModel>();

  /** Everybody on the basket, so `touchedBy` can be resolved to a name. */
  readonly people = input.required<ReadonlyMap<string, BasketParticipant>>();

  /** Every product the basket named, so the row's own can be named. */
  readonly products = input.required<ReadonlyMap<string, BasketProduct>>();

  /**
   * The covered lists this reader was served, for the "from" caption.
   *
   * Empty for a reader served none, which draws no caption: there is one question
   * here since backend `0136`, and an entry naming a list that is not in this map
   * is one this reader may not name.
   */
  readonly lists = input<ReadonlyMap<string, BasketListRef>>(new Map());

  /**
   * The one entry this row is drawn for, or null for a row about the whole thing
   * (velista `0077`, section 4.1).
   *
   * Set only under the list grouping, where a row two households asked for is drawn
   * twice, once under each heading. It changes **what the numbers and the state on
   * this row mean** and nothing about what the row says: the ceiling, the value, the
   * glyph and the progress caption all become this household's.
   *
   * The glyph moves with them, which is the change from velista `0077`. There it
   * read the line while the number read the origin, because only the line had a
   * state; backend `0136` gives an entry its own, so a tick beside "6 of 6" under
   * one household no longer needs a caption to explain that the other household's
   * six are still to get. The heading says whose row it is and everything on it
   * agrees.
   */
  readonly entry = input<BasketRowEntry | null>(null);

  /**
   * Whether this row quotes the chosen shop's price, or the cheapest anywhere
   * (velista `0078`, section 5; `0102`).
   *
   * An input rather than a store read, exactly as {@link canReopen} and
   * {@link ownName} are: one basket has a dozen of these components and the answer
   * is the same for every one of them.
   *
   * It changes **which** number the caption carries and nothing else about the row:
   * a row priced at Mercadona and a row priced at the cheapest of five shops are the
   * same shape, which is `0062` section 2's rule and holds here too. At a shop the
   * number is the product's `atShop` price, which the server decided.
   */
  readonly atShop = input(false);

  /**
   * The section of the shop the basket is read at that holds this row's product,
   * named, or null (velista `0121`, target 5). The page decides, because it is
   * the page that knows whether the shop has a map.
   */
  readonly section = input<string | null>(null);

  /**
   * What the chosen shop is known not to have on this row, or null (velista
   * `0102`).
   *
   * Composed by the pipeline beside {@link priceMark}. **A mark and never a move**:
   * the row keeps its place, its controls and its number, because the shelf may be
   * restocked and the person is the one looking at it.
   */
  readonly shelf = input<BasketShelfMark | null>(null);

  /**
   * How often this row was bought at the chosen shop's chain, for the message
   * under it, or null (velista `0104`).
   *
   * Composed by the pipeline, which is where the usual filter runs: it is set only
   * while that filter is on, only on a row bought here, and only under five times,
   * so the row draws what it is handed and decides nothing. The numbers are the
   * server's.
   */
  readonly usual = input<{
    readonly bought: number;
    readonly of: number;
  } | null>(null);

  /**
   * What this row says about that shop, beside the number, or null.
   *
   * Composed by the pipeline rather than here, because the **sink** is decided
   * there: the row that says "not listed at Mercadona" is the row that moved to
   * the end of the list, and a component working the first half out for itself would
   * be a second place for the two to disagree.
   *
   * Named `priceMark` beside the row's own change mark, which backend `0130` added
   * and velista `0093` draws. Two marks on one row need two names.
   */
  readonly priceMark = input<BasketPriceMark | null>(null);

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
   * Whether an add from the basket just raised a line of this row, which marks its
   * quantity (velista `0170`, target 4). The page decides for how long.
   */
  readonly took = input(false);

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
   * The row's name, split around the first match, or null for no match.
   *
   * **The drawn name only**: the product on a product row, the line's words on a
   * row with none. A row is also found by the names of its lines (velista `0139`,
   * section 5), which the row does not draw, so a row found that way is drawn
   * unhighlighted, which is why this is null rather than a range into some other
   * string.
   *
   * Nothing else about the row changes, so a highlighted row and an ordinary one
   * are the same height.
   */
  protected readonly highlighted = computed(() => {
    const content = this.name();
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
   * Whether the cheaper mark opens the change sheet (velista `0140`, section 1):
   * another product of the group is cheaper, and the reader may change the
   * product of one list of the row or more. The page decides, because it holds
   * the lists and the groups.
   */
  readonly canChange = input(false);

  /**
   * Another product of this product's group is cheaper, by the price per litre
   * or kilo at the basket's scopes. Words beside the price, never colour alone.
   */
  readonly groupCheaper = input(false);

  /** The cheaper mark's control was pressed: change the product for all lists. */
  readonly changeProduct = output<void>();

  /** The control's accessible name, which says why it is there and names the product. */
  protected readonly changeLabel = computed(() =>
    this._translator.t('basket.change.openLabel', undefined, this._locale(), {
      name: this.name(),
    })
  );

  /** The group mark's words, or null. */
  protected readonly groupCaption = computed(() =>
    this.groupCheaper() && this._product() !== null
      ? this._translator.t('basket.change.cheaper', undefined, this._locale())
      : null
  );

  /**
   * Settle this line's whole outstanding amount as bought.
   *
   * The same body the sheet's primary button sends, `{ outcome: 'BOUGHT' }` with no
   * quantity, which is "the whole outstanding amount" (backend `0051`, section 6). It
   * does not open the allocation pane and it asks nothing about zones: it is the one
   * tap gesture, and the system allocates oldest origin first exactly as it does when
   * the sheet sends the same body.
   */
  /**
   * Buy everything this row still asks for.
   *
   * The one tap gesture, which is the common case in a shop and used to cost a tap,
   * a sheet, a tap and a dismissal. The page sends an explicit quantity, because
   * every `BOUGHT` carries one since backend `0136`, and `from` beside it is what
   * makes a double tap safe.
   */
  readonly settle = output<void>();

  /** Take this row's purchases, or its close, back (backend `0136`, section 5.2). */
  readonly revert = output<void>();

  /**
   * The reel was let go somewhere other than where it started (plan 0054).
   *
   * Absolute numbers in both halves rather than a delta, and `from` is not
   * decoration: a stale gesture would invert its own meaning, so the server refuses
   * a write whose origin no longer matches instead of applying it as the opposite
   * act. What the move **means** is the server's to decide and never this row's,
   * which is what `BasketStore.setLeft` turns it into.
   */
  readonly left = output<{ from: number; to: number }>();

  /**
   * The state this row draws, which is **the entry's under a list heading**.
   *
   * Read and never derived (backend `0130`, section 4). `basketLineState` used to
   * work it out of two numbers here, and could not tell a shop that had none from a
   * purchase, because both leave nothing outstanding.
   */
  protected readonly state = computed<BasketRowState>(
    () => this.entry()?.state ?? this.row().state
  );

  /** Whether the row is drawn quietly as finished: bought here, or closed by the shop. */
  protected readonly drawnDone = computed(
    () => this.state() === 'DONE' || this.state() === 'NOT_AVAILABLE'
  );

  /**
   * How many are still to get, which is what the reel is bound to.
   *
   * **The entry's, on a row drawn under one** (velista `0077`, section 4.1): a
   * household that asked for six and got two has four still to get, whatever the
   * other households on the same row have done.
   *
   * Read off whichever of the two the row is about, and never computed: `left` is
   * what the server says is still wanted, and this side has no way to work it out
   * from anything else.
   */
  protected readonly stillToGet = computed(
    () => this.entry()?.left ?? this.row().left
  );

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
   * The ceiling: **what was asked for**, and nothing above it (velista `0073`).
   *
   * `asked`, read and never computed, which is `bought + left` on an open basket
   * and the frozen number on a finished one. A row of six bought to zero offers a
   * reel from zero to six, so the shopper who puts a tin back reaches for the same
   * number expecting to undo what they just did.
   */
  protected readonly ceiling = computed(
    () => this.entry()?.asked ?? this.row().asked
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
   * leading comma, which is the rule `listsCaption` and the filter sheet's rows
   * already follow for the same data. The pipeline heads no section for such a list,
   * so this is a guard and not a case anybody meets.
   */
  protected readonly reelLabel = computed(() => {
    const name = this.name();
    const listId = this.entry()?.listId ?? null;
    const list = listId === null ? '' : (this.lists().get(listId)?.name ?? '');

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

  /**
   * Who stands behind the state the control is drawn from: the entry's last act
   * under a list heading, the row's everywhere else (velista `0151`).
   */
  private readonly _actor = computed(() => {
    const entry = this.entry();
    return entry === null
      ? this.row().touchedBy
      : (entry.act?.participantId ?? null);
  });

  /**
   * What a press on the status control does, from the row as it now stands.
   *
   * **A finished row undoes only what this person did** (velista `0151`). One
   * somebody else bought or closed opens the sheet, which names who did it and
   * offers the undo on purpose. So does a bought row whose newest units are
   * somebody else's, because the server takes units back newest first.
   */
  private readonly _press = computed<StatusPress>(() => {
    const state = this.state();
    if (state !== 'DONE' && state !== 'NOT_AVAILABLE') {
      return 'settle';
    }
    const me = this.meId();
    if (me === null || this._actor() !== me) {
      return 'open';
    }
    return state === 'DONE' && ownBoughtUnits(this.row(), me) === 0
      ? 'open'
      : 'revert';
  });

  /** The press the control was last drawn for, and until when it is deaf. */
  private _drawnPress: StatusPress | null = null;
  private _flipDeafUntil = 0;

  /**
   * Whether this person's own settle or revert is still on its way back. The
   * store is not optimistic, so the flip it causes arrives later, and after an
   * undo it arrives with somebody else's act (or none) standing on the entry.
   * The next flip clears it and starts no hold.
   */
  private _ownPress = false;

  /**
   * A change somebody else made that turns the control into another act holds
   * it deaf for the reel's beat (velista `0151`): a finger already on its way
   * lands on nothing rather than on the act the change just put under it. The
   * person's own press moves the control too, and holds nothing, also when it
   * was an undo that leaves somebody else's act standing.
   */
  private readonly _flipWatch = effect(() => {
    const press = this._press();
    if (this._drawnPress !== null && press !== this._drawnPress) {
      this._holdIfRemote();
    }
    this._drawnPress = press;
  });

  private _holdIfRemote(): void {
    if (this._ownPress) {
      this._ownPress = false;
      return;
    }
    if (this._actor() !== this.meId()) {
      this._flipDeafUntil = Date.now() + QUANTITY_REEL_CLICK_SHIELD_MS;
    }
  }

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
    this.left.emit(change);
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

  /**
   * Whether this row is one whose lines all left the coverage (velista `0093`,
   * section 4).
   *
   * **A whole second shape of row**, and that is why it is asked here rather
   * than folded into the controls one by one. Nothing on it is a control: no
   * reel, no status glyph, no price, no sheet. It is a `li` with text, read in
   * document order by a screen reader and skipped by the Tab key, because there
   * is nothing on it to do and somebody still has to be told it happened.
   *
   * The row's own state and never the entry's: a `REMOVED` row has no entries
   * at all, which is what that state means.
   */
  protected readonly removed = computed(() => this.row().state === 'REMOVED');

  /**
   * Whether the row is drawn crossed out (velista `0142`, section 1): `REMOVED`,
   * or bought outside this shopping list. **The entry's state under a list
   * heading**, as everything else the row draws, so a household whose share
   * somebody else bought is crossed out under its own heading.
   *
   * A row bought elsewhere has no circle and no reel, because nothing on it buys
   * or takes back: this shopping list bought none of it, and the server refuses
   * to let it undo a buy of another. It still opens its sheet, where a list can
   * ask for the product again.
   */
  protected readonly crossed = computed(
    () => isCrossedOutRow(this.row()) || this.state() === 'BOUGHT_ELSEWHERE'
  );

  /**
   * The one line under the crossed out name: where it was bought, or that it is
   * no longer on the list. The row's note says where, so an entry crossed out
   * inside a row that still asks for something says "Already bought".
   */
  protected readonly crossedNoteKey = computed(() => {
    const row = this.row();
    return crossedOutNoteKey(
      row.state === 'REMOVED' || row.state === 'BOUGHT_ELSEWHERE'
        ? row
        : { state: 'BOUGHT_ELSEWHERE', note: null }
    );
  });

  /** The crossed out row's name and its line, as one accessible name. */
  protected readonly crossedLabel = computed(() =>
    [
      this.name(),
      this._translator.t(this.crossedNoteKey(), undefined, this._locale()),
    ].join('. ')
  );

  /**
   * The word on the tag at the end of the name line, or null (velista `0093`,
   * section 3).
   *
   * Two of the three marks draw one. `REMOVED` draws none, because that row is
   * the whole of {@link removed} above and says so in a sentence rather than in
   * a tag.
   *
   * Read off the row and **never off the entry**, and never computed: a mark is
   * the server's answer to "what has this viewer not seen", and this side holds
   * no clock and no memory of what it drew last time.
   */
  protected readonly markWord = computed<string | null>(() => {
    switch (this.row().mark) {
      case 'ADDED':
        return 'basket.mark.added';
      case 'CHANGED':
        return 'basket.mark.changed';
      default:
        return null;
    }
  });

  /**
   * Which of the five shapes to draw, from the state the server sent.
   *
   * `REMOVED` falls through to `wanted`, which is what velista `0090` section 9.1
   * says it draws until `0093` gives it its own treatment. A state this build has
   * never heard of does the same, which is the direction the model's own fallback
   * takes and for the same reason: a row this build cannot classify is still a
   * thing to buy.
   */
  protected readonly statusGlyph = computed<BasketStatusGlyph>(() => {
    const state = this.state();
    if (state === 'PARTLY') {
      return 'partly';
    }
    if (state === 'DONE') {
      return 'bought';
    }
    if (state === 'NOT_AVAILABLE') {
      return 'unavailable';
    }
    if (state === 'SKIPPED') {
      return 'skipped';
    }
    return 'wanted';
  });

  /**
   * Whether the reel is drawn at all (velista `0092`, section 4).
   *
   * **The shape that tells a closed row from a wanted one at arm's length.** A
   * skip and a close are both "nothing more is happening to this row today", and
   * neither was reached by a number: a skip has no number, and a close is an
   * outcome rather than a quantity. So a reel on either would be the one control
   * that could be dragged to zero and mean something the state does not.
   *
   * A row bought to zero keeps its reel, at zero, because that is the gesture
   * that put it there and the one that takes it back.
   *
   * Undoing a close is the status glyph beside it, unchanged since velista
   * `0044`: press it, and the reel comes back with the row.
   */
  protected readonly showsReel = computed(
    () => this.state() !== 'SKIPPED' && this.state() !== 'NOT_AVAILABLE'
  );

  /**
   * The quiet line under the name about this row having been put off, or null.
   *
   * **The row's and never the entry's**, unlike the state and the numbers above
   * it: a skip covers the row, so every entry of a skipped row draws the same
   * caption under the same words (velista `0092`, section 3.2).
   */
  protected readonly skipCaption = computed<string | null>(() =>
    skipCaption(
      { ...this.row(), state: this.state() },
      this._translator,
      this._locale()
    )
  );

  /**
   * Whether the glyph is a control, or only a statement of what the row is.
   *
   * One way to be a statement rather than a button: a finished trip, which takes
   * every control off the screen. A crossed out row draws no glyph at all
   * (velista `0142`), so it never asks.
   *
   * The third was a build with no reopen route behind it. There is no such build:
   * `BASKET_REOPEN_AVAILABLE` guarded a route backend `0136` replaced with a revert
   * that is always available, so the constant went with it.
   */
  protected readonly statusIsButton = computed(() => !this.finished());

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
      name: this.name(),
    });
  });

  /**
   * One tap, in whichever direction the row is facing.
   *
   * The row reports the act and does not perform it: the store is the page's, and a
   * component rendered once per row has no business holding one. The page also owns
   * what happens **after**, which the row could not draw anyway — a write that could
   * not reach an entry has a sentence to report, and that sentence belongs on the
   * sheet (plan 0052, section 6.4).
   *
   * A finished row reverts and everything else settles. `NOT_AVAILABLE` is finished
   * too, and reverting it takes the close back rather than any units, which is what
   * the page sends: the two directions are one gesture aimed at different things,
   * and which thing is the state's to say.
   *
   * Only this person's own finish reverts (velista `0151`). A row somebody else
   * finished opens the sheet, and a tap inside the hold after a remote change
   * does nothing.
   */
  protected toggle(): void {
    const press = this._press();
    if (this._drawnPress !== null && press !== this._drawnPress) {
      // The row moved and the screen has not caught up: the finger aimed at
      // what was drawn, so this tap starts the hold.
      this._holdIfRemote();
      this._drawnPress = press;
    }
    if (Date.now() < this._flipDeafUntil) {
      return;
    }
    if (press === 'revert') {
      this._ownPress = true;
      this.revert.emit();
    } else if (press === 'open') {
      this.open.emit();
    } else {
      this._ownPress = true;
      this.settle.emit();
    }
  }

  /**
   * The name the row is drawn under (velista `0139`, sections 1 and 2).
   *
   * **The product**, on a row of one: its name, its brand and its size, as the
   * catalog cards print them, in one line. The line's own words on a row whose
   * lines hold no product, and on a row whose product the read could not name,
   * because a basket outlives the catalog it was read against and a line with an
   * unnameable product is still a line to buy.
   */
  protected readonly name = computed<string>(() =>
    basketRowName(this.row(), this.products(), this._translator, this._locale())
  );

  /** Whether the row is a product, which cuts its name to one line. */
  protected readonly isProduct = computed(() => this._product() !== null);

  /**
   * The product's photo, drawn after the status control (velista `0164`), or
   * null for the product glyph. Read only on a row where {@link isProduct} holds.
   */
  protected readonly imageUrl = computed(
    () => this._product()?.imageUrl ?? null
  );

  /**
   * The product this row is, or null (backend `0201`): one product or none, the
   * row's own. The **row's** and never the entry's, because a row is one thing to
   * pick off one shelf however many households asked for it.
   */
  private readonly _product = computed<BasketProduct | null>(() =>
    basketRowProduct(this.row(), this.products())
  );

  /**
   * The price first on the caption line, or null where there is none.
   *
   * **The chosen shop's**, when one is in use (velista `0078`, section 5), or
   * none when that shop has no price for it (velista `0153`), and the cheapest at
   * the run's scopes otherwise. A row with no product has no price and
   * adds nothing to the total (velista `0139`, section 2).
   */
  protected readonly productPrice = computed<string | null>(() => {
    // The same lookup a settle reads its scope from (velista `0095`, section 6).
    const offer = shownOffer(this._product(), this.atShop());
    if (offer === null || offer.price === null) {
      return null;
    }
    return formatMoney(offer.price, offer.currency, this._locale());
  });

  /**
   * The price mark's own sentence, composed, or null when the row carries none.
   *
   * "Not sold here" for a product the shop of the read has no price for (velista
   * `0139`, section 1), and "No price here" at a shop that prices nothing on this
   * basket (velista `0153`), each with the cheapest price elsewhere after it when
   * there is one. That amount is the mark's and never the row's price. One
   * string, so a line break never falls between a price and its shop.
   */
  protected readonly markCaption = computed<string | null>(() => {
    const mark = this.priceMark();
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
      mark.kind === 'noPriceHere'
        ? 'basket.row.noPriceHere'
        : 'basket.row.notSoldHere',
      undefined,
      locale
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

  /**
   * What the shop's shelf says about this row, as a key, or null (velista `0102`):
   * "Not available at this shop" when its product is known missing there.
   */
  protected readonly shelfCaption = computed<string | null>(() =>
    this.shelf() === null ? null : 'basket.shelf.unavailable'
  );

  /**
   * "Bought here 2 of the last 6 times", or null (velista `0104`).
   *
   * Pluralised on the number of purchases counted, and never naming the shop:
   * "here" is the chain, so a purchase at any shop of it counted.
   */
  protected readonly usualCaption = computed(() => {
    const usual = this.usual();
    return usual === null
      ? null
      : this._translator.t(
          'basket.view.usual.here',
          undefined,
          this._locale(),
          {
            count: usual.of,
            bought: usual.bought,
          }
        );
  });

  /**
   * The sentence under the number: the row's, or this household's share of it.
   *
   * One slot and not two, because they answer the same question about the same
   * number and a row that drew both would say it twice. Under a list heading the
   * entry answers for itself, and it can: backend `0136` gives an entry its own
   * state and its own numbers, so "2 of 6" under a household is that household's
   * and needs no sentence explaining which number it is.
   */
  protected readonly progressCaption = computed(() =>
    quantityCaption(
      this.entry() ?? this.row(),
      this._translator,
      this._locale()
    )
  );

  protected readonly touched = computed(() =>
    touchedCaption(
      this.row(),
      this.people(),
      this._translator,
      this._locale(),
      this.meId(),
      this.ownName()
    )
  );

  /**
   * The lists that ask for this row, after its price (velista `0139`, section 1),
   * or null.
   *
   * Null under a list heading, which is velista `0077` section 4.1: the heading
   * already names the list, and the row there is that list's share. A list the
   * reader was not served is counted in words, "and 1 more list", and never named.
   */
  protected readonly listsText = computed(() =>
    this.entry() !== null
      ? null
      : listsCaption(this.row(), this.lists(), this._translator, this._locale())
  );

  /**
   * The accessible name of the row's button.
   *
   * Everything the row shows, in one string, because the visual layout puts the
   * quantity and the attribution on separate lines and a reader moving by button
   * would otherwise hear only the content.
   *
   * **The state, in words, and never by colour alone** (velista `0052`,
   * section 6.3). It is the same pair the glyph's own name draws from, so a reader
   * who hears the row and one who sees it are told the same thing.
   */
  protected readonly label = computed(() => {
    const parts = [
      this.name(),
      this._translator.t(
        STATES_ON_STATUS[this.statusGlyph()],
        undefined,
        this._locale(),
        { name: this.name() }
      ),
      this.progressCaption(),
      // The price, the lists and what the row says about the shop, each a
      // sentence of its own, in the order the caption draws them: a mark is words
      // beside a number and a reader who hears the row hears it (velista `0078`,
      // section 7).
      this.productPrice() ?? '',
      this.listsText() ?? '',
      this.markCaption() ?? '',
      // A cheaper product of the same group, said as it is drawn.
      this.groupCaption() ?? '',
      // What the shop is known not to have, said as it is drawn (velista `0102`).
      this._shelfLabel(),
      this.touched() ?? '',
      // How often it was bought here, said as it is drawn (velista `0104`).
      this.usualCaption() ?? '',
      // Said with the rest of the row, because a reader moving by button hears
      // this string and nothing else about it. On a skipped row it repeats what
      // the glyph's own name already says, which is deliberate: the two are read
      // in different ways and neither should be the only carrier.
      this.skipCaption() ?? '',
      // Announced with the rest of the row rather than only drawn, because a reader
      // moving by button hears this string and nothing else about the row.
      this.row().awaitingApproval
        ? this._translator.t('basket.units.pending', undefined, this._locale())
        : '',
      // "Milk, new on the list" (velista `0093`, section 3). Inside the row's
      // one name rather than a second focus stop: the tag is four letters, and
      // a control beside every changed row would be a dozen extra Tab presses
      // down a basket for a thing nobody can press.
      this._markLabel(),
    ];
    return parts.filter((part) => part !== '').join('. ');
  });

  /** The shelf caption, said in full, or the empty string on a row with none. */
  private _shelfLabel(): string {
    const key = this.shelfCaption();
    return key === null
      ? ''
      : this._translator.t(key, undefined, this._locale());
  }

  /** The tag, said in full, or the empty string on a row with no mark. */
  private _markLabel(): string {
    const mark = this.row().mark;
    if (mark !== 'ADDED' && mark !== 'CHANGED') {
      return '';
    }
    return this._translator.t(
      mark === 'ADDED' ? 'basket.mark.addedLabel' : 'basket.mark.changedLabel',
      undefined,
      this._locale(),
      { name: this.name() }
    );
  }
}
