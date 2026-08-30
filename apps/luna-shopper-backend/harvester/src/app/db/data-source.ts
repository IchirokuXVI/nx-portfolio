import { config as loadEnv } from 'dotenv';
import 'reflect-metadata';
import { register as registerTsPaths } from 'tsconfig-paths';
import { DataSource } from 'typeorm';

/**
 * The harvester TypeORM CLI data source (plan 0038, section 4.1). Used only by
 * the migration CLI, never by the running service. Schema is always committed
 * migrations; `synchronize` is never used.
 */
registerTsPaths({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

loadEnv({ path: 'apps/luna-shopper-backend/harvester/.env' });
loadEnv({ path: 'apps/luna-shopper-backend/.env.luna-shopper-backend' });

// Fail on an unset URL instead of handing `undefined` to TypeORM, which would
// quietly fall back to localhost:5432 as the OS user and die with a credentials
// error for a connection string that was never set. See catalog's data source
// for the full reasoning; this is the same decision.
const url = process.env['HARVESTER_DB_URL'];
if (!url) {
  throw new Error(
    'HARVESTER_DB_URL is not set. The migration CLI reads it from ' +
      'apps/luna-shopper-backend/harvester/.env, falling back to the shared ' +
      'apps/luna-shopper-backend/.env.luna-shopper-backend, and neither ' +
      'supplied it. Write the local dev defaults with ' +
      '`bash k8s/e2e/luna-shopper-backend/stack.sh bootstrap`, or copy ' +
      'harvester/.env.example to harvester/.env by hand.'
  );
}

const { HARVESTER_ENTITIES } = require('../entities');
const { HARVESTER_MIGRATIONS } = require('./migrations');

export default new DataSource({
  type: 'postgres',
  url,
  entities: HARVESTER_ENTITIES,
  migrations: HARVESTER_MIGRATIONS,
  synchronize: false,
});
