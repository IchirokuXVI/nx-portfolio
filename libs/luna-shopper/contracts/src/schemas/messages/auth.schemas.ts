import {
  AUTH_PATTERNS,
  AUTH_USERNAMES_MAX,
} from '../../lib/messages/auth.messages';
import {
  array,
  boolean,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { COMMON_IDS } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';

/**
 * JSON Schemas for the auth request/reply subjects (plan 0005). Request schemas
 * are strict (no extra properties) so a polyglot caller cannot smuggle an
 * unexpected field; the `AuthTokens` reply is the single shape most flows return.
 */
export const AUTH_SCHEMA_IDS = {
  authTokens: schemaId('auth/AuthTokens'),
  accessTokenClaims: schemaId('auth/AccessTokenClaims'),
  googleProfile: schemaId('auth/GoogleProfile'),
  createTemporaryUserRequest: schemaId('msg/auth.createTemporaryUser/request'),
  registerRequest: schemaId('msg/auth.register/request'),
  loginRequest: schemaId('msg/auth.login/request'),
  verifyEmailRequest: schemaId('msg/auth.verifyEmail/request'),
  resendVerificationRequest: schemaId('msg/auth.resendVerification/request'),
  retryAfterResult: schemaId('auth/RetryAfterResult'),
  forgotPasswordRequest: schemaId('msg/auth.forgotPassword/request'),
  resetPasswordRequest: schemaId('msg/auth.resetPassword/request'),
  // A reset grant spent as a sign in (plan 0210, target state 5).
  recoverySignInRequest: schemaId('msg/auth.recoverySignIn/request'),
  recoverySignInResult: schemaId('auth/RecoverySignInResult'),
  refreshRequest: schemaId('msg/auth.refresh/request'),
  upgradeRequest: schemaId('msg/auth.upgrade/request'),
  oAuthStatePayload: schemaId('auth/OAuthStatePayload'),
  mintOAuthStateResult: schemaId('auth/MintOAuthStateResult'),
  // The callback stages and the app exchanges (plan 0230).
  stageGoogleSignInRequest: schemaId('msg/auth.stageGoogleSignIn/request'),
  stageGoogleSignInResult: schemaId('auth/StageGoogleSignInResult'),
  exchangeGoogleSignInRequest: schemaId(
    'msg/auth.exchangeGoogleSignIn/request'
  ),
  // The basket scoped socket token (plan 0051, section 9): the one token auth
  // signs that names no user.
  mintParticipantTokenRequest: schemaId('auth/MintParticipantTokenRequest'),
  mintParticipantTokenResult: schemaId('auth/MintParticipantTokenResult'),
  consumeOAuthStateRequest: schemaId('msg/auth.consumeOAuthState/request'),
  setUsernameRequest: schemaId('msg/auth.setUsername/request'),
  getProfileRequest: schemaId('msg/auth.getProfile/request'),
  userProfileView: schemaId('auth/UserProfileView'),
  // A fresh generated name, for the setup's first step (plan 0145, section 4).
  suggestUsernameRequest: schemaId('msg/auth.suggestUsername/request'),
  suggestUsernameResult: schemaId('auth/SuggestUsernameResult'),
  // Several accounts' global usernames at once (plan 0114, section 9).
  getUsernamesRequest: schemaId('msg/auth.getUsernames/request'),
  userUsernameView: schemaId('auth/UserUsernameView'),
  getUsernamesResult: schemaId('msg/auth.getUsernames/response'),
  // The Terms accepted from the prompt (plan 0231, section 4.4).
  acceptTermsRequest: schemaId('msg/auth.acceptTerms/request'),
  termsAcceptanceView: schemaId('auth/TermsAcceptanceView'),
} as const;

/**
 * The Terms version a client drew beside the action that creates an account
 * (plan 0231, section 4.2). Bounded rather than patterned: the version is
 * compared for equality by auth, and a regex here would only be sampled.
 */
export const ACCEPTED_TERMS_VERSION_MAX_LENGTH = 64;
const termsVersion = () =>
  nonEmptyString({ maxLength: ACCEPTED_TERMS_VERSION_MAX_LENGTH });

const authTokens = object(
  AUTH_SCHEMA_IDS.authTokens,
  {
    userId: nonEmptyString(),
    kind: ref(ENUM_IDS.userKind),
    username: nonEmptyString(),
    accessToken: nonEmptyString(),
    refreshToken: nonEmptyString(),
  },
  ['userId', 'kind', 'username', 'accessToken', 'refreshToken']
);

const accessTokenClaims = object(
  AUTH_SCHEMA_IDS.accessTokenClaims,
  {
    sub: nonEmptyString(),
    kind: ref(ENUM_IDS.userKind),
    // Optional: a token signed before plan 0175 carries none (see the type).
    perms: array(ref(ENUM_IDS.permission)),
    // Optional: only a token of a support session carries it (plan 0194).
    act: {
      type: 'object',
      properties: {
        sub: nonEmptyString(),
        sid: nonEmptyString(),
        until: integer(),
      },
      required: ['sub', 'sid', 'until'],
      additionalProperties: false,
    },
    iat: integer(),
    exp: integer(),
  },
  ['sub', 'kind']
);

const googleProfile = object(
  AUTH_SCHEMA_IDS.googleProfile,
  {
    providerUserId: nonEmptyString(),
    email: string({ format: 'email' }),
    displayName: string(),
  },
  ['providerUserId']
);

const createTemporaryUserRequest = object(
  AUTH_SCHEMA_IDS.createTemporaryUserRequest,
  { acceptedTermsVersion: termsVersion() },
  []
);

const registerRequest = object(
  AUTH_SCHEMA_IDS.registerRequest,
  {
    email: string({ format: 'email' }),
    password: nonEmptyString(),
    displayName: string(),
    locale: string(),
    acceptedTermsVersion: termsVersion(),
  },
  ['email', 'password']
);

const loginRequest = object(
  AUTH_SCHEMA_IDS.loginRequest,
  { email: string({ format: 'email' }), password: nonEmptyString() },
  ['email', 'password']
);

const verifyEmailRequest = object(
  AUTH_SCHEMA_IDS.verifyEmailRequest,
  { token: nonEmptyString() },
  ['token']
);

const resendVerificationRequest = object(
  AUTH_SCHEMA_IDS.resendVerificationRequest,
  { userId: nonEmptyString(), locale: string() },
  ['userId']
);

const retryAfterResult = {
  ...object(
    AUTH_SCHEMA_IDS.retryAfterResult,
    {
      retryAfterSeconds: integer({
        minimum: 0,
        description:
          'Whole seconds before another request of this kind is accepted.',
      }),
    },
    ['retryAfterSeconds']
  ),
  // Carried into the published OpenAPI document (plan 0019, section 4), where a
  // client author reads it beside the field. The warning is the point: the same
  // field arrives on the 429 too, and the limits are enforced per gateway pod, so
  // a fixed countdown would be wrong in both directions.
  description:
    'The request was accepted. `retryAfterSeconds` is how long before another is accepted; a refusal returns the same field on the error envelope with what is actually left. Count down the number you were given rather than assuming a fixed wait.',
};

const forgotPasswordRequest = object(
  AUTH_SCHEMA_IDS.forgotPasswordRequest,
  { email: string({ format: 'email' }), locale: string() },
  ['email']
);

const resetPasswordRequest = object(
  AUTH_SCHEMA_IDS.resetPasswordRequest,
  { token: nonEmptyString(), password: nonEmptyString() },
  ['token', 'password']
);

const recoverySignInRequest = object(
  AUTH_SCHEMA_IDS.recoverySignInRequest,
  {
    token: nonEmptyString(),
    switchAccount: boolean(),
    callerUserId: nonEmptyString(),
    supportSession: boolean(),
  },
  ['token']
);

/**
 * The two answers of a sign in with a reset grant (plan 0210, target state 5),
 * as a `oneOf` on `outcome`. Only `SIGNED_IN` carries a pair: the other answer
 * means the caller already holds a session of that account and keeps it.
 *
 * `enum` with one value rather than `const`, which the wire types generator
 * reads as a value to export.
 */
const recoverySignInResult: JsonSchema = {
  $id: AUTH_SCHEMA_IDS.recoverySignInResult,
  description:
    'What the sign in did. `SIGNED_IN` carries the new token pair. `ALREADY_SIGNED_IN` carries none: the bearer already belongs to the account of the link, its session stays as it is, and the link no longer works.',
  oneOf: [
    {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['SIGNED_IN'] },
        tokens: ref(AUTH_SCHEMA_IDS.authTokens),
      },
      required: ['outcome', 'tokens'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['ALREADY_SIGNED_IN'] },
      },
      required: ['outcome'],
      additionalProperties: false,
    },
  ],
};

const refreshRequest = object(
  AUTH_SCHEMA_IDS.refreshRequest,
  { refreshToken: nonEmptyString() },
  ['refreshToken']
);

const upgradeRequest = object(
  AUTH_SCHEMA_IDS.upgradeRequest,
  {
    userId: nonEmptyString(),
    email: string({ format: 'email' }),
    password: string(),
    displayName: string(),
    google: ref(AUTH_SCHEMA_IDS.googleProfile),
    locale: string(),
    acceptedTermsVersion: termsVersion(),
  },
  ['userId']
);

/**
 * A PKCE challenge or verifier (plan 0230, section 2). Its exact shape, 43
 * base64url characters, is checked by the gateway DTO and again by auth, so the
 * schema states only that it is present.
 */
const pkceValue = () => nonEmptyString();

/**
 * What a state carries, and the mint request that fills it (plan 0023, section
 * 4.1). One schema for both: the request is the payload, and writing it twice
 * would let the two drift into disagreeing about what a state may hold.
 *
 * Only the challenge is required (plan 0230, section 2). A state with no
 * `userId` is the genuine sign in from scratch, not a malformed one.
 */
const oAuthStatePayload = object(
  AUTH_SCHEMA_IDS.oAuthStatePayload,
  {
    userId: string(),
    locale: string(),
    codeChallenge: pkceValue(),
    acceptedTermsVersion: termsVersion(),
  },
  ['codeChallenge']
);

const stageGoogleSignInRequest = object(
  AUTH_SCHEMA_IDS.stageGoogleSignInRequest,
  {
    providerUserId: nonEmptyString(),
    email: string({ format: 'email' }),
    displayName: string(),
    linkUserId: string(),
    codeChallenge: pkceValue(),
    locale: string(),
    acceptedTermsVersion: termsVersion(),
  },
  ['providerUserId', 'codeChallenge']
);

const stageGoogleSignInResult = object(
  AUTH_SCHEMA_IDS.stageGoogleSignInResult,
  { code: nonEmptyString() },
  ['code']
);

const exchangeGoogleSignInRequest = object(
  AUTH_SCHEMA_IDS.exchangeGoogleSignInRequest,
  {
    code: nonEmptyString(),
    codeVerifier: pkceValue(),
    callerUserId: string(),
  },
  ['code', 'codeVerifier']
);

const mintOAuthStateResult = object(
  AUTH_SCHEMA_IDS.mintOAuthStateResult,
  { state: nonEmptyString() },
  ['state']
);

const consumeOAuthStateRequest = object(
  AUTH_SCHEMA_IDS.consumeOAuthStateRequest,
  { state: nonEmptyString() },
  ['state']
);

const mintParticipantTokenRequest = object(
  AUTH_SCHEMA_IDS.mintParticipantTokenRequest,
  {
    participantId: nonEmptyString(),
    basketId: nonEmptyString(),
    kind: nonEmptyString(),
  },
  ['participantId', 'basketId', 'kind']
);

const mintParticipantTokenResult = object(
  AUTH_SCHEMA_IDS.mintParticipantTokenResult,
  { socketToken: nonEmptyString(), socketTokenExpiresAt: nonEmptyString() },
  ['socketToken', 'socketTokenExpiresAt']
);

const setUsernameRequest = object(
  AUTH_SCHEMA_IDS.setUsernameRequest,
  {
    userId: nonEmptyString(),
    username: nonEmptyString(),
    propagation: ref(ENUM_IDS.usernamePropagation),
  },
  ['userId', 'username']
);

const getProfileRequest = object(
  AUTH_SCHEMA_IDS.getProfileRequest,
  { userId: nonEmptyString() },
  ['userId']
);

/**
 * The profile's fields, apart from the schema that publishes them, so that the
 * view the gateway composes on top of it (plan 0145, section 2) is built from
 * this map rather than from a second copy of these lines. Two copies would
 * be two things to keep in step, and the one that drifts is the documented one.
 */
export const USER_PROFILE_VIEW_PROPERTIES: Record<string, JsonSchema> = {
  userId: nonEmptyString(),
  kind: ref(ENUM_IDS.userKind),
  username: nonEmptyString(),
  email: nullableString(),
  emailVerified: boolean(),
  displayName: nullableString(),
  // The newest accepted Terms version and when (plan 0231, section 4.4).
  termsAcceptedVersion: nullableString(),
  termsAcceptedAt: nullableString(),
};

/** The names of {@link USER_PROFILE_VIEW_PROPERTIES}, every one of them required. */
export const USER_PROFILE_VIEW_REQUIRED: string[] = Object.keys(
  USER_PROFILE_VIEW_PROPERTIES
);

const userProfileView = object(
  AUTH_SCHEMA_IDS.userProfileView,
  USER_PROFILE_VIEW_PROPERTIES,
  USER_PROFILE_VIEW_REQUIRED
);

// No `userId`: the caller is asking for a name, not asking about themselves,
// and the handler writes nothing anywhere. The locale is the only input, and it
// falls back to the request context when it is absent.
const suggestUsernameRequest = object(
  AUTH_SCHEMA_IDS.suggestUsernameRequest,
  { locale: nonEmptyString() },
  []
);

const suggestUsernameResult = object(
  AUTH_SCHEMA_IDS.suggestUsernameResult,
  { username: nonEmptyString() },
  ['username']
);

const getUsernamesRequest = object(
  AUTH_SCHEMA_IDS.getUsernamesRequest,
  {
    userIds: { ...array(nonEmptyString()), maxItems: AUTH_USERNAMES_MAX },
  },
  ['userIds']
);

const userUsernameView = object(
  AUTH_SCHEMA_IDS.userUsernameView,
  { userId: nonEmptyString(), username: nonEmptyString() },
  ['userId', 'username']
);

// A bare array, as plan 0114 section 9 states the answer. An id auth does not
// know is left out rather than answered with a blank name.
const getUsernamesResult: JsonSchema = {
  $id: AUTH_SCHEMA_IDS.getUsernamesResult,
  ...array(ref(AUTH_SCHEMA_IDS.userUsernameView)),
};

const acceptTermsRequest = object(
  AUTH_SCHEMA_IDS.acceptTermsRequest,
  { userId: nonEmptyString(), version: termsVersion() },
  ['userId', 'version']
);

const termsAcceptanceView = object(
  AUTH_SCHEMA_IDS.termsAcceptanceView,
  { version: nonEmptyString(), acceptedAt: nonEmptyString() },
  ['version', 'acceptedAt']
);

export const authSchemas: JsonSchema[] = [
  authTokens,
  accessTokenClaims,
  googleProfile,
  createTemporaryUserRequest,
  registerRequest,
  loginRequest,
  verifyEmailRequest,
  resendVerificationRequest,
  retryAfterResult,
  forgotPasswordRequest,
  resetPasswordRequest,
  recoverySignInRequest,
  recoverySignInResult,
  refreshRequest,
  upgradeRequest,
  oAuthStatePayload,
  mintOAuthStateResult,
  consumeOAuthStateRequest,
  stageGoogleSignInRequest,
  stageGoogleSignInResult,
  exchangeGoogleSignInRequest,
  mintParticipantTokenRequest,
  mintParticipantTokenResult,
  setUsernameRequest,
  getProfileRequest,
  userProfileView,
  suggestUsernameRequest,
  suggestUsernameResult,
  getUsernamesRequest,
  userUsernameView,
  getUsernamesResult,
  acceptTermsRequest,
  termsAcceptanceView,
];

export const authMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [AUTH_PATTERNS.createTemporaryUser]: {
    request: AUTH_SCHEMA_IDS.createTemporaryUserRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.register]: {
    request: AUTH_SCHEMA_IDS.registerRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.login]: {
    request: AUTH_SCHEMA_IDS.loginRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.verifyEmail]: {
    request: AUTH_SCHEMA_IDS.verifyEmailRequest,
    response: COMMON_IDS.userIdResult,
  },
  [AUTH_PATTERNS.resendVerification]: {
    request: AUTH_SCHEMA_IDS.resendVerificationRequest,
    response: AUTH_SCHEMA_IDS.retryAfterResult,
  },
  [AUTH_PATTERNS.forgotPassword]: {
    request: AUTH_SCHEMA_IDS.forgotPasswordRequest,
    // The same shape the resend answers with, and the same number: a request for
    // an address with no account sends nothing and still waits, because a shorter
    // wait would answer the question section 2.1 refuses to answer.
    response: AUTH_SCHEMA_IDS.retryAfterResult,
  },
  [AUTH_PATTERNS.resetPassword]: {
    request: AUTH_SCHEMA_IDS.resetPasswordRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.recoverySignIn]: {
    request: AUTH_SCHEMA_IDS.recoverySignInRequest,
    response: AUTH_SCHEMA_IDS.recoverySignInResult,
  },
  [AUTH_PATTERNS.refresh]: {
    request: AUTH_SCHEMA_IDS.refreshRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.upgrade]: {
    request: AUTH_SCHEMA_IDS.upgradeRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.mintOAuthState]: {
    // The payload is the request: what the gateway asks to have stored is
    // exactly what the callback reads back out.
    request: AUTH_SCHEMA_IDS.oAuthStatePayload,
    response: AUTH_SCHEMA_IDS.mintOAuthStateResult,
  },
  [AUTH_PATTERNS.consumeOAuthState]: {
    request: AUTH_SCHEMA_IDS.consumeOAuthStateRequest,
    response: AUTH_SCHEMA_IDS.oAuthStatePayload,
  },
  [AUTH_PATTERNS.stageGoogleSignIn]: {
    request: AUTH_SCHEMA_IDS.stageGoogleSignInRequest,
    response: AUTH_SCHEMA_IDS.stageGoogleSignInResult,
  },
  [AUTH_PATTERNS.exchangeGoogleSignIn]: {
    request: AUTH_SCHEMA_IDS.exchangeGoogleSignInRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.setUsername]: {
    request: AUTH_SCHEMA_IDS.setUsernameRequest,
    response: AUTH_SCHEMA_IDS.userProfileView,
  },
  [AUTH_PATTERNS.getProfile]: {
    request: AUTH_SCHEMA_IDS.getProfileRequest,
    response: AUTH_SCHEMA_IDS.userProfileView,
  },
  [AUTH_PATTERNS.suggestUsername]: {
    request: AUTH_SCHEMA_IDS.suggestUsernameRequest,
    response: AUTH_SCHEMA_IDS.suggestUsernameResult,
  },
  [AUTH_PATTERNS.getUsernames]: {
    request: AUTH_SCHEMA_IDS.getUsernamesRequest,
    response: AUTH_SCHEMA_IDS.getUsernamesResult,
  },
  [AUTH_PATTERNS.mintParticipantToken]: {
    request: AUTH_SCHEMA_IDS.mintParticipantTokenRequest,
    response: AUTH_SCHEMA_IDS.mintParticipantTokenResult,
  },
  [AUTH_PATTERNS.acceptTerms]: {
    request: AUTH_SCHEMA_IDS.acceptTermsRequest,
    response: AUTH_SCHEMA_IDS.termsAcceptanceView,
  },
};
