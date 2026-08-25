import { config as loadEnv } from 'dotenv';
import 'reflect-metadata';
import { register as registerTsPaths } from 'tsconfig-paths';
import { DataSource } from 'typeorm';

/**
 * The catalog TypeORM CLI data source (plan 0012; plan 0002 deploy Job). Used
 * only by the migration CLI, never by the running service. Schema is always
 * committed migrations; `synchronize` is never used.
 */
registerTsPaths({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

loadEnv({ path: 'apps/luna-shopper-backend/catalog/.env' });
loadEnv({ path: 'apps/luna-shopper-backend/.env.luna-shopper-backend' });

const { CATALOG_ENTITIES } = require('../entities');

export default new DataSource({
  type: 'postgres',
  url: process.env['CATALOG_DB_URL'],
  entities: CATALOG_ENTITIES,
  migrations: ['apps/luna-shopper-backend/catalog/src/app/db/migrations/*.ts'],
  synchronize: false,
});
