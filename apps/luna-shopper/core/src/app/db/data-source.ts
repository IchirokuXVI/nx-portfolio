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

loadEnv({ path: 'apps/luna-shopper/core/.env' });
loadEnv({ path: 'apps/luna-shopper/.env.luna-shopper' });

const { CORE_ENTITIES } = require('../entities');

export default new DataSource({
  type: 'postgres',
  url: process.env['CORE_DB_URL'],
  entities: CORE_ENTITIES,
  migrations: ['apps/luna-shopper/core/src/app/db/migrations/*.ts'],
  synchronize: false,
});
