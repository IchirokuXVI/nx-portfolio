import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { seedReferenceCatalog } from './app/db/reference';
import { CATALOG_ENTITIES } from './app/entities';

/**
 * The reference catalog seeder that lives INSIDE the image (plan 0067, section
 * 7), emitted as `seed-reference.js` beside `main.js` and `migrate.js`.
 *
 * It exists for the same reason `migrate.ts` does and takes the same shape: a
 * bundled build cannot reach `cli.js`, ts-node or `data-source.ts`, so the entry
 * point the chart's Job runs has to be a webpack entry of its own that reads its
 * URL from the environment and builds a DataSource by hand.
 *
 * It runs as a Job hook after migrations rather than on service boot. Seeding
 * from `main.ts` would have every replica race to write the same 274 rows on
 * every rollout, and would put a schema-shaped dependency inside a process whose
 * readiness probe is supposed to answer before it has done any work.
 */
async function run() {
  const url = process.env['CATALOG_DB_URL'];
  if (!url) {
    throw new Error(
      'CATALOG_DB_URL is not set. The seed Job reads it from the ' +
        'luna-shopper-backend-secrets Secret; run ' +
        'k8s/bootstrap/provision-release.sh --check to see which key is missing.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: CATALOG_ENTITIES,
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    const r = await seedReferenceCatalog(dataSource);
    console.log(
      `[seed-reference] ${r.groups} group(s), ${r.stores} store(s), ` +
        `${r.items} product(s) created, ${r.prices} price row(s) inserted; ` +
        `${r.adopted} product(s) already harvested and only grouped`
    );
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
