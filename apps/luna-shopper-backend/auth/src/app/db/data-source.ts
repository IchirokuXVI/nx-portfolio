import { config as loadEnv } from 'dotenv';
import 'reflect-metadata';
import { register as registerTsPaths } from 'tsconfig-paths';
import { DataSource } from 'typeorm';

/**
 * The TypeORM CLI data source (plan 0005, section 6; plan 0002 deploy Job).
 *
 * Used only by the migration CLI (`migration:generate` / `migration:run` /
 * `migration:revert`), never by the running service, which wires TypeORM through
 * `TypeOrmModule.forRootAsync` off the validated config. Schema changes are always
 * committed migrations applied by the deploy Job; `synchronize` is never used.
 */

// The CLI runs this file through ts-node, which does not resolve the workspace
// `@portfolio/*` path aliases on its own. Register them before the entities
// (loaded with require below so this runs first) so the CLI resolves them the
// same way the app build does.
registerTsPaths({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

// The same layered env files the service reads, so the CLI picks up AUTH_DB_URL
// from the service file (which wins) or the shared one.
loadEnv({ path: 'apps/luna-shopper-backend/auth/.env' });
loadEnv({ path: 'apps/luna-shopper-backend/.env.luna-shopper-backend' });

const { AUTH_ENTITIES } = require('../entities');
const { AUTH_MIGRATIONS } = require('./migrations');

// Fail on an unset URL instead of handing `undefined` to TypeORM. Without this
// the postgres driver quietly falls back to its own defaults (localhost:5432,
// the OS user, no password), which on a developer machine is this stack's own
// auth-db container, so the run reaches a real server and dies with a SASL
// "client password must be a string": a credentials error for a connection
// string that was never set. Naming the variable turns that into one readable
// line. The env files above are git ignored, so a fresh checkout has neither.
const url = process.env['AUTH_DB_URL'];
if (!url) {
  throw new Error(
    'AUTH_DB_URL is not set. The migration CLI reads it from ' +
      'apps/luna-shopper-backend/auth/.env, falling back to the shared ' +
      'apps/luna-shopper-backend/.env.luna-shopper-backend, and neither ' +
      'supplied it. Write the local dev defaults with ' +
      '`bash k8s/e2e/luna-shopper-backend/stack.sh bootstrap`, or copy ' +
      'auth/.env.example to auth/.env by hand.'
  );
}

export default new DataSource({
  type: 'postgres',
  url,
  entities: AUTH_ENTITIES,
  migrations: AUTH_MIGRATIONS,
  synchronize: false,
});
