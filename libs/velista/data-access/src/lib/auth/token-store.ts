import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { SessionTokens } from '@portfolio/velista/models';
import {
  BrowserFacade,
  isAccessTokenExpired,
  StorageKeys,
} from '@portfolio/velista/platform';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { hasResponse } from '../errors';
import { toSessionTokens } from '../mapping/mappers';
import { anonymous } from './http-context';

/**
 * What rule D3's gate found. `guest-account-lost` is the one that needs a screen: the
 * user had a guest account, its refresh token is spent or revoked, and creating a new
 * zone now would silently give them a second account instead of their groups.
 */
export type OptionalAuthResult =
  | { readonly state: 'authenticated'; readonly accessToken: string }
  | { readonly state: 'anonymous' }
  | { readonly state: 'guest-account-lost' };

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
 * (`auth/src/app/tokens/token.service.ts:85`). Two requests refreshing concurrently
 * means the second presents a token the first just revoked, and the user is signed out
 * mid session. `0003` loads zones and opens a realtime connection on the same tick, so
 * this is not a rare race.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class TokenStore {
  private readonly _browser = inject(BrowserFacade);
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  private readonly _tokens = signal<SessionTokens | null>(null);

  /** The current pair, or null when anonymous. */
  readonly tokens = this._tokens.asReadonly();

  /** The one refresh in flight, shared by every caller that needs a fresh token. */
  private _refreshing: Promise<SessionTokens | null> | null = null;

  constructor() {
    this._tokens.set(this._restore());
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
   * **A refresh that got no response is neither** (plan 0035, section 2). The pair
   * survives it, so the account is exactly where it was, and telling a guest it is
   * gone because their phone was in a lift is the one false alarm in this app with no
   * way back from it. The session still standing afterwards is how that case is
   * recognised, and it is the only reading of `hasSession` here: the request that
   * follows refreshes again, and either it works or it fails on the network like
   * everything else and raises the blocking screen.
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

    return before.kind === 'TEMPORARY' && !this.hasSession()
      ? { state: 'guest-account-lost' }
      : { state: 'anonymous' };
  }

  private async _performRefresh(): Promise<SessionTokens | null> {
    const current = this._tokens();
    if (current === null) {
      return null;
    }

    try {
      const body = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/auth/refresh'),
          { refreshToken: current.refreshToken },
          { context: anonymous('auth.refresh') }
        )
      );

      const tokens = toSessionTokens(body);
      if (tokens === null) {
        this.clear();
        return null;
      }

      this.set(tokens);
      return tokens;
    } catch (error) {
      if (!hasResponse(error)) {
        // **A network failure is not a rejected token** (plan 0035, section 2). The
        // refresh never reached a server, so nothing was spent and nothing was
        // revoked, and the pair being thrown away is the only way back into the
        // account. Angular reports that as status 0, which is exactly the test
        // `ConnectionRecovery` makes for exactly this reason.
        //
        // Returning null without clearing leaves every caller where it was: the
        // interceptor's retry fails, the request surfaces its ordinary error,
        // `ConnectionState` raises the blocking screen and `ConnectionRecovery`
        // probes until the backend answers. The session is simply still there when it
        // comes back, which is the whole of the fix for an app that was resumed with
        // an expired access token and a radio still waking up.
        return null;
      }

      // The server answered, whatever it answered. A refresh token is single use, so a
      // rejected one is spent or revoked either way, and a stale pair kept around would
      // be sent to an optional-auth route later and mint a duplicate guest account.
      this.clear();
      return null;
    }
  }

  private _restore(): SessionTokens | null {
    const stored = this._browser.readStorage(StorageKeys.session);
    if (stored === null) {
      return null;
    }

    try {
      // Rule D4 applies to storage too. What was written days ago by an older build
      // is as untrusted as a response body, and it is the input most likely to be
      // stale in shape.
      return toSessionTokens(JSON.parse(stored));
    } catch {
      return null;
    }
  }
}
