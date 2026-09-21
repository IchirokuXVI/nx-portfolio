import {
  PURCHASE_SESSION_GAP_MS,
  SettlementOutcome,
  TripKind,
} from '@portfolio/luna-shopper/contracts';
import {
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import { toPurchaseEntryView, toPurchaseRowView } from './purchases.mappers';
import { PurchasesService } from './purchases.service';
import {
  PURCHASE_BASKET_ROWS_SQL,
  PURCHASE_ENTRIES_SQL,
  PURCHASE_SESSION_ROWS_SQL,
} from './purchases.sql';

/**
 * The parts of the history read that are not SQL (plan 0142).
 *
 * Which rows come back is proven against a real database in
 * `purchases.integration.spec.ts`, because every rule there is a `WHERE`, a
 * `UNION` or a window. What is left for a unit spec is what happens around the
 * queries: the mappers, the shape of a cursor, which statement each kind
 * reaches, and what an entry with nothing in it answers.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const ROW = '33333333-3333-4333-8333-333333333333';

describe('one history entry (section 3)', () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: ENTRY,
    kind: 'BASKET',
    name: 'Saturday',
    open: false,
    startedAt: new Date('2026-01-10T10:00:00.000Z'),
    endedAt: new Date('2026-01-10T12:30:00.000Z'),
    lineCount: '4' as never,
    boughtLineCount: '3' as never,
    spentCents: '1240',
    currencies: 1,
    currency: 'EUR',
    unpricedCount: '1' as never,
    ...extra,
  });

  it('serializes its dates and reads its counts as numbers', () => {
    expect(toPurchaseEntryView(row())).toEqual({
      id: ENTRY,
      kind: TripKind.BASKET,
      name: 'Saturday',
      open: false,
      startedAt: '2026-01-10T10:00:00.000Z',
      endedAt: '2026-01-10T12:30:00.000Z',
      lineCount: 4,
      boughtLineCount: 3,
      spent: { cents: 1240, currency: 'EUR' },
      unpricedCount: 1,
    });
  });

  // The sum arrives as a `bigint`, which the driver hands back as a string so
  // no precision is lost on the way out of Postgres.
  it('reads a bigint sum as a number', () => {
    expect(toPurchaseEntryView(row({ spentCents: '987654321' })).spent).toEqual(
      { cents: 987654321, currency: 'EUR' }
    );
  });

  // Section 3.3: an entry where nothing carries a price has no total, and 0
  // would say the shopping was free.
  it('keeps a missing total null, never zero', () => {
    expect(
      toPurchaseEntryView(
        row({ spentCents: null, currency: null, currencies: 0 })
      ).spent
    ).toBeNull();
  });

  // Plan 0143, section 7: two shops in two currencies in one session have no
  // total. Every row still says what it cost, and `unpricedCount` is unchanged:
  // it counts rows with no price, not rows that refuse to add up.
  it('has no total when the entry’s priced rows carry two currencies', () => {
    const view = toPurchaseEntryView(
      row({ spentCents: '1240', currencies: 2, currency: 'EUR' })
    );

    expect(view.spent).toBeNull();
    expect(view.unpricedCount).toBe(1);
  });

  it('reads a kind it does not know as a session', () => {
    expect(toPurchaseEntryView(row({ kind: 'SOMETHING' })).kind).toBe(
      TripKind.SESSION
    );
  });
});

describe('one row of an entry (section 4)', () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: ROW,
    itemId: 'item-1',
    outcome: 'BOUGHT',
    quantity: '3' as never,
    pricePaidCents: 120,
    pricePaidCurrency: 'EUR',
    priceScopeId: 'scope-1',
    supermarketLocationId: 'shop-1',
    settledAt: new Date('2026-01-10T11:00:00.000Z'),
    lineId: 'line-1',
    listId: 'list-1',
    listName: 'Flat',
    zoneId: 'zone-1',
    content: 'Milk',
    ...extra,
  });

  it('serializes its date and reads its units as a number', () => {
    expect(toPurchaseRowView(row())).toEqual({
      id: ROW,
      itemId: 'item-1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 3,
      pricePaid: { cents: 120, currency: 'EUR' },
      priceScopeId: 'scope-1',
      supermarketLocationId: 'shop-1',
      settledAt: '2026-01-10T11:00:00.000Z',
      lineId: 'line-1',
      listId: 'list-1',
      listName: 'Flat',
      zoneId: 'zone-1',
      content: 'Milk',
    });
  });

  // An amount with no currency is a number, so the two travel together or
  // neither is served (plan 0143, section 2).
  it('serves no price when the currency is missing', () => {
    expect(toPurchaseRowView(row({ pricePaidCurrency: null })).pricePaid).toBe(
      null
    );
  });

  // A reader who lost `READ` keeps the purchase and loses where it was made.
  // The statement nulls all five together; the mapper passes them through.
  it('passes the five location fields through as nulls', () => {
    const view = toPurchaseRowView(
      row({
        lineId: null,
        listId: null,
        listName: null,
        zoneId: null,
        content: null,
      })
    );

    expect(view).toMatchObject({
      itemId: 'item-1',
      quantity: 3,
      pricePaid: { cents: 120, currency: 'EUR' },
      lineId: null,
      listId: null,
      listName: null,
      zoneId: null,
      content: null,
    });
  });

  it('reads a row nothing was bought on as not available', () => {
    expect(
      toPurchaseRowView(
        row({
          outcome: 'NOT_AVAILABLE',
          quantity: 0,
          pricePaidCents: null,
          pricePaidCurrency: null,
        })
      )
    ).toMatchObject({
      outcome: SettlementOutcome.NOT_AVAILABLE,
      quantity: 0,
      pricePaid: null,
      // Which chain had none is the half of that outcome worth keeping.
      priceScopeId: 'scope-1',
    });
  });
});

describe('the two reads', () => {
  function build(answers: Record<string, unknown[]> = {}) {
    const queries: { sql: string; parameters: unknown[] }[] = [];
    const dataSource = {
      query: async (sql: string, parameters: unknown[]) => {
        queries.push({ sql, parameters });
        return answers[sql] ?? [];
      },
    } as unknown as DataSource;
    return { service: new PurchasesService(dataSource), queries };
  }

  const entry = (id: string, kind: string) => ({
    id,
    kind,
    name: null,
    open: false,
    startedAt: new Date('2026-01-10T10:00:00.000Z'),
    endedAt: new Date('2026-01-10T11:00:00.000Z'),
    lineCount: 1,
    boughtLineCount: 1,
    spentCents: null,
    currencies: 0,
    currency: null,
    unpricedCount: 1,
  });

  const line = (id: string) => ({
    id,
    itemId: null,
    outcome: 'BOUGHT',
    quantity: 1,
    pricePaidCents: null,
    pricePaidCurrency: null,
    priceScopeId: null,
    supermarketLocationId: null,
    settledAt: new Date('2026-01-10T11:00:00.000Z'),
    lineId: 'line-1',
    listId: 'list-1',
    listName: 'Flat',
    zoneId: 'zone-1',
    content: 'Milk',
  });

  it('reads one page with the gap and no cursor', async () => {
    const w = build();

    const page = await w.service.listSessions({ userId: USER, limit: 2 });

    expect(w.queries.map((query) => query.sql)).toEqual([PURCHASE_ENTRIES_SQL]);
    // The limit asks for one more than the page, which is how the read knows
    // whether to issue a cursor at all.
    expect(w.queries[0].parameters).toEqual([
      USER,
      PURCHASE_SESSION_GAP_MS,
      null,
      null,
      3,
    ]);
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('issues a cursor carrying the kind and the id, and no timestamp', async () => {
    const w = build({
      [PURCHASE_ENTRIES_SQL]: [entry(ENTRY, 'SESSION'), entry(ROW, 'BASKET')],
    });

    const page = await w.service.listSessions({ userId: USER, limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({
      kind: TripKind.SESSION,
      id: ENTRY,
    });
  });

  it('hands the cursor’s kind and id to the next page', async () => {
    const w = build({
      [PURCHASE_ENTRIES_SQL]: [entry(ENTRY, 'SESSION')],
    });

    await w.service.listSessions({
      userId: USER,
      cursor: encodeCursor({ kind: TripKind.SESSION, id: ENTRY }),
      limit: 5,
    });

    expect(w.queries[0].parameters.slice(2, 4)).toEqual([
      ENTRY,
      TripKind.SESSION,
    ]);
  });

  // `decodeCursor` treats a broken token as "start from the beginning"
  // everywhere else, and an id that cannot reach a `::uuid` cast is broken.
  it.each([
    ['a kind it does not know', { kind: 'LOOSE', id: ENTRY }],
    ['an id that is not a uuid', { kind: TripKind.SESSION, id: 'nope' }],
  ])('starts from the beginning on %s', async (_name, cursor) => {
    const w = build();

    await w.service.listSessions({
      userId: USER,
      cursor: encodeCursor(cursor),
    });

    expect(w.queries[0].parameters.slice(2, 4)).toEqual([null, null]);
  });

  it('reads a basket entry through the basket statement', async () => {
    const w = build({ [PURCHASE_BASKET_ROWS_SQL]: [line(ROW)] });

    const page = await w.service.listSessionRows({
      userId: USER,
      kind: TripKind.BASKET,
      entryId: ENTRY,
      limit: 5,
    });

    expect(w.queries[0]).toEqual({
      sql: PURCHASE_BASKET_ROWS_SQL,
      parameters: [USER, ENTRY, null, 6],
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('reads a session entry through the session statement, with the gap', async () => {
    const w = build({ [PURCHASE_SESSION_ROWS_SQL]: [line(ROW)] });

    await w.service.listSessionRows({
      userId: USER,
      kind: TripKind.SESSION,
      entryId: ENTRY,
      limit: 5,
    });

    expect(w.queries[0]).toEqual({
      sql: PURCHASE_SESSION_ROWS_SQL,
      parameters: [USER, PURCHASE_SESSION_GAP_MS, ENTRY, null, 6],
    });
  });

  it('issues a rows cursor carrying the row’s earliest settlement', async () => {
    const w = build({
      [PURCHASE_BASKET_ROWS_SQL]: [line(ROW), line(ENTRY)],
    });

    const page = await w.service.listSessionRows({
      userId: USER,
      kind: TripKind.BASKET,
      entryId: ENTRY,
      limit: 1,
    });

    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({ id: ROW });
  });

  it('refuses a kind it does not know, before any query', async () => {
    const w = build();

    await expect(
      w.service.listSessionRows({
        userId: USER,
        kind: 'LOOSE' as never,
        entryId: ENTRY,
      })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(w.queries).toEqual([]);
  });

  // An id that cannot name a row names no entry, which is not found rather
  // than a validation failure: it reaches a `::uuid` cast, which throws.
  it('answers not found for an id that is not a uuid, before any query', async () => {
    const w = build();

    await expect(
      w.service.listSessionRows({
        userId: USER,
        kind: TripKind.SESSION,
        entryId: 'not-a-uuid',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(w.queries).toEqual([]);
  });

  // An entry that is not the reader's, or one whose purchases were all
  // reverted, has no rows. A cursor is only ever issued when another row
  // exists, so an honest empty page cannot happen.
  it('answers not found for an entry with no rows', async () => {
    const w = build();

    await expect(
      w.service.listSessionRows({
        userId: USER,
        kind: TripKind.BASKET,
        entryId: ENTRY,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
