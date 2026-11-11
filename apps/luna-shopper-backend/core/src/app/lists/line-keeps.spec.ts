import type { EntityManager } from 'typeorm';
import { lineKeeps } from './line-keeps';

/**
 * What a line keeps at 0 (plan 0263, section 1, and section 6 item 4).
 *
 * The two tables are read in one statement, which only a real database can
 * answer for (`settle-keeps-line.integration.spec.ts`). Here the statement
 * is answered by hand, so what is asserted is which facts the function reads
 * and that the three columns of the row decide without a query.
 */

const BARE = {
  id: 'li1',
  named: false,
  preferredSupermarketId: null,
  favoriteItemId: null,
};

function manager(keeps: boolean) {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    queries,
    manager: {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return [{ keeps }];
      },
    } as unknown as EntityManager,
  };
}

describe('lineKeeps (plan 0263)', () => {
  it('keeps nothing of a line that holds only products', async () => {
    const m = manager(false);

    expect(await lineKeeps(m.manager, BARE)).toBe(false);
    expect(m.queries).toHaveLength(1);
    expect(m.queries[0].params).toEqual(['li1']);
    expect(m.queries[0].sql).toContain('line_settlements');
    expect(m.queries[0].sql).toContain('line_comments');
  });

  it.each([
    ['a name a person typed', { named: true }],
    ['a chain', { preferredSupermarketId: 's1' }],
    ['a favourite', { favoriteItemId: 'i1' }],
  ])('keeps a line with %s, and asks no table', async (_, column) => {
    const m = manager(false);

    expect(await lineKeeps(m.manager, { ...BARE, ...column })).toBe(true);
    expect(m.queries).toHaveLength(0);
  });

  it('keeps a line that has a buy or a comment', async () => {
    const m = manager(true);

    expect(await lineKeeps(m.manager, BARE)).toBe(true);
  });
});
