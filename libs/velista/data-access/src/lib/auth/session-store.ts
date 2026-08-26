import { computed, inject, Injectable } from '@angular/core';
import type { Identity } from '@portfolio/velista/models';
import { TokenStore } from './token-store';

/**
 * The one signal every page reads to know who is looking at it.
 *
 * Three states, and the middle one is a first class product state rather than an edge
 * case (plan 0001, D6): anonymous, a temporary user holding a real token but no
 * credentials, and a registered user. `0003` renders a different page for each.
 *
 * There is deliberately no display name here. The API exposes none: there is no
 * profile endpoint, and `email` and `displayName` are never returned to a client. The
 * only human readable name anywhere is `Membership.username`, which is per zone. See
 * plan 0004 section 11 item 2, which is backend work.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly _tokens = inject(TokenStore);

  readonly identity = computed<Identity>(() => {
    const tokens = this._tokens.tokens();
    return tokens === null
      ? { kind: 'anonymous' }
      : { kind: tokens.kind, userId: tokens.userId };
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
