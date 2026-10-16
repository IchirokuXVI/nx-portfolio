import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BASKET_CHANGE_LIMITS,
  BasketRowMark,
  BUY_CHANGE_KINDS,
  LineApprovalStatus,
  LineChangeKind,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import type { CoreConfig } from '../../config/app-config';
import { ListLineChange } from '../../entities';
import {
  CHANGE_LINES_SQL,
  MARKED_CHANGES_SQL,
  REMOVING_CHANGES_SQL,
  UNSEEN_CHANGE_COUNT_SQL,
  type ChangeLineRow,
  type ChangeRow,
  type RemovingChangeRow,
  type UnseenCountRow,
} from './basket-changes.sql';

/**
 * What changed about this basket since **this viewer** last looked (plan 0138,
 * section 7).
 *
 * The basket read asks it once and folds the answer into its rows: a mark per
 * row, a disabled row for each thing that was taken off, and the count the banner
 * draws.
 *
 * ## A mark belongs to the key of a row, not to a line
 *
 * A row is a group of covered lines that share a key, so a mark belongs to the
 * key rather than to any line in it. That is not a convenience: a line
 * **deleted** from one household marks the row its product is still on in
 * another, and there is no line id both of those share.
 *
 * Since plan 0201 the key is the product a line counts as, which a caller
 * knows only after it read the products and the purchases of the lines. So
 * the reading and the folding are two steps: {@link changesFor} asks the
 * database, and {@link foldBasketMarks} folds with the caller's own keys. A
 * read with picks and a read without can therefore put one mark on two
 * different rows, exactly as they put one line in two different rows.
 *
 * ## One mark per row, and `ADDED` wins
 *
 * A line added and then raised inside one window is new rather than changed,
 * because "new" is the more useful of the two things to say and saying both is not
 * an option a row has room for.
 */
@Injectable()
export class BasketMarksReader {
  private readonly markWindowMs: number;
  private readonly retentionMs: number;

  constructor(
    @InjectRepository(ListLineChange)
    private readonly changes: Repository<ListLineChange>,
    @Inject(ConfigService) configService: ConfigService
  ) {
    const core = configService.getOrThrow<CoreConfig>('core');
    this.markWindowMs = core.basket.changeMarkWindowMs;
    this.retentionMs = core.listLineChange.retentionMs;
  }

  /**
   * The changes one viewer is told about, not folded yet.
   *
   * `covered` is the basket read's own covered lines, handed over rather than read
   * again: it is what decides whether a changed line is still in the basket, and
   * asking for it twice would be a second answer to a question already answered
   * one statement earlier in the same request.
   *
   * Four statements: the marked changes, the count, the removals of the window,
   * and the lines those changes name. The last is what a soft deleted line is
   * read through, since no other read in the basket serves one.
   *
   * `removedWindowMs` is how long a removed row is served after the change that
   * removed it (plan 0203, section 6). Null asks for no removed row: a basket
   * that is not open has none, and a caller that draws no row needs none.
   */
  async changesFor(
    participantId: string,
    coveredListIds: readonly string[],
    covered: readonly ChangeLineRow[],
    removedWindowMs: number | null = null
  ): Promise<BasketChangesRead> {
    if (coveredListIds.length === 0) {
      return NO_BASKET_CHANGES;
    }

    const [marked, counted, removing] = await Promise.all([
      this.changes.query<ChangeRow[]>(MARKED_CHANGES_SQL, [
        participantId,
        [...coveredListIds],
        this.retentionMs,
        this.markWindowMs,
        BASKET_CHANGE_LIMITS.marksCap,
      ]),
      this.changes.query<UnseenCountRow[]>(UNSEEN_CHANGE_COUNT_SQL, [
        participantId,
        [...coveredListIds],
        this.retentionMs,
        BASKET_CHANGE_LIMITS.countCap + 1,
      ]),
      removedWindowMs === null
        ? Promise.resolve<RemovingChangeRow[]>([])
        : this.changes.query<RemovingChangeRow[]>(REMOVING_CHANGES_SQL, [
            participantId,
            [...coveredListIds],
            this.retentionMs,
            removedWindowMs,
            this.markWindowMs,
            BASKET_CHANGE_LIMITS.marksCap,
          ]),
    ]);

    // The newest change is the first row, because the order is newest first and
    // an unseen change is always newer than a lingering one. So the newest unseen
    // is the first row that says so, and the cap can never hide it.
    const newestUnseen = marked.find((change) => change.unseen);
    const unseenChangeCount = Math.min(
      Number(counted[0]?.count ?? 0),
      BASKET_CHANGE_LIMITS.countCap
    );

    const lines = await this.linesOf([...marked, ...removing], covered);

    return {
      marked,
      removing,
      lines,
      unseenChangeCount,
      newestUnseenChangeId: newestUnseen?.id ?? null,
    };
  }

  /**
   * How many changes this viewer has not seen, on its own.
   *
   * The acknowledgement answers the count as it now stands, and it has no rows to
   * fold: one statement rather than the three above.
   */
  async countFor(
    participantId: string,
    coveredListIds: readonly string[]
  ): Promise<number> {
    if (coveredListIds.length === 0) {
      return 0;
    }
    const [counted] = await this.changes.query<UnseenCountRow[]>(
      UNSEEN_CHANGE_COUNT_SQL,
      [
        participantId,
        [...coveredListIds],
        this.retentionMs,
        BASKET_CHANGE_LIMITS.countCap + 1,
      ]
    );
    return Math.min(Number(counted?.count ?? 0), BASKET_CHANGE_LIMITS.countCap);
  }

  /** The window a mark lasts after this viewer acknowledged it, as a duration. */
  get markWindow(): number {
    return this.markWindowMs;
  }

  /** How far back a change is served at all. */
  get retention(): number {
    return this.retentionMs;
  }

  /**
   * Every line the marked changes name, the ones no read serves included.
   *
   * The covered lines are already in hand, so only the others are asked for. A
   * line that comes back from neither is one a merge really deleted, which is the
   * one case a change can outlive its row entirely.
   */
  private async linesOf(
    marked: readonly Pick<ChangeRow, 'lineId'>[],
    covered: readonly ChangeLineRow[]
  ): Promise<Map<string, ChangeLineRow>> {
    const known = new Map(covered.map((line) => [line.id, line]));
    const wanted = new Set<string>();
    for (const change of marked) {
      if (!known.has(change.lineId)) {
        wanted.add(change.lineId);
      }
    }
    if (wanted.size === 0) {
      return known;
    }
    const rows = await this.changes.query<ChangeLineRow[]>(CHANGE_LINES_SQL, [
      [...wanted],
    ]);
    for (const row of rows) {
      known.set(row.id, row);
    }
    return known;
  }
}

/** What {@link BasketMarksReader.changesFor} read, before any key is known. */
export interface BasketChangesRead {
  marked: readonly ChangeRow[];
  removing: readonly RemovingChangeRow[];
  /** Every line a change names, the covered ones and the ones that left. */
  lines: ReadonlyMap<string, ChangeLineRow>;
  unseenChangeCount: number;
  newestUnseenChangeId: string | null;
}

/** A read with nothing to say, which is what a basket covering no list gets. */
export const NO_BASKET_CHANGES: BasketChangesRead = {
  marked: [],
  removing: [],
  lines: new Map(),
  unseenChangeCount: 0,
  newestUnseenChangeId: null,
};

/**
 * The key of the row a line is in, or would be in if it were covered.
 *
 * The caller's, because the key is the product a line counts as (plan 0201)
 * and only the caller holds the products, the purchases and the picks.
 */
export type LineKeyOf = (line: ChangeLineRow) => string;

/**
 * The lines that left the coverage among those a read names: the ones a caller
 * has to key before it can fold.
 */
export function departedLinesOf(
  read: BasketChangesRead,
  covered: readonly ChangeLineRow[]
): ChangeLineRow[] {
  const coveredIds = new Set(covered.map((line) => line.id));
  return [...read.lines.values()].filter((line) => !coveredIds.has(line.id));
}

/** Fold what was read into the marks, the removed rows and the count. */
export function foldBasketMarks(
  read: BasketChangesRead,
  covered: readonly ChangeLineRow[],
  keyOf: LineKeyOf
): BasketMarks {
  return {
    byKey: foldMarks(read.marked, covered, read.lines, keyOf).byKey,
    removed: foldRemoved(read.removing, covered, read.lines, keyOf),
    unseenChangeCount: read.unseenChangeCount,
    newestUnseenChangeId: read.newestUnseenChangeId,
  };
}

/** What one viewer is told about the changes to the lists a basket covers. */
export interface BasketMarks {
  /** The mark of each row, by the row's key. Rows with none are absent. */
  byKey: ReadonlyMap<string, BasketRowMark>;
  /** The things taken off the basket, one entry per row to draw. */
  removed: RemovedGroup[];
  /** Capped at `BASKET_CHANGE_LIMITS.countCap`; at the cap it means "or more". */
  unseenChangeCount: number;
  /** What an acknowledgement sends as `through`. */
  newestUnseenChangeId: string | null;
}

/**
 * One disabled row: something the basket asked for and no longer does.
 *
 * Several lines of one key are **one** row, because two households taking their
 * milk off is one thing leaving the basket.
 */
export interface RemovedGroup {
  key: string;
  /** The earliest gone line by `(createdAt, id)`, which names the row. */
  rowKey: string;
  /** The text it had when it went. */
  content: string;
  /** Every gone line of this key, for the purchases the row still shows. */
  lineIds: string[];
  /**
   * A removal of this row is still marked for the viewer (plan 0203, section
   * 6). The row is served either way. This decides its `mark` alone.
   */
  marked: boolean;
}

/** A basket read with no viewer to measure, which is what the admin paths are. */
export const NO_BASKET_MARKS: BasketMarks = {
  byKey: new Map(),
  removed: [],
  unseenChangeCount: 0,
  newestUnseenChangeId: null,
};

/**
 * Fold the marked changes into a mark per row (plan 0138, section 7; plan 0203,
 * section 7).
 *
 * A free function rather than a method, for the reason the rest of `basket-rows`
 * is: it is the rule, and a spec can state it against three arrays instead of
 * mocking its way to a database.
 *
 * Every change lands in exactly one of four places:
 *
 * - its line is still covered, so its key gets `ADDED` or `CHANGED`. A `BOUGHT`
 *   and a `BUY_REVERTED` are `CHANGED`: a line that somebody else just bought is
 *   a row that changed, whatever state it now reads as;
 * - it is a `MERGED`, so the **survivor's** key gets `CHANGED` and the absorbed
 *   line is never drawn: its id names no row, and a chain of merges inside one
 *   window marks the last survivor and loses the first hop, which is accepted;
 * - its line has left the coverage, and a covered row still carries its name,
 *   so that row gets `CHANGED`: one of its entries went and its `left` fell;
 * - nothing can be said about it on a row that is drawn, and it is dropped. Its
 *   line is gone from the database, or it left the coverage with its name. The
 *   second is a removed row, and {@link foldRemoved} builds those from a read
 *   of their own since plan 0203.
 */
export function foldMarks(
  marked: readonly ChangeRow[],
  covered: readonly ChangeLineRow[],
  lines: ReadonlyMap<string, ChangeLineRow>,
  keyOf: LineKeyOf
): { byKey: Map<string, BasketRowMark> } {
  const coveredIds = new Set(covered.map((line) => line.id));
  const coveredKeys = new Set(covered.map((line) => keyOf(line)));
  const byKey = new Map<string, BasketRowMark>();

  const mark = (key: string, value: BasketRowMark): void => {
    byKey.set(key, strongest(byKey.get(key), value));
  };

  // Oldest first, so that the strongest mark of a row is decided in the order the
  // changes happened and `ADDED` wins however late the raise was.
  for (const change of [...marked].reverse()) {
    if (change.kind === LineChangeKind.MERGED) {
      const survivor = change.mergedIntoLineId
        ? lines.get(change.mergedIntoLineId)
        : undefined;
      if (survivor && coveredIds.has(survivor.id)) {
        mark(keyOf(survivor), BasketRowMark.CHANGED);
      }
      // A survivor that is not covered either says nothing a row can carry.
      continue;
    }

    const line = lines.get(change.lineId);
    if (!line) {
      // The row is gone from the database, which only a merge does. There is no
      // key to group it under and no text to draw, so it is dropped rather than
      // guessed at.
      continue;
    }

    if (coveredIds.has(line.id)) {
      mark(
        keyOf(line),
        enteredCoverage(change) ? BasketRowMark.ADDED : BasketRowMark.CHANGED
      );
      continue;
    }

    if (BUY_CHANGE_KINDS.includes(change.kind)) {
      // A buy of a line that is no row any more: the outside buy left its
      // window, or the line was deleted since. A buy never removes a row, so it
      // says nothing here (plan 0203, section 3).
      continue;
    }

    // It left the coverage: deleted, rejected, or taken to zero with nothing
    // bought. A line bought to zero lately is still covered (plan 0130, section
    // 3; plan 0188), so it never reaches here.
    const key = keyOf(line);
    if (coveredKeys.has(key)) {
      // One of the row's entries went and its `left` fell, so the row that is
      // still there is what changed. No disabled row beside it: the thing is
      // still in the basket, because another household still asks for it.
      mark(key, BasketRowMark.CHANGED);
    }
  }

  return { byKey };
}

/**
 * Fold the removals of the window into a row per thing that left (plan 0138,
 * section 7; plan 0203, section 6).
 *
 * `removing` is the newest removing change of each line, of those this viewer
 * is shown. A change makes a row when its line is not covered now and no
 * covered row carries its name:
 *
 * - a line that is covered again was raised or approved since, and is an
 *   ordinary row;
 * - a line whose name a covered row still carries marks that row instead, which
 *   {@link foldMarks} does while the change is marked;
 * - a line that is gone from the database was absorbed by a merge, and has no
 *   text to draw.
 *
 * Several lines of one key are one row. It is `marked` while any of their
 * removals is.
 */
export function foldRemoved(
  removing: readonly RemovingChangeRow[],
  covered: readonly ChangeLineRow[],
  lines: ReadonlyMap<string, ChangeLineRow>,
  keyOf: LineKeyOf
): RemovedGroup[] {
  const coveredIds = new Set(covered.map((line) => line.id));
  const coveredKeys = new Set(covered.map((line) => keyOf(line)));
  /** The gone lines, by key. */
  const gone = new Map<
    string,
    { line: ChangeLineRow; content: string; marked: boolean }[]
  >();

  // Oldest first, so the lines of a group stand in the order they left.
  for (const change of [...removing].reverse()) {
    const line = lines.get(change.lineId);
    if (!line || coveredIds.has(line.id)) {
      continue;
    }
    const key = keyOf(line);
    if (coveredKeys.has(key)) {
      continue;
    }
    // The text the change recorded, which is what a deletion keeps, and the
    // line's own where the change moved no text.
    const entry = {
      line,
      content: change.contentBefore ?? line.content,
      marked: change.marked,
    };
    const held = gone.get(key);
    if (held) {
      held.push(entry);
    } else {
      gone.set(key, [entry]);
    }
  }

  const removed: RemovedGroup[] = [];
  for (const [key, entries] of gone) {
    const anchor = earliest(entries.map((entry) => entry.line));
    removed.push({
      key,
      rowKey: anchor.id,
      content:
        entries.find((entry) => entry.line.id === anchor.id)?.content ??
        anchor.content,
      lineIds: entries.map((entry) => entry.line.id),
      marked: entries.some((entry) => entry.marked),
    });
  }
  return removed;
}

/**
 * Whether this change is the line **entering** the coverage rather than moving
 * inside it.
 *
 * An add, a quantity raised off zero, or a rejection lifted. All three are a line
 * the basket did not hold a moment ago, which is what `ADDED` means on a row: the
 * row's own history before that is not something the shopper was ever shown.
 */
function enteredCoverage(change: ChangeRow): boolean {
  if (change.kind === LineChangeKind.ADDED) {
    return true;
  }
  if (
    change.kind === LineChangeKind.QUANTITY_CHANGED &&
    change.quantityBefore === 0
  ) {
    return true;
  }
  return (
    change.kind === LineChangeKind.APPROVAL_CHANGED &&
    change.approvalBefore === LineApprovalStatus.REJECTED
  );
}

/** `ADDED` beats `CHANGED`, and anything beats nothing. */
function strongest(
  held: BasketRowMark | undefined,
  next: BasketRowMark
): BasketRowMark {
  if (held === BasketRowMark.ADDED || next === BasketRowMark.ADDED) {
    return BasketRowMark.ADDED;
  }
  return held ?? next;
}

/** The earliest line by `(createdAt, id)`, the order a row's anchor is chosen in. */
function earliest(lines: readonly ChangeLineRow[]): ChangeLineRow {
  return lines.reduce((held, line) => {
    const a = new Date(line.createdAt).getTime();
    const b = new Date(held.createdAt).getTime();
    if (a < b || (a === b && line.id < held.id)) {
      return line;
    }
    return held;
  });
}
