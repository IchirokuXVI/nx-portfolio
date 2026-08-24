// Cross-platform entry point for the TypeORM CLI (plan 0005, section 6).
//
// Sets the ts-node project (which enables decorator metadata and the workspace
// path aliases) in-process before registering ts-node, so `migration:run` /
// `:generate` / `:revert` work the same on any shell without relying on inline
// environment-variable syntax. The data source self-registers the `@portfolio/*`
// path aliases; here we only point ts-node at the migrations tsconfig.
process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT ||
  'apps/luna-shopper/auth/tsconfig.migrations.json';
process.env.TS_NODE_TRANSPILE_ONLY =
  process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('typeorm/cli');
