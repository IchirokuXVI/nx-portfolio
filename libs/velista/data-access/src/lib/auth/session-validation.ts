import { effect, inject, Injectable, untracked } from '@angular/core';
import { BackendReadiness, BrowserFacade } from '@portfolio/velista/platform';
import { ProfileStore } from '../account/profile-store';
import { TokenStore } from './token-store';

/**
 * Proves the stored session against the server once per page load.
 *
 * A pair restored from `localStorage` is proven locally and only locally: the
 * access token's signature verifies and its `exp` is in the future. Neither says
 * the account it names still exists, and the two come apart whenever an account
 * is deleted inside a token's lifetime: an admin removal, a reaped guest, or a
 * database reset under a client still holding the pair from before it. The app
 * then boots signed in as a ghost. `SessionStore` reads the pair, every screen
 * renders for a user the server has never heard of, and each request fails with
 * an error no page has copy for, while nothing ever clears the pair that causes
 * it.
 *
 * The machinery that ends such a session already exists and only needs one
 * request to trip it. `GET /v1/account/me` is keyed on the token's own `userId`
 * and nothing else, so the gateway answers it with a 401 when the account is
 * gone (`asRejectedCredentials`, over in the gateway). The interceptor answers a
 * 401 with one refresh and one retry, the refresh is refused too because the
 * account's refresh tokens died with it, and `TokenStore` clears the pair. The
 * next load is anonymous and works. So this class sends that one request and
 * reads nothing back: the side effects are the point.
 *
 * ## Why it goes through `ProfileStore`
 *
 * The dashboard reads the profile too, for its confirm-your-email card, and two
 * classes independently fetching `/v1/account/me` at startup is one request too
 * many. `ProfileStore.load` is single flight, so whichever of the two asks
 * second joins the request the first one started. A guest's profile draws
 * nothing anywhere, and the dashboard deliberately skips reading it, but the
 * *account* behind a guest is exactly as deletable as a registered one, so this
 * class asks for every held session and the empty answer is the proof it came
 * for.
 *
 * ## Why it waits for readiness
 *
 * A request sent while the startup probe is still asking whether a backend is
 * there at all would fail with the answer this class must ignore, a network
 * error, and be spent for nothing. Once the state is `ready` the request is
 * asked of a backend that answers, so what comes back means something: a 2xx
 * proves the session, a 401 ends it, and either way the question is settled
 * within one round trip of the gate lifting. Failures in between, a 5xx or a
 * connection lost right after the probe, leave the pair alone, exactly as
 * plan 0067 requires: only a refusal is a refusal.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It
// reaches `TokenStore` and `ProfileStore`, which exist only in the app's
// injector. Listed in `VELISTA_DATA_ACCESS_PROVIDERS` to be available; the
// environment initializer in `app-providers.ts` is what makes it run, the same
// split as `StartupProbe` and `ConnectionRecovery`.
@Injectable()
export class SessionValidation {
  private readonly _browser = inject(BrowserFacade);
  private readonly _readiness = inject(BackendReadiness);
  private readonly _tokens = inject(TokenStore);
  private readonly _profile = inject(ProfileStore);

  /**
   * Whether this document has validated already. Once per page load is the
   * contract: readiness can leave `ready` and come back when a connection drops
   * mid session, and a session the server has answered for needs no second
   * proof, while re-proving on every recovery would spend a request at the
   * exact moment the backend is busiest.
   */
  private _validated = false;

  constructor() {
    if (!this._browser.isBrowser) {
      return;
    }

    effect(() => {
      if (this._validated || this._readiness.state() !== 'ready') {
        return;
      }
      this._validated = true;

      untracked(() => {
        // Asked at fire time, not at construction: the pair is restored
        // synchronously but this effect runs on a later tick, and a session is
        // what is being proven, so the absence of one settles the question.
        if (this._tokens.hasSession()) {
          // Fire and forget. A failure is either the 401 whose side effects
          // are the point, or a transport failure the session must survive,
          // and `ProfileStore` holds the outcome either way.
          void this._profile.load();
        }
      });
    });
  }
}
