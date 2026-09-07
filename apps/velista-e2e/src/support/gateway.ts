import type { Page, Route } from '@playwright/test';

/**
 * The gateway routes a suite has to answer for the app to get off the ground.
 *
 * Since plan 0071 the app asks `GET /health/ready` before it draws anything, and holds
 * the outlet closed until it has an answer. **A suite that stubs the gateway and
 * forgets this one sits on the startup screen**, which is a slow and confusing way to
 * fail: nothing errors, the page simply never becomes the page under test. So the
 * health route is stubbed here rather than in each spec, and a suite that stubs
 * anything at all calls this first.
 *
 * It is matched by suffix rather than by origin, because the gateway's address is
 * supplied per environment and per dev slot and is not knowable from here.
 */
const HEALTH_READY = '**/health/ready';

/** Answer the readiness probe, so the app starts. */
export async function stubBackendReady(page: Page): Promise<void> {
  await page.route(HEALTH_READY, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
  );
}

/**
 * Leave the readiness probe hanging, so the app stays on the startup gate.
 *
 * Deliberately unanswered rather than refused: it is the case the app cannot tell
 * apart from a phone with no signal, and it is the one the probe's own eight second
 * deadline exists for.
 */
export async function stubBackendUnreachable(page: Page): Promise<void> {
  await page.route(HEALTH_READY, () => {
    // Never fulfilled and never aborted. Playwright releases the request when the
    // page closes.
  });
}
