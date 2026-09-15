import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';
import { withProgressReporter } from '../../playwright.reporters';

const preset = nxE2EPreset(__filename, { testDir: './src' });

/**
 * Browser specs that shop against a real, seeded backend (velista plan 0080).
 *
 * The other two suites each hold half of this: `velista-e2e` has a browser and
 * stubs the network, `luna-shopper-backend-e2e` has a backend and opens no page.
 * A basket shared between an owner and a guest needs both, so this project
 * points a browser at velista's own origin and its API setup at the gateway, and
 * expects both to be running already:
 *
 *   VELISTA_BASE_URL   velista's origin. Its own, never the shell's: velista is
 *                      the one remote that renders standalone (CLAUDE.md), and
 *                      the staging image this runs against in CI is served from
 *                      https://staging.velista.app.
 *   E2E_GATEWAY_URL    the gateway, for the setup every spec does through the
 *                      API before it opens a page.
 *
 * There is no `webServer`. Locally the two come from a dev slot (see the
 * verification section of the plan), in CI from the two compose stacks the
 * `e2e-velista-luna` job stands up. Neither is something this file could start.
 *
 * **A missing URL is refused in global-setup, not here.** The Nx Playwright
 * plugin loads this file to build the project graph, so a config that threw on
 * a missing variable would fail every `nx` command in the workspace, not just
 * this suite. The placeholders below are unreachable on purpose; the run stops
 * on them with a plain message before a single spec starts.
 */
export const VELISTA_BASE_URL =
  process.env['VELISTA_BASE_URL'] || 'http://velista-base-url.unset.invalid';
export const GATEWAY_URL =
  process.env['E2E_GATEWAY_URL'] || 'http://e2e-gateway-url.unset.invalid';

export default defineConfig({
  ...preset,
  /* The preset's reporters are silent on a terminal, which on CI turns a running
   * suite into a blank log. See playwright.reporters.ts. */
  reporter: withProgressReporter(preset.reporter),
  /* Every spec signs in as the same seeded owner and rewrites the same seeded
   * lines, so two of them at once would race on one household. One worker, and
   * the files run in order. */
  workers: 1,
  fullyParallel: false,
  /* One retry in CI, not the preset's two, for the reason the backend suite
   * gives: a broker hop and a socket make a first attempt worth retrying once,
   * and a test that only passes on the third go is telling us something. */
  retries: process.env['CI'] ? 1 : 0,
  /* The seed round trip, opt in through E2E_SEED as on the backend suite. */
  globalSetup: './src/global-setup.ts',
  /* Every assertion here waits on a real write through the gateway, core and
   * the broker, and on the socket that brings it back. Five seconds is enough
   * on a quiet machine and not on a runner standing two stacks up beside the
   * browser, and a settle that lands at six seconds is not a failure. */
  expect: { timeout: 10_000 },
  use: {
    baseURL: VELISTA_BASE_URL,
    // The e2e proxy serves self signed certificates on `.app` hosts, which are
    // HSTS preloaded and cannot be clicked through. This covers the page, its
    // fetches and its socket.
    ignoreHTTPSErrors: true,
    /* Both default to 0 under the test runner, and 0 means *no* limit. See
     * apps/damoclesSword-e2e/playwright.config.ts for the full account. */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
  },
  projects: [
    // Chromium alone, in CI and locally. Each spec here is one long trip through
    // a real backend rather than a screen check, so a second browser doubles the
    // wall time for a class of defect (rendering) this suite is not about.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
