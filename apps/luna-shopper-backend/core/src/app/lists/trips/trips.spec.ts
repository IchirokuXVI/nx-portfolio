import {
  RealtimeEvent,
  SettlementOutcome,
  TripKind,
  TripRowOutcome,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import type { LineClaimService } from '../../generated-lists/line-claim.service';
import type { ListAccessService } from '../list-access.service';
import { announceTripsChanged } from './trips.announce';
import { toTripRowView, toTripView } from './trips.mappers';
import { TripsService } from './trips.service';
import {
  BASKET_TRIP_ROWS_SQL,
  ENDED_TRIPS_SQL,
  LIVE_TRIPS_SQL,
  LOOSE_TRIP_GAP_MS,
  LOOSE_TRIP_ROWS_SQL,
} from './trips.sql';

/**
 * The parts of the trips read that are not SQL (plan 0122).
 *
 * Which rows come back is proven against a real database in
 * `trips.integration.spec.ts`. What is left for a unit spec is what happens
 * around the queries: the outcome of a row, the access check coming first, the
 * shape of a cursor, and the event going out once a list.
 */

const LIST = '11111111-1111-4111-8111-111111111111';
const TRIP = '22222222-2222-4222-8222-222222222222';
const LINE = '33333333-3333-4333-8333-333333333333';
const USER = 'u-reader';

describe('what a trip did to a line (section 4)', () => {
  const basket = (asked: number, bought: number, lastOutcome: string | null) =>
    toTripRowView(TripKind.BASKET, {
      lineId: LINE,
      asked,
      bought,
      lastOutcome,
    });

  it.each([
    ['bought all of it', 2, 2, 'BOUGHT', TripRowOutcome.BOUGHT, 0],
    ['bought more than was asked', 2, 3, 'BOUGHT', TripRowOutcome.BOUGHT, 0],
    ['bought some of it', 3, 1, 'BOUGHT', TripRowOutcome.PARTLY, 2],
    [
      'was told there was none',
      1,
      0,
      'NOT_AVAILABLE',
      TripRowOutcome.NOT_AVAILABLE,
      1,
    ],
    [
      'ran out part way',
      3,
      1,
      'NOT_AVAILABLE',
      TripRowOutcome.NOT_AVAILABLE,
      2,
    ],
    ['touched nothing', 1, 0, null, TripRowOutcome.NOT_BOUGHT, 1],
    // Said there was none, went back and got the last of it: the line is bought.
    ['finished after a none', 2, 2, 'NOT_AVAILABLE', TripRowOutcome.BOUGHT, 0],
  ])('%s', (_name, asked, bought, lastOutcome, outcome, left) => {
    expect(basket(asked, bought, lastOutcome)).toEqual({
      lineId: LINE,
      asked,
      bought,
      left,
      outcome,
      settledByUserId: null,
    });
  });

  it('reads a loose row as its latest settlement, with nothing asked', () => {
    expect(
      toTripRowView(TripKind.LOOSE, {
        lineId: LINE,
        bought: 3,
        lastOutcome: SettlementOutcome.BOUGHT,
        settledByUserId: USER,
      })
    ).toEqual({
      lineId: LINE,
      asked: null,
      bought: 3,
      left: null,
      outcome: TripRowOutcome.BOUGHT,
      settledByUserId: USER,
    });
    expect(
      toTripRowView(TripKind.LOOSE, {
        lineId: LINE,
        bought: 0,
        lastOutcome: SettlementOutcome.NOT_AVAILABLE,
        settledByUserId: null,
      }).outcome
    ).toBe(TripRowOutcome.NOT_AVAILABLE);
  });

  it('serializes a head, whatever the driver handed back for its numbers', () => {
    expect(
      toTripView({
        id: TRIP,
        kind: 'BASKET',
        name: null,
        startedAt: new Date('2026-01-10T10:00:00.000Z'),
        live: true,
        lineCount: '4' as never,
        boughtLineCount: '1' as never,
      })
    ).toEqual({
      id: TRIP,
      kind: TripKind.BASKET,
      name: null,
      live: true,
      startedAt: '2026-01-10T10:00:00.000Z',
      lineCount: 4,
      boughtLineCount: 1,
    });
  });
});

describe('the two reads', () => {
  const SINCE = new Date('2026-01-01T00:00:00.000Z');

  function build(answers: Record<string, unknown[]> = {}) {
    const queries: { sql: string; parameters: unknown[] }[] = [];
    const access: string[] = [];
    const dataSource = {
      query: async (sql: string, parameters: unknown[]) => {
        queries.push({ sql, parameters });
        return answers[sql] ?? [];
      },
    } as unknown as DataSource;
    const listAccess = {
      requireRead: async (listId: string, userId: string) => {
        access.push(`${listId}:${userId}`);
        if (userId !== USER) {
          throw new NotFoundException('List not found');
        }
      },
    } as unknown as ListAccessService;
    const claims = { since: () => SINCE } as unknown as LineClaimService;
    return {
      service: new TripsService(dataSource, listAccess, claims),
      queries,
      access,
    };
  }

  const head = (id: string, kind: string) => ({
    id,
    kind,
    name: null,
    startedAt: new Date('2026-01-10T10:00:00.000Z'),
    live: false,
    lineCount: 1,
    boughtLineCount: 0,
  });

  it('checks READ before it reads anything, on both', async () => {
    const w = build();

    await expect(
      w.service.list({ userId: 'u-stranger', listId: LIST })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      w.service.rows({
        userId: 'u-stranger',
        listId: LIST,
        kind: TripKind.BASKET,
        tripId: TRIP,
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(w.access).toHaveLength(2);
    expect(w.queries).toEqual([]);
  });

  it('reads live trips with the claim’s own window, then a page of ended ones', async () => {
    const w = build();

    await w.service.list({ userId: USER, listId: LIST });

    expect(w.queries.map((query) => query.sql)).toEqual([
      LIVE_TRIPS_SQL,
      ENDED_TRIPS_SQL,
    ]);
    expect(w.queries[0].parameters).toEqual([
      LIST,
      LOOSE_TRIP_GAP_MS,
      ['DRAFT', 'ACTIVE'],
      SINCE,
    ]);
    // No cursor, and one row past the default page to learn whether more exist.
    expect(w.queries[1].parameters.slice(4)).toEqual([null, null, 21]);
  });

  it('carries the kind and the id in the cursor, and skips live trips behind one', async () => {
    const first = build({
      [ENDED_TRIPS_SQL]: [head(TRIP, 'LOOSE'), head(LINE, 'BASKET')],
    });
    const page = await first.service.list({
      userId: USER,
      listId: LIST,
      limit: 1,
    });
    expect(page.items.map((trip) => trip.id)).toEqual([TRIP]);
    expect(page.nextCursor).not.toBeNull();

    const second = build();
    const next = await second.service.list({
      userId: USER,
      listId: LIST,
      limit: 1,
      cursor: page.nextCursor ?? undefined,
    });

    expect(next.live).toEqual([]);
    expect(second.queries.map((query) => query.sql)).toEqual([ENDED_TRIPS_SQL]);
    expect(second.queries[0].parameters.slice(4)).toEqual([TRIP, 'LOOSE', 2]);
  });

  it('starts from the beginning on a cursor it cannot read', async () => {
    const w = build();
    const forged = Buffer.from(
      JSON.stringify({ kind: 'BASKET', id: "x'; DROP TABLE" })
    ).toString('base64url');

    await w.service.list({ userId: USER, listId: LIST, cursor: forged });

    expect(w.queries.map((query) => query.sql)).toEqual([
      LIVE_TRIPS_SQL,
      ENDED_TRIPS_SQL,
    ]);
    expect(w.queries[1].parameters.slice(4, 6)).toEqual([null, null]);
  });

  it('reads the rows of a basket or of a loose trip, each through its own query', async () => {
    const row = { lineId: LINE, asked: 1, bought: 1, lastOutcome: 'BOUGHT' };
    const w = build({
      [BASKET_TRIP_ROWS_SQL]: [row],
      [LOOSE_TRIP_ROWS_SQL]: [row],
    });

    await w.service.rows({
      userId: USER,
      listId: LIST,
      kind: TripKind.BASKET,
      tripId: TRIP,
    });
    await w.service.rows({
      userId: USER,
      listId: LIST,
      kind: TripKind.LOOSE,
      tripId: TRIP,
      limit: 100,
    });

    expect(w.queries).toEqual([
      { sql: BASKET_TRIP_ROWS_SQL, parameters: [LIST, TRIP, null, 21] },
      {
        sql: LOOSE_TRIP_ROWS_SQL,
        parameters: [LIST, LOOSE_TRIP_GAP_MS, TRIP, null, 101],
      },
    ]);
  });

  it('answers not found for a trip with no rows, and for an id that names nothing', async () => {
    const w = build();

    await expect(
      w.service.rows({
        userId: USER,
        listId: LIST,
        kind: TripKind.BASKET,
        tripId: TRIP,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      w.service.rows({
        userId: USER,
        listId: LIST,
        kind: TripKind.LOOSE,
        tripId: 'not-an-id',
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    // The second never reached the database: the id goes into a `::uuid` cast.
    expect(w.queries).toHaveLength(1);
  });

  it('refuses a kind it does not know', async () => {
    const w = build();

    await expect(
      w.service.rows({
        userId: USER,
        listId: LIST,
        kind: 'WEEKLY' as TripKind,
        tripId: TRIP,
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('the event (section 6)', () => {
  it('goes to each list’s room once, and says only which list', () => {
    const emitTo = jest.fn();

    announceTripsChanged({ emitTo }, ['l-flat', 'l-parents', 'l-flat']);

    expect(emitTo.mock.calls).toEqual([
      [
        RealtimeEvent.ListTripsChanged,
        { listId: 'l-flat' },
        { listId: 'l-flat' },
      ],
      [
        RealtimeEvent.ListTripsChanged,
        { listId: 'l-parents' },
        { listId: 'l-parents' },
      ],
    ]);
  });

  it('says nothing for a basket that draws from no list', () => {
    const emitTo = jest.fn();

    announceTripsChanged({ emitTo }, []);

    expect(emitTo).not.toHaveBeenCalled();
  });
});
