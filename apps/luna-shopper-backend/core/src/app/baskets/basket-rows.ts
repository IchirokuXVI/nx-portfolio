import {
  rowNumbersOf,
  rowStateOf,
  progressOf as ruleProgressOf,
  type BasketRuleEntry,
} from '@portfolio/luna-shopper/basket-rules';
import {
  BASKET_ACT_SKIPPED,
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  LineApprovalStatus,
  SettlementOutcome,
  type BasketEntryAct,
  type BasketEntryPatch,
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

/**
 * What other baskets bought of one line lately (plan 0188).
 *
 * A count, a time and one boolean. **It names nobody**, and it cannot: the read
 * never loads who made these purchases, so no rule here could put a person on a
 * row by accident.
 */
export interface BasketElsewhereFact {
  /** Units bought through another basket, or through none, inside the window. */
  quantity: number;
  /** The newest of those purchases. */
  settledAt: Date;
  /**
   * That newest purchase was made through a basket, and not on the zone list
   * page (plan 0203, section 3). Never the basket itself.
   */
  throughBasket: boolean;
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
  /** `list_lines.version`, which a patch is ordered by (plan 0204). */
  version: number;
  itemSetHash: string | null;
  approvalStatus: LineApprovalStatus;
  createdAt: Date;
  /** The line's product set, in attachment order. */
  itemIds: string[];
  /** This basket's standing purchases of this line, in scope, oldest first. */
  settlements: BasketSettlementFact[];
  /** What somebody else bought of this line lately, or null (plan 0188). */
  elsewhere: BasketElsewhereFact | null;
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
 * What other baskets bought of these entries lately, summed (plan 0188).
 *
 * Kept apart from {@link boughtOf} on purpose. `bought` is what **this** basket
 * bought, and it is what a revert takes back; these units are somebody else's
 * and no act of this basket can touch them.
 */
export function boughtElsewhereOf(entries: readonly BasketEntry[]): number {
  return entries.reduce(
    (sum, entry) => sum + (entry.elsewhere?.quantity ?? 0),
    0
  );
}

/**
 * The newest purchase somebody else made of these entries, or null.
 *
 * At the same instant a purchase through a basket wins over one on the list
 * page, so two entries of one row bought in one settle of another basket agree.
 */
function newestElsewhere(
  entries: readonly BasketEntry[]
): BasketElsewhereFact | null {
  let newest: BasketElsewhereFact | null = null;
  for (const entry of entries) {
    const fact = entry.elsewhere;
    if (!fact) {
      continue;
    }
    const at = fact.settledAt.getTime();
    if (
      !newest ||
      at > newest.settledAt.getTime() ||
      (at === newest.settledAt.getTime() &&
        fact.throughBasket &&
        !newest.throughBasket)
    ) {
      newest = fact;
    }
  }
  return newest;
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
 * One entry as the shared rules take it (plan 0204, section 4).
 *
 * The state table itself is `rowStateOf` in
 * `@portfolio/luna-shopper/basket-rules`, which velista calls too. This is the
 * half that only core can do: turning what the database answered into the three
 * things the table asks of an entry.
 *
 * - **`skipped`**: the line carries a standing skip of this basket that is
 *   still fresh (plan 0137, section 4).
 * - **`act`**: the newer of the entry's newest purchase and its standing skip.
 *   A skip stands only while this basket has no later purchase of the line
 *   (`SKIP_STANDS`), so a standing skip is the newest act by construction, and
 *   the comparison below is written anyway so the rule does not rest on that.
 * - **`closed`**: that newest act is "they had none" and it still holds. A
 *   `GENERATED` basket is a trip, so the close holds until the trip is
 *   finished. A `LIVE` basket never ends, so the close runs out with the skip
 *   window (plan 0137, section 4).
 *
 * A close under a later skip is not `closed`: only the newer of a skip and a
 * close is ever standing (plan 0137, section 3.2).
 */
export function toRuleEntry(
  entry: BasketEntry,
  facts: BasketFacts
): BasketRuleEntry {
  const act = actOf(entry, facts);
  const settled = newestSettlement([entry]);
  return {
    left: entry.quantity,
    bought: boughtOf(entry),
    boughtElsewhere: entry.elsewhere?.quantity ?? 0,
    skipped: facts.skips.get(entry.lineId)?.fresh === true,
    closed:
      act?.outcome === SettlementOutcome.NOT_AVAILABLE &&
      settled !== null &&
      (facts.kind !== BasketKind.LIVE || settled.fresh),
    act,
  };
}

/**
 * The newest standing act of this basket on one line, or null (plan 0204,
 * section 2).
 *
 * The newest of the entry's scoped settlements **and** its standing skip. A
 * skip is an act on the row, and "Marta, 10:42" under a skipped row is the same
 * answer to the same question a purchase gets (plan 0137, section 4).
 */
export function actOf(
  entry: BasketEntry,
  facts: BasketFacts
): BasketEntryAct | null {
  const settled = newestSettlement([entry]);
  const skip = facts.skips.get(entry.lineId);
  if (
    skip &&
    (!settled || skip.skippedAt.getTime() > settled.settledAt.getTime())
  ) {
    return {
      participantId: skip.skippedByParticipantId,
      at: skip.skippedAt.toISOString(),
      outcome: BASKET_ACT_SKIPPED,
    };
  }
  return settled
    ? {
        participantId: settled.settledByParticipantId,
        at: settled.settledAt.toISOString(),
        outcome: settled.outcome,
      }
    : null;
}

/**
 * The state of a group of entries, by the table of plan 0130, section 4.
 *
 * The table is the shared library's. The cast is the one place its plain string
 * meets the contract's enum, and `basket-rows.spec.ts` asserts that the two
 * hold the same values.
 */
export function stateOf(
  entries: readonly BasketEntry[],
  facts: BasketFacts
): BasketRowState {
  return rowStateOf(
    entries.map((entry) => toRuleEntry(entry, facts))
  ) as BasketRowState;
}

/**
 * The fact about a row's past worth saying beside it (plan 0137, section 4;
 * plan 0188).
 *
 * ## `SKIPPED_EARLIER`
 *
 * The skip that is no longer the row's state: the window ran out under it, or
 * one entry of it was bought, or a third household asked for the same thing. It
 * clears when the skip stops standing, which is when the row is bought, closed
 * or unskipped.
 *
 * `DONE`, `BOUGHT_ELSEWHERE` and `REMOVED` carry none because there is nothing
 * left to decide about the row, and `SKIPPED` carries none because the state
 * already says it.
 *
 * ## `BOUGHT_ON_ANOTHER_BASKET` and `BOUGHT_ON_THE_LIST`
 *
 * Somebody bought some of this row lately through another basket, or through
 * none. It is said in **every** state but `REMOVED`, `DONE` included, because
 * it is the only thing on the row that explains a number this shopper did not
 * move: the row went to zero, or lost a unit, and nobody here touched it.
 *
 * **Which of the two** is decided by the newest of those purchases (plan 0203,
 * section 3): `BOUGHT_ON_ANOTHER_BASKET` when it was made through a basket, and
 * `BOUGHT_ON_THE_LIST` when it was made on the zone list page. `noteAt` is the
 * time of that purchase in both cases.
 *
 * A row carries one note, and **the skip wins** when both apply: it is this
 * basket's own decision, and the count beside the row still says what was
 * bought elsewhere.
 */
export function noteOf(
  entries: readonly BasketEntry[],
  state: BasketRowState,
  facts: BasketFacts
): { note: BasketRowNote; noteAt: Date } | null {
  if (state === BasketRowState.REMOVED) {
    return null;
  }
  if (
    state !== BasketRowState.SKIPPED &&
    state !== BasketRowState.DONE &&
    state !== BasketRowState.BOUGHT_ELSEWHERE
  ) {
    const newest = newestSkip(entries, facts);
    if (newest) {
      return { note: BasketRowNote.SKIPPED_EARLIER, noteAt: newest.skippedAt };
    }
  }
  const elsewhere = newestElsewhere(entries);
  if (!elsewhere) {
    return null;
  }
  return {
    note: elsewhere.throughBasket
      ? BasketRowNote.BOUGHT_ON_ANOTHER_BASKET
      : BasketRowNote.BOUGHT_ON_THE_LIST,
    noteAt: elsewhere.settledAt,
  };
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

/**
 * What an entry and a patch of it both state (plan 0204, sections 2 and 5).
 *
 * One function for the two, so the patch of a line is the entry a read of the
 * same instant would serve, less the two fields a room may not carry.
 */
export function toEntryPatch(
  entry: BasketEntry,
  facts: BasketFacts
): BasketEntryPatch {
  const rule = toRuleEntry(entry, facts);
  return {
    lineId: entry.lineId,
    version: entry.version,
    left: rule.left,
    bought: rule.bought,
    // Somebody else's units, beside this basket's own and never added to them
    // (plan 0188).
    boughtElsewhere: rule.boughtElsewhere,
    // The same rule as the row's, asked of a group of one: an entry the shopper
    // skipped reads `SKIPPED` whether or not its neighbours did, which is what
    // lets a client draw the half of a row that was put off.
    state: rowStateOf([rule]) as BasketRowState,
    approvalStatus: entry.approvalStatus,
    skipped: rule.skipped,
    closed: rule.closed,
    act: actOf(entry, facts),
  };
}

/** One entry, as the wire carries it. */
export function toEntryView(
  entry: BasketEntry,
  context: EntryContext
): BasketRowEntryView {
  const view: BasketRowEntryView = {
    ...toEntryPatch(entry, context.facts),
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
  // The sums, the newest act and the state all come from the entries as the
  // wire carries them, through the rules a client rebuilds its own rows with
  // (plan 0204, section 4).
  const numbers = rowNumbersOf(entries);
  const state = rowStateOf(entries) as BasketRowState;
  const note = noteOf(group.entries, state, context.facts);
  return {
    rowKey: group.anchor.lineId,
    content: group.anchor.content,
    left: numbers.left,
    bought: numbers.bought,
    // Computed here and stored nowhere, which is the whole of plan 0136.
    asked: numbers.asked,
    // Not part of `asked`: these units were never this basket's to buy by the
    // time it looked (plan 0188).
    boughtElsewhere: numbers.boughtElsewhere,
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
    // Who last did something to this row, and when (plan 0137, section 4): the
    // newest of its purchases and its standing skips.
    touchedBy: numbers.act?.participantId ?? null,
    touchedAt: numbers.act?.at ?? null,
    entries,
    // Filled by the read when it has a chain (plan 0165), and null otherwise.
    usual: null,
  };
}

/**
 * The three numbers a basket card draws (plan 0130, section 4).
 *
 * The rule is the shared library's (plan 0204, section 4). A row that only
 * outside buys closed is `BOUGHT_ELSEWHERE` and counts toward no number (plan
 * 0203, section 4, which reversed plan 0188), and a `SKIPPED` row is pending.
 */
export function progressOf(rows: readonly BasketRowView[]): BasketProgress {
  return ruleProgressOf(rows);
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
