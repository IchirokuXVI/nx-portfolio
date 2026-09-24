import {
  ItemCategory,
  PriceSourceKind,
  PRODUCT_GROUP_MEMBERS_MAX,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { Brand, Item, ProductGroup, SupermarketItem } from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { fakeAudit } from './catalog-audit.testing';
import { ItemService } from './item.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ProductGroupService } from './product-group.service';

/**
 * What the suggestion card reads from the two searches (plan 0161, sections 1
 * and 2), with fake repositories.
 *
 * These prove the wiring: which query runs when, what is attached where, and
 * that a caller who asks for nothing new gets what it got before. The order the
 * member query ranks in is a claim about an `ORDER BY`, so it is asserted
 * against Postgres in `best-offer.integration.spec.ts`.
 */

const SCOPE_A = 'scope-a';
const SCOPE_B = 'scope-b';

const item = (id: string, productGroupId: string | null = null) =>
  ({
    id,
    name: { en: id, es: id },
    brand: null,
    imageUrl: null,
    sku: null,
    ean: null,
    unitSize: '1',
    category: ItemCategory.DAIRY,
    defaultUnit: UnitOfMeasure.LITER,
    productGroupId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Item;

/** One price row, as TypeORM hands numerics back: strings. */
const priceRow = (itemId: string, priceScopeId: string, price: string) =>
  ({
    itemId,
    priceScopeId,
    price,
    currency: 'EUR',
    unitPrice: price,
    unitPriceLabel: 'L',
    priceObservedAt: new Date('2026-09-20T10:00:00.000Z'),
    priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
    priceCopiedFromScopeId: null,
    stale: false,
    available: true,
  }) as unknown as SupermarketItem;

/** The `offer` columns a raw query answers with. */
const offerColumns = (priceScopeId: string | null, price: string | null) => ({
  offerScopeId: priceScopeId,
  offerPrice: price,
  offerCurrency: price === null ? null : 'EUR',
  offerUnitPrice: price,
  offerUnitPriceLabel: price === null ? null : 'L',
  offerObservedAt: price === null ? null : '2026-09-20T10:00:00.000Z',
  offerSourceKind: price === null ? null : PriceSourceKind.OFFICIAL_WEB,
  offerCopiedFromScopeId: null,
  offerStale: price === null ? null : false,
});

/** The ranked group row for a milk group whose cheapest member is `i-1`. */
const groupRow = {
  id: 'g-milk',
  name: { en: 'Milk', es: 'Leche' },
  slug: 'milk',
  referenceUnit: UnitOfMeasure.LITER,
  synonyms: { en: [], es: [] },
  offerItemId: 'i-1',
  ...offerColumns(SCOPE_A, '0.89'),
  relevance: '1',
};

interface World {
  /** What the ranked item search answers with. */
  readonly items?: Item[];
  /** Every price row, cheapest first, as `orderOffers` would sort them. */
  readonly prices?: SupermarketItem[];
}

function build(world: World = {}) {
  const priceQueries: { distinct: boolean }[] = [];
  const prices = {
    createQueryBuilder: jest.fn(() => {
      const record = { distinct: false };
      priceQueries.push(record);
      const qb: Record<string, jest.Mock> = {};
      qb['distinctOn'] = jest.fn(() => {
        record.distinct = true;
        return qb;
      });
      for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy']) {
        qb[method] = jest.fn(() => qb);
      }
      qb['getMany'] = jest.fn(async () => {
        const rows = world.prices ?? [];
        if (!record.distinct) {
          return rows;
        }
        // `DISTINCT ON ("itemId")` over rows already in order.
        const seen = new Set<string>();
        return rows.filter((row) =>
          seen.has(row.itemId) ? false : (seen.add(row.itemId), true)
        );
      });
      return qb;
    }),
  } as unknown as Repository<SupermarketItem>;

  // `items.query` answers three different statements: the ranked item search,
  // the group membership, and the ranked members. They are told apart by what
  // each one alone selects.
  const itemQueries: { sql: string; values: unknown[] }[] = [];
  const itemsQuery = jest.fn(async (sql: string, values: unknown[]) => {
    itemQueries.push({ sql, values });
    if (sql.includes('AS "itemId"')) {
      return [
        {
          itemId: 'i-1',
          productGroupId: 'g-milk',
          ...offerColumns(SCOPE_B, '0.95'),
          rn: '1',
        },
        {
          itemId: 'i-2',
          productGroupId: 'g-milk',
          ...offerColumns(SCOPE_B, '1.10'),
          rn: '2',
        },
        {
          itemId: 'i-3',
          productGroupId: 'g-milk',
          ...offerColumns(null, null),
          rn: '3',
        },
      ];
    }
    if (sql.includes('row_number()')) {
      return ['i-1', 'i-2', 'i-3', 'i-4'].map((id) => ({
        id,
        productGroupId: 'g-milk',
      }));
    }
    return world.items ?? [item('i-1'), item('i-2')];
  });
  const items = {
    query: itemsQuery,
    find: jest.fn(async () =>
      ['i-1', 'i-2', 'i-3'].map((id) => item(id, 'g-milk'))
    ),
  } as unknown as Repository<Item>;
  const groups = {
    query: jest.fn(async () => [groupRow]),
  } as unknown as Repository<ProductGroup>;

  const service = new ItemService(
    items,
    groups,
    prices,
    {} as Repository<Brand>,
    {} as unknown as ProductGroupService,
    {} as unknown as PlatformAdminService,
    fakeAudit([]).service,
    {} as unknown as CatalogEventsPublisher
  );
  const memberQueries = () =>
    itemQueries.filter((q) => q.sql.includes('AS "itemId"'));
  return { service, priceQueries, memberQueries };
}

describe('search with every offer (plan 0161, section 1)', () => {
  const prices = [
    priceRow('i-1', SCOPE_A, '0.89'),
    priceRow('i-1', SCOPE_B, '0.95'),
    priceRow('i-2', SCOPE_B, '1.10'),
  ];

  it('fills `offers` for every item, and `bestOffer` is its first entry', async () => {
    const { service, priceQueries } = build({ prices });

    const page = await service.search({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
      offers: 'all',
    });

    expect(page.items.map((i) => i.offers?.map((o) => o.priceScopeId))).toEqual(
      [[SCOPE_A, SCOPE_B], [SCOPE_B]]
    );
    for (const found of page.items) {
      expect(found.bestOffer).toEqual(found.offers?.[0]);
    }
    // One query, uncollapsed: the cheapest is read off the same rows.
    expect(priceQueries).toEqual([{ distinct: false }]);
  });

  it('answers what it answered before when `offers` is not asked for', async () => {
    const { service, priceQueries } = build({ prices });

    const page = await service.search({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
    });

    expect(page.items.map((i) => 'offers' in i)).toEqual([false, false]);
    expect(page.items.map((i) => i.bestOffer?.priceScopeId)).toEqual([
      SCOPE_A,
      SCOPE_B,
    ]);
    expect(priceQueries).toEqual([{ distinct: true }]);
  });

  it('agrees with the cheapest-only read on `bestOffer`', async () => {
    const all = await build({ prices }).service.search({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
      offers: 'all',
    });
    const best = await build({ prices }).service.search({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
    });

    expect(all.items.map((i) => i.bestOffer)).toEqual(
      best.items.map((i) => i.bestOffer)
    );
  });

  it('reads `all` only when a scope is named', async () => {
    const { service, priceQueries } = build({ prices });

    const page = await service.search({
      userId: 'u',
      query: 'leche',
      offers: 'all',
    });

    expect(page.items.map((i) => 'offers' in i)).toEqual([false, false]);
    expect(page.items.map((i) => 'bestOffer' in i)).toEqual([false, false]);
    expect(priceQueries).toEqual([]);
  });
});

describe('searchOffers for the card (plan 0161, sections 1 and 2)', () => {
  it('adds no members and no offers when neither is asked for', async () => {
    const { service, memberQueries, priceQueries } = build();

    const page = await service.searchOffers({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
    });

    expect('members' in page.items[0]).toBe(false);
    expect('offers' in (page.items[0].cheapestItem ?? {})).toBe(false);
    expect(page.items[0].itemIds).toEqual(['i-1', 'i-2', 'i-3', 'i-4']);
    expect(memberQueries()).toEqual([]);
    expect(priceQueries).toEqual([]);
  });

  it('draws the members in the order the query ranked them, `members[0]` as `cheapestItem`', async () => {
    const { service } = build();

    const page = await service.searchOffers({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
      members: 5,
    });
    const [group] = page.items;

    expect(group.members?.map((m) => m.id)).toEqual(['i-1', 'i-2', 'i-3']);
    // The first member is the cheapest item exactly, offer included, even
    // though the member query picked another of its scopes.
    expect(group.members?.[0]).toEqual(group.cheapestItem);
    expect(group.members?.[1].bestOffer).toMatchObject({
      priceScopeId: SCOPE_B,
      price: 1.1,
    });
    // Unpriced: named, and no offer at all.
    expect('bestOffer' in (group.members?.[2] ?? {})).toBe(false);
    // Every member carries one price, never the whole list.
    expect(group.members?.some((m) => 'offers' in m)).toBe(false);
    // `itemIds` is untouched: it is what choosing the group copies.
    expect(group.itemIds).toEqual(['i-1', 'i-2', 'i-3', 'i-4']);
  });

  it(`clamps the count to ${PRODUCT_GROUP_MEMBERS_MAX}, in the database`, async () => {
    const { service, memberQueries } = build();

    await service.searchOffers({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A],
      members: 50,
    });

    const [member] = memberQueries();
    expect(member.sql).toContain('PARTITION BY i."productGroupId"');
    expect(member.values).toContain(PRODUCT_GROUP_MEMBERS_MAX);
    expect(member.values).not.toContain(50);
  });

  it("fills `offers` on the cheapest item, led by the group's own offer", async () => {
    // Cheapest by price is B here, and the group was ranked on A's row: the
    // group's offer still leads, so `bestOffer` is unchanged and is `offers[0]`.
    const { service } = build({
      prices: [
        priceRow('i-1', SCOPE_B, '0.79'),
        priceRow('i-1', SCOPE_A, '0.89'),
      ],
    });

    const page = await service.searchOffers({
      userId: 'u',
      query: 'leche',
      priceScopeIds: [SCOPE_A, SCOPE_B],
      offers: 'all',
    });
    const [group] = page.items;

    expect(group.offer).toMatchObject({ priceScopeId: SCOPE_A, price: 0.89 });
    expect(group.cheapestItem?.bestOffer).toEqual(group.offer);
    expect(group.cheapestItem?.offers?.map((o) => o.priceScopeId)).toEqual([
      SCOPE_A,
      SCOPE_B,
    ]);
    expect(group.cheapestItem?.offers?.[0]).toEqual(group.offer);
  });
});
