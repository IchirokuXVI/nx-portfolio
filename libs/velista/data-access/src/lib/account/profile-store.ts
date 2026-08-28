import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import type {
  ProfileLoad,
  UsernameScope,
  UserProfile,
} from '@portfolio/velista/models';
import { TokenStore } from '../auth/token-store';
import { Mutations } from '../mutations';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import { ACCOUNT_SERVICE, type AccountServiceI } from './account-service';

/**
 * The caller's own profile, and the name every screen in the app reads.
 *
 * ## Rule A2: the profile owns the name, not the token
 *
 * `SessionStore.username` used to be computed from the token pair alone. The name rides
 * in the **response body** of every issue and refresh, deliberately, so it cannot go
 * stale for a token's whole lifetime — but `PATCH /v1/account/me` answers a profile and
 * **no new pair**, and the access token's default life is fifteen minutes. So a person
 * who renamed themselves would see the new name on the account screen, go back to the
 * dashboard, and find the old initial in the app bar for up to a quarter of an hour.
 *
 * The tempting fix is to refresh the pair after a rename, and it is the wrong one:
 * refresh **rotates**, revoking the presented token and issuing a new one, which is why
 * `TokenStore` refreshes single flight in the first place. Spending a rotation to update
 * one letter puts a race into the cheapest possible action.
 *
 * So the rename's own response is written straight in here, `SessionStore` prefers this
 * over the pair, and the app bar changes on the same tick on every screen with no
 * request at all. The token catches up on its own schedule and agrees when it does.
 *
 * ## Why that rule needs `user.usernameChanged` to stand up in a second tab
 *
 * In the tab that did the rename the paragraph above is true. In a **second** tab it
 * was exactly backwards, and not for fifteen minutes but forever: the profile was read
 * before the rename and holds the old name, the token pair does refresh and does carry
 * the new one, and the profile is preferred, so the corrected value is shadowed by the
 * stale one. The fallback that exists to prevent staleness was unreachable precisely
 * where it would have helped.
 *
 * The fix belongs here rather than in a cleverer fallback: with the realtime event
 * applied the two agree again and A2 stands unchanged (plan 0021, section 5).
 *
 * ## Why it lives in `data-access` rather than in `feature-account`
 *
 * A store owned by a feature library is destroyed on navigation, and the app bar on
 * four other screens reads the name it holds. `ZoneStore`'s own header gives the same
 * reason and `0010` section 5.2 repeated it.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It resolves
// `ACCOUNT_SERVICE`, and at the root it would get that token's own default instead of
// whatever the app bound, which is the failure that survives longest unnoticed.
@Injectable()
export class ProfileStore {
  private readonly _account = inject<AccountServiceI>(ACCOUNT_SERVICE);
  private readonly _mutations = inject(Mutations);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _destroyRef = inject(DestroyRef);

  /**
   * The caller's id, read off the token pair.
   *
   * `SessionStore.userId` is the same value and is what plan 0021 named, and it cannot
   * be injected here: `SessionStore` injects **this** store to apply rule A2, so
   * reaching back for it would close a DI cycle. The pair is where that id comes from
   * anyway, since `SessionStore.userId` is `tokens.userId` for every non-anonymous
   * identity, so this reads the same field one link earlier in the same chain.
   */
  private readonly _tokens = inject(TokenStore);

  private readonly _profile = signal<UserProfile | null>(null);
  private readonly _state = signal<ProfileLoad>('loading');
  private readonly _error = signal<unknown>(null);

  /** The profile, or null until one has been read. */
  readonly profile = this._profile.asReadonly();

  /** How the one request this store makes has got on. */
  readonly state = this._state.asReadonly();

  /** The failure behind a `failed` state, for its correlation id. */
  readonly error = this._error.asReadonly();

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph.
    // `MembershipStore`, `PresenceStore` and `ZoneStore` all say the same thing.
    const subscription = this._realtime.events.subscribe((event) => {
      if (
        event.type !== 'user.usernameChanged' ||
        // The room makes it the caller's, and this does not take that on faith: a
        // client that trusts routing to be its authorization is one server bug away
        // from wearing somebody else's name.
        event.userId !== this._tokens.tokens()?.userId
      ) {
        return;
      }

      // A null profile stays null. The event carries a name and not a profile, and
      // inventing one would hand `SessionStore` a name to prefer over a token that is
      // already correct. Null is what makes that fallback a fallback.
      //
      // This also fires in the tab that did the renaming, after `rename` has already
      // written the response. Writing the same string twice is a no-op, and
      // suppressing it would need the "did I do this" flag plan 0021 refuses.
      this._profile.update((profile) =>
        profile === null ? profile : { ...profile, username: event.username }
      );
    });

    this._destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /**
   * The name rule A2 is about, or null when nothing has been loaded.
   *
   * Null is what makes the fallback in `SessionStore` a fallback rather than a race:
   * until this store has an answer the token pair is the only thing that knows the
   * name, and it is already correct.
   */
  readonly username = computed(() => {
    const profile = this._profile();
    return profile === null || profile.username === ''
      ? null
      : profile.username;
  });

  /**
   * Read the profile.
   *
   * Called by the account screen and by nothing else, which is the whole point of the
   * name coming off the token pair: no other screen in the app spends a request to
   * learn something it already knows.
   *
   * A second call while a profile is already held does not blank it. Re-reading is how
   * the retry line on a failed screen works, and a screen that emptied itself first
   * would flash between the name it has and the name it is about to have again.
   */
  async load(): Promise<void> {
    if (this._profile() === null) {
      this._state.set('loading');
    }
    this._error.set(null);

    try {
      this._profile.set(await this._account.getProfile());
      this._state.set('loaded');
    } catch (error) {
      this._error.set(error);
      this._state.set('failed');
    }
  }

  /**
   * Rename the caller, and adopt the answer.
   *
   * Through `Mutations.run` like every other write in this app (rule D2), which is what
   * keeps an offline queue a change to one file rather than to every call site. No
   * overlay: the sheet's primary is busy and its field is read only for the whole of
   * the request, so there is no interim state for an overlay to describe, and an
   * optimistic name that then failed would have to be un-rendered from five screens.
   *
   * `TokenStore.refresh` is **not** called, here or anywhere near here. See rule A2 in
   * the class comment; a spec asserts it.
   */
  async rename(
    username: string,
    scope: UsernameScope
  ): Promise<
    | { readonly state: 'renamed' }
    | { readonly state: 'failed'; readonly error: unknown }
  > {
    const outcome = await this._mutations.run(null, () =>
      this._account.setUsername(username, scope)
    );

    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }

    // The response, not the string that was typed. They differ whenever the server
    // normalizes: `normalizeUsername` collapses whitespace runs and normalizes to NFC,
    // and writing back what was sent would leave the screen showing a name the server
    // does not have.
    this._profile.set(outcome.value);
    this._state.set('loaded');

    return { state: 'renamed' };
  }

  /**
   * Delete the account.
   *
   * The store does **not** clear the session on success. Clearing is a decision about
   * where the app goes next, which belongs to the sheet that has somewhere to navigate
   * to; a store that signed the user out would do it before the sheet could tell them
   * why, and a failed delete would be indistinguishable from a successful one.
   */
  async remove(): Promise<
    | { readonly state: 'deleted' }
    | { readonly state: 'failed'; readonly error: unknown }
  > {
    const outcome = await this._mutations.run(null, () =>
      this._account.deleteAccount()
    );

    return outcome.state === 'failed'
      ? { state: 'failed', error: outcome.error }
      : { state: 'deleted' };
  }

  /** Drop what is held. Called on sign out and after a delete. */
  clear(): void {
    this._profile.set(null);
    this._state.set('loading');
    this._error.set(null);
  }
}
