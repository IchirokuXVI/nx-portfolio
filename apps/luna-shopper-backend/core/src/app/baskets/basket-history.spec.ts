import {
  BasketStatus,
  type BasketProgress,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import type { BasketReadService } from '../baskets/basket-read.service';
import type { Basket } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import { BasketService } from './basket.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * What a history row says a run finished (plan 0053, section 2).
 *
 * `settledLineCount` merged two different outcomes into one number, so velista
 * `0045` shipped its rows reading "N of M finished" rather than "3 of 4 got, 1
 * not available". The breakdown is what lets it say the second, and the point of
 * this file is that adding it changed nothing about the first: `settledLineCount`
 * still means every line with nothing left to do, and it is still the sum of the
 * two, because `NOT_AVAILABLE` closes a line's outstanding amount exactly as a
 * purchase does.
 *
 * Since plan 0136 the numbers come from one of two places, so every basket here
 * says which. A basket that is over answers from `basket_trip_rows` through
 * `BasketReadService.finishedProgressOf`, for a whole page at once; an `OPEN`
 * one has nothing written down and is composed by `BasketReadService`, one read
 * each. Both count products since plan 0209, section 1.2, so both are faked
 * here as a progress. The default status is `FINISHED`.
 */

const OWNER = 'u-owner';

function build(options: {
  baskets?: { id: string; status?: BasketStatus }[];
  /** What `BasketReadService.finishedProgressOf` answers, per finished basket. */
  finished?: Record<string, BasketProgress>;
  /** What `BasketReadService.progressOf` answers, per open basket. */
  progress?: Record<string, BasketProgress>;
}) {
  const baskets = options.baskets ?? [{ id: 'gl-1' }];
  const finished = options.finished ?? {};
  const progress = options.progress ?? {};

  const rows = baskets.map((basket, index) => ({
    id: basket.id,
    name: null,
    status: basket.status ?? BasketStatus.FINISHED,
    generatedAt: new Date(2026, 0, index + 1),
  }));

  /** Only the calls `listMine` makes, and `getMany` answers the page. */
  const qb = {
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    addOrderBy: () => qb,
    take: () => qb,
    getMany: async () => rows,
  };

  const queries: string[] = [];
  const lists = {
    createQueryBuilder: () => qb,
    query: async (sql: string) => {
      queries.push(sql);
      throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
    },
  } as never;

  const read: string[] = [];
  const finishedReads: string[][] = [];
  const basketRead = {
    finishedProgressOf: async (page: readonly Basket[]) => {
      finishedReads.push(page.map((basket) => basket.id));
      return new Map(
        page
          .filter((basket) => finished[basket.id])
          .map((basket) => [basket.id, finished[basket.id]])
      );
    },
    progressOf: async (basket: Basket) => {
      read.push(basket.id);
      return (
        progress[basket.id] ?? { done: 0, unavailable: 0, total: 0, pending: 0 }
      );
    },
  } as unknown as BasketReadService;

  const service = new BasketService(
    { transaction: async () => undefined } as unknown as DataSource,
    lists,
    {} as unknown as ProfileService,
    fakeLineClaims({}).service,
    { emitToUsers: () => undefined } as unknown as CoreEventsPublisher,
    // The members and the trip rows: neither is on the history path, which
    // reads the page and then counts it two ways.
    {} as never,
    { find: async () => [] } as never,
    {} as never,
    basketRead
  );

  return { service, queries, read, finishedReads };
}

describe('what a run finished, on a history row (plan 0053, section 2)', () => {
  it('distinguishes what was bought from what the shop did not have', async () => {
    const { service } = build({
      baskets: [{ id: 'gl-1' }],
      finished: { 'gl-1': { total: 4, done: 3, unavailable: 1, pending: 0 } },
    });

    const page = await service.listMine({ userId: OWNER });

    expect(page.items[0]).toMatchObject({
      lineCount: 4,
      boughtLineCount: 3,
      notAvailableLineCount: 1,
    });
  });

  it('leaves `settledLineCount` meaning every finished line, whatever finished it', async () => {
    const { service } = build({
      finished: { 'gl-1': { total: 4, done: 3, unavailable: 1, pending: 0 } },
    });

    const [row] = (await service.listMine({ userId: OWNER })).items;

    // The number velista `0045` already reads, unchanged: a shop having none of
    // something closes the line as surely as buying it does.
    expect(row.settledLineCount).toBe(4);
    expect(row.boughtLineCount + row.notAvailableLineCount).toBe(
      row.settledLineCount
    );
  });

  it('counts an unfinished line in neither outcome', async () => {
    const { service } = build({
      finished: { 'gl-1': { total: 3, done: 1, unavailable: 0, pending: 2 } },
    });

    const [row] = (await service.listMine({ userId: OWNER })).items;

    expect(row).toMatchObject({
      lineCount: 3,
      settledLineCount: 1,
      boughtLineCount: 1,
      notAvailableLineCount: 0,
    });
  });

  it('answers zeros for a basket with no lines rather than leaving it out', async () => {
    const { service } = build({
      baskets: [{ id: 'gl-1' }, { id: 'gl-empty' }],
      // A basket the read does not answer gets the default in the service.
      finished: { 'gl-1': { total: 1, done: 0, unavailable: 0, pending: 1 } },
    });

    const page = await service.listMine({ userId: OWNER });

    expect(page.items).toHaveLength(2);
    expect(page.items[1]).toMatchObject({
      id: 'gl-empty',
      lineCount: 0,
      settledLineCount: 0,
      boughtLineCount: 0,
      notAvailableLineCount: 0,
    });
  });

  it('reads the counts of a whole page of finished baskets in one call', async () => {
    const { service, queries, read, finishedReads } = build({
      baskets: [{ id: 'gl-1' }, { id: 'gl-2' }, { id: 'gl-3' }],
    });

    await service.listMine({ userId: OWNER });

    // A page of trips that read every line of every trip to render a date and a
    // number is the read that would eventually need fixing.
    expect(finishedReads).toEqual([['gl-1', 'gl-2', 'gl-3']]);
    expect(queries).toEqual([]);
    expect(read).toEqual([]);
  });

  it('composes an open basket instead, because it has nothing written down', async () => {
    // Plan 0136, section 7.4. An open basket is a view of the lists it covers,
    // so the only honest way to count its rows is to compose them. The sweep
    // finishes baskets, so a page holds at most a few.
    const { service, queries, read } = build({
      baskets: [{ id: 'gl-open', status: BasketStatus.OPEN }],
      progress: {
        'gl-open': { done: 3, unavailable: 1, total: 5, pending: 1 },
      },
    });

    const [row] = (await service.listMine({ userId: OWNER })).items;

    expect(read).toEqual(['gl-open']);
    expect(queries).toEqual([]);
    expect(row).toMatchObject({
      lineCount: 5,
      // Still the sum of the two, on this half as well.
      settledLineCount: 4,
      boughtLineCount: 3,
      notAvailableLineCount: 1,
    });
  });

  it('splits one page between the two reads', async () => {
    const { service, finishedReads, read } = build({
      baskets: [
        { id: 'gl-open', status: BasketStatus.OPEN },
        { id: 'gl-done' },
      ],
      finished: {
        'gl-done': { total: 2, done: 2, unavailable: 0, pending: 0 },
      },
      progress: {
        'gl-open': { done: 0, unavailable: 0, total: 7, pending: 7 },
      },
    });

    const page = await service.listMine({ userId: OWNER });

    expect(finishedReads).toEqual([['gl-done']]);
    expect(read).toEqual(['gl-open']);
    expect(page.items.map((item) => item.lineCount)).toEqual([7, 2]);
  });

  it('reports nobody present, since core cannot see the presence store', async () => {
    const { service } = build({});

    // The count is real and it is filled in at the gateway, which is the one
    // service that answers this read and can reach Redis. Core answering a
    // guess here is what would put a stale "2 shopping" on a card.
    expect(
      (await service.listMine({ userId: OWNER })).items[0].presentCount
    ).toBe(0);
  });
});
