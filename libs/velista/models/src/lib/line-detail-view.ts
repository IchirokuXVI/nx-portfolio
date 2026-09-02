import type { SettlementOutcome } from './enums';
import type { LineIndicator } from './list-view';

/**
 * What the detail sheet and the line page draw, as plain data (velista plan
 * 0043, sections 5.1 and 5.3).
 *
 * Rule D1 again, one screen further in: the container reads the stores, computes
 * the two things here that are genuinely computed, and hands these down. Both
 * screens answer questions about **history**, which is the reason they exist at
 * all and the reason they are separate types: the sheet answers the question you
 * have standing in the kitchen, and the page answers everything else.
 */

/** How many purchases it takes before an interval is an estimate and not a coincidence. */
export const ESTIMATE_MIN_PURCHASES = 3;

/**
 * The last purchase count that still reads as a phrase rather than a number
 * (velista plan 0047, section 5).
 *
 * Three to six inclusive gives "every few weeks"; seven and above gives the days. The
 * floor at {@link ESTIMATE_MIN_PURCHASES} says when there is anything to say at all,
 * and this says when what there is to say is precise enough to be a number.
 */
export const ESTIMATE_ROUGH_TO = 6;

/**
 * One row of either history section (section 5.3).
 *
 * The two sections draw the same row and differ only in what they are a history
 * **of**, which is why one type serves both. `listName` is what separates them on
 * screen: it is null on "on this list", where every row is this list by
 * construction and repeating its name in every row would be noise, and set on
 * "everywhere you shop", where the whole point of the section is that the rows
 * come from different places.
 */
export interface SettlementRowVm {
  readonly id: string;
  readonly outcome: SettlementOutcome;
  /** Units bought. Zero for a trip that found nothing, which the row draws as words. */
  readonly quantity: number;
  /**
   * Who did it, already resolved: their name, `you` for the reader, or null.
   *
   * Null covers two different things on purpose, and neither is worth a distinct
   * treatment. A settlement can carry no user at all, because a guest with no
   * account settled it from a shared basket (backend plan 0051), and a name can
   * simply fail to resolve. Both render the neutral phrase, because an id is not
   * a person to somebody reading their own buy history.
   */
  readonly who: string | null;
  /** True when `who` is the reader, so the row can say "you" without comparing ids. */
  readonly mine: boolean;
  readonly at: Date;
  /**
   * The same instant as words, in the reader's language.
   *
   * Formatted in the selector rather than by a pipe in the template, which is this
   * app's convention for every date it draws: Angular's `DatePipe` needs
   * `registerLocaleData` per locale and a `LOCALE_ID` this app does not set, because
   * the language is runtime state rather than the shell's build time locale.
   *
   * {@link at} stays beside it, because ordering and grouping are done on the instant
   * and a formatted string sorts alphabetically.
   */
  readonly when: string;
  /**
   * Which list this settlement was on, for the cross list section. Null on the
   * per line one.
   */
  readonly listName: string | null;
  /**
   * Whether this settlement was taken back (luna `0054`, section 3.3).
   *
   * A reverted row **stays in the history, marked**, and does not disappear: the whole
   * reason to open the pane is to reconcile two people's trips, and a purchase that was
   * taken back is part of that. The screen qualifies the sentence quietly and never
   * strikes it through, which would read as deleted rather than as reversed.
   */
  readonly reverted: boolean;
}

/** One product on a line, as a removable chip. */
export interface LineItemChipVm {
  readonly itemId: string;
  /**
   * The product's name, or null while the catalog has not answered yet.
   *
   * A line stores product **ids** and the catalog is a different service, so a
   * line page opened cold knows what it carries before it knows what those are
   * called. Null draws a resting chip rather than an id, which is the same rule
   * every other name on this screen follows.
   */
  readonly name: string | null;
  readonly brand: string | null;
  /** False while a removal is in flight, so the chip cannot be pressed twice. */
  readonly removable: boolean;
}

/**
 * How often the household gets through this, when that can honestly be said.
 *
 * **Absent, not vague, below {@link ESTIMATE_MIN_PURCHASES}.** Two purchases
 * define exactly one interval, which is not an estimate but a coincidence, and
 * the entire value of this number is that somebody trusts it enough not to check
 * the cupboard. A confident wrong date is worse than an empty field here
 * (backend plan 0047, section 6.3).
 */
export interface ConsumptionEstimateVm {
  /**
   * The **median** interval in days, never the mean.
   *
   * One stock up trip distorts a mean permanently and moves a median by one
   * position.
   */
  readonly medianDays: number;
  /** How many purchases it was computed from, so the copy can hedge below six. */
  readonly fromPurchases: number;
  /**
   * Whether to give the phrase rather than the number (velista plan 0047, section 5).
   *
   * True from three purchases up to and including {@link ESTIMATE_ROUGH_TO}, where the
   * copy reads "every few weeks" rather than "every 11 days". Plan `0043` section 9
   * and backend `0047` section 9 both left this as a leaning; it is decided here, in
   * favour of the phrase, because a median computed from three intervals is a number
   * with no business being one.
   *
   * On the view model rather than compared in a template, so the sheet and the page
   * cannot answer it differently: they draw the same estimate, and one saying "every
   * 11 days" over the other saying "every few weeks" would cost the number the only
   * thing it has, which is that somebody trusts it.
   */
  readonly rough: boolean;
}

/**
 * The sheet that opens on tapping a row (section 5.1).
 *
 * It answers the question you have standing in the kitchen and nothing more: what
 * this line carries, when it was last bought and how many, roughly how long until
 * it runs out, and a way through to everything else.
 */
export interface LineDetailVm {
  readonly lineId: string;
  readonly content: string;
  readonly quantity: number;
  /**
   * What the line stands for, in one phrase: the product, or how many of them.
   *
   * A key and its arguments rather than an assembled string, because "3 products"
   * and "not linked to a product" are different sentences in every language and
   * neither of them is a name.
   */
  readonly productsKey: string;
  readonly productsArgs: Readonly<Record<string, string | number>>;
  /**
   * Whether the product names could not be read (velista plan 0047, section 1.2).
   *
   * Separate from having no products, and the separation is the defect this field was
   * added to fix: a screen that drew "No products yet" because a lookup failed was
   * telling the reader the opposite of the truth about their own data. A failure draws
   * the count with no names and says the names could not be loaded; it never says the
   * line is empty.
   */
  readonly namesUnavailable: boolean;
  /**
   * The most recent purchase, or null when there has never been one.
   *
   * Null is a first class case rather than an empty row: a line nobody has ever
   * bought has no history to summarise, and a "last bought: never" row is a
   * sentence about an absence.
   */
  readonly lastPurchase: SettlementRowVm | null;
  /** Null below three purchases, per {@link ConsumptionEstimateVm}. */
  readonly estimate: ConsumptionEstimateVm | null;
  /**
   * The products the "I bought this" step may ask between, in the order they are
   * offered.
   *
   * Empty on a free text line and on a line with one product, and those two are
   * the same answer here: there is nothing to ask. With more than one, the sheet
   * asks which, preselecting the last one bought (backend plan 0047, section 3.2).
   */
  readonly choices: readonly LineItemChipVm[];
  /** Which of {@link choices} to preselect: the last one bought, else the first. */
  readonly preselectedItemId: string | null;
  /**
   * Whether this caller may record a purchase or a missing product at all.
   *
   * `DECIDE`, the same permission the reel follows, because both say what the
   * household now has. A reader gets the sheet with its history and neither
   * button, which is the honest shape: knowing is not deciding.
   */
  readonly canSettle: boolean;
  /**
   * The indicators, so the sheet's header agrees with the row it opened from.
   *
   * Drawn since velista plan `0047` section 5. It was modelled and passed `[]`, which
   * made a row showing "bought" open a sheet showing nothing: two answers to one
   * question, on two surfaces a tap apart.
   */
  readonly indicators: readonly LineIndicator[];
  /**
   * Who is out buying this, for the `claimed` indicator, or null when nobody is.
   *
   * A name and not an id, resolved by the container exactly as `LineRowVm.claimedBy`
   * is and for the header's sake: the row names the person, so a header drawing the
   * anonymous phrase beside it would be the disagreement {@link indicators} was drawn
   * to end, one word further in.
   */
  readonly claimedBy: string | null;
  /** Whether a settle is in flight, which disables both buttons and says so. */
  readonly busy: boolean;
}

/**
 * How many other lists one "also on" answer may name.
 *
 * The server's own ceiling (`LIST_HOLDING_ITEM_LIMITS.maxLists`), restated here because
 * the client cannot import the backend contracts and the **fake** has to cap the same
 * way the server does: a development run that never reached the cap would leave the
 * "and more" caption unreachable, which is how a caption rots.
 *
 * It is not a page size. The read is deliberately uncapped by any cursor, because the
 * answer is a caption rather than a listing.
 */
export const ALSO_ON_MAX_LISTS = 20;

/**
 * Another list that still wants this product (backend plan 0053, section 3).
 *
 * A list and its zone, because a name alone does not locate it: two households can
 * both have a "Weekly shop", and the whole value of the indicator is knowing which
 * one already asks for this.
 */
export interface AlsoOnPlaceVm {
  readonly listId: string;
  readonly listName: string;
  readonly zoneName: string;
}

/**
 * Where else this product is wanted, when that has actually been asked
 * (velista plan 0047, section 5).
 *
 * The type exists to make one distinction unrepresentable: **the whole value is null
 * when nobody asked**, and only a real answer is a value. Before backend plan 0053
 * section 3 there was no query behind this, so the page derived it from whatever lists
 * the session happened to hold, which under reported by construction and drew nothing
 * when it came back empty. "Nobody asked" and "no other list has this" were one
 * picture, and they are opposite answers.
 */
export interface AlsoOnVm {
  /**
   * The lists, already filtered to ones this reader may see, capped by the server.
   *
   * **Empty is a real answer** and means no other readable list wants this. The page
   * still draws nothing for it, because "no other list has this" is not information
   * anybody came here for; that is a rendering choice about a known answer, which is a
   * different thing from having no answer.
   */
  readonly places: readonly AlsoOnPlaceVm[];
  /** Whether the server's cap cut the answer short, so the caption can say so. */
  readonly hasMore: boolean;
}

/** Which of the line page's two histories a section is. */
export type HistoryScope = 'thisList' | 'everywhere';

/**
 * One history section on the line page (section 5.3).
 *
 * `loading` is on the section rather than on the page because the two arrive
 * independently: the per line history needs only the line, and the cross list one
 * needs the products first. A page that waited for both would show nothing while
 * the half it already had sat ready.
 */
export interface HistorySectionVm {
  readonly scope: HistoryScope;
  readonly rows: readonly SettlementRowVm[];
  readonly loading: boolean;
  /** Whether there is more to fetch, which the section offers rather than assumes. */
  readonly hasMore: boolean;
}

/**
 * The whole line page (section 5.3).
 *
 * Its own route, so it can be linked to and reached from a search later, which is
 * the reason it is a page and not a second sheet.
 */
export interface LinePageVm {
  readonly lineId: string;
  readonly content: string;
  readonly quantity: number;
  /** "on Weekly shop, in Flat 3B", as parts, so the copy can order them. */
  readonly listName: string | null;
  readonly zoneName: string | null;
  readonly products: readonly LineItemChipVm[];
  /** Whether the product names could not be read, per `LineDetailVm.namesUnavailable`. */
  readonly namesUnavailable: boolean;
  readonly estimate: ConsumptionEstimateVm | null;
  readonly lastPurchase: SettlementRowVm | null;
  readonly thisList: HistorySectionVm;
  /**
   * The cross list history, or **null** on a line with no products.
   *
   * Null is absent rather than empty, and the distinction is the section's whole
   * meaning (section 5.3). "Everywhere you shop" is keyed on the line's products,
   * so a free text line cannot have one; drawing it empty would say the reader has
   * never bought this anywhere, when in fact nobody has said what "this" is. Which
   * is the argument for the composer's suggestions.
   */
  readonly everywhere: HistorySectionVm | null;
  /**
   * The reader's other lists that still want this item, or **null when nobody has
   * asked** (velista plan 0047, section 5).
   *
   * An indicator rather than a link, per section 5.3, and filtered by the server to
   * lists the reader may actually read at request time.
   *
   * Null now means what it says rather than being the permanent state: it is a line
   * with no product, which has no question to ask, or an answer that has not arrived
   * or did not come back. Backend plan `0053` section 3 is the query behind a real
   * one. **Drawn only when the answer is known to be complete**, and omitted rather
   * than drawn empty when it is not.
   *
   * An empty {@link AlsoOnVm.places} still draws nothing, because "no other list has
   * this" is not information anybody came here for. That is a rendering choice about a
   * known answer, and a different absence from this one; the two must not be collapsed
   * again.
   */
  readonly alsoOn: AlsoOnVm | null;
  /** Whether this caller may edit the product set and delete the line. */
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

// --- Turning a settlement into a row ---------------------------------------

/**
 * A date, in the reader's language.
 *
 * `Intl` rather than Angular's `DatePipe`, which is `CommentRow`'s reason and this
 * app's convention: the pipe needs `registerLocaleData` per locale and a `LOCALE_ID`
 * this app does not set, because the language is the app's own runtime state rather
 * than the shell's build time locale. `Intl` reads the tag it is handed, which is
 * exactly the tag `RokuLocaleStore` is holding.
 *
 * A **date** and not a time, unlike the comment timestamps beside it, and the
 * difference is the subject: a history says which day the household bought something,
 * and the hour is noise nobody reading their own consumption has ever wanted.
 */
export function formatDay(at: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
  } catch {
    // An unrecognised tag, which `Intl` throws a `RangeError` for. The ISO date is
    // ugly and correct, and a history row with no date at all would be worse.
    return at.toISOString().slice(0, 10);
  }
}

/**
 * One settlement, ready to draw.
 *
 * `who` collapses three cases into what a person reads: the reader, somebody named, or
 * nobody. The last covers a settlement with no user at all, which is a guest settling
 * from a shared basket (backend plan 0051), and a name that simply would not resolve.
 * Both draw the neutral phrase, because an id is not a person to somebody reading their
 * own buy history.
 *
 * **Here rather than beside one of the screens that calls it**, since velista plan 0049
 * section 1.1: the line page, the detail sheet and the basket's own settlement history
 * all draw this row, and a history that read differently on two screens would cost the
 * only thing a history has. They resolve a name from different places, the zone's
 * members on one and the basket's participants on the other, which is exactly why
 * `nameOf` is a function the caller supplies rather than a lookup done in here.
 *
 * The settlement is taken **structurally** and not as `LineSettlement`, so a basket
 * line's history can be drawn without the basket screen importing a zone list's model
 * to satisfy a parameter.
 */
export function toSettlementRow(
  settlement: {
    readonly id: string;
    readonly outcome: SettlementOutcome;
    readonly quantity: number;
    readonly settledByUserId: string | null;
    readonly settledAt: Date;
    /** When it was taken back, if it was. Absent for a caller that cannot revert. */
    readonly revertedAt?: Date | null;
  },
  input: {
    nameOf: (userId: string) => string | null;
    callerUserId: string | null;
    locale: string;
  },
  listName: string | null
): SettlementRowVm {
  const mine =
    settlement.settledByUserId !== null &&
    settlement.settledByUserId === input.callerUserId;

  return {
    id: settlement.id,
    outcome: settlement.outcome,
    quantity: settlement.quantity,
    who: mine
      ? null
      : settlement.settledByUserId === null
        ? null
        : input.nameOf(settlement.settledByUserId),
    mine,
    at: settlement.settledAt,
    when: formatDay(settlement.settledAt, input.locale),
    listName,
    // Optional on the argument rather than required, so the two callers that build a
    // settlement shaped object by hand are not made to state a fact they do not have.
    reverted: (settlement.revertedAt ?? null) !== null,
  };
}
