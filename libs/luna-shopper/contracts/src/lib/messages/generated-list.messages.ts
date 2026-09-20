import type { BasketKind } from '../enums/basket.enums';
import type { GeneratedListStatus } from '../enums/generated-list.enums';
import type { Paginated } from '../pagination';
import type { UserUsernameView } from './auth.messages';

/**
 * Generated shopping list contracts (plan 0050): the basket a person actually
 * carries around the shop, composed from the pending lines of the zones and lists
 * they chose.
 *
 * Core owns it, keyed by an opaque `userId`, and the gateway is the only caller.
 * Every request carries the `userId` a verified token resolved to, and a
 * `generatedListId` that is not that user's is answered as **not found** rather
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
export const GENERATED_LIST_PATTERNS = {
  /** Compose a basket from the caller's chosen sources (section 4). */
  create: 'generatedList.create',
  /** The caller's baskets, newest first, cursor paginated (section 7). */
  listMine: 'generatedList.listMine',
  /** One basket's header and the sources it was composed from. */
  get: 'generatedList.get',
  /** Rename it, or move it between the three statuses. */
  update: 'generatedList.update',
  /** A real delete of the generated rows alone. It never touches a zone list. */
  delete: 'generatedList.delete',
  /**
   * The baskets other people shared with the caller, newest share first (plan
   * 0114, section 8).
   */
  listShared: 'generatedList.listShared',
} as const;

/**
 * The bounds a basket has to satisfy, stated once so the DTO, the JSON Schema and
 * the service enforce the same numbers.
 *
 * `maxLines` is gone with the run that enforced it (plan 0136, section 3.6). A
 * basket composes nothing, so it cannot refuse lines that arrive on a covered
 * list afterwards; what guards a pathological account is `BASKET_LIMITS.maxRows`,
 * applied to the answer rather than to anybody's data.
 */
export const GENERATED_LIST_LIMITS = {
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
   * left to be discovered. A generated line carries the options its origins
   * named and a composer suggestion carries a product group's members; neither
   * is anywhere near this, so it bounds the insert without bounding the feature.
   */
  maxOptions: 50,
} as const;

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
export interface GeneratedListView {
  id: string;
  /** What this basket is (plan 0133, section 2). */
  kind: BasketKind;
  name: string | null;
  status: GeneratedListStatus;
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
export interface GeneratedListSummaryView {
  id: string;
  /** What this basket is (plan 0133, section 2). */
  kind: BasketKind;
  name: string | null;
  status: GeneratedListStatus;
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
export interface GeneratedListRunResult {
  list: GeneratedListView;
}

// --- Requests --------------------------------------------------------------

/** One zone, or one list inside it, that a run should draw from. */
export interface GeneratedListSourceInput {
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
export interface CreateGeneratedListRequest {
  userId: string;
  sources?: GeneratedListSourceInput[];
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

export interface GeneratedListIdRequest {
  userId: string;
  generatedListId: string;
}

/** The caller's baskets, newest first (section 7). `ARCHIVED` is hidden by default. */
export interface ListGeneratedListsRequest {
  userId: string;
  cursor?: string;
  limit?: number;
  order?: string;
  /** Include archived baskets, which the default listing leaves out. */
  includeArchived?: boolean;
}

export type GeneratedListPage = Paginated<GeneratedListSummaryView>;

/**
 * The baskets shared with the caller (plan 0114, section 8).
 *
 * Every live `REGISTERED` row the caller holds, on a basket that is not
 * `ARCHIVED`, so a finished trip still shows. A basket they own is never here,
 * because the owner's row is an `OWNER` row.
 */
export interface ListSharedGeneratedListsRequest {
  userId: string;
  cursor?: string;
  limit?: number;
}

/** One shared basket as core answers it, before the gateway names the owner. */
export interface SharedGeneratedListCoreView extends GeneratedListSummaryView {
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

export type SharedGeneratedListCorePage =
  Paginated<SharedGeneratedListCoreView>;

/** Who shared a basket, named as section 9 names them. */
export interface GeneratedListOwnerView {
  userId: string;
  name: string;
}

/**
 * One row of the shared baskets tab (section 8): a history row, plus who shared
 * it and when.
 */
export interface SharedGeneratedListView extends GeneratedListSummaryView {
  owner: GeneratedListOwnerView;
  sharedAt: string;
}

export type SharedGeneratedListPage = Paginated<SharedGeneratedListView>;

/** Rename a basket, or move it between the three statuses. */
export interface UpdateGeneratedListRequest {
  userId: string;
  generatedListId: string;
  name?: string | null;
  status?: GeneratedListStatus;
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
 * `GeneratedListLineView.settledQuantity`, which is already here.
 */
