import type { EntityManager } from 'typeorm';
import {
  BasketLineSkip,
  BasketTripRow,
  LineComment,
  LineSettlement,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
} from '../entities';
import { fakeLineChanges } from './changes/line-change.fake';
import { LineMergeService } from './line-merge.service';

/**
 * The trip rows a merge moves (plan 0135, section 5, test 4).
 *
 * `moveTripRows` is private, so it is exercised through `merge`, over an
 * `EntityManager` that stores rows in memory. What the merge does to every other
 * table is proven against Postgres in `line-rename-merge.integration.spec.ts`,
 * and so is the unique key this one leans on. What is stated here is the
 * decision: repoint a row the survivor lacks, sum the pair the survivor already
 * has, and touch nothing when the absorbed line has no rows at all.
 */

const LIST = 'l-flat';
const SURVIVOR = 'll-survivor';
const ABSORBED = 'll-absorbed';
/** Whoever renamed. The merge carries it onto the change and reads none of it. */
const ACTOR = { userId: 'u-1', participantId: null, basketId: null };

function lineFor(id: string, position: number): ListLine {
  return {
    id,
    listId: LIST,
    content: id,
    quantity: 1,
    position,
    version: 1,
    approvalStatus: 'APPROVED',
    approvedByUserId: null,
    productGroupId: null,
    itemSetHash: null,
  } as unknown as ListLine;
}

/**
 * A manager over one in memory `basket_trip_rows`.
 *
 * Every other repository the merge asks for answers empty and swallows its
 * writes, and an entity this fake does not know **throws**: a catch-all return
 * cannot tell a read through the transaction from a read through the pool.
 */
function managerOver(rows: BasketTripRow[]): EntityManager {
  const tripRows = {
    find: async ({
      where,
      order,
    }: {
      where: { lineId: string };
      order?: { id: 'ASC' };
    }) => {
      const found = rows.filter((row) => row.lineId === where.lineId);
      return order
        ? [...found].sort((a, b) => a.id.localeCompare(b.id))
        : found;
    },
    delete: async ({ id }: { id: string }) => {
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      return { affected: 1 };
    },
    update: async ({ id }: { id: string }, patch: Partial<BasketTripRow>) => {
      const row = rows.find((entry) => entry.id === id);
      if (row) {
        Object.assign(row, patch);
      }
      return { affected: 1 };
    },
  };
  const empty = {
    find: async () => [],
    insert: async () => undefined,
    update: async () => ({ affected: 0 }),
    delete: async () => ({ affected: 0 }),
    save: async (row: unknown) => row,
    createQueryBuilder: () => ({
      insert: () => ({
        values: () => ({
          orIgnore: () => ({ execute: async () => undefined }),
        }),
      }),
    }),
  };
  const known = new Set<unknown>([
    ListLine,
    ListLineItem,
    ListLineGroupRemoval,
    LineComment,
    LineSettlement,
    // A merge carries a basket's skips onto the survivor (plan 0137, section
    // 6). The move itself is proved against a real database.
    BasketLineSkip,
  ]);
  return {
    getRepository: (entity: unknown) => {
      if (entity === BasketTripRow) {
        return tripRows;
      }
      if (known.has(entity)) {
        return empty;
      }
      throw new Error('the merge asked for an entity this fake does not know');
    },
  } as unknown as EntityManager;
}

function tripRow(
  id: string,
  basketId: string,
  lineId: string,
  asked: number
): BasketTripRow {
  return { id, basketId, listId: LIST, lineId, asked } as BasketTripRow;
}

async function mergeOver(rows: BasketTripRow[]): Promise<BasketTripRow[]> {
  await new LineMergeService(fakeLineChanges().recorder).merge(
    managerOver(rows),
    lineFor(SURVIVOR, 1),
    lineFor(ABSORBED, 2),
    // The merge records the one `MERGED` change itself (plan 0138, section 4). A
    // stand in, because this file is about the trip rows the merge moves.
    { list: { id: LIST, zoneId: 'z-1' }, actor: ACTOR }
  );
  return rows;
}

describe('the trip rows a merge moves (section 5)', () => {
  it('repoints a row the survivor has none of', async () => {
    const rows = await mergeOver([tripRow('r1', 'gl-1', ABSORBED, 3)]);

    expect(rows.map((row) => [row.basketId, row.lineId, row.asked])).toEqual([
      ['gl-1', SURVIVOR, 3],
    ]);
  });

  it('sums a basket that asked for both lines into one row', async () => {
    const rows = await mergeOver([
      tripRow('r1', 'gl-1', SURVIVOR, 2),
      tripRow('r2', 'gl-1', ABSORBED, 3),
    ]);

    expect(rows.map((row) => [row.id, row.lineId, row.asked])).toEqual([
      ['r1', SURVIVOR, 5],
    ]);
  });

  it('leaves another basket’s row on the survivor alone', async () => {
    const rows = await mergeOver([
      tripRow('r1', 'gl-1', SURVIVOR, 2),
      tripRow('r2', 'gl-2', ABSORBED, 7),
    ]);

    expect(
      rows.map((row) => [row.basketId, row.lineId, row.asked]).sort()
    ).toEqual([
      ['gl-1', SURVIVOR, 2],
      ['gl-2', SURVIVOR, 7],
    ]);
  });

  it('is a no op when the absorbed line has no trip rows', async () => {
    const rows = await mergeOver([tripRow('r1', 'gl-1', SURVIVOR, 2)]);

    expect(rows.map((row) => [row.id, row.lineId, row.asked])).toEqual([
      ['r1', SURVIVOR, 2],
    ]);
  });
});
