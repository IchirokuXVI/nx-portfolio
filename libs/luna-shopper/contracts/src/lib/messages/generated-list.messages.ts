import type {
  GeneratedLineOrigin,
  GeneratedListStatus,
} from '../enums/generated-list.enums';
import type { Paginated } from '../pagination';

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
  /** One basket with its lines, their origins and their options. */
  get: 'generatedList.get',
  /** Rename it, or move it between the four statuses. */
  update: 'generatedList.update',
  /** A real delete of the generated rows alone. It never touches a zone list. */
  delete: 'generatedList.delete',
  /** Type a line into the basket, optionally naming a list to receive it. */
  addLine: 'generatedList.addLine',
  /** Edit one line: its text, its quantity, its pick, or its target list. */
  updateLine: 'generatedList.updateLine',
  /** Take a line out of the basket, leaving every origin untouched. */
  deleteLine: 'generatedList.deleteLine',
  /** Reorder the basket, which is a local edit like every other one here. */
  reorderLines: 'generatedList.reorderLines',
} as const;

/**
 * The bounds a basket has to satisfy, stated once so the DTO, the JSON Schema and
 * the service enforce the same numbers.
 *
 * `maxLines` is a bound rather than a budget, like `PROFILE_LIMITS`: a run that
 * would compose more lines than this is drawing from more lists than anybody
 * shops for in one trip, and it is refused rather than silently truncated, so
 * nobody carries a basket that quietly lost its last forty items.
 */
export const GENERATED_LIST_LIMITS = {
  maxLines: 500,
  maxSources: 100,
  nameMaxLength: 120,
  contentMaxLength: 500,
  maxQuantity: 9999,
} as const;

// --- Views -----------------------------------------------------------------

/**
 * One zone line that fed a basket line (plan 0050, section 1).
 *
 * `lineVersion` is copied at generation time. `0050` needed it to reconcile a
 * status write back; `0047` made settling an append, so what it is for now is
 * telling a reader that the origin has moved since the basket was made, which is
 * information rather than a conflict to resolve.
 */
export interface GeneratedListLineOriginView {
  id: string;
  zoneId: string;
  listId: string;
  lineId: string;
  /** What this origin contributed to the basket line's summed quantity. */
  quantity: number;
  lineVersion: number;
}

/**
 * One line of a basket (plan 0050, section 1).
 *
 * `itemId` is **the pick**: the exact product this line means to buy, defaulted
 * at generation to the best priced of the line's options and switchable to any
 * other one (section 5). It is null for a free text line, which has no product
 * identity and therefore no pick to make.
 */
export interface GeneratedListLineView {
  id: string;
  content: string;
  /** How many the basket is asking for, summed across the origins. */
  quantity: number;
  /**
   * How many have been settled so far (`0051` section 6, brought forward by
   * `0047`'s cumulative settling).
   *
   * Outstanding is the difference, and a line is finished when the two are equal.
   * It is a column rather than a count over settlements because it is read on
   * every row of the main screen and a `NOT_AVAILABLE` outcome closes the
   * outstanding amount without contributing any bought units to sum.
   */
  settledQuantity: number;
  /** The pick. Null for a free text line. */
  itemId: string | null;
  /** The products the pick may be switched between, in the order they arrived. */
  options: string[];
  origin: GeneratedLineOrigin;
  /**
   * The zone list an `ADDED` line is also written into (section 5). Null while it
   * lives in the basket alone, and always null on a `DERIVED` line, which is
   * already in the lists its origins name.
   */
  targetListId: string | null;
  position: number;
  origins: GeneratedListLineOriginView[];
}

/**
 * What a run drew from, kept because a run's meaning depends on it (section 4).
 *
 * Without it a three week old basket cannot be explained to the person looking at
 * it: the profile it used has been edited since, and the lists it read may not
 * exist any more.
 */
export interface GeneratedListSourceSnapshot {
  /** The profile whose sources the run used, or null when the request named them. */
  profileId: string | null;
  /** Every (zone, list) pair the run actually read, after access filtering. */
  sources: { zoneId: string; listId: string }[];
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
  name: string | null;
  status: GeneratedListStatus;
  generatedAt: string;
  sourceSnapshot: GeneratedListSourceSnapshot;
  lines: GeneratedListLineView[];
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
 * A line a run **did not** take, and why (section 3).
 *
 * Reported rather than silently dropped. A basket missing the milk somebody
 * distinctly remembers putting on the list is a bug report, and this is the
 * difference between answering it and guessing.
 */
export interface GeneratedListSkippedLineView {
  zoneId: string;
  listId: string;
  lineId: string;
  content: string;
  /** The `ACTIVE` basket already carrying this line. */
  carriedByGeneratedListId: string;
}

/**
 * What a run produced: the basket, and what it left behind.
 *
 * A named result rather than a bare {@link GeneratedListView} because the skipped
 * lines are part of the answer to "why is this basket what it is", and a client
 * that discarded them would have nothing to show the person asking.
 */
export interface GeneratedListRunResult {
  list: GeneratedListView;
  skipped: GeneratedListSkippedLineView[];
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
  /**
   * The list every `ADDED` line should also be written into, unless the line
   * names its own (section 5).
   *
   * A default on new lines and **never a retroactive sweep** over lines already
   * added, which is the difference between an ergonomic default and an edit
   * nobody asked for.
   */
  defaultTargetListId?: string | null;
  idempotencyKey?: string;
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

/** Rename a basket, or move it between the four statuses. */
export interface UpdateGeneratedListRequest {
  userId: string;
  generatedListId: string;
  name?: string | null;
  status?: GeneratedListStatus;
  defaultTargetListId?: string | null;
}

/**
 * Type a line into a basket (section 5).
 *
 * With a `targetListId` it is also created in that zone list through the ordinary
 * `line.add` path, subject to the ordinary rules: the caller must hold `WRITE`
 * **at that moment**, and the new line starts `PENDING` approval like any other.
 * Without one it lives in the basket alone.
 */
export interface AddGeneratedListLineRequest {
  userId: string;
  generatedListId: string;
  content: string;
  quantity?: number;
  /** The pick, when the client already knows which product it means. */
  itemId?: string | null;
  /** The products the pick may be switched between. */
  options?: string[];
  /**
   * The zone list to also create it in. Omitted falls back to the basket's
   * `defaultTargetListId`; explicit null means the basket alone, whatever the
   * default says.
   */
  targetListId?: string | null;
}

/**
 * Edit one basket line (section 5). Every field here is **local**: the zone line
 * an origin names is not touched by any of them.
 *
 * Editing the text or the quantity of a `DERIVED` line changes the generated copy
 * alone, because the user asked for a shopping list and not for a way to rewrite
 * other people's lists by accident.
 */
export interface UpdateGeneratedListLineRequest {
  userId: string;
  generatedListId: string;
  lineId: string;
  content?: string;
  quantity?: number;
  /** Switch the pick to another of the line's options. */
  itemId?: string | null;
  /** Only meaningful on an `ADDED` line; setting it promotes the line once. */
  targetListId?: string | null;
}

export interface GeneratedListLineIdRequest {
  userId: string;
  generatedListId: string;
  lineId: string;
}

export interface ReorderGeneratedListLinesRequest {
  userId: string;
  generatedListId: string;
  /** Every line of the basket, in the order it should now be in. */
  lineIds: string[];
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
