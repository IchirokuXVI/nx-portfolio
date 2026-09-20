import type {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
} from '../enums/basket.enums';
import type { GeneratedListStatus } from '../enums/generated-list.enums';
import type {
  LineApprovalStatus,
  SettlementOutcome,
} from '../enums/list.enums';
import type { ItemView, LocalizedText } from './catalog.messages';
import type { GeneratedListParticipantView } from './generated-list-sharing.messages';

/**
 * The basket, read rather than stored (plan 0136).
 *
 * A basket holds a header, a rule saying which lists it covers, and the people
 * on it. Everything below is computed from `list_lines` and `line_settlements`
 * on every request, so **no field here has a column behind it**. That is the one
 * rule the whole file is shaped by: `asked`, `bought`, `left`, the state, the
 * order and the progress are all derived, and a cache of any of them would be
 * the copy this plan exists to remove.
 *
 * ## Why a row is not a line
 *
 * One thing to buy can be asked for by two households: "Milk" on the flat's list
 * and on the parents' list is one thing to pick off one shelf. So a **row** is a
 * group of covered list lines that share a merge key, and each line inside it is
 * an **entry**. A write addresses the row and lands on its entries.
 *
 * ## Why the row key is a line id
 *
 * A group has no identity of its own, because it is recomputed. Its anchor's
 * line id is the closest thing to a stable name, and any entry's id addresses
 * the row on a write: a row whose anchor was just bought to zero must not turn
 * the next tap on the same row into a not found.
 */

/**
 * The bounds the basket read holds itself to.
 *
 * `GENERATED_LIST_LIMITS.maxLines` is gone with the run that enforced it: a
 * basket composes nothing, so it cannot refuse lines that arrive on a covered
 * list afterwards. What is left is a guard against a pathological account, and
 * it is applied to the answer rather than to anybody's data.
 */
export const BASKET_LIMITS = {
  /** Rows one read answers. Past it the read says `truncated` (section 3.6). */
  maxRows: 1000,
} as const;

/**
 * How long back the read looks for a `LIVE` basket's current session.
 *
 * A `LIVE` basket never ends, so "what has been bought" cannot mean "everything
 * ever": the answer is the current shopping session, and a session is found by
 * gaps between purchases. This bounds the scan.
 *
 * **A session longer than seven days is cut at this edge**, which is accepted:
 * a single trip through a shop is hours, and a scan with no bound would grow
 * without limit on an account that has shopped for years.
 */
export const BASKET_SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One list a row's entries come from, named for a caption.
 *
 * Served only for the lists the **reader** holds `WRITE` on (section 3.4), so a
 * guest receives an empty array and a registered co shopper receives the ones
 * they write themselves.
 */
export interface BasketListRef {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
}

/** One covered list line inside a row (plan 0130, section 4). */
export interface BasketRowEntryView {
  lineId: string;
  /** Present only when the reader was served this list's ref (0130, section 6). */
  listId?: string;
  left: number;
  bought: number;
  /** This entry's own state, by the table of 0130 section 4. Never `REMOVED`. */
  state: BasketRowState;
  /** `APPROVED` or `PENDING`. A `REJECTED` line is not covered, so never a row. */
  approvalStatus: LineApprovalStatus;
  /**
   * Whether a change of demand on this entry is allowed, by the rule of `0131`
   * asked of the basket's **OWNER**.
   *
   * Served because no client can compute it: a reader never learns the owner's
   * permissions, and a guest has none of their own to ask about.
   */
  demandEditable: boolean;
}

/** One thing to buy, however many households asked for it. */
export interface BasketRowView {
  /** The anchor's list line id. Any entry's id addresses the row on a write. */
  rowKey: string;
  /** The anchor's text. */
  content: string;
  left: number;
  bought: number;
  /** `bought + left`, computed, never stored. */
  asked: number;
  state: BasketRowState;
  note: BasketRowNote | null;
  /** When the fact behind `note` happened, on the server clock. Null exactly when `note` is. */
  noteAt: string | null;
  mark: BasketRowMark | null;
  /** At least one entry is `PENDING`. Named apart from the `pending` count below. */
  awaitingApproval: boolean;
  /** The union of the entries' product sets, first seen order, anchor first. */
  optionIds: string[];
  /** The participant behind the newest standing act of this basket on this row. */
  touchedBy: string | null;
  touchedAt: string | null;
  /** Oldest first, the anchor at index 0. */
  entries: BasketRowEntryView[];
}

/** The three numbers a basket card draws, and the total they are of. */
export interface BasketProgress {
  done: number;
  unavailable: number;
  /** Rows that are not `REMOVED`. */
  total: number;
  /** `total - done - unavailable`. */
  pending: number;
}

/** A basket, as core answers it (plan 0136, section 2). */
export interface BasketView {
  id: string;
  kind: BasketKind;
  /** Always null for `LIVE`: the permanent basket has no name to give. */
  name: string | null;
  status: GeneratedListStatus;
  /** The column is still called `generatedAt` until plan 0144. */
  createdAt: string;
  rows: BasketRowView[];
  /** The covered lists this reader writes themselves, and no others. */
  lists: BasketListRef[];
  participants: GeneratedListParticipantView[];
  me: GeneratedListParticipantView;
  progress: BasketProgress;
  /** The read hit {@link BASKET_LIMITS.maxRows} and the rows were cut. */
  truncated: boolean;
  /**
   * Whether this reader is served shop addresses (section 2).
   *
   * The owner and every named person are; a link visitor, guest or registered,
   * is served chains and scopes and never an address. The shops are the owner's
   * profile rather than a fact about any list, so the per list rule of `0130`
   * section 6 cannot answer it and this flag does.
   */
  servesLocations: boolean;
}

/**
 * The three numbers the home card draws, with no rows behind them.
 *
 * Its own read rather than `BasketView` with the rows dropped, because the card
 * must not pay for a thousand rows and a catalog composition to show three
 * numbers.
 */
export interface BasketSummaryView {
  id: string;
  kind: BasketKind;
  progress: BasketProgress;
}

/**
 * The basket as the **gateway** answers it: core's view, plus the products it
 * names.
 *
 * Composed rather than stored: core holds the basket and references products by
 * an opaque `itemId`, catalog holds the products, and neither can answer this
 * alone. The names travel with the basket because every catalog route needs an
 * account and the reader here may be a guest who has none.
 *
 * A product an id no longer names is simply absent, because a basket outlives
 * the catalog it was read against. The client draws such a row with no product
 * caption rather than treating the page as broken.
 */
export interface BasketResult extends BasketView {
  /**
   * Every product named by a row's `optionIds`, deduplicated.
   *
   * Each carries `bestOffer`, the cheapest price at the scopes the basket's
   * profile resolves to, and null wherever nothing was harvested at them. The
   * scope is the **owner's** and never the reader's: a registered participant's
   * own profile is refused as firmly as a guest's absent one.
   *
   * A `GENERATED` basket prices against its stored `pricingProfileId`. A `LIVE`
   * basket stores none and resolves the owner's default profile on every
   * request, because a basket that never ends cannot freeze a profile its owner
   * goes on editing.
   */
  products: ItemView[];
  /**
   * What each scope an offer names **is**: one entry per scope id that appears
   * on any `bestOffer` above, and no others (plan 0066, section 4).
   *
   * A price scope is the set of stores a chain charges the same in. It is the
   * right key for a price and not something to show a person, so this is how
   * "0.95 EUR at scope 3f2a…" becomes "0.95 EUR at Mercadona, Ronda de los
   * Tejares". Empty when nothing is priced, and empty too when the gateway could
   * not name the scopes it priced against.
   */
  scopes: BasketPriceScopeView[];
}

/**
 * One price scope, described for a person (plan 0066, section 4).
 *
 * The chain reaches every participant, guests included, because a chain's name
 * is a product fact of the same class as the price it explains. The **shops**
 * reach only a reader `servesLocations` is true for: a street address is the
 * owner's geography, and it is an empty array for everybody else, which is the
 * same shape a scope whose stores we cannot place answers with. There is
 * deliberately no third state for the client to branch on.
 */
export interface BasketPriceScopeView {
  priceScopeId: string;
  supermarketId: string;
  /** The chain, both locales, resolved by the client. */
  supermarketName: LocalizedText;
  /**
   * The shops of this scope. Empty for a reader the server withheld them from,
   * and empty for a scope catalog cannot place; both draw the chain alone.
   */
  locations: BasketScopeLocationView[];
}

/** One shop of a scope, as much of it as the pick sheet draws. */
export interface BasketScopeLocationView {
  supermarketLocationId: string;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}

// --- Requests ---------------------------------------------------------------

/**
 * Read a basket as the participant the gateway's guard resolved.
 *
 * No `userId`: the participant id is the whole credential's worth of identity,
 * and an owner reading their own basket arrives here as their own participant
 * row like everybody else.
 */
export interface GetBasketRequest {
  basketId: string;
  participantId: string;
}

/** The caller's permanent basket, created the first time they ask for it. */
export interface GetLiveBasketRequest {
  userId: string;
}

/**
 * Record what happened to a row at the shelf (plan 0136, section 5.1).
 *
 * The units are **not** capped at `left`: buying three of a line that says two
 * records three, because the extra unit is real and belongs in the consumption
 * history. The double tap a cap used to guard against is caught by
 * {@link SettleBasketRowRequest.from} instead, since the second tap still names
 * the `left` the first one changed.
 */
export interface SettleBasketRowRequest {
  basketId: string;
  participantId: string;
  rowKey: string;
  outcome: SettlementOutcome;
  /** Required for `BOUGHT`, refused for `NOT_AVAILABLE`. */
  quantity?: number;
  /** The row's `left` as the client drew it. Refused with `stale_quantity`. */
  from: number;
  /** Must be one of the row's `optionIds`. */
  itemId?: string;
  /** Which entry got what. Derived oldest first when absent. */
  allocations?: BasketAllocationEntry[];
}

/** One line's share of a settle, when the caller allocates by hand. */
export interface BasketAllocationEntry {
  lineId: string;
  quantity: number;
}

/**
 * Take part of a row back (plan 0136, section 5.2).
 *
 * Two targets rather than two routes, because they are one gesture with two
 * things it can be aimed at: the units somebody said they bought, or the close
 * somebody said the shop could not supply. A close holds no units, so it has no
 * number to take back.
 */
export type RevertBasketRowRequest =
  | {
      basketId: string;
      participantId: string;
      rowKey: string;
      target: 'UNITS';
      units: number;
      /** The row's `bought` as the client drew it. */
      from: number;
    }
  | {
      basketId: string;
      participantId: string;
      rowKey: string;
      target: 'CLOSE';
    };

/**
 * Change what one household asks for, from the basket (plan 0136, section 5.3).
 *
 * The permission is `0131`'s demand rule asked of the basket's **owner**, never
 * of the actor: the owner delegated shopping, not permission.
 */
export interface SetBasketRowDemandRequest {
  basketId: string;
  participantId: string;
  rowKey: string;
  /** Required when the row holds more than one entry. */
  lineId?: string;
  /** What that list asks for from now on. */
  quantity: number;
  /** That entry's `left` as the client drew it. */
  from: number;
}

/**
 * Put a line on one of the basket's lists (plan 0136, section 5.4).
 *
 * `targetListId` is **required**: there is no line without a list any more, so
 * the guest composer of plan 0055 has nowhere to write and the route is account
 * participants only.
 */
export interface AddBasketLineRequest {
  basketId: string;
  participantId: string;
  /** The actor's own account. A guest reaches this route and is refused. */
  userId: string;
  targetListId: string;
  content: string;
  quantity?: number;
  itemIds?: string[];
}

/** Rename every entry of a row, on each of their lists (plan 0113's rule). */
export interface RenameBasketRowRequest {
  basketId: string;
  participantId: string;
  userId: string;
  rowKey: string;
  content: string;
  /** Agree to the fold a rename onto an existing name would cause. */
  confirmMerge?: boolean;
}

/** Where a search inside this basket is priced. */
export interface BasketSearchScope {
  ownerUserId: string;
  /** Null on a basket composed before plan 0078, which stays unpriced. */
  profileId: string | null;
}

// --- Results ----------------------------------------------------------------

/**
 * What every write on a row answers.
 *
 * One shape for all five, because a client redraws one row after any of them.
 * `row` is never null: a settle that takes `left` to zero leaves the row in the
 * view as `DONE`, since the purchase it just wrote is in scope.
 */
export interface BasketRowResult {
  /** The row as it now stands, under whatever `rowKey` it now has. */
  row: BasketRowView;
  progress: BasketProgress;
  /** Set by a revert: entries whose line was deleted since, so no units went back. */
  skippedCount?: number;
  /**
   * Set by a rename that folded this row into another: the key the request used.
   *
   * The client drops that row and redraws {@link row} without reading the basket
   * again.
   */
  replacedRowKey?: string;
}

/**
 * The subjects core answers for a basket.
 *
 * `basket.searchScope` is here rather than on the sharing patterns because it is
 * a question about the basket's pricing and has nothing to do with sharing.
 */
export const BASKET_PATTERNS = {
  /** The caller's permanent basket, created the first time (section 4). */
  live: 'basket.live',
  /** The same basket with the rows dropped, for the home card. */
  liveSummary: 'basket.live.summary',
  get: 'basket.get',
  rowSettle: 'basket.row.settle',
  rowRevert: 'basket.row.revert',
  rowDemand: 'basket.row.demand',
  rowRename: 'basket.row.rename',
  lineAdd: 'basket.line.add',
  searchScope: 'basket.searchScope',
} as const;
