import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { GATEWAY_URL } from '../../playwright.config';

/**
 * Shared helpers for the Playwright seed round trip (plan 0013, section 4).
 *
 * The suite drives the seed / snapshot / restore Nx tooling by shelling out to
 * the same scripts `nx run luna-shopper:*` uses, from the workspace root, so the
 * global-setup, global-teardown and the seeded spec all agree.
 */

/** apps/luna-shopper-backend-e2e/src/support -> workspace root is four up. */
export const workspaceRoot = resolve(__dirname, '../../../..');

/** Where global-setup records the pre-run snapshot for global-teardown to restore. */
export const RESTORE_MARKER = resolve(
  workspaceRoot,
  'apps/luna-shopper/.snapshots/.e2e-restore-target'
);

export function runDbTool(
  script: 'seed.js' | 'snapshot.js' | 'restore.js',
  args: string[] = []
): { status: number | null; stdout: string } {
  const result = spawnSync(
    process.execPath,
    [`apps/luna-shopper/tools/db/${script}`, ...args],
    { cwd: workspaceRoot, env: process.env, encoding: 'utf8' }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status, stdout: result.stdout || '' };
}

/** True when the gateway answers its liveness probe (a stack is up). */
export async function gatewayReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
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
