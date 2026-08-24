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
loadEnv({ path: 'apps/luna-shopper/auth/.env' });
loadEnv({ path: 'apps/luna-shopper/.env.luna-shopper' });

const { AUTH_ENTITIES } = require('../entities');

export default new DataSource({
  type: 'postgres',
  url: process.env['AUTH_DB_URL'],
  entities: AUTH_ENTITIES,
  migrations: ['apps/luna-shopper/auth/src/app/db/migrations/*.ts'],
  synchronize: false,
});
