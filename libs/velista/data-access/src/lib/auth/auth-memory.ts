import { inject, Injectable } from '@angular/core';
import type { SessionTokens, UserKind } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type {
  AuthServiceI,
  ResendOutcome,
  VerifiedEmail,
} from './auth-service';
import { TokenStore } from './token-store';

/** An account this fake knows about, and the one thing it checks. */
interface StoredAccount {
  readonly userId: string;
  readonly password: string;
}

/** The wait a refused resend reports. Deliberately far longer than a minute. */
const REFUSED_WAIT_SECONDS = 451;

/** The wait a successful resend reports, matching the mock's `0:52`. */
const SENT_WAIT_SECONDS = 52;

/** The one address that is already taken, so a `conflict` is reachable on demand. */
const TAKEN_EMAIL = 'taken@example.com';

/**
 * Credentials, in memory. Asked for by name, never a default.
 *
 * It exists for the same two reasons `ZoneMemory` does: the app runs with no backend,
 * and a spec reaches every state in section 3 without a transport. What it must not do
 * is be kinder than the real thing, so the two behaviours the plan turns on are
 * modelled exactly:
 *
 * - **Upgrade keeps the caller's `userId`.** That is the single most important
 *   property in plan 0009, and a fake that minted a fresh id here would let the bug
 *   rule C2 exists to prevent pass every test that used it.
 * - **Login answers one rejection for both failures.** An unknown email and a wrong
 *   password produce the same `unauthorized`, because the service does, deliberately,
 *   so the response does not reveal which addresses are registered.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// `TokenStore`, which reaches `APP_API_CONFIG`, which only the app can supply.
@Injectable()
export class AuthMemory implements AuthServiceI {
  private readonly _tokens = inject(TokenStore);

  private readonly _accounts = new Map<string, StoredAccount>([
    [TAKEN_EMAIL, { userId: 'u-taken', password: 'password123' }],
  ]);

  /** How many times another confirmation has been asked for, so a refusal is reachable. */
  private _resendCount = 0;

  async register(email: string, password: string): Promise<SessionTokens> {
    if (this._accounts.has(normalize(email))) {
      throw conflict();
    }

    // A **new** user id, which is exactly what makes this the wrong call for a guest
    // (rule C2). The fake is faithful about it rather than quietly reusing the
    // caller's, so a spec that routes a guest here fails the way production would.
    const userId = `u-${this._accounts.size + 1}`;
    this._accounts.set(normalize(email), { userId, password });

    return this._issue(userId, 'REGISTERED', email);
  }

  async login(email: string, password: string): Promise<SessionTokens> {
    const account = this._accounts.get(normalize(email));
    if (account === undefined || account.password !== password) {
      // One error for both, on purpose. See the class comment.
      throw unauthorized();
    }

    return this._issue(account.userId, 'REGISTERED', email);
  }

  async upgrade(email: string, password: string): Promise<SessionTokens> {
    const current = this._tokens.tokens();
    if (current === null || current.kind !== 'TEMPORARY') {
      throw conflict();
    }

    if (this._accounts.has(normalize(email))) {
      throw conflict();
    }

    this._accounts.set(normalize(email), { userId: current.userId, password });

    // The same user id, carried through. Every membership is keyed by it, so this one
    // line is the whole reason the upgrade screen exists.
    return this._issue(current.userId, 'REGISTERED', email, current.username);
  }

  async verifyEmail(token: string): Promise<VerifiedEmail> {
    if (token !== 'good-token') {
      // Expired, consumed and unknown are one error on the real service too, because
      // it cannot tell them apart either.
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: 'memory',
      });
    }

    return { userId: this._tokens.tokens()?.userId ?? 'u-1' };
  }

  async resendVerification(): Promise<ResendOutcome> {
    this._resendCount += 1;

    // Three per ten minutes, matching `THROTTLE_LIMITS.verifyResend`, so the refused
    // state is reachable and arrives with a wait far longer than a minute.
    return this._resendCount > 3
      ? { state: 'refused', waitSeconds: REFUSED_WAIT_SECONDS }
      : { state: 'sent', waitSeconds: SENT_WAIT_SECONDS };
  }

  private _issue(
    userId: string,
    kind: UserKind,
    email: string,
    username?: string
  ): SessionTokens {
    const tokens: SessionTokens = {
      userId,
      kind,
      username: username ?? nameFrom(email),
      accessToken: fakeAccessToken(userId),
      refreshToken: `refresh-${userId}-${Date.now()}`,
    };

    this._tokens.set(tokens);
    return tokens;
  }
}

function normalize(email: string): string {
  return email.trim().toLocaleLowerCase();
}

/** A readable stand-in for the username the backend would have generated. */
function nameFrom(email: string): string {
  return normalize(email).split('@')[0] ?? 'someone';
}

/**
 * A JWT shaped string with a real, unexpired `exp`.
 *
 * `TokenStore` decodes the expiry itself, so a plain opaque string here would be read
 * as already lapsed and every request would try to refresh it.
 */
function fakeAccessToken(userId: string): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'none' })}.${encode({ exp, sub: userId })}.memory`;
}

function conflict(): GatewayError {
  return new GatewayError({
    code: 'conflict',
    status: 409,
    correlationId: 'memory',
  });
}

function unauthorized(): GatewayError {
  return new GatewayError({
    code: 'unauthorized',
    status: 401,
    correlationId: 'memory',
  });
}
