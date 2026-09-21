import { PURCHASE_SESSION_GAP_MS } from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import type { LineClaimService } from '../../baskets/line-claim.service';
import type { ListAccessService } from '../list-access.service';
import {
  STAPLE_SESSION_MIN_LINES,
  STAPLE_TRIPS,
} from './suggestions.constants';
import { SuggestionsService } from './suggestions.service';
import {
  SUGGESTION_CANDIDATES_SQL,
  SUGGESTION_LAST_ASKED_SQL,
  SUGGESTION_PURCHASES_SQL,
  SUGGESTION_RECENT_TRIPS_SQL,
} from './suggestions.sql';

/**
 * What the suggestions service decides between its queries (plan 0142,
 * section 8.2).
 *
 * Which trips and which purchases come back is proven against a real database
 * in `suggestions.integration.spec.ts`. What is here is the one comparison the
 * service makes itself, which CI would otherwise never run: the integration
 * suite has its own target and needs a slot, and `nx affected -t test` runs
 * neither.
 */

const LIST = '11111111-1111-4111-8111-111111111111';
const LINE = '22222222-2222-4222-8222-222222222222';
const BASKET = '33333333-3333-4333-8333-333333333333';
const USER = 'u-reader';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/** Four trips that all wanted the line, so the staple rule says it is due. */
const STAPLE_TRIP_ROWS = [1, 2, 3, 4].map((n) => ({
  tripId: `t-${n}`,
  lineIds: [LINE],
}));

function build(answers: Record<string, unknown[]>) {
  const queries: { sql: string; parameters: unknown[] }[] = [];
  const dataSource = {
    query: async (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return answers[sql] ?? [];
    },
  } as unknown as DataSource;
  const listAccess = {
    requireRead: async () => undefined,
  } as unknown as ListAccessService;
  const claims = {
    since: () => daysAgo(3),
    skipWindow: () => 60_000,
  } as unknown as LineClaimService;
  return {
    service: new SuggestionsService(dataSource, listAccess, claims),
    queries,
  };
}

/**
 * The quantity of one candidate, over a history of one purchase and a staple
 * that is due whatever the clock says.
 *
 * `lastBoughtOn` is the basket the purchase came off, and null is the list
 * page. `asked` is what the newest ended basket asked and when, or null for a
 * line no basket ever asked for.
 */
async function quantityOf(options: {
  lastBoughtOn: string | null;
  asked: { asked: number; tripId: string; startedAt: Date } | null;
}): Promise<number> {
  const w = build({
    [SUGGESTION_CANDIDATES_SQL]: [{ lineId: LINE, position: 1 }],
    [SUGGESTION_PURCHASES_SQL]: [
      {
        lineId: LINE,
        settledAt: daysAgo(4),
        quantity: 2,
        basketId: options.lastBoughtOn,
      },
    ],
    [SUGGESTION_RECENT_TRIPS_SQL]: STAPLE_TRIP_ROWS,
    [SUGGESTION_LAST_ASKED_SQL]: options.asked
      ? [{ lineId: LINE, ...options.asked }]
      : [],
  });

  const page = await w.service.list({ userId: USER, listId: LIST });
  return page.items[0].quantity;
}

describe('the quantity of a suggestion (plan 0142, section 8.2)', () => {
  it('follows the basket trip when the line was last bought on it', async () => {
    expect(
      await quantityOf({
        lastBoughtOn: BASKET,
        // Older than the purchase, and still the last word on the line,
        // because the purchase came off it.
        asked: { asked: 5, tripId: BASKET, startedAt: daysAgo(4) },
      })
    ).toBe(5);
  });

  it('follows the basket trip when the trip is newer than the last purchase', async () => {
    expect(
      await quantityOf({
        lastBoughtOn: null,
        asked: { asked: 5, tripId: BASKET, startedAt: daysAgo(2) },
      })
    ).toBe(5);
  });

  // Without this a basket from last spring would decide the quantity for a
  // household that has shopped from the permanent basket every week since: a
  // session asks for nothing, so it can never replace the number.
  it('follows the last purchase when a newer session overtook the basket', async () => {
    expect(
      await quantityOf({
        lastBoughtOn: null,
        asked: { asked: 5, tripId: BASKET, startedAt: daysAgo(30) },
      })
    ).toBe(2);
  });

  it('follows the last purchase when no basket ever asked for the line', async () => {
    expect(await quantityOf({ lastBoughtOn: null, asked: null })).toBe(2);
  });
});

describe('what the trips read is asked for', () => {
  it('carries the session gap, the clock and the errand floor', async () => {
    const w = build({
      [SUGGESTION_CANDIDATES_SQL]: [{ lineId: LINE, position: 1 }],
    });

    await w.service.list({ userId: USER, listId: LIST });

    const trips = w.queries.find(
      (query) => query.sql === SUGGESTION_RECENT_TRIPS_SQL
    );
    expect(trips?.parameters.slice(0, 4)).toEqual([
      LIST,
      [LINE],
      STAPLE_TRIPS,
      PURCHASE_SESSION_GAP_MS,
    ]);
    // `now` is taken once by the caller and handed down, so no rule below
    // reads a clock of its own.
    expect(trips?.parameters[4]).toBeInstanceOf(Date);
    expect(trips?.parameters[5]).toBe(STAPLE_SESSION_MIN_LINES);
  });

  it('reads the four statements one after the other, never together', async () => {
    const w = build({
      [SUGGESTION_CANDIDATES_SQL]: [{ lineId: LINE, position: 1 }],
    });

    await w.service.list({ userId: USER, listId: LIST });

    expect(w.queries.map((query) => query.sql)).toEqual([
      SUGGESTION_CANDIDATES_SQL,
      SUGGESTION_PURCHASES_SQL,
      SUGGESTION_RECENT_TRIPS_SQL,
      SUGGESTION_LAST_ASKED_SQL,
    ]);
  });
});
