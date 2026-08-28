import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';
import { withProgressReporter } from '../../playwright.reporters';

const preset = nxE2EPreset(__filename, { testDir: './src' });

// These specs drive velista mounted under the shell, so baseURL is the shell's
// origin by default. Paths in the specs carry their own mount and locale
// segments. velista is also servable standalone on its own origin (CLAUDE.md),
// so unlike the other remotes it is legitimate to point this at velista's own
// port, slot 0's 4205 or a slot's 42005.
//
// Either variable points the suite at a server that is ALREADY running, so both
// of them suppress the dev-server `webServer` below. Both are a bare origin
// here, since this config appends no route suffix of its own.
//
// E2E_BASE_URL names a deployment (the local Docker/Kubernetes reverse proxy at
// http://portfolio.localhost, or staging) or a dev slot's shell at
// http://localhost:42000 (see tools/dev/README.md).
//
// Keying the webServer off both is the reason they are separate names here. It
// used to depend on E2E_BASE_URL alone, so a run with only BASE_URL set drove
// that URL *and* started `nx serve shell` on 4200, which belongs to another slot
// and, on slot 0, to the developer's own dev server.
const externalOrigin = process.env['E2E_BASE_URL'];
const explicitBaseURL = process.env['BASE_URL'];
const usesExternalServer = !!(explicitBaseURL || externalOrigin);
const baseURL = explicitBaseURL || externalOrigin || 'http://localhost:4200';

export default defineConfig({
  ...preset,
  /* The preset's reporters are silent on a terminal, which on CI turns a running
   * suite into a blank log. See playwright.reporters.ts. */
  reporter: withProgressReporter(preset.reporter),
  use: {
    baseURL,
    // The local reverse proxy serves self-signed TLS; accept it so an https
    // E2E_BASE_URL still works. Harmless for the http/dev-server defaults.
    ignoreHTTPSErrors: true,
    /* Both default to 0 under the test runner, and 0 means *no* limit, so a
     * navigation that never completes is bounded only by the test timeout. See
     * apps/damoclesSword-e2e/playwright.config.ts for the full account. */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
  },
  /* With neither BASE_URL nor E2E_BASE_URL set, run the shell dev server on the
   * default port before starting the tests (or reuse one you started yourself:
   * reuseExistingServer attaches to it and never manages its lifecycle).
   *
   * `url` is only the readiness probe and must return a status Playwright accepts
   * (<400), otherwise reuseExistingServer can't detect an already-running shell
   * and launches a duplicate `nx serve shell` that collides on port 4200. The dev
   * server's SPA fallback returns 404 to the probe's non-`text/html` request for
   * deep routes, so probe the root. */
  webServer: usesExternalServer
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
