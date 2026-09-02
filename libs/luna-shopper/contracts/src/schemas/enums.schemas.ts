import {
  AssistantRole,
  ListResolutionBranch,
} from '../lib/enums/assistant.enums';
import {
  AuthProvider,
  UserKind,
  UsernamePropagation,
} from '../lib/enums/auth.enums';
import {
  OriginUnavailableReason,
  ParticipantKind,
} from '../lib/enums/generated-list.enums';
import {
  CommentTranscription,
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  SettlementOutcome,
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
  listPermission: schemaId('enums/ListPermission'),
  lineApprovalStatus: schemaId('enums/LineApprovalStatus'),
  lineStatus: schemaId('enums/LineStatus'),
  settlementOutcome: schemaId('enums/SettlementOutcome'),
  commentTranscription: schemaId('enums/CommentTranscription'),
  mergeRequestStatus: schemaId('enums/MergeRequestStatus'),
  assistantRole: schemaId('enums/AssistantRole'),
  listResolutionBranch: schemaId('enums/ListResolutionBranch'),
  /** Who is acting on a shared basket (plan 0051, section 3). */
  participantKind: schemaId('enums/ParticipantKind'),
  /** Why a matching list cannot be adopted into a basket line (plan 0057, section 3.2). */
  originUnavailableReason: schemaId('enums/OriginUnavailableReason'),
} as const;

export const enumSchemas: JsonSchema[] = [
  enumOf(ENUM_IDS.userKind, Object.values(UserKind)),
  enumOf(ENUM_IDS.authProvider, Object.values(AuthProvider)),
  enumOf(ENUM_IDS.usernamePropagation, Object.values(UsernamePropagation)),
  enumOf(ENUM_IDS.zoneStatus, Object.values(ZoneStatus)),
  enumOf(ENUM_IDS.zoneRole, Object.values(ZoneRole)),
  enumOf(ENUM_IDS.membershipStatus, Object.values(MembershipStatus)),
  enumOf(ENUM_IDS.listPermission, Object.values(ListPermission)),
  enumOf(ENUM_IDS.lineApprovalStatus, Object.values(LineApprovalStatus)),
  enumOf(ENUM_IDS.lineStatus, Object.values(LineStatus)),
  enumOf(ENUM_IDS.settlementOutcome, Object.values(SettlementOutcome)),
  enumOf(ENUM_IDS.commentTranscription, Object.values(CommentTranscription)),
  enumOf(ENUM_IDS.mergeRequestStatus, Object.values(MergeRequestStatus)),
  enumOf(ENUM_IDS.assistantRole, Object.values(AssistantRole)),
  enumOf(ENUM_IDS.listResolutionBranch, Object.values(ListResolutionBranch)),
  enumOf(ENUM_IDS.participantKind, Object.values(ParticipantKind)),
  enumOf(
    ENUM_IDS.originUnavailableReason,
    Object.values(OriginUnavailableReason)
  ),
];
