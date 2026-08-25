import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the Luna Shopper backend (plan 0010, section 1). They hit
 * the gateway's public REST surface and the realtime SSE channel — never a
 * service's internal port. Infrastructure and the four services are started
 * externally (see k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md), so
 * there is deliberately NO `webServer` here: Nx cannot reliably boot four Nest
 * services in-config, and the slot workflow already owns their lifecycle.
 *
 * E2E_GATEWAY_URL / E2E_REALTIME_URL point the suite at a running stack (default
 * slot 0 ports). The suite skips itself when the gateway is not reachable, so it
 * is a clean green no-op without infrastructure.
 */
export const GATEWAY_URL =
  process.env['E2E_GATEWAY_URL'] || 'http://localhost:3000';
export const REALTIME_URL =
  process.env['E2E_REALTIME_URL'] || 'http://localhost:3001';

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    baseURL: GATEWAY_URL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
