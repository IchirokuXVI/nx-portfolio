import { config as loadEnv } from 'dotenv';
import 'reflect-metadata';
import { register as registerTsPaths } from 'tsconfig-paths';
import { DataSource } from 'typeorm';

/**
 * The core TypeORM CLI data source (plan 0006, section 10; plan 0002 deploy Job).
 * Used only by the migration CLI, never by the running service. Schema is always
 * committed migrations; `synchronize` is never used.
 */
registerTsPaths({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

loadEnv({ path: 'apps/luna-shopper-backend/core/.env' });
loadEnv({ path: 'apps/luna-shopper-backend/.env.luna-shopper-backend' });

const { CORE_ENTITIES } = require('../entities');

// Fail on an unset URL instead of handing `undefined` to TypeORM. Without this
// the postgres driver quietly falls back to its own defaults (localhost:5432,
// the OS user, no password), so the run reaches whatever server is on the
// default port and dies with a SASL "client password must be a string": a
// credentials error for a connection string that was never set. Naming the
// variable turns that into one readable line. The env files above are git
// ignored, so a fresh checkout has neither.
const url = process.env['CORE_DB_URL'];
if (!url) {
  throw new Error(
    'CORE_DB_URL is not set. The migration CLI reads it from ' +
      'apps/luna-shopper-backend/core/.env, falling back to the shared ' +
      'apps/luna-shopper-backend/.env.luna-shopper-backend, and neither ' +
      'supplied it. Write the local dev defaults with ' +
      '`bash k8s/e2e/luna-shopper-backend/stack.sh bootstrap`, or copy ' +
      'core/.env.example to core/.env by hand.'
  );
}

export default new DataSource({
  type: 'postgres',
  url,
  entities: CORE_ENTITIES,
  migrations: ['apps/luna-shopper-backend/core/src/app/db/migrations/*.ts'],
  synchronize: false,
});
