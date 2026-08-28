import { test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { GATEWAY_URL } from '../../playwright.config';

/**
 * Shared helpers for the Playwright seed round trip (plan 0013, section 4).
 *
 * The suite drives the seed / snapshot / restore Nx tooling by shelling out to
 * the same scripts `nx run luna-shopper-backend:*` uses, from the workspace root, so the
 * global-setup, global-teardown and the seeded spec all agree.
 */

/** apps/luna-shopper-backend-e2e/src/support -> workspace root is four up. */
export const workspaceRoot = resolve(__dirname, '../../../..');

/** Where global-setup records the pre-run snapshot for global-teardown to restore. */
export const RESTORE_MARKER = resolve(
  workspaceRoot,
  'apps/luna-shopper-backend/.snapshots/.e2e-restore-target'
);

export function runDbTool(
  script: 'seed.js' | 'snapshot.js' | 'restore.js',
  args: string[] = []
): { status: number | null; stdout: string } {
  const result = spawnSync(
    process.execPath,
    [`apps/luna-shopper-backend/tools/db/${script}`, ...args],
    { cwd: workspaceRoot, env: process.env, encoding: 'utf8' }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status, stdout: result.stdout || '' };
}

/** How long the reachability probe waits for the gateway before giving up. */
export const GATEWAY_PROBE_TIMEOUT_MS = 2000;

/**
 * True when the gateway answers its liveness probe (a stack is up).
 *
 * This is the **only** definition (plan 0015, section 3.1). `core-flow.spec.ts`
 * used to carry a second one built on Playwright's `request` fixture, and
 * `global-setup` a third path through this module; a probe with several
 * definitions is a probe nobody can reason about. Everything goes through here.
 */
export async function gatewayReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/health/live`, {
      signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether a stack was brought up on purpose, so a skip would be a lie. */
export function stackRequired(): boolean {
  return !!process.env['LUNA_REQUIRE_STACK'];
}

/**
 * The gate every e2e spec runs in `beforeAll` (plan 0015, section 3.2).
 *
 * Without a stack it skips, which keeps `nx e2e` a clean green no-op on a machine
 * with no Docker. Under `LUNA_REQUIRE_STACK` the same condition throws instead,
 * naming the URL it tried and how long it waited: CI stood a stack up on purpose,
 * so a skip there would be a green check that proved nothing.
 *
 * Pass `seeded` for a suite that navigates the seeded demo world, so a CI run
 * that forgot `E2E_SEED` fails rather than quietly testing nothing.
 */
export async function gateOnStack(options?: { seeded?: boolean }) {
  if (options?.seeded && !seedingRequested()) {
    if (stackRequired()) {
      throw new Error(
        '[e2e] LUNA_REQUIRE_STACK is set but E2E_SEED is not, so the seeded suite ' +
          'would have skipped. global-setup only seeds the demo world when E2E_SEED ' +
          'is set; without it these specs assert against a world nobody created.'
      );
    }
    test.skip(
      true,
      'seeded suite runs only with E2E_SEED (global-setup seeds the demo world)'
    );
  }

  if (!(await gatewayReachable())) {
    if (stackRequired()) {
      throw new Error(
        `[e2e] LUNA_REQUIRE_STACK is set but the gateway at ${GATEWAY_URL} did not ` +
          `answer GET /health/live within ${GATEWAY_PROBE_TIMEOUT_MS}ms. CI brings ` +
          'the stack and the five services up on purpose, so skipping here would ' +
          'report a pass that tested nothing. Check the per service logs the run ' +
          'uploads (test-output/luna-shopper-backend/services).'
      );
    }
    test.skip(
      true,
      `no stack: the gateway at ${GATEWAY_URL} is not reachable (start the compose stack and the services)`
    );
  }
}

/**
 * Whether the seed round trip should run at all: opt-in via E2E_SEED, so the
 * default `nx e2e` run is unchanged (it still self-skips when no stack is up).
 */
export function seedingRequested(): boolean {
  return !!process.env['E2E_SEED'];
}

/** CI (and any explicit throwaway stack) tears the database down, so no snapshot. */
export function isThrowawayStack(): boolean {
  return !!(process.env['CI'] || process.env['E2E_THROWAWAY']);
}
