import { effect, inject, untracked } from '@angular/core';
import { SessionStore } from '../auth/session-store';
import { DashboardStore } from './dashboard-store';

/**
 * The dashboard read stops when the session ends and starts when one begins
 * (admin plan 0044, review).
 *
 * The rail counts what waits in the harvester and how many join requests
 * wait, on every screen. Both counters are root services that start the
 * dashboard watch when they are built, and nothing ever stopped it. So after a
 * sign out the read went on every minute, refused each time, and the next
 * admin to sign in on the same tab saw the last one's document until the
 * first read answered.
 *
 * Here and not inside the store, because the session store is the app's and
 * not the root's: a store that injected it would need a session in every spec
 * of every screen that reads a count. The app calls this once, in an
 * environment initializer, which is an injection context.
 *
 * A session that is already held when the app starts changes nothing: the
 * store reads on its first watch. Only a change is acted on.
 */
export function dashboardFollowsSession(): void {
  const sessions = inject(SessionStore);
  const store = inject(DashboardStore);

  let signedIn = sessions.signedIn();
  if (!signedIn) {
    // Nobody is signed in yet, so the first watch must not read either.
    store.suspend();
  }

  effect(() => {
    const now = sessions.signedIn();
    untracked(() => {
      if (now === signedIn) {
        return;
      }
      signedIn = now;
      if (now) {
        store.resume();
      } else {
        store.suspend();
      }
    });
  });
}
