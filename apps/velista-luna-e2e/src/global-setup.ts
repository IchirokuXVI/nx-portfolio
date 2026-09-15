import { request } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { GATEWAY_URL, VELISTA_BASE_URL } from '../playwright.config';

/**
 * Playwright global setup: refuse a run that cannot work, then seed.
 *
 * The approach is `luna-shopper-backend-e2e`'s (its plan 0013, section 4), not
 * its file: seeding is opt in through `E2E_SEED`, it runs the same
 * `apps/luna-shopper-backend/tools/db/seed.js` the Nx `seed` target runs, and a
 * stack that does not answer is a hard failure under `LUNA_REQUIRE_STACK`
 * rather than a warning, because CI stood it up on purpose and a skipped seed
 * there hands the specs an empty world.
 *
 * Two things differ, and both are because this is a browser suite:
 *
 * - **The URLs are refused here when they are missing**, rather than defaulted.
 *   The backend suite falls back to slot 0's ports; a browser suite with no
 *   `VELISTA_BASE_URL` would sit on a placeholder origin for thirty seconds per
 *   spec and report a timeout nobody can read. The config cannot throw (the Nx
 *   plugin loads it to build the graph), so this is the earliest place.
 * - **No snapshot and no restore.** The seed rewrites only the demo world's rows,
 *   by fixed id, and every spec sets each seeded value it depends on to an
 *   absolute value before it starts, so a run leaves the world in a state the
 *   next run can start from. A snapshot round trip would add a `pg_dump` and a
 *   second failure mode to a suite that does not need either.
 */
const workspaceRoot = resolve(__dirname, '../../..');

const PROBE_TIMEOUT_MS = 5_000;

function unset(name: string): string {
  return (
    `[velista-luna-e2e] ${name} is not set. This suite starts no server of ` +
    'its own: point it at a running velista origin and gateway, for example ' +
    'VELISTA_BASE_URL=http://localhost:42005 E2E_GATEWAY_URL=http://localhost:43200 ' +
    '(a dev slot, see apps/velista/plans/0080-an-e2e-that-shops-against-a-real-backend.md).'
  );
}

/** True when the gateway answers its liveness probe through whatever proxy is in front of it. */
async function gatewayReachable(): Promise<boolean> {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await ctx.get(`${GATEWAY_URL}/health/live`, {
      timeout: PROBE_TIMEOUT_MS,
    });
    return res.ok();
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(): Promise<void> {
  if (!process.env['VELISTA_BASE_URL'])
    throw new Error(unset('VELISTA_BASE_URL'));
  if (!process.env['E2E_GATEWAY_URL'])
    throw new Error(unset('E2E_GATEWAY_URL'));

  if (!(await gatewayReachable())) {
    throw new Error(
      `[velista-luna-e2e] the gateway at ${GATEWAY_URL} did not answer ` +
        `GET /health/live within ${PROBE_TIMEOUT_MS}ms. velista would sit on its ` +
        `startup gate at ${VELISTA_BASE_URL} and every spec would time out ` +
        'saying nothing, so the run stops here instead.'
    );
  }

  if (!process.env['E2E_SEED']) {
    if (process.env['LUNA_REQUIRE_STACK']) {
      throw new Error(
        '[velista-luna-e2e] LUNA_REQUIRE_STACK is set but E2E_SEED is not. Every ' +
          'spec signs in as a seeded user, so a run without the seed asserts ' +
          'against a world nobody created.'
      );
    }
    console.warn(
      '[velista-luna-e2e] E2E_SEED is not set: running against whatever the ' +
        'database holds. The specs expect the demo world (alice@example.com and ' +
        'friends); set E2E_SEED=1 to seed it first.'
    );
    return;
  }

  // The seed resolves each database from the service .env files through
  // dotenv, which never overwrites a variable that is already set. So against
  // an ephemeral slot, whose configuration lives in the environment rather than
  // in those files, the caller exports AUTH_DB_URL, CORE_DB_URL and
  // CATALOG_DB_URL and the same command lands in the right databases.
  const seed = spawnSync(
    process.execPath,
    ['apps/luna-shopper-backend/tools/db/seed.js'],
    { cwd: workspaceRoot, env: process.env, encoding: 'utf8' }
  );
  if (seed.stdout) process.stdout.write(seed.stdout);
  if (seed.stderr) process.stderr.write(seed.stderr);
  if (seed.status !== 0) {
    throw new Error(
      '[velista-luna-e2e] seeding the demo world failed; aborting.'
    );
  }
}
