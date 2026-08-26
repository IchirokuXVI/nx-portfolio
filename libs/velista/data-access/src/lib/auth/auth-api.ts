import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { SessionTokens } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { GatewayError } from '../errors';
import { toSessionTokens } from '../mapping/mappers';
import { isRecord, str } from '../mapping/primitives';
import type {
  AuthServiceI,
  ResendOutcome,
  VerifiedEmail,
} from './auth-service';
import { anonymous, operation } from './http-context';
import { TokenStore } from './token-store';

/**
 * Credentials, over HTTP. The default behind `AUTH_SERVICE`.
 *
 * **The one plan since 0004 that genuinely adds transport**, and the only service in
 * the app whose job is to change who the caller is.
 *
 * ## Why these calls do not go through `Mutations`
 *
 * Rule D2 (plan 0004) sends every write through one choke point so an offline queue
 * can be added later without touching a call site. These four are the deliberate
 * exception, and the reason is the queue itself: a sign in replayed minutes later
 * answers a question nobody is still asking, and a **register** replayed later creates
 * a real account long after the person gave up and made another one. Auth is the one
 * family of writes that must fail now rather than succeed eventually.
 *
 * ## Why three of them persist the pair themselves
 *
 * `register`, `login` and `upgrade` each end by writing to `TokenStore`, exactly as
 * `ZoneApi` persists the pair the optional-auth routes mint. The alternative is three
 * pages each remembering to do it, where forgetting looks like a successful sign in
 * that leaves the app anonymous. `upgrade` is the one where it matters most: the pair
 * it returns is what flips `SessionStore.isGuest` to false and takes the banner away.
 *
 * Injects `ApiUrl`, not `ApiConsumer`: the shared helper resolves URLs from
 * `@portfolio/shared/environments`, which describes the **portfolio's** backend, and
 * extraction contract item 6 says this app reads its own environment surface.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class AuthApi implements AuthServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _tokens = inject(TokenStore);

  /**
   * `POST /v1/auth/register`, three per minute.
   *
   * `displayName` is never sent. The backend generates a username regardless of what
   * arrives, and the display name is not the public cross zone handle, so asking for
   * one would collect a value nothing in the app renders (plan 0009, section 5.1).
   */
  async register(email: string, password: string): Promise<SessionTokens> {
    return this._authenticate('/v1/auth/register', 'auth.register', {
      email,
      password,
    });
  }

  /**
   * `POST /v1/auth/login`, five per minute.
   *
   * Anonymous context, so no bearer goes out and a 401 does **not** start a refresh:
   * a rejected password is not a stale token, and treating it as one would spend the
   * caller's refresh token on their behalf.
   */
  async login(email: string, password: string): Promise<SessionTokens> {
    return this._authenticate('/v1/auth/login', 'auth.login', {
      email,
      password,
    });
  }

  /**
   * `POST /v1/auth/upgrade`, bearer authenticated.
   *
   * The user id comes from the token and never from the body, which is what makes this
   * safe to offer: the server loads the caller's own user, refuses unless its kind is
   * `TEMPORARY`, and answers with tokens for the same id. Rule C2 is enforced above
   * this, at the route, because a guest who reached the register screen instead would
   * get a perfectly valid new account and lose every group with nothing said.
   */
  async upgrade(email: string, password: string): Promise<SessionTokens> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway('/v1/auth/upgrade'),
        { email, password },
        { context: operation('auth.upgrade') }
      )
    );

    return this._persist(body, 'auth.upgrade');
  }

  /**
   * `POST /v1/auth/verify-email`, three per ten minutes.
   *
   * Anonymous, because the link is opened wherever the mail app happens to be, which
   * is often a phone that has never signed in. It answers a user id and **not** a
   * token pair: confirming an email does not sign anybody in, and pretending otherwise
   * would be the client inventing a session out of a link in an inbox.
   */
  async verifyEmail(token: string): Promise<VerifiedEmail> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway('/v1/auth/verify-email'),
        { token },
        { context: anonymous('auth.verifyEmail') }
      )
    );

    const userId = str(isRecord(body) ? body['userId'] : null);
    if (userId === null) {
      // The token was consumed either way, so this is not offered as a retry. It is
      // reported as the same failure an expired link produces, which is the honest
      // reading: the link is spent and the screen says so.
      throw new Error('auth.verifyEmail returned no user id');
    }

    return { userId };
  }

  /**
   * `POST /v1/auth/verify-resend`, bearer authenticated.
   *
   * Nothing calls this yet: `VERIFY_RESEND_AVAILABLE` is false until the endpoint
   * lands (plan 0009, section 5.8). It is written now because the shape it answers is
   * the whole of rule C3, and because the countdown it feeds is built and tested.
   *
   * A refusal is an outcome rather than a thrown error. The server's own wait comes
   * back in the problem document's `retryAfterSeconds`, in the body and not a header,
   * because this API exposes no custom response headers cross origin.
   */
  async resendVerification(): Promise<ResendOutcome> {
    try {
      const body = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/auth/verify-resend'),
          {},
          { context: operation('auth.verifyResend') }
        )
      );

      return { state: 'sent', waitSeconds: waitFrom(body) };
    } catch (error) {
      if (error instanceof GatewayError && error.code === 'rate_limited') {
        // Not a failure to report as one: the person asked too soon, the screen has a
        // sentence for it, and the only thing it needs is the number.
        return { state: 'refused', waitSeconds: error.retryAfterSeconds ?? null };
      }

      return { state: 'failed', error };
    }
  }

  /** The two routes that are identical apart from their path and their throttle. */
  private async _authenticate(
    path: string,
    name: string,
    payload: { email: string; password: string }
  ): Promise<SessionTokens> {
    const body = await firstValueFrom(
      this._http.post<unknown>(this._urls.gateway(path), payload, {
        // Anonymous: there is no token to send, and a 401 from either of these means
        // the credentials were wrong rather than that a session lapsed.
        context: anonymous(name),
      })
    );

    return this._persist(body, name);
  }

  /**
   * Map the pair, store it, and hand it back.
   *
   * Rule D4: the response is `unknown` until `toSessionTokens` has looked at it. A
   * pair that cannot be mapped is not written, because a half stored session is worse
   * than none: the app would look signed in and fail every request afterwards.
   */
  private _persist(body: unknown, name: string): SessionTokens {
    const tokens = toSessionTokens(body);
    if (tokens === null) {
      throw new Error(`${name} returned an unusable token pair`);
    }

    this._tokens.set(tokens);
    return tokens;
  }
}

/** The wait a successful resend reported, when it reported one. See rule C3. */
function waitFrom(body: unknown): number | null {
  if (!isRecord(body)) {
    return null;
  }

  const value = body['retryAfterSeconds'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}
