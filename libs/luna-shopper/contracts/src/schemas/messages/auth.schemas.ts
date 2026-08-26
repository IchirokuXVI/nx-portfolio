import { AUTH_PATTERNS } from '../../lib/messages/auth.messages';
import {
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
  resendVerificationResult: schemaId('auth/ResendVerificationResult'),
  refreshRequest: schemaId('msg/auth.refresh/request'),
  upgradeRequest: schemaId('msg/auth.upgrade/request'),
  googleLoginRequest: schemaId('msg/auth.googleLogin/request'),
  setUsernameRequest: schemaId('msg/auth.setUsername/request'),
  getProfileRequest: schemaId('msg/auth.getProfile/request'),
  userProfileView: schemaId('auth/UserProfileView'),
} as const;

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
  {},
  []
);

const registerRequest = object(
  AUTH_SCHEMA_IDS.registerRequest,
  {
    email: string({ format: 'email' }),
    password: nonEmptyString(),
    displayName: string(),
    locale: string(),
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

const resendVerificationResult = {
  ...object(
    AUTH_SCHEMA_IDS.resendVerificationResult,
    {
      retryAfterSeconds: integer({
        minimum: 0,
        description: 'Whole seconds before another resend is accepted.',
      }),
    },
    ['retryAfterSeconds']
  ),
  // Carried into the published OpenAPI document (plan 0019, section 4), where a
  // client author reads it beside the field. The warning is the point: the same
  // field arrives on the 429 too, and the limits are enforced per gateway pod, so
  // a fixed countdown would be wrong in both directions.
  description:
    'A resend was sent. `retryAfterSeconds` is how long before another is accepted; a refusal returns the same field on the error envelope with what is actually left. Count down the number you were given rather than assuming a fixed wait.',
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
  },
  ['userId']
);

const googleLoginRequest = object(
  AUTH_SCHEMA_IDS.googleLoginRequest,
  {
    providerUserId: nonEmptyString(),
    email: string({ format: 'email' }),
    displayName: string(),
    linkUserId: string(),
  },
  ['providerUserId']
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

const userProfileView = object(
  AUTH_SCHEMA_IDS.userProfileView,
  {
    userId: nonEmptyString(),
    kind: ref(ENUM_IDS.userKind),
    username: nonEmptyString(),
    email: nullableString(),
    emailVerified: boolean(),
    displayName: nullableString(),
  },
  ['userId', 'kind', 'username', 'email', 'emailVerified', 'displayName']
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
  resendVerificationResult,
  refreshRequest,
  upgradeRequest,
  googleLoginRequest,
  setUsernameRequest,
  getProfileRequest,
  userProfileView,
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
    response: AUTH_SCHEMA_IDS.resendVerificationResult,
  },
  [AUTH_PATTERNS.refresh]: {
    request: AUTH_SCHEMA_IDS.refreshRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.upgrade]: {
    request: AUTH_SCHEMA_IDS.upgradeRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [AUTH_PATTERNS.googleLogin]: {
    request: AUTH_SCHEMA_IDS.googleLoginRequest,
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
};
