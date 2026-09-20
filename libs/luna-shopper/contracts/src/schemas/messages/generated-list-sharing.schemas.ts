import { GENERATED_LIST_SHARING_PATTERNS } from '../../lib/messages/generated-list-sharing.messages';
import { GENERATED_LIST_LIMITS } from '../../lib/messages/generated-list.messages';
import { LINE_QUANTITY_MAX } from '../../lib/messages/list.messages';
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
import { ENUM_IDS } from '../enums.schemas';
import { CATALOG_SCHEMA_IDS } from './catalog.schemas';
import { GENERATED_LIST_SCHEMA_IDS } from './generated-list.schemas';

/**
 * Sharing a basket with people who have no account (plan 0051).
 *
 * A separate file from `generated-list.schemas.ts` for the same reason the
 * message file is separate: it is a separate feature with a separate reader set,
 * and plan 0050 gave every basket exactly one reader.
 *
 * Two of the shapes here describe an **HTTP** response rather than a NATS one,
 * and are marked as such: joining and refreshing a token both end in a body the
 * gateway composes from two services, because core owns the participant and auth
 * owns the signing key, and neither can answer alone.
 */
export const GENERATED_LIST_SHARING_SCHEMA_IDS = {
  shareLinkView: schemaId('generated-list-sharing/ShareLinkView'),
  participantView: schemaId('generated-list-sharing/ParticipantView'),
  participantListResult: schemaId(
    'generated-list-sharing/ParticipantListResult'
  ),
  linkPreview: schemaId('generated-list-sharing/LinkPreview'),
  joinCoreResult: schemaId('generated-list-sharing/JoinCoreResult'),
  /** The gateway's composed body: the core result plus a signed socket token. */
  joinResult: schemaId('generated-list-sharing/JoinResult'),
  participantContext: schemaId('generated-list-sharing/ParticipantContext'),
  /** The gateway's composed body for a token refresh. */
  participantTokenResult: schemaId(
    'generated-list-sharing/ParticipantTokenResult'
  ),
  shareRequest: schemaId('msg/generatedList.shareLink/request'),
  ensureLinkRequest: schemaId('msg/generatedList.shareLink.ensure/request'),
  revokeLinkRequest: schemaId('msg/generatedList.shareLink.revoke/request'),
  revokeLinkResult: schemaId('msg/generatedList.shareLink.revoke/response'),
  previewRequest: schemaId('msg/generatedList.shareLink.preview/request'),
  joinRequest: schemaId('msg/generatedList.participant.join/request'),
  listParticipantsRequest: schemaId(
    'msg/generatedList.participant.list/request'
  ),
  revokeParticipantRequest: schemaId(
    'msg/generatedList.participant.revoke/request'
  ),
  revokeParticipantResult: schemaId(
    'msg/generatedList.participant.revoke/response'
  ),
  resolveParticipantRequest: schemaId(
    'msg/generatedList.participant.resolve/request'
  ),
  /** Zero links or one, so `link` is optional rather than nullable (section 3). */
  shareLinkResult: schemaId('generated-list-sharing/ShareLinkResult'),
  /** Add one of the owner's contacts (plan 0114, section 4). */
  addParticipantRequest: schemaId('msg/generatedList.participant.add/request'),
  /** Leave a basket as a registered participant (plan 0114, section 6). */
  leaveRequest: schemaId('msg/generatedList.participant.leave/request'),
  /** What a person's own sessions hear about their access (section 10). */
  accessEvent: schemaId('generated-list-sharing/AccessEvent'),
} as const;

const shareLinkView = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.shareLinkView,
  {
    id: nonEmptyString(),
    generatedListId: nonEmptyString(),
    // Served on every read, unlike a participant's session secret: the owner has
    // to be able to copy the invitation again tomorrow (section 3.1).
    secret: nonEmptyString(),
    createdByParticipantId: nonEmptyString(),
    createdAt: nonEmptyString(),
    expiresAt: nullableString(),
    participantCount: integer({ minimum: 0 }),
  },
  [
    'id',
    'generatedListId',
    'secret',
    'createdByParticipantId',
    'createdAt',
    'expiresAt',
    'participantCount',
  ]
);

/**
 * The answer to "is this basket shared?" (plan 0051, section 3).
 *
 * An object with an **optional** `link` rather than a nullable
 * {@link shareLinkView} at the top level, because a basket having zero links or
 * one is the ordinary state rather than an error, and a bare nullable response is
 * awkward to express as a schema and worse to hoist into an OpenAPI component.
 * Absent means the basket is not shared right now.
 */
const shareLinkResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.shareLinkResult,
  { link: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.shareLinkView) },
  []
);

const participantView = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.participantView,
  {
    id: nonEmptyString(),
    kind: ref(ENUM_IDS.participantKind),
    displayName: nullableString(),
    // The account holder's own name, a separate field from the typed one
    // because they are different facts (plan 0054, section 2.3). Null for a
    // guest, and on a row that predates the plan until a share backfills it.
    username: nullableString(),
    guestNumber: { type: ['integer', 'null'] },
    userId: nullableString(),
    joinedAt: nonEmptyString(),
    lastSeenAt: nonEmptyString(),
    shareLinkId: nullableString(),
    // Present only for a reader who passes section 5.2, which is why it is
    // optional here rather than nullable: absent and null mean different things,
    // "you may not see this" against "there is nothing to see" (section 7).
    userAgent: nullableString(),
  },
  // `joinedAt` and `lastSeenAt` are optional for the same reason, and travel with
  // `userAgent` since plan 0114 (section 11).
  [
    'id',
    'kind',
    'displayName',
    'username',
    'guestNumber',
    'userId',
    'shareLinkId',
  ]
);

const participantListResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.participantListResult,
  {
    participants: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView)),
  },
  ['participants']
);

/**
 * The join screen's view before anybody joins (section 4, step 1).
 *
 * `name` and `participantCount` are optional because they are present **only**
 * when `joinable`: a link that never existed, one revoked, one expired and one
 * whose basket is finished all answer `{ joinable: false }` and nothing else, so
 * the four are indistinguishable (section 3.1) while the screen still gets an
 * honest sentence (section 4).
 */
const linkPreview = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.linkPreview,
  {
    joinable: boolean(),
    name: nullableString(),
    participantCount: integer({ minimum: 0 }),
  },
  ['joinable']
);

const joinCoreResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.joinCoreResult,
  {
    generatedListId: nonEmptyString(),
    participant: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView),
    // Null for a registered participant and the owner, who authenticate with an
    // account token and need no second credential.
    sessionSecret: nullableString(),
  },
  ['generatedListId', 'participant', 'sessionSecret']
);

const joinResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.joinResult,
  {
    generatedListId: nonEmptyString(),
    participant: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView),
    sessionSecret: nullableString(),
    socketToken: nonEmptyString(),
    socketTokenExpiresAt: nonEmptyString(),
  },
  [
    'generatedListId',
    'participant',
    'sessionSecret',
    'socketToken',
    'socketTokenExpiresAt',
  ]
);

const participantTokenResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.participantTokenResult,
  {
    socketToken: nonEmptyString(),
    socketTokenExpiresAt: nonEmptyString(),
    participant: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView),
  },
  ['socketToken', 'socketTokenExpiresAt', 'participant']
);

const participantContext = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.participantContext,
  {
    participantId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    kind: ref(ENUM_IDS.participantKind),
    userId: nullableString(),
  },
  ['participantId', 'generatedListId', 'kind', 'userId']
);

// --- Requests --------------------------------------------------------------

const shareRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.shareRequest,
  { userId: nonEmptyString(), generatedListId: nonEmptyString() },
  ['userId', 'generatedListId']
);

const ensureLinkRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.ensureLinkRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    expiresAt: nullableString(),
    // Sharing mints the owner's participant row, so it is where their account
    // name has to arrive (plan 0054, section 2.3).
    username: nullableString(),
  },
  ['userId', 'generatedListId']
);

const revokeLinkRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.revokeLinkRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    revokeParticipants: boolean(),
  },
  ['userId', 'generatedListId']
);

const revokeLinkResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.revokeLinkResult,
  { revoked: integer({ minimum: 0 }) },
  ['revoked']
);

const previewRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.previewRequest,
  { secret: nonEmptyString() },
  ['secret']
);

const joinRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.joinRequest,
  {
    secret: nonEmptyString(),
    displayName: string(),
    userId: nonEmptyString(),
    // Resolved by the gateway from the verified token: core is told the name
    // and never asks for it (plan 0054, section 2.2).
    username: nullableString(),
    userAgent: string(),
  },
  ['secret']
);

const listParticipantsRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.listParticipantsRequest,
  {
    generatedListId: nonEmptyString(),
    asParticipantId: nonEmptyString(),
    userId: nonEmptyString(),
    username: nullableString(),
  },
  ['generatedListId']
);

const revokeParticipantRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.revokeParticipantRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    participantId: nonEmptyString(),
  },
  ['userId', 'generatedListId', 'participantId']
);

const revokeParticipantResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.revokeParticipantResult,
  { id: nonEmptyString() },
  ['id']
);

const resolveParticipantRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.resolveParticipantRequest,
  {
    generatedListId: nonEmptyString(),
    sessionSecret: nonEmptyString(),
    userId: nonEmptyString(),
  },
  ['generatedListId']
);

const addParticipantRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.addParticipantRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    memberUserId: nonEmptyString(),
    globalUsername: nullableString(),
  },
  ['userId', 'generatedListId', 'memberUserId']
);

const leaveRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.leaveRequest,
  { generatedListId: nonEmptyString(), participantId: nonEmptyString() },
  ['generatedListId', 'participantId']
);

// Ids only, because the person hearing it may be in no room that may read more.
const accessEvent = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.accessEvent,
  { generatedListId: nonEmptyString() },
  ['generatedListId']
);

export const generatedListSharingSchemas: JsonSchema[] = [
  addParticipantRequest,
  leaveRequest,
  accessEvent,
  shareLinkView,
  shareLinkResult,
  participantView,
  participantListResult,
  linkPreview,
  joinCoreResult,
  joinResult,
  participantTokenResult,
  participantContext,
  shareRequest,
  ensureLinkRequest,
  revokeLinkRequest,
  revokeLinkResult,
  previewRequest,
  joinRequest,
  listParticipantsRequest,
  revokeParticipantRequest,
  revokeParticipantResult,
  resolveParticipantRequest,
];

export const generatedListSharingMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [GENERATED_LIST_SHARING_PATTERNS.linkEnsure]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.ensureLinkRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.shareLinkView,
  },
  [GENERATED_LIST_SHARING_PATTERNS.linkGet]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.shareRequest,
    // Zero links or one is the ordinary state, so the answer wraps an optional
    // link rather than being a bare nullable view (section 3).
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.shareLinkResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.linkRevoke]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.revokeLinkRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.revokeLinkResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.linkPreview]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.previewRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.linkPreview,
  },
  [GENERATED_LIST_SHARING_PATTERNS.join]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.joinRequest,
    // Core's answer, which stops short of the socket token: core holds no
    // signing key, so the gateway composes the HTTP body from this and auth.
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.joinCoreResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantList]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.listParticipantsRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.participantListResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantRevoke]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.revokeParticipantRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.revokeParticipantResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantAdd]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.addParticipantRequest,
    // The owner's view of the row, device string and join time included.
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.participantView,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantLeave]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.leaveRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.revokeParticipantResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantResolve]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.resolveParticipantRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.participantContext,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantRefresh]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.resolveParticipantRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.participantTokenResult,
  },
};
