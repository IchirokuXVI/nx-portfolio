import type { Repository } from 'typeorm';
import type { Brand, Item, ProductGroup, SupermarketItem } from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { fakeAudit } from './catalog-audit.testing';
import { ItemService } from './item.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ProductGroupService } from './product-group.service';

/**
 * The chain filter plan 0146 added, and the one thing a fake repository can
 * prove about it: **that both branches of the search carry the same clause**.
 *
 * `search` assembles its SQL two different ways. A query goes through the ranked
 * branch, which writes a raw statement with positional parameters; no query goes
 * through the listing branch, which is the query builder and named ones. Every
 * filter is therefore written twice, and a filter added to one and not the other
 * is a defect this service has already had, which is why the two are read out of
 * the same helper here and compared.
 *
 * What the clause actually selects is a claim about a `WHERE` over real tables,
 * so it is asserted in `catalog-search.integration.spec.ts` against Postgres. A
 * fake repository proves nothing about an `EXISTS`.
 */

/** A chain id as the gateway validates them: a v4 uuid. */
const MERCADONA = 'cf000000-0000-4000-a000-000000000001';
const DEZA = 'cf000000-0000-4000-a000-000000000002';

function build() {
  const rows: Item[] = [];
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['take', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => rows);

  const query = jest.fn(async () => rows);
  const items = {
    query,
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as Repository<Item>;

  const service = new ItemService(
    items,
    {} as Repository<ProductGroup>,
    {} as Repository<SupermarketItem>,
    {} as Repository<Brand>,
    {} as unknown as ProductGroupService,
    {} as unknown as PlatformAdminService,
    fakeAudit([]).service,
    {} as unknown as CatalogEventsPublisher
  );
  return { service, query, qb };
}

/** The SQL the ranked branch sent, with its bound values. */
function rankedSql(query: jest.Mock): { sql: string; values: unknown[] } {
  const [sql, values] = query.mock.calls[0] as [string, unknown[]];
  return { sql, values };
}

/** The clauses the listing branch added, with their named parameters. */
function listedClauses(
  qb: Record<string, jest.Mock>
): { sql: string; params: Record<string, unknown> }[] {
  return qb.andWhere.mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: (params ?? {}) as Record<string, unknown>,
  }));
}

describe('the chain filter (plan 0146)', () => {
  describe('the ranked branch, which a query takes', () => {
    it('narrows to the named chain, binding the id rather than writing it in', async () => {
      const { service, query } = build();

      await service.search({
        userId: 'reader',
        query: 'leche',
        soldBy: [MERCADONA],
      });

      const { sql, values } = rankedSql(query);
      expect(sql).toContain('EXISTS (');
      expect(sql).toContain('FROM "supermarket_items" si');
      expect(sql).toContain('ps."supermarketId" = ANY(');
      // Part of the meaning and not an optimization: a row saying the chain does
      // not stock the product is the row that must not list it there.
      expect(sql).toContain('si."available"');
      expect(values).toContainEqual([MERCADONA]);
    });

    it('lists what either chain sells when two are named', async () => {
      const { service, query } = build();

      await service.search({
        userId: 'reader',
        query: 'leche',
        soldBy: [MERCADONA, DEZA],
      });

      // One clause over a list, so it is a union and never an intersection: a
      // shopper pressing two chips wants both assortments, not the products both
      // chains happen to carry.
      const { sql, values } = rankedSql(query);
      expect(sql.match(/EXISTS \(/g)).toHaveLength(1);
      expect(values).toContainEqual([MERCADONA, DEZA]);
    });

    it('writes no clause at all when the filter is absent or empty', async () => {
      for (const soldBy of [undefined, []]) {
        const { service, query } = build();

        await service.search({ userId: 'reader', query: 'leche', soldBy });

        // Empty is the same as absent, which is the reading `priceScopeIds`
        // already has: somebody who cleared the chips reads the catalog rather
        // than being told there is nothing.
        expect(rankedSql(query).sql).not.toContain('ps."supermarketId"');
      }
    });
  });

  describe('the listing branch, which no query takes', () => {
    it('adds the same clause, from the same helper', async () => {
      const { service, qb } = build();

      await service.search({ userId: 'reader', soldBy: [MERCADONA] });

      const clause = listedClauses(qb).find((c) => c.sql.includes('EXISTS ('));
      expect(clause).toBeDefined();
      expect(clause?.sql).toContain('ps."supermarketId" = ANY(:soldBy)');
      expect(clause?.sql).toContain('si."available"');
      expect(clause?.params.soldBy).toEqual([MERCADONA]);
    });

    it('writes no clause at all when the filter is absent or empty', async () => {
      for (const soldBy of [undefined, []]) {
        const { service, qb } = build();

        await service.search({ userId: 'reader', soldBy });

        expect(
          listedClauses(qb).some((c) => c.sql.includes('ps."supermarketId"'))
        ).toBe(false);
      }
    });
  });

  it('is one rule: both branches hold the same clause, parameters apart', async () => {
    const ranked = build();
    await ranked.service.search({
      userId: 'reader',
      query: 'leche',
      soldBy: [MERCADONA],
    });
    const listed = build();
    await listed.service.search({ userId: 'reader', soldBy: [MERCADONA] });

    // The two branches bind differently, so the comparison is of the clause with
    // its placeholder removed. Everything else about it has to be identical: the
    // tables, the join, the item test and `available`.
    const strip = (sql: string) =>
      (/EXISTS \([\s\S]*?\n {6}\)/.exec(sql)?.[0] ?? '')
        .replace(/ANY\((\$\d+|:soldBy)\)/, 'ANY(?)')
        .replace(/\s+/g, ' ');

    const fromRanked = strip(rankedSql(ranked.query).sql);
    const fromListed = strip(
      listedClauses(listed.qb).find((c) => c.sql.includes('EXISTS ('))?.sql ??
        ''
    );

    expect(fromRanked).not.toBe('');
    expect(fromListed).toBe(fromRanked);
  });

  it('answers a page rather than an error for a chain nobody knows', async () => {
    const { service } = build();

    // An id that names no supermarket selects nothing, and selecting nothing is
    // an empty page. There is no lookup in front of the filter that could turn
    // it into a refusal, and a browse screen has nothing useful to do with one.
    const page = await service.search({
      userId: 'reader',
      soldBy: ['cf000000-0000-4000-a000-0000000000ff'],
    });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
