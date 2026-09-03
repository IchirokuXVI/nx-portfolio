import { HttpClient } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { SessionTokens } from '@portfolio/velista/models';
import {
  BrowserFacade,
  isAccessTokenExpired,
  StorageKeys,
} from '@portfolio/velista/platform';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { isCredentialRejection } from '../errors';
import { toSessionTokens } from '../mapping/mappers';
import { anonymous } from './http-context';

/**
 * What rule D3's gate found. `guest-account-lost` is the one that needs a screen: the
 * user had a guest account, its refresh token is spent or revoked, and creating a new
 * zone now would silently give them a second account instead of their groups.
 *
 * `unavailable` is the fourth, and it is the one that keeps the other three honest
 * (plan 0067, section 4): a session is held, and this app could not prove it right
 * now, because the refresh got no answer or an answer that said nothing about the
 * token. **It is not `anonymous`**, and the difference is a whole account. The two
 * routes behind this gate mint a guest account when they see no identity, so calling
 * either one anonymously while a session sits unproven in storage is how somebody ends
 * a supermarket outage with a second, empty account and no way back to their groups.
 */
export type OptionalAuthResult =
  | { readonly state: 'authenticated'; readonly accessToken: string }
  | { readonly state: 'anonymous' }
  | { readonly state: 'guest-account-lost' }
  | { readonly state: 'unavailable' };

/**
 * Holds the token pair, persists it, and owns refreshing it.
 *
 * ## Why the pair is in `localStorage`, and what that costs
 *
 * For a temporary user the refresh token **is** the account: plan 0001 D6 says "a
 * temporary user's token is the only proof of their identity, so losing it loses their
 * data". Memory or `sessionStorage` would delete a guest's groups when they close the
 * tab, which destroys the "start without an account" flow the whole home page is built
 * around.
 *
 * The cost is real and is recorded rather than hidden: a token in `localStorage` is
 * readable by any script that achieves XSS on this origin, and today that origin is
 * the entire portfolio. What keeps it acceptable is that this app renders no user
 * supplied HTML and never uses `innerHTML`, and that `0003`'s guest banner exists to
 * move people off this footing. The correct long term fix is an httpOnly refresh
 * cookie, which is a backend change (plan 0004, section 11).
 *
 * ## Why refresh is single flight
 *
 * The backend rotates refresh tokens and revokes the presented one
 * (`auth/src/app/tokens/token.service.ts:177`). Two requests refreshing concurrently
 * means the second presents a token the first just revoked, and the user is signed out
 * mid session. `0003` loads zones and opens a realtime connection on the same tick, so
 * this is not a rare race.
 *
 * ## Why single flight is not enough, and what stands beside it
 *
 * Single flight is per document, and one origin holds more than one (plan 0067,
 * section 3). The installed app and the browser tab are two documents over one
 * `localStorage`, both hold their own copy of the pair in a signal, and both refresh on
 * resume. The loser presents a token the winner revoked a moment earlier, and the 401
 * it gets back is real. So this store also **watches storage for the other document's
 * pair**, adopts a newer one rather than racing it, and checks for one before it acts
 * on any refusal.
 *
 * ## What may delete a session
 *
 * One thing: the server refusing the credential, `isCredentialRejection`, while the
 * pair that was refused is still the newest one on this origin. Not a 500, not a 503,
 * not a body this app could not read, and not a request that got no answer. Everything
 * else keeps the pair and reports the failure, because the pair is the only way back
 * into the account and a temporary user has nothing else at all.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class TokenStore {
  private readonly _browser = inject(BrowserFacade);
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tokens = signal<SessionTokens | null>(null);

  /** The current pair, or null when anonymous. */
  readonly tokens = this._tokens.asReadonly();

  /** The one refresh in flight, shared by every caller that needs a fresh token. */
  private _refreshing: Promise<SessionTokens | null> | null = null;

  constructor() {
    this._tokens.set(this._restore());
    this._followOtherDocuments();
  }

  /**
   * Keep in step with the other document on this origin (plan 0067, section 3).
   *
   * The installed app and the browser tab share one `localStorage` and hold two
   * independent copies of the pair. Without this, the copy in the document that was
   * asleep goes stale the moment the other one refreshes, and the next thing it does
   * with that copy is present a revoked token and be signed out on a real 401.
   *
   * The `storage` event never fires in the document that wrote the value, so
   * everything arriving here was written by somebody else:
   *
   * - **A pair.** Adopt it. It is newer than whatever is held, by construction, and
   *   adopting it costs nothing: no request, no rotation, no round trip.
   * - **A removal.** Sign out too. Deleting the key is what `signOut` and the account
   *   deletion path do, and both are deliberate. This is the one case that ends a
   *   session without the server refusing anything, and it is safe because the only
   *   thing that removes the key is this same store deciding to.
   * - **Anything unreadable.** Ignored, deliberately. A value this app cannot parse
   *   says nothing about the account, and treating it as a sign out would let one
   *   corrupt write on a shared origin end a working session.
   */
  private _followOtherDocuments(): void {
    const stop = this._browser.watchStorage(StorageKeys.session, (value) => {
      if (value === null) {
        this._tokens.set(null);
        return;
      }

      const adopted = this._parse(value);
      if (adopted !== null) {
        this._tokens.set(adopted);
      }
    });

    this._destroyRef.onDestroy(stop);
  }

  /** Persist a new pair. Called after sign in, refresh, and the guest handshake. */
  set(tokens: SessionTokens): void {
    this._tokens.set(tokens);
    this._browser.writeStorage(StorageKeys.session, JSON.stringify(tokens));
  }

  /** Drop the session entirely. The app is anonymous afterwards. */
  clear(): void {
    this._tokens.set(null);
    this._browser.removeStorage(StorageKeys.session);
  }

  /**
   * The stored access token if it is usable right now, otherwise `null`.
   *
   * Synchronous on purpose. The overwhelmingly common case is a valid token, and
   * routing that through a promise would push every single request in the app onto a
   * microtask for no reason. A `null` here means either no session or one that needs
   * refreshing, which {@link hasSession} distinguishes.
   */
  accessTokenIfFresh(): string | null {
    const current = this._tokens();
    if (current === null || isAccessTokenExpired(current.accessToken)) {
      return null;
    }

    return current.accessToken;
  }

  /** Whether a pair is held at all, whatever state the access token is in. */
  hasSession(): boolean {
    return this._tokens() !== null;
  }

  /**
   * An access token that is valid now, refreshing first if the stored one has expired
   * or is close enough that a request could arrive after it lapses.
   *
   * Returns `null` when there is no session, or when the refresh failed. A `null` here
   * is the signal that the user is anonymous, and **rule D3 makes it load bearing**:
   * the optional-auth routes must not be called with a stale token, because the
   * gateway would treat it as anonymous and silently mint a second guest account
   * (plan 0004, section 5.5).
   */
  async ensureFreshToken(): Promise<string | null> {
    const current = this._tokens();
    if (current === null) {
      return null;
    }

    if (!isAccessTokenExpired(current.accessToken)) {
      return current.accessToken;
    }

    const refreshed = await this.refresh();
    return refreshed?.accessToken ?? null;
  }

  /**
   * Force a refresh, sharing one in-flight request between all callers.
   *
   * On a refresh the server **answered** the session is cleared, because a rejected
   * refresh token cannot be retried: it is single use, so an answered failure means it
   * is spent or revoked either way. On a refresh that reached no server the pair is
   * kept, because nothing was spent (plan 0035, section 2). Either way this returns
   * null, so no caller has to tell them apart.
   */
  refresh(): Promise<SessionTokens | null> {
    this._refreshing ??= this._performRefresh().finally(() => {
      this._refreshing = null;
    });

    return this._refreshing;
  }

  /**
   * Rule D3's gate, for the two routes that mint a guest account when they see no
   * valid identity: `POST /v1/zones` and `POST /v1/zones/join`.
   *
   * Since backend plan 0020 the gateway's `OptionalJwtAuthGuard` answers a stale
   * token with a 401 instead of quietly minting a second guest account, so the data
   * loss this gate used to be the only defence against can no longer happen. The gate
   * stays for the two things the server cannot do: it refreshes before the call rather
   * than spending a round trip on a rejection, and it is the only place that knows the
   * difference between "nobody is signed in" and "the guest we had is gone". A failed
   * refresh over a `TEMPORARY` identity is the second case, and only that one needs
   * telling.
   *
   * **A refresh that was not answered, or was answered with something that says
   * nothing about the token, is neither** (plan 0035, section 2, widened by plan 0067,
   * section 4). The pair survives it, so the account is exactly where it was, and
   * telling a guest it is gone because their phone was in a lift is the one false
   * alarm in this app with no way back from it.
   *
   * That case is `unavailable`, and it used to be `anonymous`, which was the more
   * expensive of the two mistakes. The caller goes on to a route that mints a guest
   * account when it sees no identity, so answering "nobody is signed in" while a
   * perfectly good session sat unproven in storage handed the user a second, empty
   * account and left their groups on the first one. The session still standing after a
   * failed refresh is how that case is recognised, and it is the only reading of
   * `hasSession` here.
   */
  async authorizeOptionalAuthCall(): Promise<OptionalAuthResult> {
    const before = this._tokens();
    if (before === null) {
      return { state: 'anonymous' };
    }

    const token = await this.ensureFreshToken();
    if (token !== null) {
      return { state: 'authenticated', accessToken: token };
    }

    if (this.hasSession()) {
      return { state: 'unavailable' };
    }

    return before.kind === 'TEMPORARY'
      ? { state: 'guest-account-lost' }
      : { state: 'anonymous' };
  }

  /**
   * The gateway refused a token this store had just minted (plan 0067, section 5).
   *
   * Called from the interceptor's one retry, which is the only place that holds a
   * pair issued seconds earlier and refused anyway. That normally means the identity
   * behind it is gone, and the session goes with it. It means something else entirely
   * when another document rotated the pair in between, so that is checked first, and
   * the newer pair is adopted rather than deleted.
   */
  reportRejected(presented: SessionTokens): void {
    const newer = this._newerThan(presented);
    if (newer !== null) {
      this._tokens.set(newer);
      return;
    }

    this.clear();
  }

  private async _performRefresh(): Promise<SessionTokens | null> {
    const held = this._tokens();
    const current = this._newestHeldPair();
    if (current === null) {
      return null;
    }

    // The other document refreshed while this one was in the background, and what it
    // wrote is still good. Adopt it instead of spending a rotation to arrive at the
    // same place.
    //
    // **Only when the pair came from elsewhere.** This method also serves the
    // interceptor's forced retry, which holds a token that looks perfectly valid and
    // was refused anyway, so a check on freshness alone would hand that path back the
    // very token the gateway had just rejected and the retry would ask the same
    // question twice.
    const adopted = held !== null && current.refreshToken !== held.refreshToken;
    if (adopted && !isAccessTokenExpired(current.accessToken)) {
      return current;
    }

    return this._exchange(current, true);
  }

  /**
   * Present one refresh token and store whatever comes back.
   *
   * `mayAdopt` allows exactly one restart, on a pair another document wrote. One,
   * because a second restart would be racing the same document again rather than
   * catching up with it, and a bounded retry is what keeps a resume from turning into
   * a loop of rotations between two windows.
   */
  private async _exchange(
    presented: SessionTokens,
    mayAdopt: boolean
  ): Promise<SessionTokens | null> {
    try {
      const body = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/auth/refresh'),
          { refreshToken: presented.refreshToken },
          { context: anonymous('auth.refresh') }
        )
      );

      const tokens = toSessionTokens(body);
      if (tokens === null) {
        // Rule D4: an answer this app cannot read is not a session. It is not a
        // refusal either, and the difference decides whether an account survives, so
        // the pair stays (plan 0067, section 2). A captive portal answering 200 with
        // its own login page is exactly this shape, and it is the single most likely
        // way to meet it: a phone joining a supermarket's wifi. If the pair really was
        // spent, the next refresh is answered with a 401 and cleared then, at the cost
        // of one round trip.
        return null;
      }

      this.set(tokens);
      return tokens;
    } catch (error) {
      if (!isCredentialRejection(error)) {
        // **Only a refusal is a refusal** (plan 0067, section 2). No answer at all
        // means the refresh never reached a server, so nothing was spent (plan 0035).
        // A 5xx means it reached the gateway and no further: the refresh route is a
        // broker call, so an auth service that is restarting produces a 500, and a
        // gateway pod that is down produces the proxy's 503. Neither says one word
        // about this token, and both are the ordinary shape of a deploy.
        //
        // Returning null without clearing leaves every caller where it was: the
        // interceptor's retry fails, the request surfaces its ordinary error,
        // `ConnectionState` raises the blocking screen and `ConnectionRecovery`
        // probes until the backend answers. The session is simply still there when it
        // comes back.
        return null;
      }

      // Refused. Before believing it, check whether the token that was refused is
      // still the one this origin holds: the other document rotating it is the one
      // way to earn a truthful 401 while the account is perfectly fine.
      const newer = this._newerThan(presented);
      if (newer !== null) {
        this._tokens.set(newer);
        return mayAdopt ? this._exchange(newer, false) : null;
      }

      // A refresh token is single use, so one the server rejected is spent or revoked
      // either way, and a stale pair kept around would be sent to an optional-auth
      // route later and mint a duplicate guest account.
      this.clear();
      return null;
    }
  }

  /**
   * The newest pair on this origin, adopting it if this document was behind.
   *
   * Storage is the shared truth and the signal is one document's view of it. Reading
   * storage first is what stops a tab that has been asleep from presenting a token the
   * installed app rotated an hour ago.
   *
   * Falls back to the held pair when storage reads null, which is both "there is
   * nothing stored" and "storage threw", as it does in private mode. Neither is a
   * reason to drop a session this document is holding.
   */
  private _newestHeldPair(): SessionTokens | null {
    const stored = this._restore();
    if (stored === null) {
      return this._tokens();
    }

    if (stored.refreshToken !== this._tokens()?.refreshToken) {
      this._tokens.set(stored);
    }

    return stored;
  }

  /** The stored pair when another document has replaced the given one, else null. */
  private _newerThan(presented: SessionTokens): SessionTokens | null {
    const stored = this._restore();
    return stored !== null && stored.refreshToken !== presented.refreshToken
      ? stored
      : null;
  }

  private _restore(): SessionTokens | null {
    const stored = this._browser.readStorage(StorageKeys.session);
    return stored === null ? null : this._parse(stored);
  }

  /**
   * Rule D4 applies to storage too. What was written days ago by an older build is as
   * untrusted as a response body, and it is the input most likely to be stale in
   * shape. It is also what another document just wrote, which is the same problem
   * wearing a different hat.
   */
  private _parse(raw: string): SessionTokens | null {
    try {
      return toSessionTokens(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
