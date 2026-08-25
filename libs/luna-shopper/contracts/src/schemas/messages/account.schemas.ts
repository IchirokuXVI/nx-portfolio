import { AUTH_PATTERNS } from '../../lib/messages/auth.messages';
import { RECONCILIATION_PATTERNS } from '../../lib/messages/reconciliation.messages';
import {
  array,
  boolean,
  JsonSchema,
  nonEmptyString,
  object,
  schemaId,
} from '../builders';

/**
 * Account deletion + reconciliation schemas (plan 0011). The gateway's
 * delete-account call and the auth reaper's memberless-users query to core.
 */
export const ACCOUNT_SCHEMA_IDS = {
  deleteAccountRequest: schemaId('msg/auth.deleteAccount/request'),
  deleteAccountResult: schemaId('auth/DeleteAccountResult'),
  usersWithoutMembershipsRequest: schemaId(
    'msg/core.usersWithoutMemberships/request'
  ),
  usersWithoutMembershipsResponse: schemaId(
    'core/UsersWithoutMembershipsResponse'
  ),
} as const;

const deleteAccountRequest = object(
  ACCOUNT_SCHEMA_IDS.deleteAccountRequest,
  { userId: nonEmptyString() },
  ['userId']
);

const deleteAccountResult = object(
  ACCOUNT_SCHEMA_IDS.deleteAccountResult,
  { userId: nonEmptyString(), deleted: boolean() },
  ['userId', 'deleted']
);

const usersWithoutMembershipsRequest = object(
  ACCOUNT_SCHEMA_IDS.usersWithoutMembershipsRequest,
  { userIds: array(nonEmptyString()) },
  ['userIds']
);

const usersWithoutMembershipsResponse = object(
  ACCOUNT_SCHEMA_IDS.usersWithoutMembershipsResponse,
  { userIds: array(nonEmptyString()) },
  ['userIds']
);

export const accountSchemas: JsonSchema[] = [
  deleteAccountRequest,
  deleteAccountResult,
  usersWithoutMembershipsRequest,
  usersWithoutMembershipsResponse,
];

export const accountMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [AUTH_PATTERNS.deleteAccount]: {
    request: ACCOUNT_SCHEMA_IDS.deleteAccountRequest,
    response: ACCOUNT_SCHEMA_IDS.deleteAccountResult,
  },
  [RECONCILIATION_PATTERNS.usersWithoutMemberships]: {
    request: ACCOUNT_SCHEMA_IDS.usersWithoutMembershipsRequest,
    response: ACCOUNT_SCHEMA_IDS.usersWithoutMembershipsResponse,
  },
};
