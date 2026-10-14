import {
  lineProductOf,
  progressOf,
  rowNumbersOf,
  rowStateOf,
  type BasketRuleEntry,
} from '@portfolio/luna-shopper/basket-rules';
import type { BasketProgress, BasketRow, BasketRowEntry } from './basket-view';
import {
  BASKET_ROW_STATE_FALLBACK,
  BASKET_ROW_STATES,
  type BasketRowState,
} from './enums';

/**
 * Put the lines a write answered back into the rows a page holds (velista `0139`,
 * section 4; backend `0201`, section 4).
 *
 * A write answers lines and no row, because a row is a group the server makes
 * with the prices of a read. So the page does what core does with the same lines:
 * each answered line goes back into the row that held it, and that row's numbers
 * and state are rebuilt from its entries with `@portfolio/luna-shopper/basket-rules`,
 * the one rule core and this app both call. The read that follows every write is
 * where the row as the server groups it comes from.
 *
 * ## Four things it has to get right
 *
 * - **A named line that is not in the answer left the basket**, which is a demand
 *   taken to zero with no buy that keeps it. It is taken off its row, and a row
 *   left with no entry is dropped.
 * - **A line the page did not hold** is an add, or a list raised from zero. It
 *   joins the row of the product it counts as, or of its name when it holds no
 *   product, and makes a row of its own when no row is either. Its name comes from
 *   the catalog only after the read, so until then it draws its own words.
 * - **The anchor can leave.** A row keyed by a line that left is keyed by its
 *   oldest remaining line, which is what the server does too; a sheet over it
 *   follows the new key.
 * - **The list ids are gated** against the lists this reader was served, the same
 *   rule the read's mapper applies.
 *
 * It **never computes a number of its own**: every sum and state is the shared
 * rule's answer over the server's entries.
 *
 * @param named The lines the write named. A demand names one, a settle every line
 *   of the row.
 * @param served The list ids this reader was served.
 */
export function foldBasketEntries(
  rows: readonly BasketRow[],
  answered: readonly BasketRowEntry[],
  named: readonly string[],
  served: ReadonlySet<string>
): readonly BasketRow[] {
  const byLine = new Map(
    answered.map((entry) => [entry.lineId, gateEntry(entry, served)])
  );
  const touched = new Set([...named, ...byLine.keys()]);
  const placed = new Set<string>();

  const next: BasketRow[] = [];
  for (const row of rows) {
    if (!row.entries.some((entry) => touched.has(entry.lineId))) {
      next.push(row);
      continue;
    }
    const entries: BasketRowEntry[] = [];
    for (const entry of row.entries) {
      const fresh = byLine.get(entry.lineId);
      if (fresh !== undefined) {
        entries.push(fresh);
        placed.add(entry.lineId);
      } else if (!touched.has(entry.lineId)) {
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      next.push(rebuildBasketRow(row, entries));
    }
  }

  for (const entry of byLine.values()) {
    if (placed.has(entry.lineId)) {
      continue;
    }
    const productId = lineProductOf(entry);
    const at = next.findIndex((row) =>
      productId === null
        ? row.productId === null &&
          row.state !== 'REMOVED' &&
          sameName(row.content, entry.content)
        : row.productId === productId
    );
    if (at === -1) {
      next.push(rowOfOne(entry, productId));
    } else {
      const row = next[at];
      next[at] = rebuildBasketRow(row, [...row.entries, entry]);
    }
  }

  return next;
}

/**
 * Put these lines in the rows of the products they count as now (velista
 * `0140`, section 4).
 *
 * {@link foldBasketEntries} puts an answered line back in the row that held it,
 * because a write on a row does not change its product. A change of product does,
 * so the lines are first taken out of their rows and then added again, and the
 * second fold places each one with `lineProductOf` as an add. It is that function
 * twice and no rule of its own: a row the lines leave is rebuilt or dropped, and a
 * line joins the row of its new product or makes one.
 */
export function regroupBasketEntries(
  rows: readonly BasketRow[],
  entries: readonly BasketRowEntry[],
  served: ReadonlySet<string>
): readonly BasketRow[] {
  if (entries.length === 0) {
    return rows;
  }
  const named = entries.map((entry) => entry.lineId);
  const without = foldBasketEntries(rows, [], named, served);
  return foldBasketEntries(without, entries, named, served);
}

/**
 * The rows with the choices this device holds put on them (velista `0140`,
 * section 4): a product chosen for a line with no buy in this trip yet, which
 * nothing was sent for.
 *
 * A held choice is the product a buy would make the line follow, so it is put on
 * the entry where the server puts the product of a buy, `tripItemId`, and the
 * entry is grouped again by the shared rule. Only on this device and only until
 * the server states a buy of its own: an entry with a `tripItemId` is the
 * server's answer, and a held choice under it is spent.
 *
 * @param held The product held for each line, by line id.
 */
export function withHeldChoices(
  rows: readonly BasketRow[],
  held: ReadonlyMap<string, string>,
  served: ReadonlySet<string>
): readonly BasketRow[] {
  if (held.size === 0) {
    return rows;
  }
  const moved: BasketRowEntry[] = [];
  for (const row of rows) {
    for (const entry of row.entries) {
      const itemId = held.get(entry.lineId);
      if (
        itemId !== undefined &&
        entry.tripItemId === null &&
        row.productId !== itemId
      ) {
        moved.push({ ...entry, tripItemId: itemId });
      }
    }
  }
  return regroupBasketEntries(rows, moved, served);
}

/**
 * A row's numbers, state and last act from its entries, by the shared rule.
 *
 * The note, the change mark and `usual` are kept: they are facts the read states
 * about the row's past, which no entry carries, and the read after the write
 * replaces them.
 */
export function rebuildBasketRow(
  row: BasketRow,
  entries: readonly BasketRowEntry[]
): BasketRow {
  const rules = entries.map(toRuleEntry);
  const numbers = rowNumbersOf(rules);
  const anchor = entries[0];
  const keyLeft = !entries.some((entry) => entry.lineId === row.rowKey);
  return {
    ...row,
    rowKey: keyLeft && anchor !== undefined ? anchor.lineId : row.rowKey,
    // The anchor's words, as the server states `content` for every row (backend
    // `0201`, point 9), so a rename shows at once. A product row is still drawn
    // by the catalog's name.
    content:
      anchor !== undefined && anchor.content !== ''
        ? anchor.content
        : row.content,
    left: numbers.left,
    bought: numbers.bought,
    asked: numbers.asked,
    boughtElsewhere: numbers.boughtElsewhere,
    state: knownState(rowStateOf(rules)),
    awaitingApproval: entries.some((entry) => entry.awaitingApproval),
    touchedBy: numbers.act?.participantId ?? null,
    touchedAt: numbers.act === null ? null : toDate(numbers.act.at),
    entries,
  };
}

/**
 * The progress of a basket over the rows the page holds, and what is pending
 * (backend `0201`, "What the build decided", point 1).
 *
 * The page counts its header itself after a write, because the progress a write
 * answers is counted by core with no prices and can be one off the read's.
 */
export function basketProgressOf(rows: readonly BasketRow[]): {
  readonly progress: BasketProgress;
  readonly pending: number;
} {
  const counted = progressOf(rows);
  return {
    progress: {
      done: counted.done,
      unavailable: counted.unavailable,
      total: counted.total,
    },
    pending: counted.pending,
  };
}

function rowOfOne(entry: BasketRowEntry, productId: string | null): BasketRow {
  return rebuildBasketRow(
    {
      rowKey: entry.lineId,
      content: entry.content,
      productId,
      left: 0,
      bought: 0,
      asked: 0,
      boughtElsewhere: 0,
      state: 'WANTED',
      note: null,
      noteAt: null,
      mark: null,
      awaitingApproval: false,
      touchedBy: null,
      touchedAt: null,
      entries: [],
      usual: null,
    },
    [entry]
  );
}

function toRuleEntry(entry: BasketRowEntry): BasketRuleEntry {
  return {
    left: entry.left,
    bought: entry.bought,
    boughtElsewhere: entry.boughtElsewhere,
    skipped: entry.skipped,
    closed: entry.closed,
    act: entry.act,
  };
}

function gateEntry(
  entry: BasketRowEntry,
  served: ReadonlySet<string>
): BasketRowEntry {
  return entry.listId !== null && !served.has(entry.listId)
    ? { ...entry, listId: null }
    : entry;
}

/** The server's text key is the normalized name. This is near enough to it. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function toDate(at: string): Date | null {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A state of the shared rules that velista draws, or the fallback the mapper
 * gives an unknown state on the wire: a state added to the rules first must not
 * reach a template that has no branch for it.
 */
function knownState(state: string): BasketRowState {
  return (BASKET_ROW_STATES as readonly string[]).includes(state)
    ? (state as BasketRowState)
    : BASKET_ROW_STATE_FALLBACK;
}
