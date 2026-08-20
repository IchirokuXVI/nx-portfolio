import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// For CI, you may want to set BASE_URL to the deployed application.
// landingV2 renders only through the shell (CLAUDE.md) and mounts at the
// locale root, so baseURL points at the shell's /en, never port 4204 directly.
//
// E2E_BASE_URL points the suite at an already-running deployment origin (e.g. the
// local Docker/Kubernetes reverse proxy at http://portfolio.localhost); the shell
// locale root is appended. When set, the dev-server webServer below is skipped.
const dockerOrigin = process.env['E2E_BASE_URL'];
const baseURL =
  process.env['BASE_URL'] ||
  (dockerOrigin ? `${dockerOrigin}/en` : 'http://localhost:4200/en');

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    // The local reverse proxy serves self-signed TLS; accept it so an https
    // E2E_BASE_URL still works. Harmless for the http/dev-server defaults.
    ignoreHTTPSErrors: true,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Run the shell dev server before starting the tests (or reuse one you
   * started yourself — reuseExistingServer attaches to it and never manages its
   * lifecycle).
   *
   * `url` is only the readiness probe and must return a status Playwright
   * accepts (<400), otherwise reuseExistingServer can't detect an already-running
   * shell and launches a duplicate `nx serve shell` that collides on port 4200.
   * The dev server's SPA fallback returns 404 to the probe's non-`text/html`
   * request for deep routes, so probe the root. Tests still navigate to
   * `baseURL` in a browser. */
  webServer: dockerOrigin
    ? undefined
    : {
        command: 'npx nx serve shell',
        url: 'http://localhost:4200',
        reuseExistingServer: true,
        cwd: workspaceRoot,
      },
  projects: [
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
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
  ],
});
