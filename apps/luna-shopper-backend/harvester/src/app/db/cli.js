// Cross-platform entry point for the TypeORM CLI (plan 0038). Sets the ts-node
// project (decorator metadata + workspace path aliases) in-process before
// registering ts-node, so migrations run the same on any shell. The data source
// self-registers the `@portfolio/*` path aliases.
process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT ||
  'apps/luna-shopper-backend/harvester/tsconfig.migrations.json';
process.env.TS_NODE_TRANSPILE_ONLY =
  process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('typeorm/cli');
