import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import { createHash } from 'node:crypto';
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import {
  Item,
  ItemPrice,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
} from '../../entities';

/**
 * The catalog half of the demo world seeder (plan 0013, section 2).
 *
 * Inserts the reference catalog (supermarkets, locations, items, per store
 * rows) through the real entities and repositories. The core shopping lines
 * reference these item ids across the databases by opaque id only, so the shared
 * fixed constants keep the graph consistent. Idempotent by fixed id.
 *
 * The caller supplies the DataSource; this module never imports one. Importing
 * `data-source.ts` throws the moment CATALOG_DB_URL is unset, so holding it here
 * would make every consumer of this file need a configured database, unit tests
 * beside it included. `cli.js` already resolves the URL and runs the host guard,
 * so it is the one place that should hold a real data source.
 *
 * Since plan 0080 a materialized price has a price row behind it. The fixture
 * describes the materialized rows, which is what every read consumes, and the
 * `item_prices` row each one stands on is derived here from it: one row per
 * priced fixture, of the fixture's kind, observed when the fixture says. The
 * id is derived from the fixture's own id, so a rerun rewrites the same row.
 */

const catalog = demoWorld.catalog;

/** A stable uuid for the price row behind one seeded materialized row. */
function priceRowId(supermarketItemId: string): string {
  const hex = createHash('sha1')
    .update(`demo-item-price/${supermarketItemId}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const itemPrices = catalog.supermarketItems
  .filter((row) => row.price !== null || row.unitPrice !== null)
  .map((row) => {
    const observedAt =
      row.priceObservedAt ?? new Date('2026-09-01T06:00:00.000Z');
    return {
      id: priceRowId(row.id),
      itemId: row.itemId,
      priceScopeId: row.priceScopeId,
      sourceKind: row.priceSourceKind,
      price: row.price,
      currency: row.currency,
      unitPrice: row.unitPrice,
      unitPriceLabel: row.unitPriceLabel,
      observedAt,
      lastObservedAt: observedAt,
      validFrom: null,
      validUntil: null,
      sourceRunId: null,
      lastObservedRunId: null,
      overrides: row.priceSourceKind === 'ADMIN' ? {} : null,
      protectedUntil: null,
    };
  });

/** The materialized rows, each pointing at the price row derived for it. */
const supermarketItems = catalog.supermarketItems.map((row) => {
  const priced = row.price !== null || row.unitPrice !== null;
  return {
    ...row,
    priceObservedAt: priced
      ? (row.priceObservedAt ?? new Date('2026-09-01T06:00:00.000Z'))
      : null,
    priceSourceKind: priced ? row.priceSourceKind : null,
    itemPriceId: priced ? priceRowId(row.id) : null,
    stale: false,
    validUntil: null,
    nextBoundaryAt: null,
  };
});

/** Parents-first insert order; deleting walks it in reverse (children-first). */
export const CATALOG_INSERT_ORDER: {
  name: string;
  entity: EntityTarget<ObjectLiteral>;
  rows: { id: string }[];
}[] = [
  { name: 'Supermarket', entity: Supermarket, rows: catalog.supermarkets },
  // Scopes come before locations: a location cannot exist without one to price
  // against (plan 0038, section 5.1).
  { name: 'PriceScope', entity: PriceScope, rows: catalog.priceScopes },
  {
    name: 'SupermarketLocation',
    entity: SupermarketLocation,
    rows: catalog.locations,
  },
  // Groups before items, because an item may point at one (plan 0048).
  {
    name: 'ProductGroup',
    entity: ProductGroup,
    rows: catalog.productGroups,
  },
  { name: 'Item', entity: Item, rows: catalog.items },
  // The price rows before the materialized rows that point at them (plan 0080).
  { name: 'ItemPrice', entity: ItemPrice, rows: itemPrices },
  {
    name: 'SupermarketItem',
    entity: SupermarketItem,
    rows: supermarketItems,
  },
  {
    name: 'SupermarketLocationItem',
    entity: SupermarketLocationItem,
    rows: catalog.locationItems,
  },
];

export async function seedCatalog(dataSource: DataSource): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  await dataSource.transaction(async (m: EntityManager) => {
    for (const step of [...CATALOG_INSERT_ORDER].reverse()) {
      const ids = step.rows.map((r) => r.id);
      if (ids.length) {
        await m.getRepository(step.entity).delete(ids);
      }
    }
    for (const step of CATALOG_INSERT_ORDER) {
      if (step.rows.length) {
        await m.getRepository(step.entity).insert(step.rows as ObjectLiteral[]);
      }
    }
  });
}

/** CLI entry: seed, then close the connection (the CLI wrapper handles errors). */
export async function main(dataSource: DataSource): Promise<void> {
  await seedCatalog(dataSource);
  await dataSource.destroy();
  console.log(
    `[seed] catalog: ${catalog.supermarkets.length} supermarket(s), ${catalog.priceScopes.length} price scope(s), ${catalog.locations.length} location(s), ${catalog.items.length} items, ${catalog.supermarketItems.length} per-scope price(s), ${catalog.locationItems.length} per-store row(s)`
  );
}
