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
  ListLineItem,
  MergeRequest,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';

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
 *
 * The caller supplies the DataSource; this module never imports one. Importing
 * `data-source.ts` throws the moment CORE_DB_URL is unset, so holding it here
 * would make every consumer of this file need a configured database, the unit
 * tests beside it included, even though they drive the seeder with a fake.
 * `cli.js` already resolves the URL and runs the host guard, so it is the one
 * place that should hold a real data source.
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
  // The products each line stands for (plan 0048, section 1.1). After the lines,
  // because a row cannot reference a line that does not exist yet.
  { name: 'ListLineItem', entity: ListLineItem, rows: core.lineItems },
  { name: 'LineComment', entity: LineComment, rows: core.comments },
  { name: 'MergeRequest', entity: MergeRequest, rows: core.mergeRequests },
];

export async function seedCore(dataSource: DataSource): Promise<void> {
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
export async function main(dataSource: DataSource): Promise<void> {
  await seedCore(dataSource);
  await dataSource.destroy();
  console.log(
    `[seed] core: ${core.zones.length} zone(s), ${core.memberships.length} memberships, ${core.lists.length} lists, ${core.lines.length} lines`
  );
}
