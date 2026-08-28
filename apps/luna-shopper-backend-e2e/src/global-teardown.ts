import { existsSync, readFileSync, rmSync } from 'node:fs';
import { RESTORE_MARKER, runDbTool } from './support/db';

/**
 * Playwright global teardown (plan 0013, section 4): restore whatever was in the
 * databases before the run. Only fires when global-setup recorded a snapshot (a
 * non-throwaway stack); against the CI throwaway stack there is nothing to
 * restore because the stack itself is torn down with `down -v`.
 */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(RESTORE_MARKER)) {
    return;
  }
  const dir = readFileSync(RESTORE_MARKER, 'utf8').trim();
  const result = runDbTool('restore.js', ['--dir', dir]);
  rmSync(RESTORE_MARKER, { force: true });
  if (result.status !== 0) {
    throw new Error(`[e2e] restoring the pre-run snapshot at ${dir} failed.`);
  }
}
