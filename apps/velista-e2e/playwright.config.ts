import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// This app renders only through the shell (CLAUDE.md), so baseURL points at the
// shell's origin and never at port 4205, where the remote entry is empty by
// design. Paths in the specs carry their own locale segment.
//
// E2E_BASE_URL points the suite at an already-running deployment origin (e.g. the
// local Docker/Kubernetes reverse proxy at http://portfolio.localhost). When set,
// the dev-server webServer below is skipped.
const dockerOrigin = process.env['E2E_BASE_URL'];
const baseURL =
  process.env['BASE_URL'] || dockerOrigin || 'http://localhost:4200';

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    baseURL,
    // The local reverse proxy serves self-signed TLS; accept it so an https
    // E2E_BASE_URL still works. Harmless for the http/dev-server defaults.
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  /* Run the shell dev server before starting the tests (or reuse one you started
   * yourself — reuseExistingServer attaches to it and never manages its
   * lifecycle).
   *
   * `url` is only the readiness probe and must return a status Playwright accepts
   * (<400), otherwise reuseExistingServer can't detect an already-running shell
   * and launches a duplicate `nx serve shell` that collides on port 4200. The dev
   * server's SPA fallback returns 404 to the probe's non-`text/html` request for
   * deep routes, so probe the root. */
  webServer: dockerOrigin
    ? undefined
    : {
        command: 'npx nx serve shell',
        url: 'http://localhost:4200',
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
