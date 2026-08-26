import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// For CI, you may want to set BASE_URL to the deployed application.
//
// E2E_BASE_URL points the suite at an already-running deployment origin (e.g. the
// local Docker/Kubernetes reverse proxy at http://portfolio.localhost); the shell
// route suffix is appended to it. When it is set, the dev-server webServer below
// is skipped so Playwright talks to the deployment instead of `nx serve shell`.
const dockerOrigin = process.env['E2E_BASE_URL'];
const baseURL =
  process.env['BASE_URL'] ||
  (dockerOrigin
    ? `${dockerOrigin}/en/damoclesSword`
    : 'http://localhost:4200/en/damoclesSword');

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
  /* The shell dev server is a single Node process serving the shell and the
   * lazily loaded remote as hundreds of unbundled dev chunks, and every worker
   * drives a browser that pulls all of them on each navigation. Playwright's
   * default worker count (half the logical cores) saturates it: navigations
   * queue past the test timeout and the listen backlog overflows outright
   * ("page.goto: Could not connect to server"). That is why the suite fails from
   * the CLI but passes in UI mode, which runs a single worker. Cap the workers
   * so the dev server stays responsive; the preset already pins CI to one. */
  workers: process.env.CI ? 1 : 4,
  /* Specs here drive a lazily mounted remote behind a dev server, so a single
   * navigation carries a lot more than a static page would. 30s is the
   * Playwright default and leaves no room for that; the crawl in
   * no-horizontal-scroll.spec.ts raises its own budget further still. */
  timeout: 60_000,
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
   * `baseURL` in a browser.
   *
   * `--live-reload=false` disables Angular's live-reload WebSocket
   * (ws://…/ng-cli-ws). That socket stays open for the life of the page; in
   * Playwright UI mode (persistent, reused context) it interferes with runs, and
   * it also keeps the dev-server process tree alive so Playwright can't tear it
   * down cleanly on Windows. e2e never needs live reload. If you run the shell
   * yourself for UI mode, start it the same way: `nx serve shell --live-reload=false`. */
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
