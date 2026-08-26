import type { UserKind, UsernamePropagation } from '../enums/auth.enums';

/**
 * Auth service message contracts (plan 0005).
 *
 * The gateway talks to auth over NATS request/reply; these are the subject names
 * and the request/response payload shapes. Keeping them in `contracts` lets a
 * future polyglot service answer the same subjects. Subjects carry the service
 * prefix; a version token can be appended when a contract needs to evolve
 * (plan 0004, section 4).
 */
export const AUTH_PATTERNS = {
  /** Mint a throwaway identity when a client first creates or joins a zone. */
  createTemporaryUser: 'auth.createTemporaryUser',
  /** Email + password registration. */
  register: 'auth.register',
  /** Email + password login. */
  login: 'auth.login',
  /** Consume an email verification token. */
  verifyEmail: 'auth.verifyEmail',
  /** Send a fresh confirmation link to the caller's unconfirmed address. */
  resendVerification: 'auth.resendVerification',
  /** Exchange a refresh token for a fresh token pair (rotates). */
  refresh: 'auth.refresh',
  /** Upgrade a temporary user into a registered one, in place. */
  upgrade: 'auth.upgrade',
  /** Create or link an account from a verified Google profile. */
  googleLogin: 'auth.googleLogin',
  /** Delete the authenticated user's account and all personal identity data. */
  deleteAccount: 'auth.deleteAccount',
  /** Change the caller's global username, optionally propagating to zones. */
  setUsername: 'auth.setUsername',
  /** Read the caller's own profile (plan 0018, section 12). */
  getProfile: 'auth.getProfile',
} as const;

export type AuthPattern = (typeof AUTH_PATTERNS)[keyof typeof AUTH_PATTERNS];

/** The claims carried inside the signed access token. */
export interface AccessTokenClaims {
  /** userId. */
  sub: string;
  kind: UserKind;
  iat?: number;
  exp?: number;
}

/** The token pair every successful auth flow returns. */
export interface AuthTokens {
  userId: string;
  kind: UserKind;
  /**
   * The caller's global username at the time this pair was issued (plan 0018,
   * section 9). Deliberately part of the response body and not of
   * {@link AccessTokenClaims}: a claim would be cached for the token's whole
   * lifetime and could seed a freshly joined zone with a name the user has
   * already changed.
   */
  username: string;
  accessToken: string;
  refreshToken: string;
}

/** No fields: a temporary identity is minted purely from the request context. */
export type CreateTemporaryUserRequest = Record<string, never>;

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
  /** Locale for the confirmation email; defaults to the request locale. */
  locale?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface VerifyEmailRequest {
  /** The raw token from the confirmation link (auth stores only its hash). */
  token: string;
}

/**
 * Resend the confirmation link (plan 0021, section 4). `userId` is set by the
 * gateway from the verified token, never from a body: resending needs to know
 * whose address to send to, and only a token says that.
 */
export interface ResendVerificationRequest {
  userId: string;
  /** Locale for the confirmation email; defaults to the request locale. */
  locale?: string;
}

/**
 * What a resend answers with, on the success path as well as on the 429 (plan
 * 0021, section 4.2). One field across all three states, so a client renders
 * "you can ask for another in 0:52" from the number it was given rather than
 * inventing a countdown of its own.
 */
export interface ResendVerificationResult {
  /** Whole seconds before another resend is accepted. */
  retryAfterSeconds: number;
}

export interface RefreshRequest {
  refreshToken: string;
}

/**
 * Upgrade a temporary user in place (plan 0005, section 4.5). `userId` is taken
 * from the caller's verified token by the gateway. Either an email + password or
 * a linked Google identity is supplied.
 */
export interface UpgradeRequest {
  userId: string;
  email?: string;
  password?: string;
  displayName?: string;
  google?: GoogleProfile;
  locale?: string;
}

/**
 * Delete the authenticated user's account (plan 0011, section 1). `userId` is set
 * by the gateway from the verified token, never the request body, so a caller can
 * only ever delete themselves.
 */
export interface DeleteAccountRequest {
  userId: string;
}

/** The outcome of a delete-account call. */
export interface DeleteAccountResult {
  userId: string;
  /**
   * True if this call performed the deletion; false if the user was already gone
   * (the operation is idempotent, so a repeat is a clean no-op).
   */
  deleted: boolean;
}

/**
 * Change the caller's global username (plan 0018, section 4.3). `userId` is set
 * by the gateway from the verified token, never from the body, so a caller can
 * only ever rename themselves.
 */
export interface SetUsernameRequest {
  userId: string;
  username: string;
  /** Defaults to GLOBAL_ONLY when omitted. */
  propagation?: UsernamePropagation;
}

/** Read the caller's own profile (plan 0018, section 12). */
export interface GetProfileRequest {
  userId: string;
}

/** The caller's own account, as `GET /v1/account/me` returns it. */
export interface UserProfileView {
  userId: string;
  kind: UserKind;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

/** A verified Google profile, resolved by the gateway's passport callback. */
export interface GoogleProfile {
  providerUserId: string;
  email?: string;
  displayName?: string;
}

/**
 * Google login (plan 0005, section 4.4). If `linkUserId` is set (the caller held
 * a temporary token), the Google identity is linked onto that user, upgrading it
 * in place; otherwise auth finds or creates a registered user.
 */
export interface GoogleLoginRequest extends GoogleProfile {
  linkUserId?: string;
}
