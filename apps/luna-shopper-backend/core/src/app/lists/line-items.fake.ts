import { LineItemSource } from '@portfolio/luna-shopper/contracts';
import type { ListLineGroupRemoval, ListLineItem } from '../entities';

/** The columns of a membership row a fake has to hold to be useful. */
type FakeItemRow = Pick<
  ListLineItem,
  'lineId' | 'itemId' | 'position' | 'source'
>;

/** The same, before the default provenance is filled in (plan 0070, section 3). */
type FakeItemSeed = Omit<FakeItemRow, 'source'> & { source?: LineItemSource };

/** Unwraps `{ lineId }` or `{ lineId: In([...]) }` into the ids it names. */
function idsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return (value as { _value?: string[] })?._value ?? [];
}

/**
 * An in memory stand in for the `list_line_items` repository (plan 0048, section
 * 1.1).
 *
 * The line service reads and writes a product set on paths that have nothing to
 * do with products: approving a line, ticking it off, splitting a remainder. The
 * unit specs around those paths need the set to *work*, not to be interesting, so
 * this holds rows in an array and answers the calls the service makes.
 *
 * It is shared rather than copied into each spec because four harnesses agreeing
 * on what a repository does by coincidence is four chances for one of them to
 * drift into testing a shape the service does not use.
 *
 * Since plan 0070 a row carries `source`, defaulted to `USER` here exactly as the
 * column is defaulted in the database, so a spec that says nothing about
 * provenance describes a hand made set and gets one.
 */
export interface FakeLineItems {
  rows: FakeItemRow[];
  repo: {
    find(options: { where: { lineId: unknown } }): Promise<ListLineItem[]>;
    count(options: { where: { lineId: unknown } }): Promise<number>;
    delete(criteria: { lineId: string; itemId?: string }): Promise<{
      affected: number;
    }>;
    insert(rows: FakeItemSeed[] | FakeItemSeed): Promise<void>;
    update(
      criteria: { lineId: unknown; source?: LineItemSource },
      values: { source: LineItemSource }
    ): Promise<{ affected: number }>;
  };
}

export function fakeLineItems(initial: FakeItemSeed[] = []): FakeLineItems {
  const withSource = (row: FakeItemSeed): FakeItemRow => ({
    ...row,
    source: row.source ?? LineItemSource.USER,
  });
  const rows = initial.map(withSource);
  return {
    rows,
    repo: {
      async find({ where }) {
        // `lineId` arrives either as a plain id or as TypeORM's `In([...])`,
        // whose value sits under `_value`. Both are answered, so a spec can drive
        // the single line reads and the page read with one fake.
        const ids = idsOf(where.lineId);
        return rows
          .filter((row) => ids.includes(row.lineId))
          .sort((a, b) => a.position - b.position) as ListLineItem[];
      },
      async count({ where }) {
        const ids = idsOf(where.lineId);
        return rows.filter((row) => ids.includes(row.lineId)).length;
      },
      async delete({ lineId, itemId }) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (
            rows[i].lineId === lineId &&
            (itemId === undefined || rows[i].itemId === itemId)
          ) {
            rows.splice(i, 1);
          }
        }
        return { affected: before - rows.length };
      },
      async insert(inserted) {
        rows.push(
          ...(Array.isArray(inserted) ? inserted : [inserted]).map(withSource)
        );
      },
      async update(criteria, values) {
        const ids = idsOf(criteria.lineId);
        let affected = 0;
        for (const row of rows) {
          if (
            ids.includes(row.lineId) &&
            (criteria.source === undefined || row.source === criteria.source)
          ) {
            row.source = values.source;
            affected += 1;
          }
        }
        return { affected };
      },
    },
  };
}

/** One tombstone: a product of this line's group that a person took off. */
type FakeRemovalRow = Pick<ListLineGroupRemoval, 'lineId' | 'itemId'>;

/**
 * An in memory stand in for the `list_line_group_removals` repository (plan 0070,
 * section 2).
 *
 * It sits beside {@link fakeLineItems} for the same reason that one is shared:
 * every write path on a line can now leave a tombstone, so a spec about approval
 * or quantity needs the table to work without being about it.
 *
 * The insert is a query builder rather than a method, because the service writes
 * these with `orIgnore`: two phones dropping the same product at once would
 * otherwise turn a race nobody can see into a 500 for one of them. The fake
 * honours the unique pair, so a spec sees the same "one row, whoever wrote it".
 */
export interface FakeGroupRemovals {
  rows: FakeRemovalRow[];
  repo: {
    find(options: {
      where: { lineId: unknown; itemId?: string };
    }): Promise<ListLineGroupRemoval[]>;
    delete(criteria: { lineId: unknown; itemId?: unknown }): Promise<{
      affected: number;
    }>;
    createQueryBuilder(): {
      insert(): {
        values(rows: FakeRemovalRow[]): {
          orIgnore(): { execute(): Promise<void> };
        };
      };
    };
  };
}

export function fakeGroupRemovals(
  initial: FakeRemovalRow[] = []
): FakeGroupRemovals {
  const rows = [...initial];
  return {
    rows,
    repo: {
      async find({ where }) {
        const ids = idsOf(where.lineId);
        return rows.filter(
          (row) =>
            ids.includes(row.lineId) &&
            (where.itemId === undefined || row.itemId === where.itemId)
        ) as ListLineGroupRemoval[];
      },
      async delete({ lineId, itemId }) {
        const lineIds = idsOf(lineId);
        const itemIds = itemId === undefined ? undefined : idsOf(itemId);
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (
            lineIds.includes(rows[i].lineId) &&
            (itemIds === undefined || itemIds.includes(rows[i].itemId))
          ) {
            rows.splice(i, 1);
          }
        }
        return { affected: before - rows.length };
      },
      createQueryBuilder() {
        return {
          insert() {
            return {
              values(inserted: FakeRemovalRow[]) {
                return {
                  orIgnore() {
                    return {
                      async execute() {
                        for (const row of inserted) {
                          const held = rows.some(
                            (existing) =>
                              existing.lineId === row.lineId &&
                              existing.itemId === row.itemId
                          );
                          if (!held) {
                            rows.push({ ...row });
                          }
                        }
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}
