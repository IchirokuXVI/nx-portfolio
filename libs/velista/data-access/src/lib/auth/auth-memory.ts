import { inject, Injectable } from '@angular/core';
import type { SessionTokens, UserKind } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type {
  AuthServiceI,
  RecoveryOutcome,
  ResendOutcome,
  ResetPasswordOutcome,
  VerifiedEmail,
} from './auth-service';
import { TokenStore } from './token-store';

/** An account this fake knows about, and the one thing it checks. */
interface StoredAccount {
  readonly userId: string;
  readonly password: string;
}

/** The wait a refused resend reports. Under a minute, because that bucket is per minute. */
const REFUSED_WAIT_SECONDS = 43;

/** The wait a successful resend reports, matching the mock's `0:52`. */
const SENT_WAIT_SECONDS = 52;

/** The one address that is already taken, so a `conflict` is reachable on demand. */
const TAKEN_EMAIL = 'taken@example.com';

/** The wait a refused reset reports. Under a minute, because that bucket is per minute. */
const RESET_REFUSED_WAIT_SECONDS = 47;

/** The wait a sent reset reports. */
const RESET_SENT_WAIT_SECONDS = 60;

/** The one reset link this fake knows, and whose it is. */
export const MEMORY_RESET_TOKEN = 'good-reset';

/** The rule the server holds a new password to. */
const PASSWORD_MIN_LENGTH = 8;

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

  /** Every address a reset was asked for, in order, so a spec can assert which one. */
  readonly forgotPasswordAsks: string[] = [];

  /**
   * Live reset links and the account each belongs to.
   *
   * One grant, two links, as on the server (backend `0210`): spending it either way
   * removes it, and the owner check survives the spend, which is what lets a second
   * visit by its owner still answer `already-signed-in`.
   */
  private readonly _resetGrants = new Map<string, string>([
    [MEMORY_RESET_TOKEN, 'u-taken'],
  ]);

  /** Whose each link was, spent or not. */
  private readonly _resetOwners = new Map<string, string>(this._resetGrants);

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

    // One per minute, matching `THROTTLE_LIMITS.verifyResend`, so the second ask in a
    // sitting is refused and the refused sentence is reachable.
    return this._resendCount > 1
      ? { state: 'refused', waitSeconds: REFUSED_WAIT_SECONDS }
      : { state: 'sent', waitSeconds: SENT_WAIT_SECONDS };
  }

  /**
   * A password reset link, in memory.
   *
   * **Incurious, exactly like the real one.** The address is not looked up, and an
   * unknown one gets the same answer as a registered one, because that is the whole
   * design of the endpoint (plan 0015, section 5.6) and a fake that answered
   * differently would let a screen grow copy the real service can never justify.
   *
   * One per minute, matching `THROTTLE_LIMITS.passwordReset`, so the second ask in a
   * sitting is refused and the refused sentence is reachable.
   */
  async forgotPassword(email: string): Promise<ResendOutcome> {
    this.forgotPasswordAsks.push(normalize(email));

    return this.forgotPasswordAsks.length > 1
      ? { state: 'refused', waitSeconds: RESET_REFUSED_WAIT_SECONDS }
      : { state: 'sent', waitSeconds: RESET_SENT_WAIT_SECONDS };
  }

  async resetPassword(
    token: string,
    password: string
  ): Promise<ResetPasswordOutcome> {
    if (password.length < PASSWORD_MIN_LENGTH) {
      return { state: 'password-rejected' };
    }

    const owner = this._resetGrants.get(token);
    if (owner === undefined) {
      return { state: 'link-dead' };
    }

    this._resetGrants.delete(token);
    for (const [email, account] of this._accounts) {
      if (account.userId === owner) {
        this._accounts.set(email, { userId: owner, password });
      }
    }

    return {
      state: 'signed-in',
      tokens: this._issue(owner, 'REGISTERED', `${owner}@example.com`),
    };
  }

  /**
   * The decision table of backend `0210`, section 5, in the same order: the owner
   * first, then a dead link, then another account without the switch.
   */
  async recoverySignIn(
    token: string,
    options: { readonly switchAccount?: boolean } = {}
  ): Promise<RecoveryOutcome> {
    const caller = this._tokens.tokens()?.userId ?? null;
    const owner = this._resetOwners.get(token);

    if (owner !== undefined && caller === owner) {
      this._resetGrants.delete(token);
      return { state: 'already-signed-in' };
    }

    if (!this._resetGrants.has(token) || owner === undefined) {
      return { state: 'link-dead' };
    }

    if (caller !== null && options.switchAccount !== true) {
      return { state: 'other-account' };
    }

    this._resetGrants.delete(token);
    return {
      state: 'signed-in',
      tokens: this._issue(owner, 'REGISTERED', `${owner}@example.com`),
    };
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
