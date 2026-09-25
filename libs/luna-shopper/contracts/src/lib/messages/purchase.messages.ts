import type { SettlementOutcome, TripKind } from '../enums/list.enums';
import type { Paginated } from '../pagination';
import type { BasketShopView } from './basket.messages';

/**
 * What one person bought, with or without a basket (plan 0142).
 *
 * The history of a person used to be the baskets they made, and a purchase used
 * to need a basket. Neither is true any more: the permanent basket is one row
 * that never ends, and a purchase can be made on the list page with no basket
 * at all (plan 0130, section 9). So somebody who never creates a basket has a
 * history of purchases and no basket to read it through.
 *
 * These are the shapes of that history. It is a read of `line_settlements` and
 * never of baskets: an entry is a basket the reader owns, or a **session**, a
 * run of purchases separated from the next by more than
 * `PURCHASE_SESSION_GAP_MS`, across lists and across baskets. Elapsed time and
 * never a calendar day, so no time zone is involved anywhere.
 *
 * ## Whose purchases (section 2)
 *
 * A purchase is the reader's by any of three routes: it was made through a
 * basket they own, by anybody; they settled it themselves on the list page; or
 * they settled it on somebody else's basket, as a participant carrying their
 * account. A purchase reachable by two routes is one purchase.
 *
 * ## What is never on the wire
 *
 * `settledByUserId`, `settledByParticipantId` and `basketId`. Who tapped is the
 * basket screen's business and is attributed there (section 5).
 */

/**
 * An amount of money, with the currency it is in (plan 0143, section 7).
 *
 * An amount with no currency is a number, and every sum over it is only honest
 * while every row happens to be in euros. So the two travel together or neither
 * is served: a null here is "nothing recorded a price", never "zero".
 */
export interface MoneyView {
  /** In the minor unit of {@link currency}. */
  cents: number;
  /** ISO 4217. */
  currency: string;
}

/** The subjects of the history reads. Both need an account and no more. */
export const PURCHASE_PATTERNS = {
  /** A page of history entries, newest first (plan 0142, section 3). */
  listSessions: 'purchase.listSessions',
  /** The rows of one entry, in the order they were bought (section 4). */
  listSessionRows: 'purchase.listSessionRows',
  /**
   * The shops the caller bought at in the last {@link RECENT_SHOP_DAYS} days,
   * newest first (plan 0164, section 4). Ids and dates only: the gateway names
   * the shops through catalog.
   */
  recentShops: 'purchase.recentShops',
} as const;

/**
 * How far back a shop counts as recent (plan 0164, section 4). A shop is recent
 * when the person marked something bought there within this many days, and
 * that is the only rule: no ranking by frequency and no minimum count.
 */
export const RECENT_SHOP_DAYS = 60;

/**
 * One entry of a person's history: a basket of theirs, or a session.
 *
 * Every number is derived on read. Nothing here is stored, so an entry cannot
 * drift from the purchases it counts.
 */
export interface PurchaseEntryView {
  /** The basket's id, or the id of the session's earliest settlement. */
  id: string;
  kind: TripKind;
  /** `BASKET` only. Null is "shown as its date". */
  name: string | null;
  /** `BASKET` only: the basket's status is `OPEN`. Always false for a session. */
  open: boolean;
  /** `BASKET`: `generatedAt`. `SESSION`: its earliest `settledAt`. */
  startedAt: string;
  /** The newest `settledAt` in the entry. */
  endedAt: string;
  /**
   * Distinct list lines this person settled in the entry, bought or not
   * available (plan 0159 names it; plan 0142 defines it).
   */
  settledLineCount: number;
  /** Of those, the ones with at least one unit bought, partly bought included. */
  anyBoughtLineCount: number;
  /**
   * The same value as {@link settledLineCount}, for one release.
   *
   * @deprecated Read `settledLineCount`. Removed by backlog plan 0015.
   */
  lineCount: number;
  /**
   * The same value as {@link anyBoughtLineCount}, for one release.
   *
   * @deprecated Read `anyBoughtLineCount`. Removed by backlog plan 0015.
   */
  boughtLineCount: number;
  /**
   * What the entry cost: the sum over its standing `BOUGHT` purchases that
   * carry a price, of the price of one unit times the units.
   *
   * **Null and never zero when no purchase carries a price** (section 3.3),
   * which is a correct answer and needs no flag of its own.
   *
   * **Null also when the entry's priced rows carry two currencies** (plan 0143,
   * section 7): two shops in two countries in one session have no total, every
   * row still says what it cost, and {@link unpricedCount} is unchanged,
   * because it counts rows with no price and not rows that refuse to add up.
   */
  spent: MoneyView | null;
  /**
   * How many bought lines hold at least one purchase with no price.
   *
   * It is what lets a screen say "12.40, and 3 lines with no price" rather than
   * pass a partial sum off as a total.
   */
  unpricedCount: number;
}

/** A page of history entries, newest first. */
export interface PurchaseEntryPage {
  items: PurchaseEntryView[];
  nextCursor: string | null;
}

/**
 * One row of an entry: what was bought, how many, and at what price each
 * (section 4).
 *
 * **One row per `(lineId, itemId, pricePaidCents, pricePaidCurrency)`.** Three
 * partial settles of one milk at one price are one row of three. The same milk
 * at two prices, which is two shops in one session, is two rows: a history that
 * averaged them would report a price nobody paid.
 */
export interface PurchaseRowView {
  /** The earliest settlement folded into the row. The cursor's key. */
  id: string;
  /** The product bought, or null for a free text line. */
  itemId: string | null;
  /** `NOT_AVAILABLE` only when the line had nothing bought in this entry. */
  outcome: SettlementOutcome;
  /** Standing `BOUGHT` units. Zero for `NOT_AVAILABLE`. */
  quantity: number;
  /** What **one unit** cost, or null when nothing recorded it. */
  pricePaid: MoneyView | null;
  /**
   * The chain catchment the price was read at, and the one shop, when the
   * shopper named one and was served shops at all (plan 0143, section 6).
   *
   * This is the **one** place `supermarketLocationId` is served: the reader is
   * the person the purchase is about, or the owner whose basket was shopped. It
   * is withheld from every reader of a list, because a shop and a time say
   * where a named member of the household was standing at 18:40.
   */
  priceScopeId: string | null;
  supermarketLocationId: string | null;
  /** The row's earliest purchase. */
  settledAt: string;
  /**
   * Where it was bought, served only while the reader holds `READ` on that list
   * **now**, and null together otherwise (section 4).
   *
   * A reader who has left the household keeps the product, the quantity, the
   * date and the price, because it is still their purchase. They lose the five
   * fields below, because it is no longer their household's list.
   */
  lineId: string | null;
  listId: string | null;
  listName: string | null;
  zoneId: string | null;
  /** The line's text as it stands now. A soft deleted line still serves it. */
  content: string | null;
}

export type PurchaseRowPage = Paginated<PurchaseRowView>;

/** A page of the caller's history. The account comes from the token. */
export interface ListPurchaseSessionsRequest {
  userId: string;
  cursor?: string;
  limit?: number;
}

/** The rows of one entry of the caller's history. */
export interface ListPurchaseSessionRowsRequest {
  userId: string;
  kind: TripKind;
  entryId: string;
  cursor?: string;
  limit?: number;
}

/** The caller's recent shops. The account comes from the token. */
export interface ListRecentShopsRequest {
  userId: string;
}

/** One shop the caller bought at recently, as core knows it: an id and a date. */
export interface RecentShopIdView {
  /** The `supermarket_locations` id, opaque to core. */
  supermarketLocationId: string;
  /** The latest `settledAt` of a standing `BOUGHT` settle at the shop. */
  lastBoughtAt: string;
}

/** Core's answer, newest first. */
export interface RecentShopIdsView {
  shops: RecentShopIdView[];
}

/** One recent shop, named (plan 0164, section 4). */
export interface RecentShopView {
  /**
   * The shop view of plan 0163. `inProfile` is against the caller's default
   * pricing profile, and false for every shop when they have none.
   */
  shop: BasketShopView;
  lastBoughtAt: string;
}

/**
 * `GET /v1/account/recent-shops` (plan 0164, section 4): newest first, and a
 * shop that no longer exists is left out. Per person, never per household.
 */
export interface RecentShopsView {
  shops: RecentShopView[];
}
