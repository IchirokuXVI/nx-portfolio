import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_TOKEN_AUDIENCE,
} from '../../lib/messages/admin-auth.messages';
import {
  array,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { adminCredentialProperties } from '../common.schemas';

/**
 * JSON Schemas for the operator identity subjects (plan 0071).
 *
 * Their own domain (`admin-auth/...`) rather than more entries under `auth/`, for
 * the same reason the subjects have their own prefix: the two principals are
 * separate, and a reader of the registry should not have to notice which of two
 * adjacent token shapes belongs to a person shopping and which belongs to an
 * operator with the whole database in front of them.
 */
export const ADMIN_AUTH_SCHEMA_IDS = {
  adminAuthTokens: schemaId('admin-auth/AdminAuthTokens'),
  adminTokenClaims: schemaId('admin-auth/AdminTokenClaims'),
  adminIdentityView: schemaId('admin-auth/AdminIdentityView'),
  adminIdentityListView: schemaId('admin-auth/AdminIdentityListView'),
  adminMeView: schemaId('admin-auth/AdminMeView'),
  listAdminsRequest: schemaId('msg/adminAuth.listAdmins/request'),
  loginRequest: schemaId('msg/adminAuth.login/request'),
  refreshRequest: schemaId('msg/adminAuth.refresh/request'),
  getAdminRequest: schemaId('msg/adminAuth.getAdmin/request'),
  devAutologinRequest: schemaId('msg/adminAuth.devAutologin/request'),
} as const;

const adminAuthTokens = object(
  ADMIN_AUTH_SCHEMA_IDS.adminAuthTokens,
  {
    adminId: nonEmptyString(),
    username: nonEmptyString(),
    displayName: nullableString(),
    accessToken: nonEmptyString(),
    expiresAt: string({ format: 'date-time' }),
  },
  ['adminId', 'username', 'displayName', 'accessToken', 'expiresAt']
);

// `aud` is pinned to the one value rather than left a free string. A schema that
// accepts any audience would validate a token minted for something else, which is
// exactly the confusion the second signing key exists to prevent.
const adminTokenClaims = object(
  ADMIN_AUTH_SCHEMA_IDS.adminTokenClaims,
  {
    sub: nonEmptyString(),
    aud: string({ const: ADMIN_TOKEN_AUDIENCE }),
    iat: integer(),
    exp: integer(),
  },
  ['sub', 'aud']
);

const adminIdentityView = object(
  ADMIN_AUTH_SCHEMA_IDS.adminIdentityView,
  {
    adminId: nonEmptyString(),
    username: nonEmptyString(),
    displayName: nullableString(),
    lastLoginAt: nullableString(),
    disabledAt: nullableString(),
  },
  ['adminId', 'username', 'displayName', 'lastLoginAt', 'disabledAt']
);

// The roster of plan 0074, section 5. Read only in the strongest sense: there is
// no request that writes one of these rows, here or anywhere, and adding one
// would need plan 0071 section 6 changed first.
const adminIdentityListView = object(
  ADMIN_AUTH_SCHEMA_IDS.adminIdentityListView,
  { admins: array(ref(ADMIN_AUTH_SCHEMA_IDS.adminIdentityView)) },
  ['admins']
);

// Only the operator's own credential: nothing to filter by, nothing to page.
const listAdminsRequest = object(
  ADMIN_AUTH_SCHEMA_IDS.listAdminsRequest,
  { ...adminCredentialProperties },
  ['userId']
);

// Composed by the gateway from auth's answer plus its own environment name, so it
// belongs to no request/reply pair and is documented with `ApiComposedResponse`.
const adminMeView = object(
  ADMIN_AUTH_SCHEMA_IDS.adminMeView,
  {
    admin: ref(ADMIN_AUTH_SCHEMA_IDS.adminIdentityView),
    environment: nonEmptyString(),
  },
  ['admin', 'environment']
);

const loginRequest = object(
  ADMIN_AUTH_SCHEMA_IDS.loginRequest,
  {
    username: nonEmptyString(),
    password: nonEmptyString(),
    ip: string(),
    userAgent: string(),
  },
  ['username', 'password']
);

const refreshRequest = object(
  ADMIN_AUTH_SCHEMA_IDS.refreshRequest,
  { adminId: nonEmptyString() },
  ['adminId']
);

const getAdminRequest = object(
  ADMIN_AUTH_SCHEMA_IDS.getAdminRequest,
  { adminId: nonEmptyString() },
  ['adminId']
);

const devAutologinRequest = object(
  ADMIN_AUTH_SCHEMA_IDS.devAutologinRequest,
  { username: nonEmptyString() },
  ['username']
);

export const adminAuthSchemas: JsonSchema[] = [
  adminAuthTokens,
  adminTokenClaims,
  adminIdentityView,
  adminIdentityListView,
  adminMeView,
  listAdminsRequest,
  loginRequest,
  refreshRequest,
  getAdminRequest,
  devAutologinRequest,
];

export const adminAuthMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ADMIN_AUTH_PATTERNS.login]: {
    request: ADMIN_AUTH_SCHEMA_IDS.loginRequest,
    response: ADMIN_AUTH_SCHEMA_IDS.adminAuthTokens,
  },
  [ADMIN_AUTH_PATTERNS.refresh]: {
    request: ADMIN_AUTH_SCHEMA_IDS.refreshRequest,
    response: ADMIN_AUTH_SCHEMA_IDS.adminAuthTokens,
  },
  [ADMIN_AUTH_PATTERNS.getAdmin]: {
    request: ADMIN_AUTH_SCHEMA_IDS.getAdminRequest,
    response: ADMIN_AUTH_SCHEMA_IDS.adminIdentityView,
  },
  [ADMIN_AUTH_PATTERNS.listAdmins]: {
    request: ADMIN_AUTH_SCHEMA_IDS.listAdminsRequest,
    response: ADMIN_AUTH_SCHEMA_IDS.adminIdentityListView,
  },
  [ADMIN_AUTH_PATTERNS.devAutologin]: {
    request: ADMIN_AUTH_SCHEMA_IDS.devAutologinRequest,
    response: ADMIN_AUTH_SCHEMA_IDS.adminAuthTokens,
  },
};
