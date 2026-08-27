import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AUTH_MIGRATIONS } from './app/db/migrations';
import { AUTH_ENTITIES } from './app/entities';

/**
 * The migration entry point that lives INSIDE the image (plan 0027, section 2).
 *
 * `webpack.config.js` emits this as `migrate.js` beside `main.js`, and the
 * chart's pre-install/pre-upgrade Job runs `node migrate.js`. Before this
 * existed, `values.yaml` named that command against a file nothing ever built,
 * so `migrations.enabled: true` would have failed the Job rather than migrating.
 *
 * It deliberately does NOT reuse `app/db/data-source.ts`. That file is the
 * TypeORM CLI's, and it needs ts-node, the workspace tsconfig, the
 * `@portfolio/*` path aliases and the git ignored `.env` files — a runtime image
 * has none of them and should not. Both paths share the entity list and the
 * migration array, which is what keeps them from disagreeing.
 */
async function run() {
  // The Job receives this from the application Secret through _env.tpl, which
  // gives the auth pod AUTH_DB_URL and nothing else. Fail naming the variable
  // rather than handing `undefined` to TypeORM, whose postgres driver falls back
  // to its own defaults and dies with a credentials error for a connection
  // string that was never set.
  const url = process.env['AUTH_DB_URL'];
  if (!url) {
    throw new Error(
      'AUTH_DB_URL is not set. The migration Job reads it from the ' +
        'luna-shopper-backend-secrets Secret; run ' +
        'k8s/bootstrap/provision-release.sh --check to see which key is missing.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: AUTH_ENTITIES,
    migrations: AUTH_MIGRATIONS,
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    // One transaction for the whole set. Migrations are expand and contract, so
    // a half applied set is the single state the rollout contract does not
    // cover: the new pods would meet a schema that is neither the old one nor
    // the new one.
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
