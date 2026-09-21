import {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  LineApprovalStatus,
  SettlementOutcome,
  type BasketProgress,
  type BasketRowEntryView,
  type BasketRowView,
} from '@portfolio/luna-shopper/contracts';
import { mergeKey } from './line-dedup';

/**
 * Every rule of a basket row that needs no database (plan 0136, section 3).
 *
 * Free functions rather than methods, which is what lets a spec state the rule
 * instead of mocking its way to it. It is the reasoning `allocateOldestFirst`
 * already gave for itself, applied to the grouping, the arithmetic and the
 * states as well, because all four are now recomputed on every request and a
 * wrong one is a wrong screen rather than a wrong row in a table somebody can go
 * and look at.
 */

/** One standing purchase in scope, as the read hands it to these rules. */
export interface BasketSettlementFact {
  id: string;
  outcome: SettlementOutcome;
  quantity: number;
  settledAt: Date;
  settledByParticipantId: string | null;
  /**
   * Inside the skip window, decided by the database (plan 0137, section 4).
   *
   * Read for a `LIVE` basket alone, where "the shop had none" runs out with the
   * same clock a skip does. A `GENERATED` basket's close holds until the trip is
   * finished, so this is computed for its rows and looked at for none of them.
   */
  fresh: boolean;
}

/** One line's newest standing skip, as the read hands it to these rules. */
export interface BasketSkipFact {
  skippedAt: Date;
  skippedByParticipantId: string;
  /** Inside the skip window, decided by the database (plan 0137, section 3). */
  fresh: boolean;
}

/**
 * What the read knows about a basket that its entries do not say (plan 0137,
 * section 4).
 *
 * Both fields are answers the database already gave. These rules receive
 * booleans and never a clock, which is the property that lets one spec state
 * "a stale skip reads as wanted" without moving anybody's time.
 */
export interface BasketFacts {
  /** This basket's standing skips, by line. Empty for a finished basket. */
  skips: ReadonlyMap<string, BasketSkipFact>;
  /** Only `LIVE` lets a close expire, which is the one thing the kind decides. */
  kind: BasketKind;
}

/** A basket with no skips of any kind, which is what a finished one reads as. */
export const NO_BASKET_SKIPS: ReadonlyMap<string, BasketSkipFact> = new Map();

/** No row marked, which is what a read with no viewer answers (plan 0138). */
export const NO_ROW_MARKS: ReadonlyMap<string, BasketRowMark> = new Map();

/** One covered list line, with everything this file needs about it. */
export interface BasketEntry {
  lineId: string;
  listId: string;
  content: string;
  /** `list_lines.quantity`: what this household still asks for. */
  quantity: number;
  itemSetHash: string | null;
  approvalStatus: LineApprovalStatus;
  createdAt: Date;
  /** The line's product set, in attachment order. */
  itemIds: string[];
  /** This basket's standing purchases of this line, in scope, oldest first. */
  settlements: BasketSettlementFact[];
}

/** A group of entries that are one thing to buy. */
export interface BasketGroup {
  key: string;
  /** The earliest entry by `(createdAt, id)`. It names the row. */
  anchor: BasketEntry;
  entries: BasketEntry[];
}

/**
 * Fold the covered lines into rows (plan 0136, section 3.1, step 5).
 *
 * The same `mergeKey` a generation run used, which is the point: a run merged
 * "Milk" on the flat's list with "leche" on the parents' when they named one
 * product, and the view has to fold exactly the same pair or a basket read would
 * disagree with every basket ever composed.
 *
 * **The input must already be ordered by `(createdAt, id)`**, which
 * `COVERED_LINES_SQL` does, because the anchor is the group's first entry and
 * the oldest ask for a thing is the one that names the row.
 */
export function groupEntries(entries: readonly BasketEntry[]): BasketGroup[] {
  const groups = new Map<string, BasketGroup>();
  for (const entry of entries) {
    const key = mergeKey(entry);
    const held = groups.get(key);
    if (held) {
      held.entries.push(entry);
      continue;
    }
    groups.set(key, { key, anchor: entry, entries: [entry] });
  }
  return [...groups.values()];
}

/** What one entry's purchases add up to. */
export function boughtOf(entry: BasketEntry): number {
  return entry.settlements
    .filter((row) => row.outcome === SettlementOutcome.BOUGHT)
    .reduce((sum, row) => sum + row.quantity, 0);
}

/**
 * The newest standing act over these entries, by `("settledAt", id)`.
 *
 * The tie break on the id is not decoration: one settle writes a row per entry
 * with the same `settledAt`, so without it "what did the last act say" would
 * have no answer on the ordinary two household row.
 */
export function newestSettlement(
  entries: readonly BasketEntry[]
): BasketSettlementFact | null {
  let newest: BasketSettlementFact | null = null;
  for (const entry of entries) {
    for (const row of entry.settlements) {
      if (
        !newest ||
        row.settledAt.getTime() > newest.settledAt.getTime() ||
        (row.settledAt.getTime() === newest.settledAt.getTime() &&
          row.id > newest.id)
      ) {
        newest = row;
      }
    }
  }
  return newest;
}

/**
 * The state of a left/bought pair and the newest thing said about it (plan 0130,
 * section 4).
 *
 * The table's order, with `REMOVED` skipped because nothing produces it before
 * plan 0138 and the union is declared whole so that plan changes a value here
 * rather than the wire shape.
 *
 * `entries` is the group the numbers came from, which is what a skip is asked
 * about: a skip belongs to a line, and a row is skipped only when every line it
 * still asks something of is.
 */
export function stateOf(
  entries: readonly BasketEntry[],
  left: number,
  bought: number,
  newest: BasketSettlementFact | null,
  facts: BasketFacts
): BasketRowState {
  if (left > 0 && isSkipped(entries, facts)) {
    // Tested before `NOT_AVAILABLE`, which is the table's order, and right in
    // both directions because only the newer of a skip and a close is ever
    // standing (plan 0137, section 3.2).
    return BasketRowState.SKIPPED;
  }
  if (
    newest?.outcome === SettlementOutcome.NOT_AVAILABLE &&
    left > 0 &&
    closeHolds(newest, facts)
  ) {
    // Tested before `DONE`, which is the table's order, and guarded on `left`
    // because a demand taken to zero after a close would otherwise leave a row
    // claiming the shop had none of something nobody is asking for.
    return BasketRowState.NOT_AVAILABLE;
  }
  if (left === 0 && bought > 0) {
    return BasketRowState.DONE;
  }
  if (left > 0 && bought > 0) {
    return BasketRowState.PARTLY;
  }
  return BasketRowState.WANTED;
}

/**
 * Every entry the row still asks something of has a **fresh** standing skip
 * (plan 0137, section 4).
 *
 * **One unskipped entry makes the row wanted again.** A row of two lists' milk
 * is skipped as one gesture, and when a third household asks for milk an hour
 * later that entry carries no skip. New demand is a reason to look at the row
 * again, and the note below then says it was skipped earlier, so nothing about
 * the first gesture is lost.
 *
 * An entry at zero is not asked about: there is nothing left of it to skip, and
 * requiring a skip on it would leave a partly bought row wanted for ever.
 */
function isSkipped(
  entries: readonly BasketEntry[],
  facts: BasketFacts
): boolean {
  const asking = entries.filter((entry) => entry.quantity > 0);
  return (
    asking.length > 0 &&
    asking.every((entry) => facts.skips.get(entry.lineId)?.fresh === true)
  );
}

/**
 * Whether a close still says anything (plan 0137, section 4).
 *
 * A `GENERATED` basket is a trip, so the shop not having something holds until
 * the trip is finished. A `LIVE` basket never ends, so the close runs out with
 * the skip window, whichever comes first: plan 0136 already held it to the
 * current session, and this is the other bound. After it the row is `WANTED`
 * with no note, and `touchedBy` still says who looked and when.
 */
function closeHolds(newest: BasketSettlementFact, facts: BasketFacts): boolean {
  return facts.kind !== BasketKind.LIVE || newest.fresh;
}

/**
 * The fact about a row's past worth saying beside it (plan 0137, section 4).
 *
 * One value, and it is the skip that is no longer the row's state: the window
 * ran out under it, or one entry of it was bought, or a third household asked
 * for the same thing. It clears when the skip stops standing, which is when the
 * row is bought, closed or unskipped.
 *
 * `DONE` and `REMOVED` carry no note because there is nothing left to decide
 * about the row, and `SKIPPED` carries none because the state already says it.
 */
export function noteOf(
  entries: readonly BasketEntry[],
  state: BasketRowState,
  facts: BasketFacts
): { note: BasketRowNote; noteAt: Date } | null {
  if (
    state === BasketRowState.SKIPPED ||
    state === BasketRowState.DONE ||
    state === BasketRowState.REMOVED
  ) {
    return null;
  }
  const newest = newestSkip(entries, facts);
  return newest
    ? { note: BasketRowNote.SKIPPED_EARLIER, noteAt: newest.skippedAt }
    : null;
}

/** The newest standing skip over these entries, fresh or not. */
function newestSkip(
  entries: readonly BasketEntry[],
  facts: BasketFacts
): BasketSkipFact | null {
  let newest: BasketSkipFact | null = null;
  for (const entry of entries) {
    const skip = facts.skips.get(entry.lineId);
    if (
      skip &&
      (!newest || skip.skippedAt.getTime() > newest.skippedAt.getTime())
    ) {
      newest = skip;
    }
  }
  return newest;
}

/**
 * The union of the entries' product sets, first seen order, anchor first.
 *
 * A union rather than the anchor's own set: two households naming the same thing
 * may each have attached a different carton, and the shopper at the shelf is
 * choosing between all of them. Deduplicated, because the common case is two
 * entries naming the same product and a picker offering it twice is a bug the
 * shopper sees.
 */
export function optionIdsOf(entries: readonly BasketEntry[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of entries) {
    for (const itemId of entry.itemIds) {
      if (!seen.has(itemId)) {
        seen.add(itemId);
        ids.push(itemId);
      }
    }
  }
  return ids;
}

/** What the caller has to answer per entry, since neither is a fact about the line. */
export interface EntryContext {
  /** The list's ref was served to this reader, so the entry may name it. */
  servedListIds: ReadonlySet<string>;
  /** Whether the **owner** may change this entry's demand (plan 0131). */
  demandEditable: (entry: BasketEntry) => boolean;
  /** What the read knows and the entries do not (plan 0137, section 4). */
  facts: BasketFacts;
  /**
   * What changed about each row since **this viewer** last looked, by merge key
   * (plan 0138, section 7).
   *
   * By key rather than by line, because a mark belongs to the row: a line deleted
   * from one household marks the row its name is still on in another, and there is
   * no line id both of those share. Empty for a caller with no viewer to measure,
   * which is what the admin and history reads are.
   */
  marks: ReadonlyMap<string, BasketRowMark>;
}

/** One entry, as the wire carries it. */
export function toEntryView(
  entry: BasketEntry,
  context: EntryContext
): BasketRowEntryView {
  const bought = boughtOf(entry);
  const view: BasketRowEntryView = {
    lineId: entry.lineId,
    left: entry.quantity,
    bought,
    // The same rule as the row's, asked of a group of one: an entry the shopper
    // skipped reads `SKIPPED` whether or not its neighbours did, which is what
    // lets a client draw the half of a row that was put off.
    state: stateOf(
      [entry],
      entry.quantity,
      bought,
      newestSettlement([entry]),
      context.facts
    ),
    approvalStatus: entry.approvalStatus,
    demandEditable: context.demandEditable(entry),
  };
  // Redaction by absence (plan 0130, section 6). The field is omitted rather
  // than nulled, so a reader cannot tell "a list you may not see" from "no
  // list", and nothing downstream is trusted to hide a value it was handed.
  if (context.servedListIds.has(entry.listId)) {
    view.listId = entry.listId;
  }
  return view;
}

/** One row, as the wire carries it. */
export function toRowView(
  group: BasketGroup,
  context: EntryContext
): BasketRowView {
  const entries = group.entries.map((entry) => toEntryView(entry, context));
  const left = entries.reduce((sum, entry) => sum + entry.left, 0);
  const bought = entries.reduce((sum, entry) => sum + entry.bought, 0);
  const newest = newestSettlement(group.entries);
  const state = stateOf(group.entries, left, bought, newest, context.facts);
  const note = noteOf(group.entries, state, context.facts);
  const touched = newestAct(group.entries, newest, context.facts);
  return {
    rowKey: group.anchor.lineId,
    content: group.anchor.content,
    left,
    bought,
    // Computed here and stored nowhere, which is the whole of plan 0136.
    asked: bought + left,
    state,
    note: note?.note ?? null,
    noteAt: note ? note.noteAt.toISOString() : null,
    // One mark per row, decided by the fold in `changes/basket-marks.reader.ts`
    // (plan 0138, section 7). Null when nothing about this row has moved since
    // this viewer last looked, and null for every row of a read with no viewer.
    mark: context.marks.get(group.key) ?? null,
    awaitingApproval: group.entries.some(
      (entry) => entry.approvalStatus === LineApprovalStatus.PENDING
    ),
    optionIds: optionIdsOf(group.entries),
    touchedBy: touched?.participantId ?? null,
    touchedAt: touched ? touched.at.toISOString() : null,
    entries,
  };
}

/**
 * Who last did something to this row, and when (plan 0137, section 4).
 *
 * The newest of the row's scoped settlements **and** its standing skips. A skip
 * is an act on the row, and "Marta, 10:42" under a skipped row is the same
 * answer to the same question a purchase gets.
 */
function newestAct(
  entries: readonly BasketEntry[],
  newest: BasketSettlementFact | null,
  facts: BasketFacts
): { participantId: string | null; at: Date } | null {
  const settled = newest
    ? { participantId: newest.settledByParticipantId, at: newest.settledAt }
    : null;
  const skip = newestSkip(entries, facts);
  if (!skip) {
    return settled;
  }
  const skipped = {
    participantId: skip.skippedByParticipantId,
    at: skip.skippedAt,
  };
  if (!settled) {
    return skipped;
  }
  return skip.skippedAt.getTime() > settled.at.getTime() ? skipped : settled;
}

/** The three numbers a basket card draws (plan 0130, section 4). */
export function progressOf(rows: readonly BasketRowView[]): BasketProgress {
  // Nothing produces `REMOVED` before plan 0138, so every row counts. The
  // filter is written anyway, because that plan adds a value and not a rule.
  const counted = rows.filter((row) => row.state !== BasketRowState.REMOVED);
  // A `SKIPPED` row falls into `pending` by arithmetic rather than by a branch,
  // which is the answer plan 0130 section 4 asks for: it is neither done nor
  // unavailable, and it is still something somebody has to decide about.
  const done = counted.filter(
    (row) => row.state === BasketRowState.DONE
  ).length;
  const unavailable = counted.filter(
    (row) => row.state === BasketRowState.NOT_AVAILABLE
  ).length;
  return {
    done,
    unavailable,
    total: counted.length,
    pending: counted.length - done - unavailable,
  };
}

/**
 * Oldest entry first, until the settled quantity is exhausted (plan 0051,
 * section 6.2).
 *
 * A row can sum several list lines: milk from the flat list (2) and from the
 * parents' list (1) is one row of 3, and buying 2 has to land somewhere.
 *
 * Deterministic, explicable in one sentence, and **identical to the obvious
 * answer in the overwhelmingly common case where a row has exactly one entry**.
 * Proportional splitting was rejected for producing fractional units of things
 * that come in units.
 *
 * It read an origin's contributed `quantity` before plan 0136 and reads the
 * entry's own `left` now, which is the same number by a shorter route: the
 * origin was a copy of what the list asked for, and the list is asked directly.
 */
export function allocateOldestFirst(
  entries: readonly BasketEntry[],
  units: number
): Map<BasketEntry, number> {
  const plan = new Map<BasketEntry, number>();
  let left = units;
  for (const entry of entries) {
    const take = Math.min(left, entry.quantity);
    plan.set(entry, take);
    left -= take;
  }
  // More bought than the row asked for is not an error (plan 0047, section
  // 4.2): the excess is real and the last entry carries it, so the consumption
  // history is not quietly clamped to the demand.
  if (left > 0 && entries.length > 0) {
    const last = entries[entries.length - 1];
    plan.set(last, (plan.get(last) ?? 0) + left);
  }
  return plan;
}
