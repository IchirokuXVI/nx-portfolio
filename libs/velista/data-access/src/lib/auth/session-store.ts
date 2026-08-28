import { computed, inject, Injectable } from '@angular/core';
import type { Identity } from '@portfolio/velista/models';
import { ProfileStore } from '../account/profile-store';
import { TokenStore } from './token-store';

/**
 * The one signal every page reads to know who is looking at it.
 *
 * Three states, and the middle one is a first class product state rather than an edge
 * case (plan 0001, D6): anonymous, a temporary user holding a real token but no
 * credentials, and a registered user. `0003` renders a different page for each.
 *
 * The global username arrives on the token pair itself (backend plan 0018), which is
 * what closes plan 0004 section 11 item 2: there is now a name to show without asking
 * for one.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class SessionStore {
  private readonly _tokens = inject(TokenStore);
  private readonly _profile = inject(ProfileStore);

  readonly identity = computed<Identity>(() => {
    const tokens = this._tokens.tokens();
    return tokens === null
      ? { kind: 'anonymous' }
      : {
          kind: tokens.kind,
          userId: tokens.userId,
          username: tokens.username,
        };
  });

  /**
   * The caller's global username, or null when anonymous.
   *
   * Comes off the token pair (backend plan 0018), so the app bar shows a real name
   * with no request at all. `GET /v1/account/me` exists and carries more, but the
   * home page needs none of it and a round trip for one initial would be waste.
   *
   * **Rule A2** (plan 0015): once `ProfileStore` has loaded, its name wins. A rename
   * answers a profile and no new token pair, so the name on the pair is stale for up to
   * the access token's whole life afterwards, and the fix has to be a preference here
   * rather than a refresh there — refreshing rotates the pair, which is a race spent on
   * one letter. Until the profile has been read there is nothing to prefer and the pair
   * is both the only answer and the correct one.
   *
   * Still null for an anonymous caller whatever the profile says, because a profile
   * held from a session that has since been cleared must not put a name in the app bar
   * of somebody who is signed out.
   */
  readonly username = computed(() => {
    const identity = this.identity();
    if (identity.kind === 'anonymous') {
      return null;
    }

    return this._profile.username() ?? (identity.username || null);
  });

  /** True for a temporary or a registered user. */
  readonly isAuthenticated = computed(
    () => this.identity().kind !== 'anonymous'
  );

  /** True only for a temporary user. Raises `0003`'s guest banner. */
  readonly isGuest = computed(() => this.identity().kind === 'TEMPORARY');

  /** The signed-in user's id, or null. */
  readonly userId = computed(() => {
    const identity = this.identity();
    return identity.kind === 'anonymous' ? null : identity.userId;
  });
}
