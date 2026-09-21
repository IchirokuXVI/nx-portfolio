import type {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  BasketStatus,
} from '../enums/basket.enums';
import type {
  LineApprovalStatus,
  SettlementOutcome,
} from '../enums/list.enums';
import type { Paginated } from '../pagination';
import type { UserUsernameView } from './auth.messages';
import type { BasketParticipantView } from './basket-sharing.messages';
import type { ItemView, LocalizedText } from './catalog.messages';
import type { SettlementPaid } from './list.messages';

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
 * `BASKET_LIMITS.maxLines` is gone with the run that enforced it: a
 * basket composes nothing, so it cannot refuse lines that arrive on a covered
 * list afterwards. What is left is a guard against a pathological account, and
 * it is applied to the answer rather than to anybody's data.
 */
export const BASKET_LIMITS = {
  /** Rows one read answers. Past it the read says `truncated` (section 3.6). */
  maxRows: 1000,
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
  /**
   * What the screen said one of it costs, and where (plan 0143).
   *
   * Written by the **gateway**, which reads the price as the basket's owner at
   * the basket's scopes, and never by a client: the actor at the shelf can be a
   * guest. The same four values are written on every row this settle writes.
   */
  paid?: SettlementPaid;
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
  rowKey: string;
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
  /** Put a row off for now, and take that back (plan 0137). */
  rowSkip: 'basket.row.skip',
  rowUnskip: 'basket.row.unskip',
  lineAdd: 'basket.line.add',
  searchScope: 'basket.searchScope',
  /** What changed on the covered lists, and saying it was drawn (plan 0138). */
  changesList: 'basket.changes.list',
  changesAcknowledge: 'basket.changes.acknowledge',
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
 */
export interface BasketRunResult {
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
