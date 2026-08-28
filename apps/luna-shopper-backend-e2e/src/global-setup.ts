import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  GATEWAY_PROBE_TIMEOUT_MS,
  gatewayReachable,
  isThrowawayStack,
  RESTORE_MARKER,
  runDbTool,
  seedingRequested,
  stackRequired,
} from './support/db';

/**
 * Playwright global setup (plan 0013, section 4): the seed round trip.
 *
 * Opt-in via E2E_SEED so the default suite is unchanged. When requested and a
 * stack is reachable it optionally snapshots the current data (skipped against a
 * CI throwaway stack, which is torn down instead), then seeds the demo world so
 * the specs can navigate by the fixed fixture ids. global-teardown restores the
 * snapshot.
 *
 * Under LUNA_REQUIRE_STACK (plan 0015, section 3.2) the "no stack, warn and carry
 * on" branch becomes a hard failure. Warning here and letting the run continue is
 * right for a developer; in CI it hands the specs an unseeded world and the whole
 * run reports on nothing.
 */
export default async function globalSetup(): Promise<void> {
  if (!seedingRequested()) {
    return;
  }
  if (!(await gatewayReachable())) {
    if (stackRequired()) {
      throw new Error(
        '[e2e] LUNA_REQUIRE_STACK and E2E_SEED are both set but the gateway did ' +
          `not answer GET /health/live within ${GATEWAY_PROBE_TIMEOUT_MS}ms, so the ` +
          'demo world was never seeded. Aborting rather than running the suite ' +
          'against an empty database.'
      );
    }
    console.warn(
      '[e2e] E2E_SEED is set but the gateway is not reachable; skipping seed.'
    );
    return;
  }

  if (!isThrowawayStack()) {
    const snap = runDbTool('snapshot.js', ['--label', 'before-e2e']);
    if (snap.status !== 0) {
      throw new Error('[e2e] pre-run snapshot failed; aborting.');
    }
    const match = /to (.+)\s*$/m.exec(snap.stdout);
    if (match) {
      mkdirSync(dirname(RESTORE_MARKER), { recursive: true });
      writeFileSync(RESTORE_MARKER, match[1].trim());
    }
  }

  const seed = runDbTool('seed.js');
  if (seed.status !== 0) {
    throw new Error('[e2e] seeding the demo world failed; aborting.');
  }
}
