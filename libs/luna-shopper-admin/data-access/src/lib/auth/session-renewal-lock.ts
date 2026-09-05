/**
 * The lock name. One per origin, which is one per deployment of this app, which
 * is what "the tabs sharing a session" means.
 */
const LOCK_NAME = 'luna-shopper-admin.renewal';

/**
 * Run `work` with no other tab of this app running its own (plan 0013,
 * section 4).
 *
 * {@link SessionStore.refresh} is already single flight *within* a tab. This is
 * the same guarantee between them, and it is needed because the tabs do not
 * merely happen to renew together, they are **built** to: every tab decides from
 * the same `receivedAt` and `expiresAt`, so every tab's timer names the same
 * instant and they all fire at once.
 *
 * `navigator.locks` is the whole implementation. It is a browser primitive that
 * serializes across the tabs of an origin and releases the lock when the tab
 * holding it is closed, which is the part a lock built out of `localStorage`
 * gets wrong: a hand written one needs a timeout to survive a tab closed mid
 * renewal, and that timeout is either too short to be a lock or too long to be
 * usable.
 *
 * **Holding the lock is not the point on its own.** Serializing four renewals
 * still makes four requests. What removes the other three is the caller reading
 * storage again *inside* the lock and finding the token the first one wrote, so
 * this function exists to make that read meaningful. The read is in
 * {@link SessionStore.renew}.
 *
 * A plain function rather than a service, because there is nothing here to
 * configure or substitute: it is a browser API with a fallback, not a policy.
 *
 * A browser without the API runs the work unserialized. That is the honest
 * degradation: tabs that decide in the same instant can each renew, which is the
 * behaviour before this plan, and it costs a duplicate request rather than a
 * session. Every browser this app is used in has had the API for years, and the
 * fallback is mostly for jsdom, where the specs run.
 *
 * The work's result is passed through untouched, and so is its failure. A
 * failure to *acquire* is different: the work has not run, so it is run without
 * the lock rather than reported, because a renewal refused by a lock manager
 * would cost an operator their session for a reason that has nothing to do with
 * their session.
 */
export async function withRenewalLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) {
    return work();
  }

  // The flag separates "the lock manager refused" from "the work threw", which
  // matters because the first is retried without the lock and retrying the
  // second would run a renewal twice.
  let started = false;
  try {
    return await locks.request(LOCK_NAME, () => {
      started = true;
      return work();
    });
  } catch (error) {
    if (started) {
      throw error;
    }
    return work();
  }
}
