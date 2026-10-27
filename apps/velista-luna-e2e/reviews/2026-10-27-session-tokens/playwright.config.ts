import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from '../../playwright.config';

/**
 * The session token review battery of 2026-10-27, run on its own.
 *
 * These specs state invariants the code does not hold, and nine of them fail
 * by design until the findings in report.md are built. They sit outside `src`
 * so the project's own config, whose `testDir` is `./src`, never collects
 * them: that suite gates the staging deploy, and a red review battery must not
 * block a deploy. This config is the same suite config with one change, the
 * directory it reads, so the seed, the URLs, the storage state and the
 * timeouts are exactly what the gate uses.
 *
 * Run it through the project's e2e target with this file named explicitly,
 * from a shell whose environment carries VELISTA_BASE_URL and E2E_GATEWAY_URL:
 *
 *   npx nx e2e velista-luna-e2e --skip-nx-cache -- \
 *     --config reviews/2026-10-27-session-tokens/playwright.config.ts
 */
export default defineConfig({
  ...base,
  testDir: __dirname,
  globalSetup: resolve(__dirname, '../../src/global-setup.ts'),
});
