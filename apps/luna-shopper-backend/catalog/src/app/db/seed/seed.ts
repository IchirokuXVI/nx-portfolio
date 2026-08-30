import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import {
  Item,
  PriceScope,
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
 */

const catalog = demoWorld.catalog;

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
  { name: 'Item', entity: Item, rows: catalog.items },
  {
    name: 'SupermarketItem',
    entity: SupermarketItem,
    rows: catalog.supermarketItems,
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
