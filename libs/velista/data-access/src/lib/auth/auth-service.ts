import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { SessionTokens } from '@portfolio/velista/models';
import { AuthApi } from './auth-api';

/**
 * What a caller can do with credentials.
 *
 * Every method returns a promise, for the same reason `ZoneServiceI`'s do: these are
 * one-shot requests and nothing about them streams.
 *
 * **Three of these five put a token pair in `TokenStore` as their last act.** That is
 * part of the contract rather than an implementation detail, because "the app is
 * signed in afterwards" is the whole point of calling them, and a page that had to
 * remember to persist the pair itself is a page that can forget.
 */
export interface AuthServiceI {
  /**
   * Make a new account.
   *
   * **Never call this for a guest** (rule C2, plan 0009 section 5.3). It creates a
   * *new* user row, so the caller's existing memberships stay on the account whose
   * only credential was the token this call is about to replace. `guestOnlyGuard` and
   * `anonymousOnlyGuard` are what enforce that at the route, which is where it can be
   * tested.
   */
  register(email: string, password: string): Promise<SessionTokens>;

  /** Sign in. One rejection for a wrong password and for an unknown email alike. */
  login(email: string, password: string): Promise<SessionTokens>;

  /**
   * Attach an email and a password to the account already on this phone.
   *
   * Returns tokens for **the same `userId`**, which is the property the whole flow
   * exists for: memberships are keyed by it, so every group survives.
   */
  upgrade(email: string, password: string): Promise<SessionTokens>;

  /** Consume a confirmation link. Answers whose account it confirmed. */
  verifyEmail(token: string): Promise<VerifiedEmail>;

  /**
   * Ask for another confirmation email.
   *
   * Bearer authenticated, because the server takes the address off the caller's
   * account rather than from a body: there is nothing here for an anonymous visitor
   * to send. See {@link VERIFY_RESEND_AVAILABLE} for why nothing calls this yet.
   */
  resendVerification(): Promise<ResendOutcome>;

  /**
   * Ask for a password reset link (`POST /v1/auth/forgot-password`, one per minute).
   *
   * **Unauthenticated and deliberately incurious.** The answer is identical for an
   * address with a password, one with no account at all, and one that signs in with
   * Google, so a caller cannot use it to learn which addresses are registered. The copy
   * above it has to match that: "if that address has a password, a link is on its way",
   * and never a claim of delivery (plan 0015, section 5.6).
   *
   * The address is a parameter rather than being taken from the session because the
   * route has no session to take it from. The account screen passes the profile's own
   * email, which is the only place in the app that calls this today.
   *
   * Answers a {@link ResendOutcome} for the same reason the resend does: a refusal is an
   * ordinary outcome the screen has copy and a wait for, not a failure to report as
   * one, and both states carry the server's own number rather than a hardcoded sixty
   * (rule C3, and rule A4).
   *
   * **Spending the link signs every other device out.** `resetPassword` revokes every
   * live refresh token and then issues a fresh pair to whoever spent it, so the person
   * changing their password stays signed in where they did it. The row says so before
   * it is pressed.
   */
  forgotPassword(email: string): Promise<ResendOutcome>;
}

/** What `POST /v1/auth/verify-email` answers. Deliberately not the token pair. */
export interface VerifiedEmail {
  readonly userId: string;
}

/**
 * How an ask for another confirmation email ended.
 *
 * `refused` is not folded into a thrown error, because it is an ordinary outcome the
 * screen has copy for and a wait to render, and because the two states differ only in
 * their sentence. Both carry the server's own number.
 *
 * `waitSeconds` is nullable in both, and rule C3 is why: the client renders whatever
 * wait it was told about and **never a hardcoded sixty**. The resend bucket is three
 * per ten minutes, so the fourth ask in a window waits far longer than a minute; a
 * countdown from an invented number would reach zero, invite the tap, and fail again.
 * A `null` means the server named no wait, and the sentence falls back to copy that
 * promises no particular moment.
 */
export type ResendOutcome =
  | { readonly state: 'sent'; readonly waitSeconds: number | null }
  | { readonly state: 'refused'; readonly waitSeconds: number | null }
  | { readonly state: 'failed'; readonly error: unknown };

/**
 * Whether the gateway serves the resend endpoint yet.
 *
 * Plan 0009 section 5.8 lists two backend changes it is written against, and this is
 * the first of them. Until it lands the resend sentence is **not rendered anywhere**:
 * not in the dashboard nudge, not on the expired link screen, and not on the account
 * screen's unconfirmed email row. Everything else on those screens works, which is what
 * makes this a flag rather than a blocker.
 *
 * The path this guards was wrong until plan 0015 went looking for it: the client asked
 * for `/v1/auth/verify-resend` and the gateway has always served
 * `/v1/auth/resend-verification`, so flipping the flag would have produced a 404 on a
 * route that exists. Corrected in `AuthApi`; the flag itself is 0009's to turn.
 *
 * A constant rather than a runtime probe on purpose. There is nothing to discover at
 * runtime that is not already known at build time, and a probe would spend a request
 * per page load learning something a one line edit says better. Flipping it to `true`
 * is the whole of the frontend work when the endpoint ships.
 */
export const VERIFY_RESEND_AVAILABLE = false;

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * **The default is the real gateway**, matching `ZONE_SERVICE` and reversing the
 * workspace convention for the reason recorded there: a wrong default that quietly
 * works is worse than one that fails loudly. Anything that wants the fake asks for it
 * by name with `{ provide: AUTH_SERVICE, useExisting: AuthMemory }`.
 */
export const AUTH_SERVICE = serviceToken<AuthServiceI>('AUTH_SERVICE', () =>
  inject(AuthApi)
);
