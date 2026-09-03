import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  AdminIdentity,
  AdminSession,
  SignInFailure,
} from '@portfolio/luna-shopper-admin/models';
import { toSignInFailure } from '../gateway-error';
import { SESSION_SERVICE } from './session-service';
import { SessionStorage } from './session-storage';

/**
 * The session, as the one signal the whole app reads (plan 0002, sections 3, 4
 * and 6).
 *
 * Everything that needs a token asks here: the interceptor for the header, the
 * route guard for whether there is one at all, and from `0004` the chrome for
 * who is signed in. Nothing else holds a copy, so signing out is one write.
 *
 * The token is mirrored into `sessionStorage` by {@link SessionStorage} rather
 * than kept only in memory, which is a change from the plan as written: a
 * reload keeps the session, and closing the browser still ends it. See that
 * class for why, and for the tab scoped limit that comes with it.
 */
@Injectable()
export class SessionStore {
  private readonly _service = inject(SESSION_SERVICE);
  private readonly _storage = inject(SessionStorage);

  /** What was restored from storage before anything rendered. */
  private readonly _session = signal<AdminSession | null>(this._storage.read());

  /** The held session, or `null` when nobody is signed in. */
  readonly session = this._session.asReadonly();

  /** Whether there is a session at all. What the route guard asks. */
  readonly signedIn = computed(() => this._session() !== null);

  private readonly _identity = signal<AdminIdentity | null>(null);

  /**
   * Who the server says the held token belongs to (plan 0002, section 6).
   *
   * `null` until `GET /v1/admin/auth/me` has answered, which it may never do:
   * the identity is what the chrome in `0004` shows, and nothing in this plan
   * blocks on it. What the session already carries — the username the login
   * answered with — is enough to be signed in; this is what stays true when a
   * display name changes elsewhere.
   */
  readonly identity = this._identity.asReadonly();

  /**
   * The bearer token, or `null`.
   *
   * Read synchronously by the interceptor on every request, so it must not be a
   * promise and must not trigger any work. Expiry is **not** checked here:
   * `0003` is what notices a token running out and renews it, and a store that
   * silently withheld an expired token would leave this plan's interceptor
   * sending unauthenticated requests that fail in a way nothing explains.
   */
  token(): string | null {
    return this._session()?.accessToken ?? null;
  }

  /**
   * Sign in, and hold what comes back.
   *
   * Answers `null` on success and a {@link SignInFailure} otherwise, rather than
   * throwing. The screen has to render every failure anyway, so a caller that
   * must remember to catch is a caller that will eventually not.
   */
  async signIn(
    username: string,
    password: string
  ): Promise<SignInFailure | null> {
    return this.hold(() => this._service.signIn(username, password));
  }

  /**
   * Take the passwordless session a server offered (plan 0002, section 5).
   *
   * Only ever called after the environment read came back saying the server
   * would give one. It still reports its failure the same way, because the
   * server is entitled to change its mind between the two calls, and a
   * development app that silently failed to sign in would look like a broken
   * backend rather than a login it can simply be given.
   */
  async signInForDevelopment(): Promise<SignInFailure | null> {
    return this.hold(() => this._service.signInForDevelopment());
  }

  /**
   * Forget the session, here and in storage.
   *
   * The only way out of a session in this plan, and it is a local act: nothing
   * on the server ends an admin session, so there is no request to make. It is
   * what a 401 does (section 4) and what `0004`'s sign out control will call.
   */
  signOut(): void {
    this._session.set(null);
    this._identity.set(null);
    this._storage.clear();
  }

  /**
   * Ask who the token belongs to (plan 0002, section 6).
   *
   * Never awaited by anything that renders, and it swallows its own failure. The
   * identity decorates the app; a `me` that did not answer must not turn a
   * working session into a blank screen. A 401 among those failures has already
   * cleared the session through the interceptor, which is the one failure that
   * needs to do anything at all.
   */
  async loadIdentity(): Promise<void> {
    if (!this.signedIn()) {
      return;
    }

    try {
      const me = await this._service.readMe();
      // Checked again: `signOut` may have run while this was in flight, and
      // writing an identity onto a cleared session would leave the chrome naming
      // somebody who is no longer signed in.
      if (this.signedIn()) {
        this._identity.set(me.admin);
      }
    } catch {
      // Left as null. The chrome shows what the session already carries.
    }
  }

  private async hold(
    call: () => Promise<AdminSession>
  ): Promise<SignInFailure | null> {
    try {
      const session = await call();
      this._session.set(session);
      this._storage.write(session);
      // Not awaited. The operator is signed in the moment the token exists, and
      // making them watch a second round trip before the app opens would spend
      // the whole latency budget on a display name.
      void this.loadIdentity();
      return null;
    } catch (error) {
      // A failed attempt must not leave a previous session standing. Nothing in
      // this plan can reach a sign in while already signed in, but a store whose
      // failure path is "change nothing" is one route change away from holding a
      // session the operator believes they replaced.
      this.signOut();
      return toSignInFailure(error);
    }
  }
}
