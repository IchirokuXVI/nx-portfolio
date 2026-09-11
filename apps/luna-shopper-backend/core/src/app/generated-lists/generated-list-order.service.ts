import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GeneratedListStatus } from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { GeneratedList } from '../entities';
import { ORDER_HISTORY_SQL, type OrderHistoryRow } from './generated-list.sql';
import { normalizeContent } from './line-dedup';

/**
 * What counts as a trip that already happened (plan 0110, section 2).
 *
 * `ARCHIVED` is in it because archiving hides a basket from the listing without
 * saying anything about whether it was shopped, and the sweep turns a forgotten
 * basket into a `COMPLETED` one. A live basket is deliberately out: the shopper
 * is still walking it, so its offsets are a fragment of a trip rather than one.
 */
const PAST_TRIP_STATUSES: readonly GeneratedListStatus[] = [
  GeneratedListStatus.COMPLETED,
  GeneratedListStatus.ARCHIVED,
];

/** How many past trips the order is read from (section 2). */
const TRIPS = 7;

/** The little a line has to carry to be ordered: its text and its products. */
export interface OrderableLine {
  content: string;
  options: string[];
}

/**
 * The order a shopper walks (plan 0110).
 *
 * A basket's lines used to be written in the order the source lists happened to
 * be read, list by list, position by position. Somebody who has shopped the same
 * supermarket every Saturday for a year settles milk, then skimmed milk three
 * seconds later, then juice ten seconds after that, because those are aisles,
 * and the list still put the juice first because it was written first.
 *
 * So a new basket takes its order from **the timing of the owner's own past
 * trips**: for each line, the median of how many seconds into a trip that shelf
 * was settled, over the trips it appears in. Lines with no history come after,
 * alphabetically, which is already a better order than the one they had.
 *
 * ## Once, at creation, and never again
 *
 * `GeneratedListService.create` calls {@link order} between composing and
 * writing, and nothing recomputes afterwards. A typed line takes
 * `MAX(position) + 1`, a split takes the midpoint, the owner's reorder route
 * rewrites them all, and a settle changes nothing. A shopping list that
 * rearranges itself while somebody is in the shop is hostile, which is the same
 * reasoning that makes the basket a snapshot (plan 0050, section 4).
 *
 * ## What it does not key on
 *
 * Not the profile: `generated_lists` carries no profile column, and the owner's
 * trips are the owner's wherever they shopped. Not a similar name and not a
 * product in the same group: a wrong match puts the bread in the dairy aisle,
 * which is worse than no order at all.
 */
@Injectable()
export class GeneratedListOrderService {
  constructor(
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>
  ) {}

  /**
   * The composed lines, reordered into the order the owner walks.
   *
   * One query, bounded by seven trips' lines and settlements, on indexes that
   * exist (`ix_generated_lists_owner`, `ix_settlements_basket_line_live`). No
   * cache: a create is rare and the answer changes with every trip.
   *
   * A basket with no lines asks nothing, because there is nothing to order.
   */
  async order<T extends OrderableLine>(
    userId: string,
    composed: T[]
  ): Promise<T[]> {
    if (composed.length === 0) {
      return composed;
    }
    const rows = await this.lists.query<OrderHistoryRow[]>(ORDER_HISTORY_SQL, [
      userId,
      [...PAST_TRIP_STATUSES],
      TRIPS,
    ]);
    const history = index(rows);

    // Two buckets rather than one comparator, because the second half is not
    // sorted on a missing offset: it is sorted on the text, and a comparator
    // that had to express both would be read wrong by the next person.
    const walked: { line: T; offset: number }[] = [];
    const unwalked: { line: T; key: string }[] = [];
    for (const line of composed) {
      const offset = medianOffset(history, line);
      if (offset === null) {
        unwalked.push({ line, key: normalizeContent(line.content) });
      } else {
        walked.push({ line, offset });
      }
    }

    // `sort` is stable, so two shelves the shopper reaches at the same moment
    // keep the order the run composed them in.
    walked.sort((a, b) => a.offset - b.offset);
    unwalked.sort((a, b) => compareKeys(a.key, b.key));
    return [
      ...walked.map((entry) => entry.line),
      ...unwalked.map((entry) => entry.line),
    ];
  }
}

/** One shelf, on one trip, however the line naming it was keyed. */
interface Visit {
  tripId: string;
  offsetSeconds: number;
}

/** The past trips, under both of the keys section 2.1 matches on. */
interface History {
  byItem: Map<string, Visit[]>;
  byText: Map<string, Visit[]>;
}

/**
 * The history rows under both keys at once.
 *
 * A row is filed under every product that identifies it **and** under its
 * normalized text, rather than under whichever key it happens to have: which key
 * is used is the composed line's question, asked in {@link medianOffset}, and a
 * row filed under one key could not answer the other.
 */
function index(rows: OrderHistoryRow[]): History {
  const byItem = new Map<string, Visit[]>();
  const byText = new Map<string, Visit[]>();
  for (const row of rows) {
    const visit: Visit = {
      tripId: row.tripId,
      offsetSeconds: row.offsetSeconds,
    };
    for (const itemId of itemIdsOf(row)) {
      file(byItem, itemId, visit);
    }
    file(byText, normalizeContent(row.content), visit);
  }
  return { byItem, byText };
}

/** The pick and everything a settlement on it copied, without duplicates. */
function itemIdsOf(row: OrderHistoryRow): string[] {
  const ids = new Set(row.settledItemIds ?? []);
  if (row.pickItemId) {
    ids.add(row.pickItemId);
  }
  return [...ids];
}

function file(into: Map<string, Visit[]>, key: string, visit: Visit): void {
  const existing = into.get(key);
  if (existing) {
    existing.push(visit);
    return;
  }
  into.set(key, [visit]);
}

/**
 * How far into a trip this line usually sits, or null when it has no history.
 *
 * **The product first, the text second** (section 2.1), and the second is only
 * reached when the first finds nothing. The product is an identity and the text
 * is a spelling: two households typing "leche" and "Milk" for the same carton
 * meet on the product and would never meet on the text, and a free text line has
 * no product and nothing but its text.
 */
function medianOffset(history: History, line: OrderableLine): number | null {
  const byProduct = line.options.flatMap(
    (itemId) => history.byItem.get(itemId) ?? []
  );
  if (byProduct.length > 0) {
    return median(byProduct);
  }
  const byText = history.byText.get(normalizeContent(line.content)) ?? [];
  return byText.length > 0 ? median(byText) : null;
}

/**
 * The median offset over the trips these visits belong to.
 *
 * **One value per trip**, the earliest, before the median is taken. A composed
 * line matching two past lines of one trip, which is what a line split by the
 * product that was got leaves behind (plan 0094), is still one visit to one
 * shelf and must not weigh twice as much as a trip that had one.
 *
 * The median rather than the mean, because a trip where the shopper doubled back
 * for the milk they forgot should not drag the milk to the end of every basket
 * afterwards. One trip is a median of one.
 */
function median(visits: Visit[]): number {
  const perTrip = new Map<string, number>();
  for (const visit of visits) {
    const earliest = perTrip.get(visit.tripId);
    if (earliest === undefined || visit.offsetSeconds < earliest) {
      perTrip.set(visit.tripId, visit.offsetSeconds);
    }
  }
  const offsets = [...perTrip.values()].sort((a, b) => a - b);
  const middle = Math.floor(offsets.length / 2);
  return offsets.length % 2 === 1
    ? offsets[middle]
    : (offsets[middle - 1] + offsets[middle]) / 2;
}

/**
 * A to Z over already normalized text, so accents and case do not get in the
 * way.
 *
 * A plain comparison rather than `localeCompare`, because the fold has already
 * happened and the server must not order one shopper's basket differently from
 * another's on whatever locale the process happens to be running under.
 */
function compareKeys(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
