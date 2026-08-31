import type { Repository } from 'typeorm';
import type { Item, ProductGroup, SupermarketItem } from '../entities';
import { ItemService } from './item.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ProductGroupService } from './product-group.service';

/**
 * The one rule plan 0049 section 3 adds to the catalog service itself: **absent
 * and empty scopes are different things.**
 *
 * Absent is an unscoped read, which is what the admin surface does and what
 * every existing spec exercises. An empty array is a caller who said where they
 * shop and reached no chain we know, and it answers with an empty page rather
 * than with the global product table, because listing everything would answer a
 * question they did not ask.
 *
 * Everything about how the search itself ranks belongs to plan 0048 and lives in
 * `item.service.spec.ts` beside `catalog-search.integration.spec.ts`; this file
 * is only about which of the two branches a request takes.
 */
function build() {
  const query = jest.fn(async () => [] as Item[]);
  const getMany = jest.fn(async () => [] as Item[]);
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['take', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[method] = jest.fn(() => qb);
  }
  qb['getMany'] = getMany;

  const items = {
    query,
    createQueryBuilder: jest.fn(() => qb),
    find: jest.fn(async () => []),
  } as unknown as Repository<Item>;
  const groups = {
    query: jest.fn(async () => []),
  } as unknown as Repository<ProductGroup>;
  const prices = {
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as Repository<SupermarketItem>;

  const service = new ItemService(
    items,
    groups,
    prices,
    {} as unknown as ProductGroupService,
    {} as unknown as PlatformAdminService
  );
  return { service, items, groups, query, getMany };
}

describe('a scoped catalog read that resolved to nothing', () => {
  it('answers an empty page rather than the whole catalog', async () => {
    const { service, query, getMany } = build();

    const page = await service.search({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });

    expect(page).toEqual({ items: [], nextCursor: null });
    // Not merely empty: it never asked. An empty page produced by a query that
    // matched nothing would be indistinguishable from this one to a reader of
    // the response and completely different in cost.
    expect(query).not.toHaveBeenCalled();
    expect(getMany).not.toHaveBeenCalled();
  });

  it('does the same for the group search the composer runs', async () => {
    const { service, groups } = build();

    const page = await service.searchOffers({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });

    expect(page).toEqual({ items: [], nextCursor: null });
    expect(groups.query).not.toHaveBeenCalled();
  });

  it('still lists when the scopes are absent rather than empty', async () => {
    const { service, getMany } = build();

    await service.search({ userId: 'user-1' });

    // The unscoped read plan 0048 shipped, unchanged: it ranks, it quotes no
    // price, and it is how the admin surface lists the catalog.
    expect(getMany).toHaveBeenCalled();
  });

  it('still ranks groups when the scopes are absent', async () => {
    const { service, groups } = build();

    await service.searchOffers({ userId: 'user-1', query: 'milk' });

    expect(groups.query).toHaveBeenCalled();
  });
});
