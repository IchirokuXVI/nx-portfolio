import type { SettlementOutcome, TripKind } from '../enums/list.enums';
import type { Paginated } from '../pagination';

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

/** The subjects of the history reads. Both need an account and no more. */
export const PURCHASE_PATTERNS = {
  /** A page of history entries, newest first (plan 0142, section 3). */
  listSessions: 'purchase.listSessions',
  /** The rows of one entry, in the order they were bought (section 4). */
  listSessionRows: 'purchase.listSessionRows',
} as const;

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
  /** Distinct list lines the entry touched. */
  lineCount: number;
  /** Of those, the ones with at least one unit bought. */
  boughtLineCount: number;
  /**
   * What the entry cost: the sum over its standing `BOUGHT` purchases that
   * carry a price, of the price of one unit times the units.
   *
   * **Null and never zero when no purchase carries a price** (section 3.3).
   * Until plan 0143 fills `pricePaidCents` that is every entry, which is a
   * correct answer and needs no flag of its own.
   */
  spentCents: number | null;
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
 * **One row per `(lineId, itemId, pricePaidCents)`.** Three partial settles of
 * one milk at one price are one row of three. The same milk at two prices,
 * which is two shops in one session, is two rows: a history that averaged them
 * would report a price nobody paid.
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
  /** What one unit cost, or null while nothing records it. */
  pricePaidCents: number | null;
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
