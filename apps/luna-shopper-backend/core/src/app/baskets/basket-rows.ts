import {
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
}

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
 * The table's order, with `REMOVED` and `SKIPPED` skipped because nothing in
 * this plan can produce them: they arrive with plans 0138 and 0137, and the
 * union is declared whole so that those plans change a value here rather than
 * the wire shape.
 */
export function stateOf(
  left: number,
  bought: number,
  newest: BasketSettlementFact | null
): BasketRowState {
  if (newest?.outcome === SettlementOutcome.NOT_AVAILABLE && left > 0) {
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
    state: stateOf(entry.quantity, bought, newestSettlement([entry])),
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
  return {
    rowKey: group.anchor.lineId,
    content: group.anchor.content,
    left,
    bought,
    // Computed here and stored nowhere, which is the whole of plan 0136.
    asked: bought + left,
    state: stateOf(left, bought, newest),
    // Both arrive with plan 0137 and plan 0138. Until then a row says nothing
    // about its past and carries no mark, and the fields exist so that those
    // plans change a value rather than the shape.
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: group.entries.some(
      (entry) => entry.approvalStatus === LineApprovalStatus.PENDING
    ),
    optionIds: optionIdsOf(group.entries),
    touchedBy: newest?.settledByParticipantId ?? null,
    touchedAt: newest ? newest.settledAt.toISOString() : null,
    entries,
  };
}

/** The three numbers a basket card draws (plan 0130, section 4). */
export function progressOf(rows: readonly BasketRowView[]): BasketProgress {
  // Nothing produces `REMOVED` before plan 0138, so every row counts. The
  // filter is written anyway, because that plan adds a value and not a rule.
  const counted = rows.filter((row) => row.state !== BasketRowState.REMOVED);
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
