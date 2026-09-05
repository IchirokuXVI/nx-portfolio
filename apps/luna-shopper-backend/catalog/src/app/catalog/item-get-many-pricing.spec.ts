import {
  ItemCategory,
  PriceSourceKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { Item, ProductGroup, SupermarketItem } from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { fakeAudit } from './catalog-audit.testing';
import { ItemService } from './item.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ProductGroupService } from './product-group.service';

/**
 * Pricing a lookup by id (plan 0066, section 2).
 *
 * `getMany` used to answer names alone, and `bestOffer` was documented as absent
 * on it. With scopes it now carries the cheapest row across exactly those scopes,
 * by **price**, and the four cases here are the four sentences of sections 2 and
 * 7: the regression guard for callers sending no scopes, the cheapest row at the
 * requested scopes, null for an item priced only elsewhere, and the unit price
 * travelling verbatim.
 *
 * The `DISTINCT ON` itself is Postgres's and is not simulated. What is asserted
 * is that the query asked for the right scopes in the right order, and that what
 * came back is attached to the right item.
 */

function build(
  items: Partial<Repository<Item>>,
  qb: Record<string, jest.Mock>
) {
  const prices = {
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as Repository<SupermarketItem>;
  const service = new ItemService(
    items as Repository<Item>,
    {} as Repository<ProductGroup>,
    prices,
    {} as ProductGroupService,
    { requireAdmin: jest.fn() } as unknown as PlatformAdminService,
    // Plan 0075. Both reads here, so no transaction is ever opened.
    fakeAudit([]).service,
    // Plan 0070. Neither read here moves a product's group, so it is never
    // called; the constructor still needs it.
    {} as unknown as CatalogEventsPublisher
  );
  return { service, prices };
}

const item = (id: string) =>
  ({
    id,
    name: { en: 'Milk', es: 'Leche' },
    brand: null,
    imageUrl: null,
    sku: null,
    ean: null,
    unitSize: '1.5',
    category: ItemCategory.DAIRY,
    defaultUnit: UnitOfMeasure.LITER,
    productGroupId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Item;

/** One price row, as TypeORM hands numerics back: strings. */
const priceRow = (
  itemId: string,
  priceScopeId: string,
  price: string,
  unitPrice: string | null
) =>
  ({
    itemId,
    priceScopeId,
    price,
    currency: 'EUR',
    unitPrice,
    unitPriceLabel: 'EUR/L',
    priceObservedAt: new Date('2026-09-01T06:00:00.000Z'),
    priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
    available: true,
  }) as unknown as SupermarketItem;

/** A query builder double that records the scope filter and the order. */
function makePriceQb(rows: SupermarketItem[]) {
  const calls: { scopeIds?: string[]; order: string[] } = { order: [] };
  const qb: Record<string, jest.Mock> = {};
  qb['distinctOn'] = jest.fn(() => qb);
  qb['where'] = jest.fn(() => qb);
  qb['andWhere'] = jest.fn((_sql: string, params?: { scopeIds?: string[] }) => {
    if (params?.scopeIds) {
      calls.scopeIds = params.scopeIds;
    }
    return qb;
  });
  qb['orderBy'] = jest.fn((column: string) => {
    calls.order.push(column);
    return qb;
  });
  qb['addOrderBy'] = jest.fn((column: string) => {
    calls.order.push(column);
    return qb;
  });
  qb['getMany'] = jest.fn(async () => rows);
  return { qb, calls };
}

describe('ItemService.getMany with scopes (plan 0066)', () => {
  it('answers items with `bestOffer` absent when no scopes are named', async () => {
    const items = { find: jest.fn(async () => [item('i1')]) };
    const { qb } = makePriceQb([]);
    const { service, prices } = build(items, qb);

    const absent = await service.getMany({ ids: ['i1'] });
    const empty = await service.getMany({ ids: ['i1'], priceScopeIds: [] });

    // The regression guard for every existing caller: the key is not there,
    // rather than there and null, and no price query was run at all.
    expect('bestOffer' in absent.items[0]).toBe(false);
    expect('bestOffer' in empty.items[0]).toBe(false);
    expect(prices.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('carries the cheapest row across exactly the requested scopes, by price', async () => {
    const items = { find: jest.fn(async () => [item('i1')]) };
    const { qb, calls } = makePriceQb([
      priceRow('i1', 'scope-a', '0.95', '0.63'),
    ]);
    const { service } = build(items, qb);

    const result = await service.getMany({
      ids: ['i1'],
      priceScopeIds: ['scope-a', 'scope-b'],
    });

    expect(result.items[0].bestOffer).toMatchObject({
      itemId: 'i1',
      priceScopeId: 'scope-a',
      price: 0.95,
      currency: 'EUR',
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
    });
    expect(calls.scopeIds).toEqual(['scope-a', 'scope-b']);
    // Section 2.1: the shelf price decides, and the unit price only breaks a
    // tie. Search ranks the other way round, on purpose.
    expect(calls.order).toEqual([
      'si."itemId"',
      'si."price"',
      'si."unitPrice"',
    ]);
  });

  it('answers null for an item priced only at scopes the caller did not ask about', async () => {
    const items = { find: jest.fn(async () => [item('i1'), item('i2')]) };
    // Only `i2` has a row inside the requested scopes. The query is what keeps
    // `i1`'s other scope out, so the double answers as Postgres would.
    const { qb } = makePriceQb([priceRow('i2', 'scope-a', '2.19', '1.46')]);
    const { service } = build(items, qb);

    const result = await service.getMany({
      ids: ['i1', 'i2'],
      priceScopeIds: ['scope-a'],
    });

    const byId = new Map(result.items.map((view) => [view.id, view]));
    // Null and not absent: this read priced, and this item has no price here.
    expect(byId.get('i1')?.bestOffer).toBeNull();
    expect(byId.get('i2')?.bestOffer?.price).toBe(2.19);
  });

  it('carries the unit price verbatim rather than recomputing it', async () => {
    const items = { find: jest.fn(async () => [item('i1')]) };
    // 2.19 over a 1.5 L item would derive 1.46; the stored figure is what the
    // chain published, and plan 0038 section 2.4 says the two disagree on 110
    // products. It travels untouched.
    const { qb } = makePriceQb([priceRow('i1', 'scope-a', '2.19', '1.52')]);
    const { service } = build(items, qb);

    const result = await service.getMany({
      ids: ['i1'],
      priceScopeIds: ['scope-a'],
    });

    expect(result.items[0].bestOffer?.unitPrice).toBe(1.52);
    expect(result.items[0].bestOffer?.unitPriceLabel).toBe('EUR/L');
  });
});
