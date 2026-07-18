import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL =
  process.env['BASE_URL'] || 'http://localhost:4200/en/damoclesSword';

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
   * `baseURL` in a browser.
   *
   * `--live-reload=false` disables Angular's live-reload WebSocket
   * (ws://…/ng-cli-ws). That socket stays open for the life of the page; in
   * Playwright UI mode (persistent, reused context) it interferes with runs, and
   * it also keeps the dev-server process tree alive so Playwright can't tear it
   * down cleanly on Windows. e2e never needs live reload. If you run the shell
   * yourself for UI mode, start it the same way: `nx serve shell --live-reload=false`. */
  webServer: {
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
