import { inject } from '@angular/core';
import type {
  AdminMe,
  AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { SessionMemory } from './session-memory';

/**
 * Getting a token, renewing it, and asking who it belongs to (plan 0002,
 * sections 1, 5 and 6, and plan 0003, section 4).
 *
 * Four calls, and no `signOut`. Nothing on the server ends an admin session:
 * there is no refresh token to revoke and no server side session to destroy, so
 * signing out is deleting what the browser holds, which is
 * {@link SessionStore}'s job and not a request. Deliberate signing out arrives
 * with the chrome in `0004`; the store can already do it.
 *
 * Every method **throws** on failure rather than answering a result union. The
 * failure has to be mapped for the screen anyway, `toSignInFailure` is the one
 * place that happens, and a union here would make each implementation reproduce
 * that mapping.
 */
export interface SessionServiceI {
  /**
   * Username and password in, a session out.
   *
   * Throws a `GatewayError` for every refusal, which the caller turns into a
   * `SignInFailure`. The four outcomes of section 2 are distinguished by the
   * code on that error and nowhere else.
   */
  signIn(username: string, password: string): Promise<AdminSession>;

  /**
   * A session with no password, from a server that said it would give one (plan
   * 0002, section 5).
   *
   * A separate method rather than `signIn` with empty strings, so the one call
   * in this app that skips authentication is named, greppable, and impossible to
   * reach by leaving a form blank. What it sends is still `POST
   * /v1/admin/auth/login`, because that is the route the gateway shortcuts when
   * its own switch is on: the client cannot turn this on, it can only take what
   * a server that already decided is offering.
   */
  signInForDevelopment(): Promise<AdminSession>;

  /**
   * `POST /v1/admin/auth/refresh`: a live token in, a new one out (plan 0003).
   *
   * **There is no refresh token, and this is not one.** It presents the access
   * token the app already holds and receives a fresh one, so a session that is
   * still valid renews indefinitely and a session that has expired cannot be
   * renewed at all. Nothing outliving the access token is stored anywhere,
   * which is the whole session model in one sentence.
   *
   * It is a round trip rather than a local re-sign because auth re-reads the
   * admin row, which is what makes disabling an operator take effect within one
   * token lifetime instead of never.
   *
   * Throws like the others. A 401 here means the token is dead and the caller
   * must re-authenticate; anything else means the renewal did not happen and
   * can be tried again while the token is still live.
   */
  refresh(): Promise<AdminSession>;

  /** `GET /v1/admin/auth/me`: who the held token names, and where. */
  readMe(): Promise<AdminMe>;
}

// Inject THIS token, typed as the interface, never the concrete class.
export const SESSION_SERVICE = serviceToken<SessionServiceI>(
  'SESSION_SERVICE',
  () => inject(SessionMemory)
);
