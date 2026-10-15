import {
  lineProductOf,
  needsPriceChoice,
} from '@portfolio/luna-shopper/basket-rules';
import { basketProgressOf, rebuildBasketRow } from './basket-row-fold';
import type {
  Basket,
  BasketEntryAct,
  BasketRow,
  BasketRowEntry,
} from './basket-view';
import type { BasketChangeMark, BasketRowNote, BasketRowState } from './enums';

/**
 * The state of one line as one basket reads it, from a `basket.linesChanged`
 * event or from the answer of a write (backend `0204`, section 2; velista
 * `0143`, section 1).
 *
 * Every value is absolute, so applying a patch twice gives what applying it once
 * gives. It carries nothing a patch must not change: no list, no name, no
 * product of the line and no `demandEditable`.
 */
export interface BasketEntryPatch {
  readonly lineId: string;
  /** `list_lines.version` after the write. */
  readonly version: number;
  readonly left: number;
  readonly bought: number;
  readonly boughtElsewhere: number;
  readonly state: BasketRowState;
  /** The wire's `approvalStatus` is `PENDING`. */
  readonly awaitingApproval: boolean;
  readonly skipped: boolean;
  readonly closed: boolean;
  readonly act: BasketEntryAct | null;
  /** The product of the latest standing buy of the line in this trip, or null. */
  readonly tripItemId: string | null;
}

/**
 * The fields of an entry that a patch carries. A write answers whole entries,
 * and the store applies them as patches (velista `0143`, section 6).
 */
export function basketEntryPatchOf(entry: BasketRowEntry): BasketEntryPatch {
  return {
    lineId: entry.lineId,
    version: entry.version,
    left: entry.left,
    bought: entry.bought,
    boughtElsewhere: entry.boughtElsewhere,
    state: entry.state,
    awaitingApproval: entry.awaitingApproval,
    skipped: entry.skipped,
    closed: entry.closed,
    act: entry.act,
    tripItemId: entry.tripItemId,
  };
}

/** What {@link applyBasketPatch} answers when only a read can say what is true. */
export const BASKET_PATCH_READ = 'read';

/**
 * Apply the lines of one event, or of one write answer, to the basket held
 * (velista `0143`, sections 2 and 3).
 *
 * The new basket, or `'read'` when the patch cannot be applied honestly. **When
 * in doubt, read**: no answer of this function draws a state the server would
 * not answer.
 *
 * For each line of `lineIds`:
 *
 * | The line | What happens |
 * | --- | --- |
 * | Has a patch, an entry holds it | the entry takes the fields of the patch |
 * | Has a patch, no row holds it | `'read'`: the line is new to this client |
 * | Has no patch, an entry holds it | the entry goes, and a row with none left goes |
 * | Has no patch, no row holds it | nothing |
 *
 * The order of two states of one entry (backend `0204`, "What the build
 * decided", point 1):
 *
 * - A patch older than the entry is dropped.
 * - At an equal version a patch whose `skipped` or `closed` differs from the
 *   entry answers `'read'`: a skip and a close move no version, so either one
 *   can be the newer.
 *
 * And four more reasons to read:
 *
 * - **`tripItemId` names another product than the row's** (backend `0201`), or
 *   is taken back from a line whose product then is not the row's, or depends
 *   on a price. The line belongs to another row, and only a read knows it.
 * - **`skipped` moves.** The note of a skip needs more than the plan's sentence
 *   to write in that direction (section 3), so the plan's exit is taken.
 * - **`boughtElsewhere` of a row moves.** Its note says through which surface
 *   and when the newest such buy was made, and a patch carries neither.
 * - **A skip note leaves a row that bought elsewhere.** The note it hid is one
 *   this client was never sent.
 *
 * The rows a patch touches are rebuilt with the shared rules, and the progress
 * is counted over the rows with them (`progressOf`), as the server counts it.
 *
 * @param lineIds The lines the event names. Empty means the coverage moved,
 *   which only a read answers.
 */
export function applyBasketPatch(
  basket: Basket,
  lineIds: readonly string[],
  entries: readonly BasketEntryPatch[]
): Basket | typeof BASKET_PATCH_READ {
  if (lineIds.length === 0) {
    return BASKET_PATCH_READ;
  }
  const patches = new Map(entries.map((patch) => [patch.lineId, patch]));
  const touched = new Set([...lineIds, ...patches.keys()]);

  const held = new Set<string>();
  for (const row of basket.rows) {
    for (const entry of row.entries) {
      held.add(entry.lineId);
    }
  }
  for (const lineId of patches.keys()) {
    if (!held.has(lineId)) {
      return BASKET_PATCH_READ;
    }
  }

  let moved = false;
  const rows: BasketRow[] = [];
  for (const row of basket.rows) {
    if (!row.entries.some((entry) => touched.has(entry.lineId))) {
      rows.push(row);
      continue;
    }

    let rowMoved = false;
    const next: BasketRowEntry[] = [];
    for (const entry of row.entries) {
      if (!touched.has(entry.lineId)) {
        next.push(entry);
        continue;
      }
      const patch = patches.get(entry.lineId);
      if (patch === undefined) {
        rowMoved = true;
        continue;
      }
      const applied = patchEntry(row, entry, patch);
      if (applied === BASKET_PATCH_READ) {
        return BASKET_PATCH_READ;
      }
      rowMoved ||= applied !== entry;
      next.push(applied);
    }

    if (!rowMoved) {
      rows.push(row);
      continue;
    }
    moved = true;
    if (next.length === 0) {
      continue;
    }
    const rebuilt = rebuildBasketRow(row, next);
    const note = noteAfter(row, rebuilt);
    if (note === BASKET_PATCH_READ) {
      return BASKET_PATCH_READ;
    }
    rows.push(
      note.note === rebuilt.note && note.noteAt === rebuilt.noteAt
        ? rebuilt
        : { ...rebuilt, ...note }
    );
  }

  if (!moved) {
    return basket;
  }
  const { progress, pending } = basketProgressOf(rows);
  return { ...basket, rows, progress, pending };
}

/**
 * One entry with the fields of its patch, the entry itself when the patch is
 * older or changes nothing, or `'read'`.
 */
function patchEntry(
  row: BasketRow,
  entry: BasketRowEntry,
  patch: BasketEntryPatch
): BasketRowEntry | typeof BASKET_PATCH_READ {
  if (entry.version > patch.version) {
    return entry;
  }
  if (patch.skipped !== entry.skipped) {
    // At an equal version this is the order rule of backend `0204`. At a newer
    // one it is the exit of section 3: the note of a skip is not written here.
    return BASKET_PATCH_READ;
  }
  if (entry.version === patch.version && patch.closed !== entry.closed) {
    return BASKET_PATCH_READ;
  }
  if (!staysInRow(row, entry, patch.tripItemId)) {
    return BASKET_PATCH_READ;
  }
  if (samePatched(entry, patch)) {
    return entry;
  }
  return {
    ...entry,
    version: patch.version,
    left: patch.left,
    bought: patch.bought,
    asked: patch.bought + patch.left,
    boughtElsewhere: patch.boughtElsewhere,
    state: patch.state,
    awaitingApproval: patch.awaitingApproval,
    skipped: patch.skipped,
    closed: patch.closed,
    act: patch.act,
    tripItemId: patch.tripItemId,
  };
}

/**
 * Whether the line still counts as the product of the row that holds it, with
 * this `tripItemId` (backend `0201`, section 1).
 */
function staysInRow(
  row: BasketRow,
  entry: BasketRowEntry,
  tripItemId: string | null
): boolean {
  if (tripItemId !== null) {
    return tripItemId === row.productId;
  }
  if (entry.tripItemId === null) {
    return true;
  }
  // The buy of this trip was taken back. The line falls back to its favourite or
  // its first product, unless the server picks it by price, which it alone can.
  const line = {
    itemIds: entry.itemIds,
    favoriteItemId: entry.favoriteItemId,
    tripItemId: null,
  };
  return !needsPriceChoice(line) && lineProductOf(line) === row.productId;
}

function samePatched(entry: BasketRowEntry, patch: BasketEntryPatch): boolean {
  return (
    entry.version === patch.version &&
    entry.left === patch.left &&
    entry.bought === patch.bought &&
    entry.boughtElsewhere === patch.boughtElsewhere &&
    entry.state === patch.state &&
    entry.awaitingApproval === patch.awaitingApproval &&
    entry.skipped === patch.skipped &&
    entry.closed === patch.closed &&
    entry.tripItemId === patch.tripItemId &&
    sameAct(entry.act, patch.act)
  );
}

function sameAct(a: BasketEntryAct | null, b: BasketEntryAct | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.at === b.at &&
      a.outcome === b.outcome &&
      a.participantId === b.participantId)
  );
}

/** The states that carry no skip note, by `noteOf` of core. */
const NO_SKIP_NOTE: readonly BasketRowState[] = [
  'SKIPPED',
  'DONE',
  'BOUGHT_ELSEWHERE',
  'REMOVED',
];

/**
 * The note of a row after a patch, by the rule of core's `noteOf` (velista
 * `0143`, section 3), or `'read'`.
 *
 * - **A skip note** is said when the row is in a state that carries one and a
 *   skip still stands on one of its lines. A skip stands exactly while it is
 *   the newest act of its line (core's `actOf` and `SKIP_STANDS`), so the note
 *   and its time are read off the entries.
 * - **Otherwise the note of a buy made elsewhere**, which is kept as the read
 *   sent it. The caller already answered `'read'` when the row's
 *   `boughtElsewhere` moved, so that note cannot have changed, unless a skip
 *   note hid it: then this client was never sent it.
 */
function noteAfter(
  before: BasketRow,
  after: BasketRow
): Pick<BasketRow, 'note' | 'noteAt'> | typeof BASKET_PATCH_READ {
  if (after.boughtElsewhere !== before.boughtElsewhere) {
    return BASKET_PATCH_READ;
  }
  const skipAt = NO_SKIP_NOTE.includes(after.state)
    ? null
    : standingSkipAt(after.entries);
  if (skipAt !== null) {
    return { note: 'SKIPPED_EARLIER', noteAt: new Date(skipAt) };
  }
  if (before.note === 'SKIPPED_EARLIER') {
    return after.boughtElsewhere > 0
      ? BASKET_PATCH_READ
      : { note: null, noteAt: null };
  }
  return isElsewhereNote(before.note)
    ? { note: before.note, noteAt: before.noteAt }
    : { note: null, noteAt: null };
}

function isElsewhereNote(note: BasketRowNote | null): boolean {
  return note === 'BOUGHT_ON_ANOTHER_BASKET' || note === 'BOUGHT_ON_THE_LIST';
}

/** The newest skip that still stands over these entries, as the server wrote it. */
function standingSkipAt(entries: readonly BasketRowEntry[]): string | null {
  let at: string | null = null;
  for (const entry of entries) {
    if (
      entry.act?.outcome === 'SKIPPED' &&
      (at === null || entry.act.at > at)
    ) {
      at = entry.act.at;
    }
  }
  return at;
}

/**
 * The marks of a basket's lines and the two numbers of the banner, as
 * `GET /v1/baskets/:id/changes/marks` answers them (backend `0204`, section 6).
 */
export interface BasketMarks {
  readonly unseenChangeCount: number;
  readonly newestUnseenChangeId: string | null;
  /** The mark of each covered line that carries one, by line id. */
  readonly lines: ReadonlyMap<string, BasketChangeMark>;
}

/**
 * Put a marks read on the rows held (velista `0143`, section 4).
 *
 * Each row takes the mark of its lines: `ADDED` wins over `CHANGED`, and a row
 * with no marked line has none. A `REMOVED` row keeps the mark it has, because
 * its lines left the coverage and the marks read names none of them. The two
 * numbers of the banner are replaced by the answer.
 *
 * A row whose mark did not move is the same object, so nothing above it is
 * drawn again.
 */
export function applyBasketMarks(basket: Basket, marks: BasketMarks): Basket {
  const rows = basket.rows.map((row) => {
    if (row.state === 'REMOVED') {
      return row;
    }
    let mark: BasketChangeMark | null = null;
    for (const entry of row.entries) {
      const held = marks.lines.get(entry.lineId);
      if (held === 'ADDED') {
        mark = 'ADDED';
        break;
      }
      if (held === 'CHANGED') {
        mark = 'CHANGED';
      }
    }
    return mark === row.mark ? row : { ...row, mark };
  });
  return {
    ...basket,
    rows,
    unseenChangeCount: marks.unseenChangeCount,
    newestUnseenChangeId: marks.newestUnseenChangeId,
  };
}
