import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './app/db/migrations';
import { HARVESTER_ENTITIES } from './app/entities';

/**
 * The migration entry point that lives INSIDE the image (plan 0027, section 2).
 *
 * `webpack.config.js` emits this as `migrate.js` beside `main.js`, and the
 * chart's post-install/pre-upgrade Job runs `node migrate.js`. It does not reuse
 * the CLI's `data-source.ts`, which registers ts-node path aliases and reads
 * `.env` files that do not exist inside a container.
 */
async function run() {
  const url = process.env['HARVESTER_DB_URL'];
  if (!url) {
    throw new Error(
      'HARVESTER_DB_URL is not set. The migration Job reads it from the ' +
        'luna-shopper-backend-secrets Secret; run ' +
        'k8s/bootstrap/provision-release.sh --check to see which key is missing.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: HARVESTER_ENTITIES,
    migrations: HARVESTER_MIGRATIONS,
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    // One transaction for the whole set: migrations are expand and contract, so
    // a half applied set is the one state the rollout contract does not cover.
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    console.log(`applied ${applied.length} migration(s)`);
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
