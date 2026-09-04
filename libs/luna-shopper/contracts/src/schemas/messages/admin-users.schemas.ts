import { ADMIN_USER_PATTERNS } from '../../lib/messages/admin-users.messages';
import {
  array,
  boolean,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  paginated,
  ref,
  schemaId,
  string,
} from '../builders';
import { adminCredentialProperties } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';
import { ACCOUNT_SCHEMA_IDS } from './account.schemas';
import { AUTH_SCHEMA_IDS } from './auth.schemas';

/**
 * JSON Schemas for the back office's user directory (plan 0074).
 *
 * Their own domain (`admin-users/...`) beside `admin-auth/...`, because they
 * describe a different principal being looked **at** rather than a different
 * principal looking. The two responses that are shared with a user facing
 * subject are referenced rather than restated: deleting an account and resending
 * a confirmation mail answer with the same shapes here as they do there, because
 * they are the same service methods, and a second copy of either schema is a
 * place for the two to drift.
 *
 * `passwordHash` appears in no schema here, which is the contract half of section
 * 4. The query half, never selecting the column, is in auth; both exist because
 * either one alone is a rule somebody can forget.
 */
export const ADMIN_USERS_SCHEMA_IDS = {
  adminUserView: schemaId('admin-users/AdminUserView'),
  adminUserDetailView: schemaId('admin-users/AdminUserDetailView'),
  adminUserRefView: schemaId('admin-users/AdminUserRefView'),
  adminUserPage: schemaId('admin-users/AdminUserPage'),
  resolveResult: schemaId('admin-users/ResolveAdminUsersResult'),
  listRequest: schemaId('msg/adminUser.list/request'),
  getRequest: schemaId('msg/adminUser.get/request'),
  resolveManyRequest: schemaId('msg/adminUser.resolveMany/request'),
  deleteRequest: schemaId('msg/adminUser.delete/request'),
  resendVerificationRequest: schemaId(
    'msg/adminUser.resendVerification/request'
  ),
  updateRequest: schemaId('msg/adminUser.update/request'),
} as const;

const userFields = {
  userId: nonEmptyString(),
  kind: ref(ENUM_IDS.userKind),
  username: nonEmptyString(),
  displayName: nullableString(),
  email: nullableString(),
  emailVerifiedAt: nullableString(),
  createdAt: string({ format: 'date-time' }),
  updatedAt: string({ format: 'date-time' }),
};
const userKeys = [
  'userId',
  'kind',
  'username',
  'displayName',
  'email',
  'emailVerifiedAt',
  'createdAt',
  'updatedAt',
];

const adminUserView = object(
  ADMIN_USERS_SCHEMA_IDS.adminUserView,
  userFields,
  userKeys
);

const adminUserDetailView = object(
  ADMIN_USERS_SCHEMA_IDS.adminUserDetailView,
  {
    ...userFields,
    hasPassword: boolean(),
    providers: array(ref(ENUM_IDS.authProvider)),
  },
  [...userKeys, 'hasPassword', 'providers']
);

const adminUserRefView = object(
  ADMIN_USERS_SCHEMA_IDS.adminUserRefView,
  {
    userId: nonEmptyString(),
    username: nonEmptyString(),
    displayName: nullableString(),
  },
  ['userId', 'username', 'displayName']
);

const adminUserPage = paginated(
  ADMIN_USERS_SCHEMA_IDS.adminUserPage,
  ADMIN_USERS_SCHEMA_IDS.adminUserView
);

const resolveResult = object(
  ADMIN_USERS_SCHEMA_IDS.resolveResult,
  { users: array(ref(ADMIN_USERS_SCHEMA_IDS.adminUserRefView)) },
  ['users']
);

// Every filter is optional and none is required, so a request naming only the
// credential is the whole table. `verified` is a boolean rather than a tri state
// string because the third state, "do not filter", is the field's absence.
const listRequest = object(
  ADMIN_USERS_SCHEMA_IDS.listRequest,
  {
    ...adminCredentialProperties,
    username: string(),
    email: string(),
    kind: ref(ENUM_IDS.userKind),
    verified: boolean(),
    createdAfter: string({ format: 'date-time' }),
    createdBefore: string({ format: 'date-time' }),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const getRequest = object(
  ADMIN_USERS_SCHEMA_IDS.getRequest,
  { ...adminCredentialProperties, targetUserId: nonEmptyString() },
  ['userId', 'targetUserId']
);

const resolveManyRequest = object(
  ADMIN_USERS_SCHEMA_IDS.resolveManyRequest,
  { ...adminCredentialProperties, userIds: array(nonEmptyString()) },
  ['userId', 'userIds']
);

const deleteRequest = object(
  ADMIN_USERS_SCHEMA_IDS.deleteRequest,
  { ...adminCredentialProperties, targetUserId: nonEmptyString() },
  ['userId', 'targetUserId']
);

const resendVerificationRequest = object(
  ADMIN_USERS_SCHEMA_IDS.resendVerificationRequest,
  {
    ...adminCredentialProperties,
    targetUserId: nonEmptyString(),
    locale: string(),
  },
  ['userId', 'targetUserId']
);

/**
 * The two editable fields, and no third (plan 0077, section 3).
 *
 * `email`, `emailVerifiedAt` and `kind` are absent here on purpose, and their
 * absence is asserted rather than left to inspection: an operator who could type
 * an address would leave the credential, the linked providers, the outstanding
 * verifications and every live refresh token pointing at the address the account
 * no longer claims, and setting `emailVerifiedAt` by hand asserts the one thing
 * an operator cannot observe.
 *
 * `displayName` is `nullableString`, so clearing it is expressible. Absent leaves
 * the column alone and null clears it, which are different requests.
 */
const updateRequest = object(
  ADMIN_USERS_SCHEMA_IDS.updateRequest,
  {
    ...adminCredentialProperties,
    targetUserId: nonEmptyString(),
    username: nonEmptyString(),
    displayName: nullableString(),
    usernamePropagation: ref(ENUM_IDS.usernamePropagation),
  },
  ['userId', 'targetUserId']
);

export const adminUsersSchemas: JsonSchema[] = [
  adminUserView,
  adminUserDetailView,
  adminUserRefView,
  adminUserPage,
  resolveResult,
  listRequest,
  getRequest,
  resolveManyRequest,
  deleteRequest,
  resendVerificationRequest,
  updateRequest,
];

export const adminUsersMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ADMIN_USER_PATTERNS.list]: {
    request: ADMIN_USERS_SCHEMA_IDS.listRequest,
    response: ADMIN_USERS_SCHEMA_IDS.adminUserPage,
  },
  [ADMIN_USER_PATTERNS.get]: {
    request: ADMIN_USERS_SCHEMA_IDS.getRequest,
    response: ADMIN_USERS_SCHEMA_IDS.adminUserDetailView,
  },
  [ADMIN_USER_PATTERNS.resolveMany]: {
    request: ADMIN_USERS_SCHEMA_IDS.resolveManyRequest,
    response: ADMIN_USERS_SCHEMA_IDS.resolveResult,
  },
  // Both answer with the user facing shape, because both run the user facing
  // service method. Referencing rather than restating is the point.
  [ADMIN_USER_PATTERNS.delete]: {
    request: ADMIN_USERS_SCHEMA_IDS.deleteRequest,
    response: ACCOUNT_SCHEMA_IDS.deleteAccountResult,
  },
  [ADMIN_USER_PATTERNS.resendVerification]: {
    request: ADMIN_USERS_SCHEMA_IDS.resendVerificationRequest,
    response: AUTH_SCHEMA_IDS.retryAfterResult,
  },
  // The detail view, because a rename is the moment an operator wants to see the
  // whole account again, and the two extra fields on it are the ones that answer
  // why the person cannot sign in.
  [ADMIN_USER_PATTERNS.update]: {
    request: ADMIN_USERS_SCHEMA_IDS.updateRequest,
    response: ADMIN_USERS_SCHEMA_IDS.adminUserDetailView,
  },
};
