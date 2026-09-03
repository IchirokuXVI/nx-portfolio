import type { Repository } from 'typeorm';
import type { Item, ProductGroup, SupermarketItem } from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { ItemService } from './item.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ProductGroupService } from './product-group.service';

/**
 * The one rule plan 0069 leaves the catalog service: **absent and empty scopes
 * are the same read.** Both rank, both page, and neither quotes a price.
 *
 * Plan 0049 section 3 made them different, an empty array answering an empty
 * page on the grounds that listing everything answers a question the caller did
 * not ask. What that actually produced was a shopper who switched off four
 * chains, typed "milk", and was told there is no milk. A scope is how a price
 * gets attached to a product; it says nothing about which products exist, so
 * this file now asserts the branch is gone rather than which side of it a
 * request takes.
 *
 * Everything about how the search itself ranks belongs to plan 0048 and lives in
 * `item.service.spec.ts` beside `catalog-search.integration.spec.ts`.
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
    {} as unknown as PlatformAdminService,
    // Plan 0070. Neither read here moves a product's group, so it is never
    // called; the constructor still needs it.
    {} as unknown as CatalogEventsPublisher
  );
  return { service, items, groups, prices, query, getMany };
}

describe('a catalog read whose scopes resolved to nothing', () => {
  it('ranks the catalog rather than short circuiting to an empty page', async () => {
    const { service, query } = build();

    await service.search({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });

    // The point of the whole change: it asks. An empty page here read as "there
    // is no milk" to somebody who had only refused every shop near them.
    expect(query).toHaveBeenCalled();
  });

  it('quotes no price when there is no scope to quote from', async () => {
    const { service, prices } = build();

    await service.search({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });

    // Ranked and paged, but the price table is never opened: with no scopes
    // there is nothing to attach, which is the only thing an empty scope set
    // ever meant.
    expect(prices.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('lists rather than refusing when there is no query either', async () => {
    const { service, getMany } = build();

    await service.search({ userId: 'user-1', priceScopeIds: [] });

    expect(getMany).toHaveBeenCalled();
  });

  it('does the same for the group search the composer runs', async () => {
    const { service, groups } = build();

    await service.searchOffers({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });

    expect(groups.query).toHaveBeenCalled();
  });

  it('reads empty scopes exactly as it reads absent ones', async () => {
    const empty = build();
    const absent = build();

    await empty.service.search({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });
    await absent.service.search({ userId: 'user-1', query: 'milk' });

    // Same SQL, same parameters: the two ways of having no scopes are one branch
    // now, and this is the assertion that keeps them one.
    expect(empty.query.mock.calls).toEqual(absent.query.mock.calls);
  });

  it('reads empty group scopes exactly as it reads absent ones', async () => {
    const empty = build();
    const absent = build();

    await empty.service.searchOffers({
      userId: 'user-1',
      query: 'milk',
      priceScopeIds: [],
    });
    await absent.service.searchOffers({ userId: 'user-1', query: 'milk' });

    expect((empty.groups.query as jest.Mock).mock.calls).toEqual(
      (absent.groups.query as jest.Mock).mock.calls
    );
  });
});
