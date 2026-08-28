import { inject, Injectable } from '@angular/core';
import type { UserProfile, UsernameScope } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { TokenStore } from '../auth/token-store';
import type { AccountServiceI } from './account-service';

/** Five per hour, matching `THROTTLE_LIMITS.usernameChange` (rule A4). */
const RENAME_LIMIT = 5;

/**
 * The wait a refused rename reports.
 *
 * Deliberately far longer than a minute, and not a round number, so a screen that
 * hardcoded sixty fails its spec instead of looking plausible. `41:08` is what the
 * mock's refused frame draws.
 */
const RENAME_REFUSED_WAIT_SECONDS = 2468;

/** The address the fake's registered account answers with. */
const MEMORY_EMAIL = 'marta@example.com';

/**
 * The caller's own account, in memory. Asked for by name, never a default.
 *
 * It exists for `AuthMemory`'s two reasons: the app runs with no backend, and a spec
 * reaches every state in section 3 without a transport. And, like `AuthMemory`, it must
 * not be kinder than the real thing, so the three behaviours the plan turns on are
 * modelled exactly:
 *
 * - **A guest has no email.** `kind` follows the token pair, so asking for the profile
 *   while signed in as a temporary user answers `email: null` and
 *   `emailVerified: false`, which is what makes the guest branch of the screen
 *   reachable with no server.
 * - **The rename bucket is hourly, not per minute.** The sixth attempt is refused with
 *   a wait of forty one minutes, so a countdown that invented sixty is visibly wrong.
 * - **Delete is idempotent.** A repeat answers `deleted: false` and throws nothing.
 *
 * What it does **not** model is propagation. The scope is recorded so a spec can assert
 * what was sent, and no membership is touched, because this fake has none: the per zone
 * copies live in `MembershipMemory` and inventing a link between two fakes would test
 * the link rather than the app.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// `TokenStore`, which reaches `APP_API_CONFIG`, which only the app can supply.
@Injectable()
export class AccountMemory implements AccountServiceI {
  private readonly _tokens = inject(TokenStore);

  /** Overrides the name off the token pair once something has renamed it. */
  private _username: string | null = null;

  private _renameCount = 0;
  private _deleted = false;

  /** Every scope this fake was asked for, in order, so a spec can assert rule A3. */
  readonly scopesSent: UsernameScope[] = [];

  async getProfile(): Promise<UserProfile> {
    return this._profile();
  }

  async setUsername(
    username: string,
    scope: UsernameScope
  ): Promise<UserProfile> {
    this._renameCount += 1;
    if (this._renameCount > RENAME_LIMIT) {
      throw new GatewayError({
        code: 'rate_limited',
        status: 429,
        correlationId: 'memory',
        retryAfterSeconds: RENAME_REFUSED_WAIT_SECONDS,
      });
    }

    this.scopesSent.push(scope);
    this._username = username;

    return this._profile();
  }

  async deleteAccount(): Promise<{ readonly deleted: boolean }> {
    const first = !this._deleted;
    this._deleted = true;

    return { deleted: first };
  }

  private _profile(): UserProfile {
    const tokens = this._tokens.tokens();
    if (tokens === null) {
      // Every account route is bearer authenticated, so no session is a 401 rather
      // than an empty profile. Answering a blank one would let a spec render the
      // screen for nobody.
      throw new GatewayError({
        code: 'unauthorized',
        status: 401,
        correlationId: 'memory',
      });
    }

    const guest = tokens.kind === 'TEMPORARY';

    return {
      userId: tokens.userId,
      kind: tokens.kind,
      username: this._username ?? tokens.username,
      // The whole of the guest branch, in one line: a temporary user has no address,
      // which is exactly what `UserProfileView.email` being nullable is for.
      email: guest ? null : MEMORY_EMAIL,
      emailVerified: !guest,
      displayName: null,
    };
  }
}
