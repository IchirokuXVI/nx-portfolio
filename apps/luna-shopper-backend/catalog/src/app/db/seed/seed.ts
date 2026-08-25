import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import {
  Item,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../../entities';
import defaultDataSource from '../data-source';

/**
 * The catalog half of the demo world seeder (plan 0013, section 2).
 *
 * Inserts the reference catalog (supermarkets, locations, items, per store
 * rows) through the real entities and repositories. The core shopping lines
 * reference these item ids across the databases by opaque id only, so the shared
 * fixed constants keep the graph consistent. Idempotent by fixed id.
 */

const catalog = demoWorld.catalog;

/** Parents-first insert order; deleting walks it in reverse (children-first). */
export const CATALOG_INSERT_ORDER: {
  name: string;
  entity: EntityTarget<ObjectLiteral>;
  rows: { id: string }[];
}[] = [
  { name: 'Supermarket', entity: Supermarket, rows: catalog.supermarkets },
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
];

export async function seedCatalog(
  dataSource: DataSource = defaultDataSource
): Promise<void> {
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
export async function main(): Promise<void> {
  await seedCatalog();
  await defaultDataSource.destroy();
  console.log(
    `[seed] catalog: ${catalog.supermarkets.length} supermarket(s), ${catalog.locations.length} location(s), ${catalog.items.length} items, ${catalog.supermarketItems.length} per-store rows`
  );
}
