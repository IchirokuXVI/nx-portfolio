import { effect, inject, untracked } from '@angular/core';
import { SessionStore } from '../auth/session-store';
import { EarlierRunTotals } from './earlier-run-totals';

/**
 * The held estimates end with the session (owner decision 113b of the
 * harvester round).
 *
 * `EarlierRunTotals` is root scoped and holds one answer per run. Without this
 * the next admin to sign in on the same tab would be shown the last one's
 * estimates, read under the last one's session. So a sign out clears them, the
 * way `dashboardFollowsSession` suspends the dashboard store, and an answer on
 * its way then is not kept.
 *
 * Here and not inside the service, for the reason `dashboardFollowsSession`
 * gives: the session store is the app's, and a service that injected it would
 * need a session in every spec of every screen that draws a run. The app calls
 * this once, in an environment initializer, which is an injection context.
 *
 * Only a change is acted on. A sign in finds nothing held, so it needs nothing.
 */
export function earlierRunTotalsFollowSession(): void {
  const sessions = inject(SessionStore);
  const totals = inject(EarlierRunTotals);

  let signedIn = sessions.signedIn();
  effect(() => {
    const now = sessions.signedIn();
    untracked(() => {
      if (now === signedIn) {
        return;
      }
      signedIn = now;
      if (!now) {
        totals.clear();
      }
    });
  });
}
