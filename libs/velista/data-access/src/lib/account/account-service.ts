import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { UserProfile, UsernameScope } from '@portfolio/velista/models';
import { AccountApi } from './account-api';

/**
 * What a caller can do to their own account (plan 0015, section 5.1).
 *
 * Three methods, one endpoint each, and every one of them resolves the caller from
 * their own token. There is **no id parameter anywhere on this interface**, and that is
 * the contract rather than a convenience: `GET`, `PATCH` and `DELETE /v1/account` all
 * take `userId` from the verified token and never from a body or a path, so there is no
 * id for this app to send and no way to address anybody else.
 *
 * Sign out is deliberately not here. There is no logout endpoint at all (section 5.5),
 * so it is `TokenStore.clear()` and a navigation, which is a page's business and not a
 * service's. Putting it on this interface would imply a request that does not exist.
 */
export interface AccountServiceI {
  /**
   * The caller's own profile (`GET /v1/account/me`).
   *
   * The only thing on this screen that needs a request. The name and the initial come
   * off the token pair, which is already in memory, so this is fetched for the
   * **email** and for whether it has been confirmed.
   */
  getProfile(): Promise<UserProfile>;

  /**
   * Change the global username, and say what should happen to the per zone copies
   * (`PATCH /v1/account/me`, five per hour).
   *
   * Answers a fresh `UserProfile` and **no new token pair**, which is why rule A2
   * exists: `ProfileStore` writes the answer into itself and `SessionStore` prefers it,
   * rather than a refresh being spent to bring the name on the pair up to date.
   */
  setUsername(username: string, scope: UsernameScope): Promise<UserProfile>;

  /**
   * Delete the account (`DELETE /v1/account`).
   *
   * Idempotent: a repeat answers `deleted: false` and emits no event, which is why
   * there is no conflict to handle and no failure row of its own in section 5.9. The
   * boolean is returned rather than swallowed because a caller that wants to know
   * whether *this* call did it can, even though the screen treats both the same.
   */
  deleteAccount(): Promise<{ readonly deleted: boolean }>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * **The default is the real gateway**, matching `ZONE_SERVICE` and `AUTH_SERVICE` for
 * the reason recorded there: a wrong default that quietly works is worse than one that
 * fails loudly. Anything that wants the fake asks for it by name with
 * `{ provide: ACCOUNT_SERVICE, useExisting: AccountMemory }`.
 */
export const ACCOUNT_SERVICE = serviceToken<AccountServiceI>(
  'ACCOUNT_SERVICE',
  () => inject(AccountApi)
);
