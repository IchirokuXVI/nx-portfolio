import type { LineIndicator } from './list-view';
import type { SettlementOutcome } from './enums';

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
  /** The indicators, so the sheet's header agrees with the row it opened from. */
  readonly indicators: readonly LineIndicator[];
  /** Whether a settle is in flight, which disables both buttons and says so. */
  readonly busy: boolean;
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
   * The reader's other lists that carry this item, or something close enough.
   *
   * An indicator rather than a link, per section 5.3, and filtered to lists the
   * reader may actually read. Empty draws nothing at all: "no other list has this"
   * is not information anybody came here for.
   */
  readonly alsoOn: readonly string[];
  /** Whether this caller may edit the product set and delete the line. */
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}
