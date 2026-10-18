import type {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  BasketRowUsualState,
  BasketStatus,
} from '../enums/basket.enums';
import type {
  LineApprovalStatus,
  SettlementOutcome,
} from '../enums/list.enums';
import type { Paginated } from '../pagination';
import type { UserUsernameView } from './auth.messages';
import type { BasketParticipantView } from './basket-sharing.messages';
import type {
  ItemSnapshot,
  ItemView,
  LocalizedText,
  LocationSectionNameView,
  PriceScopeChainView,
} from './catalog.messages';
import type { SettlePick, SettlementPaid } from './list.messages';

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
 * group of covered list lines that count as the same product, or that share a
 * normalized name when they hold no product (plan 0201). Each line inside it is
 * an **entry**.
 *
 * ## A line counts as one product
 *
 * The first of these that applies (plan 0201, section 1): the product of its
 * latest buy in this trip, its favourite, the cheapest of its products at the
 * scopes of the read, its first product, nothing. Only the cheapest needs a
 * price, and core holds none, so the gateway hands core a
 * {@link BasketLinePick} for each line that reaches that step.
 *
 * ## The row key is an address, and a write names its lines
 *
 * A group has no identity of its own, because it is recomputed, and two reads
 * at two shops can group the same lines differently. `rowKey` is the line id of
 * the anchor and addresses a page. Every write names the lines it means in
 * `lineIds`, and acts on those lines and no others.
 */

/**
 * The bounds the basket read holds itself to.
 *
 * `BASKET_LIMITS.maxLines` is gone with the run that enforced it: a
 * basket composes nothing, so it cannot refuse lines that arrive on a covered
 * list afterwards. What is left is a guard against a pathological account, and
 * it is applied to the answer rather than to anybody's data.
 */
export const BASKET_LIMITS = {
  /** Rows one read answers. Past it the read says `truncated` (section 3.6). */
  maxRows: 1000,
  /**
   * Lines one `basket.linesChanged` event states the entries of (plan 0204,
   * section 3). A write that names more sends the ids alone, and a client reads
   * the basket again, as it did for every write before that plan.
   */
  patchMaxLines: 25,
  maxSources: 100,
  nameMaxLength: 120,
  contentMaxLength: 500,
  maxQuantity: 9999,
  /**
   * How many products one line may offer to switch between (plan 0055,
   * section 7).
   *
   * The only unbounded array on a write plan 0055 makes reachable by anybody
   * holding a link, and therefore the one cap section 7 would otherwise have
   * left to be discovered. A basket line carries the options its origins
   * named and a composer suggestion carries a product group's members; neither
   * is anywhere near this, so it bounds the insert without bounding the feature.
   */
  maxOptions: 50,
  /** Lines one write on a row may name (plan 0201, section 4). */
  maxWriteLines: 100,
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
  /**
   * Present only when the reader was served this list's ref (0130, section 6).
   * The name of the list and its zone are in {@link BasketView.lists} under
   * this id, so an entry repeats neither (plan 0201, section 3).
   */
  listId?: string;
  /** The name of the line on its own list (plan 0201, section 3). */
  content: string;
  /** The products of the line, in the order the line holds them. */
  itemIds: string[];
  /** The favourite of the line (plan 0199), or null. */
  favoriteItemId: string | null;
  /**
   * Whether the **reader** may edit this line: they hold `WRITE` on its list
   * themselves. False for a guest, who holds no list.
   */
  canWrite: boolean;
  left: number;
  bought: number;
  /**
   * Units of this line bought lately through **another** basket, or through no
   * basket (plan 0188). Zero when there are none.
   *
   * A count and nothing else: it names no person, no account and no basket.
   * `bought` and `left` keep their meaning and count this basket's purchases.
   */
  boughtElsewhere: number;
  /** This entry's own state, by the table of 0130 section 4. Never `REMOVED`. */
  state: BasketRowState;
  /** `APPROVED` or `PENDING`. A `REJECTED` line is not covered, so never a row. */
  approvalStatus: LineApprovalStatus;
  /**
   * `list_lines.version` as this read found it (plan 0204, section 5).
   *
   * A client keeps it to drop a {@link BasketEntryPatch} that is older than the
   * entry it holds. It does not rise on every write: a skip and "they had none"
   * move no line, so two states of one entry can carry one version.
   */
  version: number;
  /** A standing skip of this basket on the line, inside its window (0137). */
  skipped: boolean;
  /**
   * The newest standing act of this basket on the line is "they had none", and
   * it still holds: until the trip is finished for a `GENERATED` basket, inside
   * the skip window for a `LIVE` one (plan 0137, section 4).
   */
  closed: boolean;
  /** The newest standing act of this basket on the line, or null. */
  act: BasketEntryAct | null;
  /** As {@link BasketEntryPatch.tripItemId}. */
  tripItemId: string | null;
  /**
   * Whether a change of demand on this entry is allowed, by the rule of `0131`
   * asked of the basket's **OWNER**.
   *
   * Served because no client can compute it: a reader never learns the owner's
   * permissions, and a guest has none of their own to ask about.
   */
  demandEditable: boolean;
}

/** What {@link BasketEntryAct.outcome} says for a skip, which is no settlement. */
export const BASKET_ACT_SKIPPED = 'SKIPPED';

/**
 * The newest thing a basket did to one line: a purchase, "they had none", or a
 * skip (plan 0204, section 2).
 *
 * `at` orders two acts and is drawn beside a row. **A client never compares it
 * with its own clock**: whether a skip or a close still holds is `skipped` and
 * `closed`, which the database decided.
 */
export interface BasketEntryAct {
  participantId: string | null;
  at: string;
  outcome: SettlementOutcome | typeof BASKET_ACT_SKIPPED;
}

/**
 * The state of one line as one basket reads it, on `basket.linesChanged` (plan
 * 0204, section 2).
 *
 * **Every value is absolute**, so applying a patch twice gives what applying it
 * once gives. It holds nothing that a guest of the basket does not already read
 * on {@link BasketRowEntryView}: no list, no zone, no name, no account and no
 * basket. It says nothing about a row either, because a row is a group and the
 * client rebuilds its own with `@portfolio/luna-shopper/basket-rules`.
 *
 * ## The order of two patches of one line
 *
 * `version` orders them when it differs. When it is equal, the two states
 * differ only in `skipped`, `closed` and `act`, and a patch is computed after
 * the commit of its write, so one read before a later skip can be published
 * after the patch of that skip. **A client that holds an entry of the same
 * version whose `skipped` or `closed` differs from the patch reads the basket
 * again** and does not apply it. The payload carries no order of its own.
 */
export interface BasketEntryPatch {
  lineId: string;
  /** `list_lines.version` after the write. */
  version: number;
  left: number;
  bought: number;
  boughtElsewhere: number;
  state: BasketRowState;
  approvalStatus: LineApprovalStatus;
  skipped: boolean;
  closed: boolean;
  act: BasketEntryAct | null;
  /**
   * The product of the latest standing buy of this line through this basket in
   * its trip, or null (plan 0201, section 1; plan 0204, section 7).
   *
   * A line counts as this product while it is set, so a buy that names another
   * product than the row's moves the line to another row. **A client reads the
   * basket again when this differs from the `productId` of the row that holds
   * the line.** No patch can say which row the line is in now.
   */
  tripItemId: string | null;
}

/** One thing to buy, however many households asked for it. */
export interface BasketRowView {
  /**
   * The anchor's list line id. An address for a page, not an identity: another
   * read can hand the same lines out under another key (plan 0201, section 3).
   */
  rowKey: string;
  /**
   * The anchor's text. A row with a product is named by the catalog, and this
   * is what a client draws when the catalog could not name it.
   */
  content: string;
  /**
   * The product every entry of this row counts as, or null for a row whose
   * lines hold no product (plan 0201, section 2). Always null on a `REMOVED`
   * row.
   */
  productId: string | null;
  left: number;
  bought: number;
  /** `bought + left`, computed, never stored. */
  asked: number;
  /**
   * The sum of the entries' `boughtElsewhere` (plan 0188): units somebody bought
   * lately through another basket or through none. Zero when there are none.
   *
   * It is in neither `bought` nor `asked`, which count this basket alone. A row
   * with nothing left and nothing bought here is `DONE` when this is above
   * zero, and `note` then says `BOUGHT_ON_ANOTHER_BASKET`.
   */
  boughtElsewhere: number;
  state: BasketRowState;
  note: BasketRowNote | null;
  /** When the fact behind `note` happened, on the server clock. Null exactly when `note` is. */
  noteAt: string | null;
  mark: BasketRowMark | null;
  /** At least one entry is `PENDING`. Named apart from the `pending` count below. */
  awaitingApproval: boolean;
  /** The participant behind the newest standing act of this basket on this row. */
  touchedBy: string | null;
  touchedAt: string | null;
  /** Oldest first, the anchor at index 0. */
  entries: BasketRowEntryView[];
  /**
   * How often this row's lines were bought at the read's chain, lately (plan
   * 0165).
   *
   * Null when the read has no shop, and null on the row a write answers,
   * because a write is not made at a chain a reader chose. Counts only: it never
   * names a person, a time, or any shop or chain but the read's.
   */
  usual: BasketRowUsualView | null;
}

/**
 * How many purchases one line's window holds (plan 0165, section 1).
 *
 * The last six purchases of a line are what "usually" means. Changing it
 * changes what every shopper is told, so it is a decision rather than a knob.
 */
export const BASKET_USUAL_WINDOW = 6;

/**
 * Whether and how often a row's lines were bought at the read's chain (plan
 * 0165, section 2).
 *
 * Each line's window is its last {@link BASKET_USUAL_WINDOW} purchases that
 * stand: outcome `BOUGHT`, not reverted, newest first. `bought` and `of` are
 * averages over the lines that have a window, rounded half up, so a row that
 * merges three lines still answers a number from 0 to 6. The client decides
 * what to draw; the server filters nothing, because the filter is the viewer's
 * choice and the rows are shared.
 */
export interface BasketRowUsualView {
  state: BasketRowUsualState;
  /**
   * Purchases at the read's chain, 0 to 6. At least 1 whenever the average is
   * above 0, so `HERE` never answers 0.
   */
  bought: number;
  /** Purchases counted, 0 to 6. 0 only for `NEVER_BOUGHT`. */
  of: number;
}

/**
 * The three numbers a basket card draws, and the total they are of.
 *
 * It counts rows, and a row is a product (plan 0201). **Only the full read
 * counts with the picks of the gateway.** A basket card, `live/summary`, the
 * answer of a write and the back office count the rows core builds alone, where
 * a line with several products and no favourite counts as its first product.
 * The two can differ by one for such a line. A client that holds the rows
 * counts them itself with `@portfolio/luna-shopper/basket-rules`.
 */
export interface BasketProgress {
  done: number;
  unavailable: number;
  /** Rows that are not `REMOVED` and not `BOUGHT_ELSEWHERE`. */
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
  status: BasketStatus;
  /** The column is still called `generatedAt` until plan 0144. */
  createdAt: string;
  rows: BasketRowView[];
  /** The covered lists this reader writes themselves, and no others. */
  lists: BasketListRef[];
  participants: BasketParticipantView[];
  me: BasketParticipantView;
  progress: BasketProgress;
  /** The read hit {@link BASKET_LIMITS.maxRows} and the rows were cut. */
  truncated: boolean;
  /**
   * How many changes to the covered lists this **viewer** has not seen (plan
   * 0138, section 7).
   *
   * Capped at `BASKET_CHANGE_LIMITS.countCap`, so a person back from three weeks
   * away costs a bounded read; at the cap it means "this many or more" and the
   * client draws "99+". A viewer's own changes are never counted.
   */
  unseenChangeCount: number;
  /**
   * The newest unseen change's id, which is what an acknowledgement sends as
   * `through`. Null when there is nothing unseen.
   */
  newestUnseenChangeId: string | null;
  /**
   * Whether this reader is served shop addresses (section 2).
   *
   * The owner and every named person are; a link visitor, guest or registered,
   * is served chains and scopes and never an address. The shops are the owner's
   * profile rather than a fact about any list, so the per list rule of `0130`
   * section 6 cannot answer it and this flag does.
   *
   * Since plan 0163 it is true for **every** participant, a link visitor
   * included: a guest picks the shop they are standing in from the same list
   * the owner sees. The field stays so that a client reading it keeps working.
   */
  servesLocations: boolean;
  /**
   * The shop this basket was started at, or null (plan 0163, section 1).
   *
   * Set only by the request that created the basket and never changed after,
   * by anybody, and always null on a `LIVE` basket, whose shop is a choice of
   * the device rather than of the basket. The gateway turns it into
   * `BasketResult.shop`; it is here as an id so that the lock is a fact core
   * states even when catalog cannot name the shop.
   */
  supermarketLocationId: string | null;
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
   * The product of every row, and nothing else (plan 0201, section 3). The
   * other products of a line are read by the page that needs them.
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
  products: BasketProductView[];
  /**
   * The basket's own shop, named, or null (plan 0163, section 1).
   *
   * Null on a basket started at no shop, which is every `LIVE` basket, and
   * null too when catalog could not name the shop this time: the lock itself
   * is {@link BasketView.supermarketLocationId}, which core always answers.
   */
  shop: BasketShopView | null;
  /**
   * Every scope the basket's profile resolves to, named (plan 0066, section 4;
   * plan 0213), and the quoted scope of the read's shop when it has one.
   *
   * A price scope is the set of stores a chain charges the same in. It is the
   * right key for a price and not something to show a person, so this is how
   * "0.95 EUR at scope 3f2a…" becomes "0.95 EUR at Mercadona, Ronda de los
   * Tejares". Since plan 0213 a scope that quotes nothing on this basket is
   * here too, with {@link BasketPriceScopeView.quotesBasket} false, so a shop
   * picker that reads this list alone offers every chain of the profile.
   *
   * Empty when the profile resolves to nothing, and empty too when the gateway
   * could not name the scopes, which {@link scopesIncomplete} tells apart.
   */
  scopes: BasketPriceScopeView[];
  /**
   * True when naming the scopes failed this time, so `scopes` is empty for
   * that reason and not because the profile resolves to nothing (plan 0213).
   * A client says "shops could not be listed" rather than drawing an empty
   * picker.
   *
   * Optional only for a mixed fleet during a deploy: a gateway from before
   * plan 0213 leaves it out, and absent reads as false.
   */
  scopesIncomplete?: boolean;
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
 *
 * The chain half is {@link PriceScopeChainView}, which the composer's
 * suggestions carry alone (plan 0161, section 3). One gateway helper names both,
 * so the basket and the dropdown cannot name one scope differently.
 */
export interface BasketPriceScopeView extends PriceScopeChainView {
  /**
   * The shops of this scope that lie in the profile's postal codes (plan
   * 0213), the same shops the supermarkets page counts, so the list does not
   * move with the basket's rows. Empty for a reader the server withheld them
   * from, and empty for a scope with no shop in those codes; both draw the
   * chain alone.
   */
  locations: BasketScopeLocationView[];
  /**
   * Whether at least one product of this basket has an offer at this scope
   * (plan 0213). False names a chain of the profile that has no price for
   * anything here yet.
   *
   * Optional only for a mixed fleet during a deploy: a gateway from before
   * plan 0213 leaves it out, and named only the scopes that quote something.
   */
  quotesBasket?: boolean;
}

/**
 * A product of the basket read, with what the read's shop says about it (plan
 * 0163, section 2).
 */
export interface BasketProductView extends ItemView {
  /** Null when the read has no shop. */
  atShop: BasketProductAtShopView | null;
  /**
   * The read's shop's sections this product is in, in the shop's order, by the
   * rule of backend plan 0167, section 3 (plan 0167, section 4).
   *
   * **Absent** on a read without a shop, and absent too when catalog could not
   * answer the rule this time: both mean "draw it under its own categories",
   * and neither is a claim about the shop. **Empty** means catalog answered
   * and no section of this shop holds the product, which is drawn the same way
   * but is an answer. Never an availability: an empty list is still sold there.
   */
  sectionIds?: string[];
}

/**
 * One product at the shop the read is made at (plan 0163, section 2).
 *
 * The price is the one catalog materializes for the shop's most specific scope,
 * which already applies the rule of plan 0117 over the shop's whole stack: the
 * narrowest scope with a valid price wins. The gateway picks nothing itself.
 */
export interface BasketProductAtShopView {
  /**
   * The scope the price was read at, which is what a settle at this shop sends
   * as its `priceScopeId`. Null when the shop has no price for the product.
   */
  priceScopeId: string | null;
  price: number | null;
  currency: string | null;
  /**
   * `supermarket_location_items.available` for this product at this shop, or
   * null when there is no row. Read, never inferred: the chain's own
   * availability is not a shop's.
   */
  available: boolean | null;
}

/**
 * A shop, named for a person (plan 0163, section 1).
 *
 * The same shape `0164` answers for a shop near a point, so one client model
 * draws both.
 */
export interface BasketShopView {
  /** The `supermarket_locations` id. */
  id: string;
  supermarketId: string;
  supermarketName: LocalizedText;
  /**
   * The chain's `supermarkets.logoUrl` (plan 0170, section 1), null until an
   * operator sets one. It travels on the view because a guest reading a
   * basket has no account to list the chains with.
   */
  supermarketLogoUrl: string | null;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  /**
   * Whether the shop's postal code is one of the postal codes of the basket
   * owner's pricing profile (plan 0163, section 3). A fact for the client to
   * warn about, and it changes nothing on the server.
   */
  inProfile: boolean;
  /**
   * The shop's section names in its order (plan 0170, section 2), by the rule
   * `section.forLocation` applies. Always present, and empty when the chain
   * has no sections.
   */
  sections: LocationSectionNameView[];
}

/** One shop of a scope, as much of it as the pick sheet draws. */
export interface BasketScopeLocationView {
  supermarketLocationId: string;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  /** As {@link BasketShopView.sections}: always present, maybe empty. */
  sections: LocationSectionNameView[];
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
  /**
   * The chain of the shop the read is made at, sent by the gateway when the
   * read has a shop (plan 0165). Every row then carries
   * {@link BasketRowView.usual}; absent, every row carries null.
   *
   * The chain rather than the shop, because a purchase at any shop of a chain
   * counts for every shop of it. The gateway resolves it through catalog,
   * which is the service that knows which chain a shop belongs to.
   */
  supermarketId?: string;
  /**
   * The cheapest product of each line that has several and no favourite, as
   * the gateway priced them at the scopes of the read (plan 0201, section 1).
   *
   * Core ignores a pick that is not a product of its line, and a line with no
   * pick counts as its first product.
   */
  picks?: BasketLinePick[];
}

/** The caller's permanent basket, created the first time they ask for it. */
export interface GetLiveBasketRequest {
  userId: string;
  /** The read's chain, exactly as {@link GetBasketRequest.supermarketId}. */
  supermarketId?: string;
  /** As {@link GetBasketRequest.picks}. */
  picks?: BasketLinePick[];
}

/** The product one line counts as, chosen by price (plan 0201, section 1). */
export interface BasketLinePick {
  lineId: string;
  itemId: string;
}

/**
 * Ask which covered lines need a price to know their product (plan 0201,
 * section 1): two or more products, no favourite among them, and no buy in
 * this trip.
 */
export interface GetBasketPriceChoicesRequest {
  basketId: string;
  participantId: string;
}

/** One such line, with its products in the order the line holds them. */
export interface BasketPriceChoice {
  lineId: string;
  itemIds: string[];
}

/**
 * The lines the gateway must price before it reads the basket.
 *
 * `basketId` and `participantId` are the basket and the reader the answer is
 * for. The live read asks with an account alone, and learns both here.
 */
export interface BasketPriceChoicesView {
  basketId: string;
  participantId: string;
  lines: BasketPriceChoice[];
}

/**
 * The covered lists that can still take a product (plan 0201, section 5).
 *
 * Every covered list the actor may write that holds no covered line counting
 * as that product. Core decides "counting as" alone, with no picks.
 */
export interface GetBasketProductListsRequest {
  basketId: string;
  participantId: string;
  itemId: string;
}

/** One such list, with its line that holds the product when it has one. */
export interface BasketProductListView {
  listId: string;
  listName: string;
  zoneId: string;
  zoneName: string;
  /**
   * The oldest line of the list that holds the product among its products, or
   * null. It can be at zero, and the demand route raises it.
   */
  lineId: string | null;
  lineName: string | null;
  quantity: number | null;
}

export interface BasketProductListsView {
  lists: BasketProductListView[];
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
  /** One of {@link lineIds}. */
  rowKey: string;
  /**
   * The lines this settle acts on, 1 to {@link BASKET_LIMITS.maxWriteLines}
   * (plan 0201, section 4). Each must be a row of the basket.
   */
  lineIds: string[];
  outcome: SettlementOutcome;
  /**
   * How many were bought, a whole number from 1. Absent on a `BOUGHT`, the
   * settle buys what the named lines still ask for. Ignored on a
   * `NOT_AVAILABLE`, which records no units.
   */
  quantity?: number;
  /**
   * The sum of `left` over the named lines as the client drew them. Refused
   * with `stale_quantity`.
   */
  from: number;
  /**
   * The product of the row as the client drew it. It can be a product that is
   * not on the line, which is a change for this trip only. The gateway refuses
   * an id the catalog does not know. Absent, the settle records the product
   * the named lines count as when they agree on one, and none otherwise.
   */
  itemId?: string;
  /** Which entry got what, over the named lines. Derived oldest first when absent. */
  allocations?: BasketAllocationEntry[];
  /**
   * What one of it costs, and where (plan 0143; plan 0202, section 2).
   *
   * Written by the **gateway**, which chooses the price as the basket's owner,
   * and never by a client: the actor at the shelf can be a guest. At the shop
   * of the settle when it has one, else the cheapest across the owner's scopes
   * with no shop and no chain. The same values are written on every row this
   * settle writes.
   */
  paid?: SettlementPaid;
  /**
   * What the product was called when it was bought (plan 0202, section 1). As
   * `SettleLineRequest.itemSnapshot`: written by the gateway, and absent when
   * catalog did not answer in time.
   */
  itemSnapshot?: ItemSnapshot | null;
}

/**
 * Change the product of basket lines (plan 0202, section 3).
 *
 * Two writes in one transaction, for each named line:
 *
 * 1. **The buys of the trip are rewritten.** Every standing buy of the line
 *    through this basket in its trip that names another product is marked
 *    reverted, and a new settlement is written beside it with the same line,
 *    quantity, person and `settledAt`, the new product, its name and its price.
 *    The quantity of the line does not move, so no change row is written.
 * 2. **When {@link keep} is true the line is written.** The product joins the
 *    products of the line when it is not one of them, and it becomes the
 *    favourite. That is an ordinary edit of the line, with its permissions,
 *    its change row and its events.
 *
 * With `keep` false and no buy in the trip nothing is written, and the answer
 * is the lines as they are.
 *
 * Account participants only. Every named line must be a row of the basket, or
 * the whole write answers "Row not found".
 */
export interface ChangeBasketLinesProductRequest {
  basketId: string;
  participantId: string;
  /** The actor's own account. A guest reaches the route and is refused. */
  userId: string;
  /** 1 to {@link BASKET_LIMITS.maxWriteLines} lines, each a row of the basket. */
  lineIds: string[];
  /** The product the lines change to. The gateway refuses one catalog does not know. */
  itemId: string;
  /** Whether the change is kept on the line, or holds for this trip only. */
  keep: boolean;
  /** What the product is called now. Written by the gateway, never by a client. */
  itemSnapshot?: ItemSnapshot | null;
  /**
   * What one unit of the product costs at each scope a rewritten buy was
   * priced at. Written by the gateway, which learned those scopes from
   * {@link BasketSearchScope.tripBuys}. A buy whose scope is not in this list
   * keeps its scope and its shop and gets no price.
   */
  prices?: BasketScopePrice[];
  /**
   * The price for a rewritten buy that recorded no scope, chosen as a settle
   * chooses one (plan 0202, section 2). Written by the gateway.
   */
  paid?: SettlementPaid;
}

/** What one unit of a product costs at one scope, as the gateway read it. */
export interface BasketScopePrice {
  priceScopeId: string;
  /** One unit, in the minor unit of {@link pricePaidCurrency}. */
  pricePaidCents: number;
  /** ISO 4217. */
  pricePaidCurrency: string;
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
      /** One of `lineIds`. */
      rowKey: string;
      /** The lines this revert acts on (plan 0201, section 4). */
      lineIds: string[];
      target: 'UNITS';
      units: number;
      /** The sum of `bought` over the named lines as the client drew them. */
      from: number;
    }
  | {
      basketId: string;
      participantId: string;
      rowKey: string;
      lineIds: string[];
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
  /** The same id as {@link lineId}. */
  rowKey: string;
  /**
   * The line to change, always (plan 0201, section 4). It is on a covered list
   * and it can be at zero, which is how a list that holds a product at zero
   * asks for it again.
   */
  lineId: string;
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
  /**
   * Whether a person typed {@link content} (plan 0207, section 1.3). Handed to
   * the add of a list line as it arrived, and absent means true.
   */
  named?: boolean;
}

/**
 * Put a row off for now, or take that back (plan 0137, section 5).
 *
 * One shape for both directions, because they are one gesture aimed twice: the
 * `PUT` marks every entry the row still asks for and the `DELETE` takes every
 * mark back.
 *
 * **It carries no `from`**, which is the one exception to "every write on a row
 * names the number it started from" (plan 0130, section 8). That guard exists
 * because a number's meaning depends on where it started, and "not today" means
 * the same thing whether the row says two or three. What the state refuses
 * instead is a row with nothing left to skip.
 */
export interface SkipBasketRowRequest {
  basketId: string;
  participantId: string;
  /** One of {@link lineIds}. */
  rowKey: string;
  /** The lines to put off, or to take the skip back from (plan 0201). */
  lineIds: string[];
}

/**
 * Rename the named lines, on each of their lists (plan 0113's rule).
 *
 * Refused with `validation_failed` for a line that has a product: a row with a
 * product is named by the catalog (plan 0201, section 4).
 */
export interface RenameBasketRowRequest {
  basketId: string;
  participantId: string;
  userId: string;
  /** One of {@link lineIds}. */
  rowKey: string;
  lineIds: string[];
  content: string;
  /** Agree to the fold a rename onto an existing name would cause. */
  confirmMerge?: boolean;
}

/**
 * Where a search inside this basket is priced, and, for a settle, which
 * product the row records when the settle names none (plan 0151, section 1).
 */
export interface BasketSearchScopeRequest extends GetBasketRequest {
  /**
   * The lines a write is about to act on. Sent by a settle that named no
   * `itemId`, and answered in {@link BasketSearchScope.pick}. Sent also by a
   * change of product that asks for {@link tripBuys}.
   */
  lineIds?: string[];
  /**
   * Ask where the standing buys of {@link lineIds} in this trip were priced
   * (plan 0202, section 3). Answered in {@link BasketSearchScope.tripBuys}.
   */
  tripBuys?: boolean;
}

/**
 * Where the buys a change of product will rewrite were priced (plan 0202,
 * section 3).
 *
 * The gateway reads a price and core never does. So before core rewrites the
 * buys of a trip, the gateway asks where they were priced, reads what the new
 * product costs at each of those scopes, and hands core the answers. The buys
 * are the standing `BOUGHT` settlements of the named lines through this basket
 * in its trip.
 */
export interface BasketTripBuys {
  /** The distinct price scopes those buys recorded. */
  priceScopeIds: string[];
  /** At least one of those buys recorded no scope. */
  unscoped: boolean;
}

/** Where a search inside this basket is priced. */
export interface BasketSearchScope {
  ownerUserId: string;
  /** Null on a basket composed before plan 0078, which stays unpriced. */
  profileId: string | null;
  /**
   * Whether **this participant** is served shop addresses, which is the one
   * condition plan 0136 section 2 left deciding that question
   * (`BasketView.servesLocations`).
   *
   * It rides here, on the question the settle already asks, rather than on a
   * second read of the basket: plan 0143 needs the same flag to decide whether
   * a settle may record the shop a client named, and a settle that read the
   * whole basket to learn one boolean would pay for a thousand rows to answer
   * it. It is the actor's flag, unlike the two fields above it, which are the
   * basket's; that is why it is documented and not merely added.
   */
  servesLocations: boolean;
  /**
   * The shop the basket was started at, or null (plan 0163, section 5).
   *
   * The basket's, like the owner and the profile. A settle on a basket with
   * its own shop records that shop, and one naming another shop is refused.
   */
  supermarketLocationId: string | null;
  /**
   * The product a settle on the requested lines records when it names none
   * (plan 0151). `optionCount` is 1 when they agree on one product and 0
   * otherwise (plan 0201). Present exactly when the request named `lineIds`.
   *
   * It rides here for the reason {@link servesLocations} does: the settle
   * already asks this question to price what was paid, so the gateway learns
   * which product to price without a second round trip, and it learns it from
   * core, which is the one service that writes the answer.
   */
  pick?: SettlePick;
  /** Present exactly when the request asked for it and named `lineIds`. */
  tripBuys?: BasketTripBuys;
}

// --- Results ----------------------------------------------------------------

/**
 * What every write on a row answers (plan 0201, section 4).
 *
 * The lines of the write as they are now, and no row: a row cannot be built
 * without the prices of a read. A client rebuilds its rows from the entries
 * with `@portfolio/luna-shopper/basket-rules`, or takes them from its next
 * read.
 */
export interface BasketRowResult {
  /**
   * The lines the write named or touched, as this reader reads them now. **A
   * line that is absent left the basket**: it is at zero with no buy that keeps
   * it a row, or it was merged away, deleted or rejected.
   */
  entries: BasketRowEntryView[];
  /** Counted by core alone. See {@link BasketProgress}. */
  progress: BasketProgress;
  /** Set by a revert: entries whose line was deleted since, so no units went back. */
  skippedCount?: number;
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
  /** The lines the gateway must price before a read (plan 0201, section 1). */
  priceChoices: 'basket.priceChoices',
  livePriceChoices: 'basket.live.priceChoices',
  /** The covered lists that can still take a product (plan 0201, section 5). */
  productLists: 'basket.productLists',
  rowSettle: 'basket.row.settle',
  rowRevert: 'basket.row.revert',
  rowDemand: 'basket.row.demand',
  rowRename: 'basket.row.rename',
  /** Put a row off for now, and take that back (plan 0137). */
  rowSkip: 'basket.row.skip',
  rowUnskip: 'basket.row.unskip',
  lineAdd: 'basket.line.add',
  /** Change the product of basket lines (plan 0202, section 3). */
  linesProduct: 'basket.lines.product',
  searchScope: 'basket.searchScope',
  /** What changed on the covered lists, and saying it was drawn (plan 0138). */
  changesList: 'basket.changes.list',
  changesAcknowledge: 'basket.changes.acknowledge',
  /** The marks and the count alone, with no rows (plan 0204, section 6). */
  changesMarks: 'basket.changes.marks',
  /** Compose a basket from the caller's chosen sources (plan 0050, section 4). */
  create: 'basket.create',
  /** The caller's baskets, newest first, cursor paginated (plan 0050, section 7). */
  listMine: 'basket.listMine',
  /** Rename it, or move it between the three statuses. */
  update: 'basket.update',
  /** A real delete of the basket alone. It never touches a zone list. */
  delete: 'basket.delete',
  /**
   * The baskets other people shared with the caller, newest share first (plan
   * 0114, section 8).
   */
  listShared: 'basket.listShared',
} as const;

// --- The basket's own header, its history and the run that made one (plan 0050)

/**
 * Generated shopping list contracts (plan 0050): the basket a person actually
 * carries around the shop, composed from the pending lines of the zones and lists
 * they chose.
 *
 * Core owns it, keyed by an opaque `userId`, and the gateway is the only caller.
 * Every request carries the `userId` a verified token resolved to, and a
 * `basketId` that is not that user's is answered as **not found** rather
 * than as forbidden, on the same reasoning plan 0049 gave for a profile: a basket
 * is private (section 8), and telling a stranger that an id names something real
 * is telling them something.
 *
 * ## What this plan takes from 0051 before 0051 is built
 *
 * Two rules here do not match `0050` as written, because `0047` landed first and
 * took the trip status off a zone line:
 *
 * - **Qualification is `quantity > 0`**, not `status = PENDING`. Section 3's
 *   third bullet asked for a column `0047` deleted, and wanting a thing is what
 *   that column was standing in for.
 * - **Settling replaces `applyStatuses`.** `0050` section 6 existed only to write
 *   a trip status back onto a zone line and reconcile the versions when it had
 *   moved. A settlement is an append (`0047` section 3), so the conflict
 *   machinery evaporates with the column, exactly as `0051` section 1 predicted.
 *
 * The share links, participants and guest sockets `0051` adds are **not** here.
 * They are that plan's own feature, and every basket in this one has exactly one
 * reader.
 */
/**
 * REMOVED-BY-0144: the owner's header read, `generatedList.get`.
 *
 * It answered {@link BasketHeaderView}, which is the header plus `sources`, and
 * renaming it landed it on `basket.get`, which plan 0136 had already given to
 * the participant read. The two are one read by that plan's rule, so the older
 * one went with its route (`GET /v1/generated-lists/:id`) and both its handlers.
 *
 * `sources` is the one field the participant read does not carry, and nothing
 * anywhere asked for it through this subject: not velista, not the back office,
 * not the e2e. It stays on the wire through `create`, which answers the same
 * header shape, so no fact left the API with the subject.
 *
 * **This marker is here to be deleted.** Search `REMOVED-BY-0144` once a release
 * has shipped without anybody missing the read. If something did need it, this
 * is the note saying what it was and where it went.
 */

/**
 * The bounds a basket has to satisfy, stated once so the DTO, the JSON Schema and
 * the service enforce the same numbers.
 *
 * `maxLines` is gone with the run that enforced it (plan 0136, section 3.6). A
 * basket composes nothing, so it cannot refuse lines that arrive on a covered
 * list afterwards; what guards a pathological account is `BASKET_LIMITS.maxRows`,
 * applied to the answer rather than to anybody's data.
 */

// --- Views -----------------------------------------------------------------

/**
 * One source of a basket, as it was named (plan 0133, section 4).
 *
 * What the request **asked for**, never the lists it resolved to on the day. The
 * snapshot this replaced stored the resolved lists, so a run for a whole zone
 * came back as that zone's lists at that moment and could not follow a list
 * added to the zone next month.
 */
export interface BasketSourceView {
  zoneId: string;
  /** Null means every list of the zone the owner can write. */
  listId: string | null;
}

/**
 * A basket and everything on it.
 *
 * `name` is nullable and null is not missing: an unnamed list is displayed as its
 * generation date, localized by the reader's client, and a second unnamed list on
 * the same day gets a number appended to the display (section 1). Core does not
 * know the caller's locale, so the default is never stored.
 */
export interface BasketHeaderView {
  id: string;
  /** What this basket is (plan 0133, section 2). */
  kind: BasketKind;
  name: string | null;
  status: BasketStatus;
  generatedAt: string;
  /** What the run was asked to draw from, as it was named (section 4). */
  sources: BasketSourceView[];
  /**
   * The shop the basket was started at, or null (plan 0163, section 1). Fixed
   * when the basket is created and never changed after.
   */
  supermarketLocationId: string | null;
}

/**
 * A basket without its lines, for the history listing (section 7).
 *
 * `lineCount` and `settledLineCount` rather than the lines themselves, because
 * the listing is a page of trips and loading every line of every one of them to
 * render a date and a number is the read that would eventually need fixing.
 */
export interface BasketHistoryView {
  id: string;
  /** What this basket is (plan 0133, section 2). */
  kind: BasketKind;
  name: string | null;
  status: BasketStatus;
  generatedAt: string;
  lineCount: number;
  /**
   * How many lines are finished, whatever finished them (plan 0053, section 2).
   *
   * Unchanged, and deliberately so: `NOT_AVAILABLE` closes a line's outstanding
   * amount exactly as a purchase does, so this has always been the count of lines
   * with nothing left to do and it still is. The two counts below say which of
   * the two things happened, and neither replaces it.
   */
  settledLineCount: number;
  /**
   * Of the finished lines, how many were actually bought (plan 0053, section 2).
   *
   * An aggregate over `lastOutcome`, which the basket's own line view already
   * carries, rather than a new fact: a line's last settle is what decided it, and
   * the history row is summing what the shop screen already showed.
   */
  boughtLineCount: number;
  /** Of the finished lines, how many the shop did not have. */
  notAvailableLineCount: number;
  /**
   * How many people are in this basket right now (plan 0053, section 2).
   *
   * **A count, never a list of who.** The home card is a card, and velista `0049`
   * section 4 refuses to spend a request per card on the question; it is resolved
   * here, beside the projection, where it is one read for a whole page.
   *
   * Resolved from the presence store **at read time** rather than stored, so a
   * card cannot say "2 shopping" about a shop everybody has left, which is the
   * exact staleness velista `0048` section 5 refuses to draw. Zero when presence
   * cannot be read at all: presence fails open and empty everywhere else in this
   * system, and a card that says nobody is here is much better than a history
   * that will not load.
   */
  presentCount: number;
}

/**
 * What a run produced.
 *
 * A wrapper with one field, where it used to carry the lines the run refused as
 * well. Plan 0133 section 7 deleted that refusal, and plan 0136 replaces the run
 * outright, so the wrapper stays for one plan rather than being unwrapped twice.
 *
 * Plan 0159 names the basket under `basket`, because a client read a basket
 * under a key named after the other thing a shopper has.
 */
export interface BasketRunResult {
  basket: BasketHeaderView;
  /**
   * The same value as {@link basket}, under its old key, for one release.
   *
   * @deprecated Read `basket`. Removed by backlog plan 0015.
   */
  list: BasketHeaderView;
}

// --- Requests --------------------------------------------------------------

/** One zone, or one list inside it, that a run should draw from. */
export interface BasketSourceInput {
  zoneId: string;
  /** Null means every list in the zone the caller may draw from. */
  listId?: string | null;
}

/**
 * Compose a basket (section 4).
 *
 * The sources are resolved in order: the `sources` given here, else the stored
 * generation sources of the named profile, else those of the caller's default
 * profile, which default to `ALL` (plan 0049, section 1).
 *
 * `idempotencyKey` is what stops a double tap producing two baskets (plan 0004,
 * section 9). The same key from the same user inside the retention window returns
 * the run it produced the first time rather than composing a second one.
 */
export interface CreateBasketRequest {
  userId: string;
  sources?: BasketSourceInput[];
  profileId?: string;
  name?: string | null;
  idempotencyKey?: string;
  /**
   * People to share the basket with as it is created (plan 0114, section 4).
   *
   * Every id must be one of the owner's contacts at that moment, and the whole
   * run is refused otherwise, before anything is written. At most one fewer than
   * the participant limit, which leaves room for the owner.
   */
  memberUserIds?: string[];
  /**
   * The global usernames of {@link memberUserIds}, resolved by the gateway from
   * auth (section 9). Core owns no usernames, so it is told them, and uses one
   * only for a person the owner shares no approved group with, or several.
   */
  globalUsernames?: UserUsernameView[];
  /**
   * The shop the basket is bought at (plan 0163, section 1).
   *
   * The gateway has already asked catalog that the shop exists. It does not
   * have to be in the owner's profile. It is fixed for the life of the basket
   * and applies to everybody in it: no request changes it afterwards.
   */
  supermarketLocationId?: string;
}

export interface BasketIdRequest {
  userId: string;
  basketId: string;
}

/** The caller's baskets, newest first (section 7). `ARCHIVED` is hidden by default. */
export interface ListBasketsRequest {
  userId: string;
  cursor?: string;
  limit?: number;
  order?: string;
  /** Include archived baskets, which the default listing leaves out. */
  includeArchived?: boolean;
}

export type BasketPage = Paginated<BasketHistoryView>;

/**
 * The baskets shared with the caller (plan 0114, section 8).
 *
 * Every live `REGISTERED` row the caller holds, on a basket that is not
 * `ARCHIVED`, so a finished trip still shows. A basket they own is never here,
 * because the owner's row is an `OWNER` row.
 */
export interface ListSharedBasketsRequest {
  userId: string;
  cursor?: string;
  limit?: number;
}

/** One shared basket as core answers it, before the gateway names the owner. */
export interface SharedBasketCoreView extends BasketHistoryView {
  ownerUserId: string;
  /**
   * The owner's membership name in the one approved group the two people share,
   * or null when they share none or more than one (section 9). Core owns no
   * global usernames, so a null is the gateway's cue to ask auth.
   */
  ownerZoneUsername: string | null;
  /** When the owner added the caller, and otherwise when they joined by link. */
  sharedAt: string;
}

export type SharedBasketCorePage = Paginated<SharedBasketCoreView>;

/** Who shared a basket, named as section 9 names them. */
export interface BasketOwnerView {
  userId: string;
  name: string;
}

/**
 * One row of the shared baskets tab (section 8): a history row, plus who shared
 * it and when.
 */
export interface SharedBasketView extends BasketHistoryView {
  owner: BasketOwnerView;
  sharedAt: string;
}

export type SharedBasketPage = Paginated<SharedBasketView>;

/** Rename a basket, or move it between the three statuses. */
export interface UpdateBasketRequest {
  userId: string;
  basketId: string;
  name?: string | null;
  status?: BasketStatus;
}

/*
 * Settling a basket line is deliberately absent, and it is the one thing a reader
 * of `0050` will look for here.
 *
 * `0050` section 6 wrote a trip status back onto every origin and reconciled the
 * versions when one had moved. `0047` deleted that status, which turned a settle
 * into an append rather than a contested update, and `0051` section 1 records
 * that its own section 6 replaces the whole apparatus: the allocation across
 * several origins, the override sheet, and the rule that a settle is authorized
 * by the basket **owner's** access rather than the actor's, because a guest has
 * none of their own.
 *
 * So the subject, its request and its result belong to `0051` and are defined
 * there, beside the participant that performs it. What this plan owes that one is
 * `BasketLineView.settledQuantity`, which is already here.
 */
