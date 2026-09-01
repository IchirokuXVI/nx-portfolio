import type { ListLineItem } from '../entities';

/**
 * An in memory stand in for the `list_line_items` repository (plan 0048, section
 * 1.1).
 *
 * The line service reads and writes a product set on paths that have nothing to
 * do with products: approving a line, ticking it off, splitting a remainder. The
 * unit specs around those paths need the set to *work*, not to be interesting, so
 * this holds rows in an array and answers the three calls the service makes.
 *
 * It is shared rather than copied into each spec because four harnesses agreeing
 * on what a repository does by coincidence is four chances for one of them to
 * drift into testing a shape the service does not use.
 */
export interface FakeLineItems {
  rows: Pick<ListLineItem, 'lineId' | 'itemId' | 'position'>[];
  repo: {
    find(options: { where: { lineId: unknown } }): Promise<ListLineItem[]>;
    delete(criteria: { lineId: string }): Promise<{ affected: number }>;
    insert(
      rows: Pick<ListLineItem, 'lineId' | 'itemId' | 'position'>[]
    ): Promise<void>;
  };
}

export function fakeLineItems(
  initial: Pick<ListLineItem, 'lineId' | 'itemId' | 'position'>[] = []
): FakeLineItems {
  const rows = [...initial];
  return {
    rows,
    repo: {
      async find({ where }) {
        // `lineId` arrives either as a plain id or as TypeORM's `In([...])`,
        // whose value sits under `_value`. Both are answered, so a spec can drive
        // the single line reads and the page read with one fake.
        const wanted = where.lineId as string | { _value?: string[] };
        const ids =
          typeof wanted === 'string' ? [wanted] : (wanted?._value ?? []);
        return rows
          .filter((row) => ids.includes(row.lineId))
          .sort((a, b) => a.position - b.position) as ListLineItem[];
      },
      async delete({ lineId }) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].lineId === lineId) {
            rows.splice(i, 1);
          }
        }
        return { affected: before - rows.length };
      },
      async insert(inserted) {
        rows.push(...inserted);
      },
    },
  };
}
