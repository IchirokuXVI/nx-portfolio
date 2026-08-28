import {
  AuthProvider,
  UserKind,
  UsernamePropagation,
} from '../lib/enums/auth.enums';
import {
  LineApprovalStatus,
  LineStatus,
  ListRole,
} from '../lib/enums/list.enums';
import { MergeRequestStatus } from '../lib/enums/merge.enums';
import {
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '../lib/enums/zone.enums';
import { enumOf, JsonSchema, schemaId } from './builders';

/**
 * One schema per wire enum, its `enum` list pinned to the runtime enum's values
 * via `Object.values`. Because the schema derives from the same TypeScript enum
 * the services use, a value renamed in one place fails the contract tests until
 * it is renamed everywhere (plan 0010, section 2).
 */
export const ENUM_IDS = {
  userKind: schemaId('enums/UserKind'),
  authProvider: schemaId('enums/AuthProvider'),
  usernamePropagation: schemaId('enums/UsernamePropagation'),
  zoneStatus: schemaId('enums/ZoneStatus'),
  zoneRole: schemaId('enums/ZoneRole'),
  membershipStatus: schemaId('enums/MembershipStatus'),
  listRole: schemaId('enums/ListRole'),
  lineApprovalStatus: schemaId('enums/LineApprovalStatus'),
  lineStatus: schemaId('enums/LineStatus'),
  mergeRequestStatus: schemaId('enums/MergeRequestStatus'),
} as const;

export const enumSchemas: JsonSchema[] = [
  enumOf(ENUM_IDS.userKind, Object.values(UserKind)),
  enumOf(ENUM_IDS.authProvider, Object.values(AuthProvider)),
  enumOf(ENUM_IDS.usernamePropagation, Object.values(UsernamePropagation)),
  enumOf(ENUM_IDS.zoneStatus, Object.values(ZoneStatus)),
  enumOf(ENUM_IDS.zoneRole, Object.values(ZoneRole)),
  enumOf(ENUM_IDS.membershipStatus, Object.values(MembershipStatus)),
  enumOf(ENUM_IDS.listRole, Object.values(ListRole)),
  enumOf(ENUM_IDS.lineApprovalStatus, Object.values(LineApprovalStatus)),
  enumOf(ENUM_IDS.lineStatus, Object.values(LineStatus)),
  enumOf(ENUM_IDS.mergeRequestStatus, Object.values(MergeRequestStatus)),
];
