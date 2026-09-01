import { GeneratedListStatus } from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import { GeneratedListService } from './generated-list.service';
import { GENERATED_LIST_COUNTS_SQL } from './generated-list.sql';
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
 * The counts query is faked by matching on the SQL constant itself rather than on
 * a string, as the run spec beside this one does: a rewritten query shows up here
 * as an unmocked read rather than as a test that keeps passing about nothing.
 */

const OWNER = 'u-owner';

interface CountsSeed {
  generatedListId: string;
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
}

function build(options: {
  baskets?: { id: string; status?: GeneratedListStatus }[];
  counts?: CountsSeed[];
}) {
  const baskets = options.baskets ?? [{ id: 'gl-1' }];
  const counts = options.counts ?? [];

  const rows = baskets.map((basket, index) => ({
    id: basket.id,
    name: null,
    status: basket.status ?? GeneratedListStatus.ACTIVE,
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
  } as never;

  const lines = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql === GENERATED_LIST_COUNTS_SQL) {
        return counts;
      }
      throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
    },
  } as never;

  const service = new GeneratedListService(
    { transaction: async () => undefined } as unknown as DataSource,
    lists,
    lines,
    {} as never,
    {} as never,
    {} as never,
    {} as unknown as ProfileService,
    fakeLineClaims({}).service,
    { emitToUsers: () => undefined } as unknown as CoreEventsPublisher
  );

  return { service, queries };
}

describe('what a run finished, on a history row (plan 0053, section 2)', () => {
  it('distinguishes what was bought from what the shop did not have', async () => {
    const { service } = build({
      baskets: [{ id: 'gl-1' }],
      counts: [
        {
          generatedListId: 'gl-1',
          lineCount: 4,
          settledLineCount: 4,
          boughtLineCount: 3,
          notAvailableLineCount: 1,
        },
      ],
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
      counts: [
        {
          generatedListId: 'gl-1',
          lineCount: 4,
          settledLineCount: 4,
          boughtLineCount: 3,
          notAvailableLineCount: 1,
        },
      ],
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
      counts: [
        {
          generatedListId: 'gl-1',
          lineCount: 3,
          settledLineCount: 1,
          boughtLineCount: 1,
          notAvailableLineCount: 0,
        },
      ],
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
      // `GROUP BY` produces no row for an empty group, which is what the default
      // in the service is for.
      counts: [
        {
          generatedListId: 'gl-1',
          lineCount: 1,
          settledLineCount: 0,
          boughtLineCount: 0,
          notAvailableLineCount: 0,
        },
      ],
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

  it('reads the counts of a whole page in one query', async () => {
    const { service, queries } = build({
      baskets: [{ id: 'gl-1' }, { id: 'gl-2' }, { id: 'gl-3' }],
      counts: [],
    });

    await service.listMine({ userId: OWNER });

    // A page of trips that read every line of every trip to render a date and a
    // number is the read that would eventually need fixing.
    expect(queries).toEqual([GENERATED_LIST_COUNTS_SQL]);
  });

  it('reports nobody present, since core cannot see the presence store', async () => {
    const { service } = build({ counts: [] });

    // The count is real and it is filled in at the gateway, which is the one
    // service that answers this read and can reach Redis. Core answering a
    // guess here is what would put a stale "2 shopping" on a card.
    expect(
      (await service.listMine({ userId: OWNER })).items[0].presentCount
    ).toBe(0);
  });
});
