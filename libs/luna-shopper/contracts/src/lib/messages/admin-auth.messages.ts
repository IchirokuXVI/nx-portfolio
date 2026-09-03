/**
 * Platform operator identity (plan 0071).
 *
 * A separate namespace from `AUTH_PATTERNS`, and separate on purpose. An
 * admin is not a user: the rows live in their own table, the token is signed with
 * its own keypair, and none of the user facing flows (registration, verification,
 * reset, OAuth, the orphan reaper) can reach an admin credential. Sharing the
 * `auth.*` prefix would put the two a typo apart on the broker, which is the one
 * mistake this design spends a second table and a second key to make
 * unrepresentable.
 *
 * There is no create, update or delete subject, and there never will be: an admin
 * is created by somebody with the server, using the commands in section 6 of the
 * plan. The bus can authenticate an operator and read one back; it cannot mint
 * one.
 */
export const ADMIN_AUTH_PATTERNS = {
  /** Username + password, answering with a signed admin token. */
  login: 'adminAuth.login',
  /** Present a live token, receive a fresh one. No refresh token exists. */
  refresh: 'adminAuth.refresh',
  /** Read one admin by id, for `GET /v1/admin/auth/me`. */
  getAdmin: 'adminAuth.getAdmin',
  /**
   * Mint a token for a named admin with no password (plan 0071, section 8).
   *
   * Guarded twice over: the gateway only sends it when `ADMIN_DEV_AUTOLOGIN` is
   * on, and auth refuses to boot at all with that variable on and a non local
   * host, so a production deployment cannot answer this subject because it cannot
   * start.
   */
  devAutologin: 'adminAuth.devAutologin',
} as const;

export type AdminAuthPattern =
  (typeof ADMIN_AUTH_PATTERNS)[keyof typeof ADMIN_AUTH_PATTERNS];

/** The audience every admin token carries, and no other token does. */
export const ADMIN_TOKEN_AUDIENCE = 'platform-admin';

/**
 * The claims inside a signed admin token (plan 0071, section 4).
 *
 * No `kind`: `UserKind` describes velista users and an admin is not one, so
 * a claim naming one would be a value that is always wrong. `aud` is checked by
 * the guard rather than assumed, even though the signing key already separates
 * the two principals, because a future key consolidation would otherwise remove
 * the only check silently.
 */
export interface AdminTokenClaims {
  /** `admin_users.id`, and the actor id the audit trail records. */
  sub: string;
  aud: typeof ADMIN_TOKEN_AUDIENCE;
  iat?: number;
  exp?: number;
}

/**
 * What a successful admin login or refresh answers with (plan 0071, section 4).
 *
 * Deliberately not `AuthTokens`, whose shape is wrong in three of its five
 * fields here: there is no `userId`, no `kind` and no `refreshToken`. Widening
 * that interface would make the user facing contract carry admin concepts for the
 * benefit of one caller.
 *
 * `expiresAt` is stated rather than left to be read out of the token, so the app
 * can time its own renewal (`apps/luna-shopper-admin/plans/0003`) without
 * decoding a JWT it is not otherwise required to understand.
 */
export interface AdminAuthTokens {
  adminId: string;
  username: string;
  displayName: string | null;
  accessToken: string;
  /** ISO 8601. When the token stops being accepted. */
  expiresAt: string;
}

export interface AdminLoginRequest {
  username: string;
  password: string;
  /**
   * The caller's address, as the gateway resolved it, recorded against a failed
   * attempt and counted toward the lockout in section 7. Absent when the gateway
   * could not determine one, which is a value the record keeps rather than a
   * reason to refuse the login.
   */
  ip?: string;
  /** Recorded against a failed attempt. Untrusted, and never parsed. */
  userAgent?: string;
}

/**
 * Renew a live token (plan 0071, section 4). The gateway has already verified
 * the presented token, so this carries only who it named: auth re-reads the row
 * and refuses a disabled admin, which is what makes disabling take effect within
 * one token lifetime rather than never.
 */
export interface AdminRefreshRequest {
  adminId: string;
}

/** Read one admin back by id. */
export interface GetAdminRequest {
  adminId: string;
}

/** Mint a development token for a named admin (plan 0071, section 8). */
export interface AdminDevAutologinRequest {
  username: string;
}

/**
 * An operator, as the back office renders them. No password hash, ever: the
 * field exists on the row and on nothing that leaves auth.
 */
export interface AdminIdentityView {
  adminId: string;
  username: string;
  displayName: string | null;
  /** ISO 8601, or null while the account has never been used. */
  lastLoginAt: string | null;
  /** ISO 8601, or null for an account that may still log in. */
  disabledAt: string | null;
}

/**
 * What `GET /v1/admin/auth/me` answers with: who is signed in, and which
 * deployment they are signed in to.
 *
 * Composed by the gateway rather than answered by auth, because the two halves
 * have different owners: auth knows the operator and only the gateway knows what
 * environment it is. The environment name is here rather than in a build time
 * constant because the failure being guarded against is believing you are in
 * staging when you are in production (`apps/luna-shopper-admin/plans/0001`,
 * section 6), and a compile time value is exactly what is wrong in that
 * scenario, whether from a stale cache, a mis tagged image or a bundle served
 * from the wrong host.
 */
export interface AdminMeView {
  admin: AdminIdentityView;
  /** 'development', 'staging' or 'production', as the server reports itself. */
  environment: string;
}
