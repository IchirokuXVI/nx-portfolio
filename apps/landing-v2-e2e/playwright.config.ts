import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// landingV2 renders only through the shell (CLAUDE.md) and mounts at the
// locale root, so baseURL points at the shell's /en, never port 4204 directly.
//
// Either variable points the suite at a server that is ALREADY running, so both
// of them suppress the dev-server `webServer` below.
//
// E2E_BASE_URL is an origin, to which the shell's locale root is appended: a
// deployment (the local Docker/Kubernetes reverse proxy at
// http://portfolio.localhost, or staging), or a dev slot's shell at
// http://localhost:42000 (see tools/dev/README.md).
//
// BASE_URL is the whole base URL, locale segment included, for a target this
// config would not assemble on its own.
//
// Keying the webServer off both is the reason they are separate names here. It
// used to depend on E2E_BASE_URL alone, so a run with only BASE_URL set drove
// that URL *and* started `nx serve shell` on 4200, which belongs to another slot
// and, on slot 0, to the developer's own dev server.
const externalOrigin = process.env['E2E_BASE_URL'];
const explicitBaseURL = process.env['BASE_URL'];
const usesExternalServer = !!(explicitBaseURL || externalOrigin);
const baseURL =
  explicitBaseURL ||
  (externalOrigin ? `${externalOrigin}/en` : 'http://localhost:4200/en');

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
  /* With neither BASE_URL nor E2E_BASE_URL set, run the shell dev server on the
   * default port before starting the tests (or reuse one you started yourself:
   * reuseExistingServer attaches to it and never manages its lifecycle).
   *
   * `url` is only the readiness probe and must return a status Playwright
   * accepts (<400), otherwise reuseExistingServer can't detect an already-running
   * shell and launches a duplicate `nx serve shell` that collides on port 4200.
   * The dev server's SPA fallback returns 404 to the probe's non-`text/html`
   * request for deep routes, so probe the root. Tests still navigate to
   * `baseURL` in a browser. */
  webServer: usesExternalServer
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
