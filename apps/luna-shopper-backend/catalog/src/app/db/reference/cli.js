// Cross-platform entry point for the reference catalog seeder (plan 0067,
// section 7). The development twin of `src/seed-reference.ts`: same seeder, but
// resolved and host-guarded the way every other db script here is, so a
// mistyped CATALOG_DB_URL cannot write 274 rows into somebody's production.
const path = require('node:path');

const toolsDb = path.resolve(__dirname, '../../../../../tools/db');
const { resolveDbUrl } = require(path.join(toolsDb, 'env'));
const { assertSafeTarget } = require(path.join(toolsDb, 'guard'));

const url = resolveDbUrl('catalog');
assertSafeTarget(url, 'seed the reference catalog');

process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT ||
  'apps/luna-shopper-backend/catalog/tsconfig.migrations.json';
process.env.TS_NODE_TRANSPILE_ONLY = process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: { '@portfolio/luna-shopper/*': ['libs/luna-shopper/*/src/index.ts'] },
});

const dataSource = require('../data-source').default;

require('./seed-reference-catalog')
  .seedReferenceCatalog(dataSource)
  .then(async (r) => {
    await dataSource.destroy();
    console.log(
      `[seed-reference] ${r.groups} group(s), ${r.stores} store(s), ` +
        `${r.items} item(s), ${r.prices} price(s); ` +
        `${r.assigned} harvested row(s) grouped, ${r.unmatched} not carried here, ` +
        `${r.preserved} hand-entered price(s) left alone`
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
