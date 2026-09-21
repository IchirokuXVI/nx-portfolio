import { Injectable } from '@nestjs/common';
import { PURCHASE_SESSION_GAP_MS } from '@portfolio/luna-shopper/contracts';
import { DataSource } from 'typeorm';
import { WALK_HISTORY_SQL, type WalkHistoryRow } from './basket-order.sql';
import { normalizeContent } from './line-dedup';

/**
 * How far back the history is read. 180 days.
 *
 * A named constant beside the rule rather than an environment variable, for the
 * reason `suggestions.constants.ts` gives: it is a product rule, and a cluster
 * that answered a different rule from the one the specs prove is a bug nobody
 * can reproduce. The horizon exists only to bound the window. A shop somebody
 * has not visited for half a year was rearranged since.
 */
export const WALK_HISTORY_HORIZON_MS = 180 * 24 * 60 * 60 * 1000;

/** How many past sessions the order is read from (plan 0141, section 3.2). */
export const WALK_SESSIONS = 7;

/** The little a row has to carry to be ordered. */
export interface OrderableRow {
  /** The anchor's list line id (plan 0130, section 3). The last tie break. */
  key: string;
  content: string;
  /** The union of the entries' product sets. Empty for free text. */
  optionIds: string[];
}

/**
 * The order a shopper walks (plan 0110, learned from sessions by plan 0141).
 *
 * A basket's rows would otherwise come out in whatever order the source lists
 * happened to be read. Somebody who has shopped the same supermarket every
 * Saturday for a year settles milk, then skimmed milk three seconds later, then
 * juice ten seconds after that, because those are aisles, and the list still put
 * the juice first because it was written first.
 *
 * So a basket takes its order from **the timing of the owner's own past
 * sessions**: for each row, the median of how many seconds into a session that
 * shelf was settled, over the sessions it appears in. Rows with no history come
 * after, alphabetically, which is already a better order than the one they had.
 *
 * ## A session is a run of one owner's purchases across every basket they own
 *
 * Plan 0130 section 3 defines a session as a run of one basket's purchases.
 * **Here it is a run of one owner's purchases across every basket they own**,
 * because a shopper who settles two rows on a generated basket and one on the
 * `LIVE` basket in the same aisle walked one shop. A session breaks wherever the
 * silence before a purchase is longer than `PURCHASE_SESSION_GAP_MS`.
 *
 * ## Asked on every read, and still unable to move a row under a thumb
 *
 * Plan 0110 wrote the order once, into a `position` column, and said a shopping
 * list that rearranges itself while somebody is in the shop is hostile. Plan
 * 0136 deleted that column and the basket it belonged to, so the order is
 * computed on every read instead. The reason survives, carried by two rules
 * rather than by a column:
 *
 * 1. **The current session teaches nothing.** A session is current while its
 *    newest purchase is younger than one gap, and {@link WALK_HISTORY_SQL}
 *    leaves it out, so settling milk does not change where milk, or anything
 *    else, is drawn.
 * 2. **The order is a pure function.** A row's slot depends on the history and
 *    on that row's own text and products, and on nothing else. So the same
 *    basket read twice in one shop gives the same order, on any pod, whatever
 *    arrived in between. Nothing here leans on the order the rows came in.
 *
 * The history moves only **between** shops. When a shopper comes back after more
 * than six hours, the session they finished last time joins the seven, the
 * oldest of the seven leaves, and the basket opens in the new order. Nobody is
 * holding the phone at that moment.
 *
 * ## What it does not key on
 *
 * Not the shop: `generated_lists` carries a `pricingProfileId` since plan 0133
 * and a settlement a `priceScopeId`, and neither is read here (plan 0141,
 * section 7). Not a similar name and not a product in the same group: a wrong
 * match puts the bread in the dairy aisle, which is worse than no order at all.
 */
@Injectable()
export class BasketOrderService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The rows, in the order the owner walks them.
   *
   * `ownerUserId` is the basket's owner, never the reader's account: a named
   * person shopping somebody else's basket sees the owner's order, or four
   * people in one shop would look at four different screens of one basket and
   * "it is near the top" would stop being something they can say to each other
   * (plan 0141, section 3.1).
   *
   * `now` is an argument and never a clock read inside a rule, which is the
   * convention of `suggestion-rules.ts` and what lets a spec state the rule.
   *
   * One query, through the `DataSource` and outside any transaction, bounded by
   * the owner's baskets (`ix_generated_lists_owner`) and their standing
   * settlements (`ix_settlements_basket_live`). **No cache**: core runs more than
   * one replica, and two pods holding histories of different ages would answer
   * two orders for one basket, which is a row moving under a thumb produced by
   * the thing meant to make the read cheaper (section 3.4).
   *
   * A basket with no rows asks nothing, because there is nothing to order.
   */
  async order<T extends OrderableRow>(
    ownerUserId: string,
    rows: T[],
    now: Date
  ): Promise<T[]> {
    if (rows.length === 0) {
      return rows;
    }
    const history = index(
      await this.dataSource.query<WalkHistoryRow[]>(WALK_HISTORY_SQL, [
        ownerUserId,
        new Date(now.getTime() - WALK_HISTORY_HORIZON_MS),
        PURCHASE_SESSION_GAP_MS,
        now,
        WALK_SESSIONS,
      ])
    );

    // Two buckets rather than one comparator, because the second half is not
    // sorted on a missing offset: it is sorted on the text, and a comparator
    // that had to express both would be read wrong by the next person.
    const walked: Slotted<T>[] = [];
    const unwalked: Slotted<T>[] = [];
    for (const row of rows) {
      const text = normalizeContent(row.content);
      const offset = medianOffset(history, row);
      if (offset === null) {
        unwalked.push({ row, text, offset: 0 });
      } else {
        walked.push({ row, text, offset });
      }
    }

    // The text and then the key break every tie, in both halves. Leaning on the
    // order the input arrived in, which is what a stable sort would do, breaks
    // rule 2 above: the rows arrive in whatever order the grouping produced.
    walked.sort(
      (a, b) =>
        a.offset - b.offset ||
        compareKeys(a.text, b.text) ||
        compareKeys(a.row.key, b.row.key)
    );
    unwalked.sort(
      (a, b) => compareKeys(a.text, b.text) || compareKeys(a.row.key, b.row.key)
    );
    return [...walked, ...unwalked].map((slotted) => slotted.row);
  }
}

/** A row with the two things its slot is decided by. */
interface Slotted<T extends OrderableRow> {
  row: T;
  /** `normalizeContent(row.content)`, folded once rather than per comparison. */
  text: string;
  /** Meaningless for an unwalked row, which is sorted on the text alone. */
  offset: number;
}

/** One shelf, in one session, however the line naming it was keyed. */
interface Visit {
  sessionId: string;
  offsetSeconds: number;
}

/** The past sessions, under both of the keys plan 0110 section 2.1 matches on. */
interface History {
  byItem: Map<string, Visit[]>;
  byText: Map<string, Visit[]>;
}

/**
 * The history rows under both keys at once.
 *
 * A row is filed under every product that identifies it **and** under its
 * normalized text, rather than under whichever key it happens to have: which key
 * is used is the basket row's question, asked in {@link medianOffset}, and a row
 * filed under one key could not answer the other.
 */
function index(rows: WalkHistoryRow[]): History {
  const byItem = new Map<string, Visit[]>();
  const byText = new Map<string, Visit[]>();
  for (const row of rows) {
    const visit: Visit = {
      sessionId: row.sessionId,
      offsetSeconds: row.offsetSeconds,
    };
    for (const itemId of row.settledItemIds ?? []) {
      file(byItem, itemId, visit);
    }
    file(byText, normalizeContent(row.content), visit);
  }
  return { byItem, byText };
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
 * How far into a session this row usually sits, or null when it has no history.
 *
 * **The product first, the text second** (plan 0110, section 2.1), and the
 * second is only reached when the first finds nothing. The product is an
 * identity and the text is a spelling: two households typing "leche" and "Milk"
 * for the same carton meet on the product and would never meet on the text, and
 * a free text row has no product and nothing but its text.
 */
function medianOffset(history: History, row: OrderableRow): number | null {
  const byProduct = row.optionIds.flatMap(
    (itemId) => history.byItem.get(itemId) ?? []
  );
  if (byProduct.length > 0) {
    return median(byProduct);
  }
  const byText = history.byText.get(normalizeContent(row.content)) ?? [];
  return byText.length > 0 ? median(byText) : null;
}

/**
 * The median offset over the sessions these visits belong to.
 *
 * **One value per session**, the earliest, before the median is taken. A row
 * matching two past lines of one session, which is what two lines of one name in
 * two lists settled in one shop leave behind, is still one visit to one shelf
 * and must not weigh twice as much as a session that had one.
 *
 * The median rather than the mean, because a session where the shopper doubled
 * back for the milk they forgot should not drag the milk to the end of every
 * basket afterwards. One session is a median of one.
 */
function median(visits: Visit[]): number {
  const perSession = new Map<string, number>();
  for (const visit of visits) {
    const earliest = perSession.get(visit.sessionId);
    if (earliest === undefined || visit.offsetSeconds < earliest) {
      perSession.set(visit.sessionId, visit.offsetSeconds);
    }
  }
  const offsets = [...perSession.values()].sort((a, b) => a - b);
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
