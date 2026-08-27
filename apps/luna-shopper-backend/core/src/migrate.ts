import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CORE_MIGRATIONS } from './app/db/migrations';
import { CORE_ENTITIES } from './app/entities';

/**
 * The migration entry point that lives INSIDE the image (plan 0027, section 2).
 *
 * `webpack.config.js` emits this as `migrate.js` beside `main.js`, and the
 * chart's pre-install/pre-upgrade Job runs `node migrate.js`. See the auth
 * service's `migrate.ts` for why this does not reuse the CLI's `data-source.ts`.
 */
async function run() {
  const url = process.env['CORE_DB_URL'];
  if (!url) {
    throw new Error(
      'CORE_DB_URL is not set. The migration Job reads it from the ' +
        'luna-shopper-backend-secrets Secret; run ' +
        'k8s/bootstrap/provision-release.sh --check to see which key is missing.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: CORE_ENTITIES,
    migrations: CORE_MIGRATIONS,
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
