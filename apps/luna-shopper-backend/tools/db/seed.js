// Orchestrator for the demo world seeders (plan 0013, section 2). Runs the three
// service seeders in a safe order (auth, catalog, then core) — core references
// auth user ids and catalog item ids, so it goes last. This is the everyday
// entry point: `nx run luna-shopper-backend:seed` (add LUNA_ENV=test to target the opt-in
// test databases). Each service cli.js re-applies the default-deny host guard, so
// the orchestrator never needs to connect itself.
const { spawnSync } = require('node:child_process');
const { SERVICE_ORDER } = require('./env');

const SEED_CLI = (svc) => `apps/luna-shopper-backend/${svc}/src/app/db/seed/cli.js`;

for (const svc of SERVICE_ORDER) {
  const result = spawnSync(process.execPath, [SEED_CLI(svc)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(
      `[seed] ${svc} seeder failed (exit ${result.status ?? 'signal'}); stopping.`
    );
    process.exit(result.status || 1);
  }
}

console.log(
  `[seed] demo world inserted into ${SERVICE_ORDER.join(', ')} database(s)`
);
