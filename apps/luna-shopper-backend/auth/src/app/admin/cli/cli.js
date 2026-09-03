// Cross-platform entry point for the operator commands on a developer machine
// (plan 0071, section 6).
//
// Mirrors `db/seed/cli.js` in shape and differs from it in one deliberate way:
// there is NO `assertSafeTarget` call. The seed, snapshot and restore tooling is
// default-deny because seeding a non local database is never right; creating an
// operator on the server is the whole point of this command, and a guard here
// would refuse the one case section 6 was written for. The image carries its own
// entry (`admin-cli.js`, from `src/admin-cli.ts`) for exactly that case; this one
// exists so a developer with a checkout does not have to build an image first.
const path = require('node:path');

const toolsDb = path.resolve(__dirname, '../../../../../../tools/db');
const { resolveDbUrl } = require(path.join(toolsDb, 'env'));

// Resolving it here fails with the "copy .env.example" message rather than
// handing `undefined` to TypeORM, whose postgres driver falls back to its own
// defaults and dies with a credentials error for a URL that was never set.
resolveDbUrl('auth');

process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT ||
  'apps/luna-shopper-backend/auth/tsconfig.migrations.json';
process.env.TS_NODE_TRANSPILE_ONLY = process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

const dataSource = require('../../db/data-source').default;

require('./run')
  .runAdminCli(dataSource, process.argv.slice(2))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
