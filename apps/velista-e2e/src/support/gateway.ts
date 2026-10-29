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

const LEGAL_SETTINGS = '**/v1/legal/settings';

/**
 * What backend `0231`'s `GET /v1/legal/settings` answers in these suites: a deployment
 * that published both documents, with invented values. Nothing here is anybody's real
 * deployment. A spec that needs another deployment passes its own changes.
 */
export const STUB_LEGAL_SETTINGS = {
  appName: 'Example Shopper',
  controllerName: 'Example Controller',
  contactEmail: 'privacy@example.org',
  published: true,
  terms: {
    version: '2026-10-29',
    updatedOn: '2026-10-29',
    acceptanceRequired: false,
  },
  privacy: { updatedOn: '2026-10-29' },
  features: {
    googleSignIn: true,
    assistant: true,
    transcription: true,
    offsiteBackups: true,
    supportAccess: false,
  },
  processors: {
    hosting: null,
    email: 'Example Mail',
    aiText: 'anthropic',
    offsiteBackups: null,
  },
  retention: {
    auditTrailDays: 180,
    adminLoginFailureDays: 90,
    expiredGrantDays: 14,
    applicationLogDays: 30,
    assistantLogDays: 7,
    backupDays: 14,
  },
};

/**
 * Answer the readiness probe, so the app starts, and the operator's settings (velista
 * `0172`), which the app reads the first time the backend is ready. Unanswered, that
 * read fails, which changes only the legal pages today, but plans `0173` and `0174`
 * read the same answer on the screens every suite opens.
 */
export async function stubBackendReady(
  page: Page,
  legalSettings: Record<string, unknown> = STUB_LEGAL_SETTINGS
): Promise<void> {
  await page.route(HEALTH_READY, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
  );
  await page.route(LEGAL_SETTINGS, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // The gateway is another origin than the app, as it is everywhere.
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(legalSettings),
    })
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
