import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';
import { withProgressReporter } from '../../playwright.reporters';

const preset = nxE2EPreset(__filename, { testDir: './src' });

// These specs drive velista on its own origin (plan 0165 D8), so paths in the
// specs start at the locale: `/en`, not `/velista/en`.
//
// VELISTA_BASE_URL points the suite at a velista that is ALREADY running, and so
// suppresses the dev-server `webServer` below. It is the variable
// `velista-luna-e2e` reads too: staging's https://staging.velista.app on CI, or a
// dev slot's velista such as http://localhost:42005 (see tools/dev/README.md).
const externalOrigin = process.env['VELISTA_BASE_URL'];
const baseURL = externalOrigin || 'http://localhost:4205';

export default defineConfig({
  ...preset,
  /* The preset's reporters are silent on a terminal, which on CI turns a running
   * suite into a blank log. See playwright.reporters.ts. */
  reporter: withProgressReporter(preset.reporter),
  use: {
    baseURL,
    // The local reverse proxy serves self-signed TLS; accept it so an https
    // VELISTA_BASE_URL still works. Harmless for the http/dev-server defaults.
    ignoreHTTPSErrors: true,
    /* Both default to 0 under the test runner, and 0 means *no* limit, so a
     * navigation that never completes is bounded only by the test timeout. See
     * apps/damoclesSword-e2e/playwright.config.ts for the full account. */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
  },
  /* With VELISTA_BASE_URL unset, run velista's dev server on its default port
   * before starting the tests (or reuse one you started yourself:
   * reuseExistingServer attaches to it and never manages its lifecycle).
   *
   * `url` is only the readiness probe and must return a status Playwright accepts
   * (<400), otherwise reuseExistingServer can't detect an already-running velista
   * and launches a duplicate `nx serve velista` that collides on port 4205. The dev
   * server's SPA fallback returns 404 to the probe's non-`text/html` request for
   * deep routes, so probe the root. */
  webServer: externalOrigin
    ? undefined
    : {
        command: 'npx nx serve velista',
        url: 'http://localhost:4205',
        reuseExistingServer: true,
        cwd: workspaceRoot,
      },
  projects: [
    // Phone first (plan 0001, D3): the mobile projects are the ones that matter
    // most for this app, and they run first for that reason.
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
