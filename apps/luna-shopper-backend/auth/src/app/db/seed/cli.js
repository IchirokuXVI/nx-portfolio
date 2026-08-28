// Cross-platform entry point for the auth seeder (plan 0013, section 2).
//
// Mirrors the migration cli.js. It resolves and guards the target database
// BEFORE anything connects (default-deny: it refuses a non-local host), then runs
// the TypeScript seeder under ts-node so it uses the real entities and
// repositories. tsconfig-paths is registered here too, so the seeder's
// `@portfolio/luna-shopper/*` imports resolve regardless of import order.
const path = require('node:path');

const toolsDb = path.resolve(__dirname, '../../../../../tools/db');
const { resolveDbUrl } = require(path.join(toolsDb, 'env'));
const { assertSafeTarget } = require(path.join(toolsDb, 'guard'));

const url = resolveDbUrl('auth');
assertSafeTarget(url, 'seed the auth database');

process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT ||
  'apps/luna-shopper-backend/auth/tsconfig.migrations.json';
process.env.TS_NODE_TRANSPILE_ONLY = process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

// The seeder takes its DataSource from here rather than importing one, so that
// importing it in a unit test does not require a configured database. This is
// the CLI path, the only one that connects, and the URL above is already
// resolved and guarded by the time this line runs.
const dataSource = require('../data-source').default;

require('./seed')
  .main(dataSource)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
