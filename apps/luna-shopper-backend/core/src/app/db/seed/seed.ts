import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import {
  LineComment,
  ListAccess,
  ListLine,
  MergeRequest,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';
import defaultDataSource from '../data-source';

/**
 * The core half of the demo world seeder (plan 0013, section 2).
 *
 * Inserts through the real TypeORM entities and repositories, referencing the
 * auth user ids by the shared fixed constants (core joins auth by opaque id, not
 * a cross database foreign key). Idempotent by fixed id: it deletes the known
 * seed rows children-first, then reinserts parents-first, so it only ever
 * touches the canonical scenario rows.
 *
 * It deliberately does NOT replay NATS domain events: seeded rows are historical,
 * so no realtime fan-out fires for them (plan 0013, section 2).
 */

const core = demoWorld.core;

/**
 * Parents-first insert order. Deleting walks it in reverse (children-first).
 * Exported so the ordering is unit testable without a database.
 */
export const CORE_INSERT_ORDER: {
  name: string;
  entity: EntityTarget<ObjectLiteral>;
  rows: { id: string }[];
}[] = [
  { name: 'Zone', entity: Zone, rows: core.zones },
  { name: 'ZoneMembership', entity: ZoneMembership, rows: core.memberships },
  { name: 'ShoppingList', entity: ShoppingList, rows: core.lists },
  { name: 'ListAccess', entity: ListAccess, rows: core.listAccess },
  { name: 'ListLine', entity: ListLine, rows: core.lines },
  { name: 'LineComment', entity: LineComment, rows: core.comments },
  { name: 'MergeRequest', entity: MergeRequest, rows: core.mergeRequests },
];

export async function seedCore(
  dataSource: DataSource = defaultDataSource
): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  await dataSource.transaction(async (m: EntityManager) => {
    for (const step of [...CORE_INSERT_ORDER].reverse()) {
      const ids = step.rows.map((r) => r.id);
      if (ids.length) {
        await m.getRepository(step.entity).delete(ids);
      }
    }
    for (const step of CORE_INSERT_ORDER) {
      if (step.rows.length) {
        await m.getRepository(step.entity).insert(step.rows as ObjectLiteral[]);
      }
    }
  });
}

/** CLI entry: seed, then close the connection (the CLI wrapper handles errors). */
export async function main(): Promise<void> {
  await seedCore();
  await defaultDataSource.destroy();
  console.log(
    `[seed] core: ${core.zones.length} zone(s), ${core.memberships.length} memberships, ${core.lists.length} lists, ${core.lines.length} lines`
  );
}
