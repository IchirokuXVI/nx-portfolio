// Cross-platform entry point for the catalog seeder (plan 0013, section 2).
// Resolves and guards the target database before connecting, then runs the
// TypeScript seeder under ts-node. See the auth seed cli.js for the rationale.
const path = require('node:path');

const toolsDb = path.resolve(__dirname, '../../../../../tools/db');
const { resolveDbUrl } = require(path.join(toolsDb, 'env'));
const { assertSafeTarget } = require(path.join(toolsDb, 'guard'));

const url = resolveDbUrl('catalog');
assertSafeTarget(url, 'seed the catalog database');

process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT ||
  'apps/luna-shopper-backend/catalog/tsconfig.migrations.json';
process.env.TS_NODE_TRANSPILE_ONLY = process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

// The seeder takes its DataSource from here rather than importing one; see the
// auth seed cli.js for why.
const dataSource = require('../data-source').default;

require('./seed')
  .main(dataSource)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
