import { BASKET_SHARING_PATTERNS } from '../../lib/messages/basket-sharing.messages';
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

/**
 * Sharing a basket with people who have no account (plan 0051).
 *
 * A separate file from `basket.schemas.ts` for the same reason the
 * message file is separate: it is a separate feature with a separate reader set,
 * and plan 0050 gave every basket exactly one reader.
 *
 * Two of the shapes here describe an **HTTP** response rather than a NATS one,
 * and are marked as such: joining and refreshing a token both end in a body the
 * gateway composes from two services, because core owns the participant and auth
 * owns the signing key, and neither can answer alone.
 */
export const BASKET_SHARING_SCHEMA_IDS = {
  shareLinkView: schemaId('basket-sharing/ShareLinkView'),
  participantView: schemaId('basket-sharing/ParticipantView'),
  participantListResult: schemaId('basket-sharing/ParticipantListResult'),
  linkPreview: schemaId('basket-sharing/LinkPreview'),
  joinCoreResult: schemaId('basket-sharing/JoinCoreResult'),
  /** The gateway's composed body: the core result plus a signed socket token. */
  joinResult: schemaId('basket-sharing/JoinResult'),
  participantContext: schemaId('basket-sharing/ParticipantContext'),
  /** The gateway's composed body for a token refresh. */
  participantTokenResult: schemaId('basket-sharing/ParticipantTokenResult'),
  shareRequest: schemaId('msg/basket.shareLink/request'),
  ensureLinkRequest: schemaId('msg/basket.shareLink.ensure/request'),
  revokeLinkRequest: schemaId('msg/basket.shareLink.revoke/request'),
  revokeLinkResult: schemaId('msg/basket.shareLink.revoke/response'),
  previewRequest: schemaId('msg/basket.shareLink.preview/request'),
  joinRequest: schemaId('msg/basket.participant.join/request'),
  listParticipantsRequest: schemaId('msg/basket.participant.list/request'),
  revokeParticipantRequest: schemaId('msg/basket.participant.revoke/request'),
  revokeParticipantResult: schemaId('msg/basket.participant.revoke/response'),
  resolveParticipantRequest: schemaId('msg/basket.participant.resolve/request'),
  /** Zero links or one, so `link` is optional rather than nullable (section 3). */
  shareLinkResult: schemaId('basket-sharing/ShareLinkResult'),
  /** Add one of the owner's contacts (plan 0114, section 4). */
  addParticipantRequest: schemaId('msg/basket.participant.add/request'),
  /** Leave a basket as a registered participant (plan 0114, section 6). */
  leaveRequest: schemaId('msg/basket.participant.leave/request'),
  /** What a person's own sessions hear about their access (section 10). */
  accessEvent: schemaId('basket-sharing/AccessEvent'),
} as const;

const shareLinkView = object(
  BASKET_SHARING_SCHEMA_IDS.shareLinkView,
  {
    id: nonEmptyString(),
    basketId: nonEmptyString(),
    // Served on every read, unlike a participant's session secret: the owner has
    // to be able to copy the invitation again tomorrow (section 3.1).
    secret: nonEmptyString(),
    createdByParticipantId: nonEmptyString(),
    createdAt: nonEmptyString(),
    // Twelve hours after `createdAt`, always (plan 0140, section 4), so no
    // longer nullable: a link with no end was a standing key.
    expiresAt: nonEmptyString(),
    participantCount: integer({ minimum: 0 }),
  },
  [
    'id',
    'basketId',
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
  BASKET_SHARING_SCHEMA_IDS.shareLinkResult,
  { link: ref(BASKET_SHARING_SCHEMA_IDS.shareLinkView) },
  []
);

const participantView = object(
  BASKET_SHARING_SCHEMA_IDS.participantView,
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
    // When this person's access ends, null when it does not (plan 0140,
    // section 8). Served to every reader, on every projection: the people sheet
    // offers "keep" from it and the shopper needs the warning.
    expiresAt: nullableString(),
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
    'expiresAt',
  ]
);

const participantListResult = object(
  BASKET_SHARING_SCHEMA_IDS.participantListResult,
  {
    participants: array(ref(BASKET_SHARING_SCHEMA_IDS.participantView)),
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
  BASKET_SHARING_SCHEMA_IDS.linkPreview,
  {
    joinable: boolean(),
    name: nullableString(),
    participantCount: integer({ minimum: 0 }),
  },
  ['joinable']
);

const joinCoreResult = object(
  BASKET_SHARING_SCHEMA_IDS.joinCoreResult,
  {
    basketId: nonEmptyString(),
    participant: ref(BASKET_SHARING_SCHEMA_IDS.participantView),
    // Null for a registered participant and the owner, who authenticate with an
    // account token and need no second credential.
    sessionSecret: nullableString(),
  },
  ['basketId', 'participant', 'sessionSecret']
);

const joinResult = object(
  BASKET_SHARING_SCHEMA_IDS.joinResult,
  {
    basketId: nonEmptyString(),
    participant: ref(BASKET_SHARING_SCHEMA_IDS.participantView),
    sessionSecret: nullableString(),
    socketToken: nonEmptyString(),
    socketTokenExpiresAt: nonEmptyString(),
  },
  [
    'basketId',
    'participant',
    'sessionSecret',
    'socketToken',
    'socketTokenExpiresAt',
  ]
);

const participantTokenResult = object(
  BASKET_SHARING_SCHEMA_IDS.participantTokenResult,
  {
    socketToken: nonEmptyString(),
    socketTokenExpiresAt: nonEmptyString(),
    participant: ref(BASKET_SHARING_SCHEMA_IDS.participantView),
  },
  ['socketToken', 'socketTokenExpiresAt', 'participant']
);

const participantContext = object(
  BASKET_SHARING_SCHEMA_IDS.participantContext,
  {
    participantId: nonEmptyString(),
    basketId: nonEmptyString(),
    kind: ref(ENUM_IDS.participantKind),
    userId: nullableString(),
  },
  ['participantId', 'basketId', 'kind', 'userId']
);

// --- Requests --------------------------------------------------------------

const shareRequest = object(
  BASKET_SHARING_SCHEMA_IDS.shareRequest,
  { userId: nonEmptyString(), basketId: nonEmptyString() },
  ['userId', 'basketId']
);

// No lifetime field (plan 0140, section 2): every link lasts twelve hours and a
// caller may not ask for another number.
const ensureLinkRequest = object(
  BASKET_SHARING_SCHEMA_IDS.ensureLinkRequest,
  {
    userId: nonEmptyString(),
    basketId: nonEmptyString(),
    // Sharing mints the owner's participant row, so it is where their account
    // name has to arrive (plan 0054, section 2.3).
    username: nullableString(),
  },
  ['userId', 'basketId']
);

const revokeLinkRequest = object(
  BASKET_SHARING_SCHEMA_IDS.revokeLinkRequest,
  {
    userId: nonEmptyString(),
    basketId: nonEmptyString(),
    revokeParticipants: boolean(),
  },
  ['userId', 'basketId']
);

const revokeLinkResult = object(
  BASKET_SHARING_SCHEMA_IDS.revokeLinkResult,
  { revoked: integer({ minimum: 0 }) },
  ['revoked']
);

const previewRequest = object(
  BASKET_SHARING_SCHEMA_IDS.previewRequest,
  { secret: nonEmptyString() },
  ['secret']
);

const joinRequest = object(
  BASKET_SHARING_SCHEMA_IDS.joinRequest,
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
  BASKET_SHARING_SCHEMA_IDS.listParticipantsRequest,
  {
    basketId: nonEmptyString(),
    asParticipantId: nonEmptyString(),
    userId: nonEmptyString(),
    username: nullableString(),
  },
  ['basketId']
);

const revokeParticipantRequest = object(
  BASKET_SHARING_SCHEMA_IDS.revokeParticipantRequest,
  {
    userId: nonEmptyString(),
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
  },
  ['userId', 'basketId', 'participantId']
);

const revokeParticipantResult = object(
  BASKET_SHARING_SCHEMA_IDS.revokeParticipantResult,
  { id: nonEmptyString() },
  ['id']
);

const resolveParticipantRequest = object(
  BASKET_SHARING_SCHEMA_IDS.resolveParticipantRequest,
  {
    basketId: nonEmptyString(),
    sessionSecret: nonEmptyString(),
    userId: nonEmptyString(),
  },
  ['basketId']
);

const addParticipantRequest = object(
  BASKET_SHARING_SCHEMA_IDS.addParticipantRequest,
  {
    userId: nonEmptyString(),
    basketId: nonEmptyString(),
    memberUserId: nonEmptyString(),
    globalUsername: nullableString(),
  },
  ['userId', 'basketId', 'memberUserId']
);

const leaveRequest = object(
  BASKET_SHARING_SCHEMA_IDS.leaveRequest,
  { basketId: nonEmptyString(), participantId: nonEmptyString() },
  ['basketId', 'participantId']
);

// Ids only, because the person hearing it may be in no room that may read more.
const accessEvent = object(
  BASKET_SHARING_SCHEMA_IDS.accessEvent,
  { basketId: nonEmptyString() },
  ['basketId']
);

export const basketSharingSchemas: JsonSchema[] = [
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

export const basketSharingMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [BASKET_SHARING_PATTERNS.linkEnsure]: {
    request: BASKET_SHARING_SCHEMA_IDS.ensureLinkRequest,
    response: BASKET_SHARING_SCHEMA_IDS.shareLinkView,
  },
  [BASKET_SHARING_PATTERNS.linkGet]: {
    request: BASKET_SHARING_SCHEMA_IDS.shareRequest,
    // Zero links or one is the ordinary state, so the answer wraps an optional
    // link rather than being a bare nullable view (section 3).
    response: BASKET_SHARING_SCHEMA_IDS.shareLinkResult,
  },
  [BASKET_SHARING_PATTERNS.linkRevoke]: {
    request: BASKET_SHARING_SCHEMA_IDS.revokeLinkRequest,
    response: BASKET_SHARING_SCHEMA_IDS.revokeLinkResult,
  },
  [BASKET_SHARING_PATTERNS.linkPreview]: {
    request: BASKET_SHARING_SCHEMA_IDS.previewRequest,
    response: BASKET_SHARING_SCHEMA_IDS.linkPreview,
  },
  [BASKET_SHARING_PATTERNS.join]: {
    request: BASKET_SHARING_SCHEMA_IDS.joinRequest,
    // Core's answer, which stops short of the socket token: core holds no
    // signing key, so the gateway composes the HTTP body from this and auth.
    response: BASKET_SHARING_SCHEMA_IDS.joinCoreResult,
  },
  [BASKET_SHARING_PATTERNS.participantList]: {
    request: BASKET_SHARING_SCHEMA_IDS.listParticipantsRequest,
    response: BASKET_SHARING_SCHEMA_IDS.participantListResult,
  },
  [BASKET_SHARING_PATTERNS.participantRevoke]: {
    request: BASKET_SHARING_SCHEMA_IDS.revokeParticipantRequest,
    response: BASKET_SHARING_SCHEMA_IDS.revokeParticipantResult,
  },
  [BASKET_SHARING_PATTERNS.participantAdd]: {
    request: BASKET_SHARING_SCHEMA_IDS.addParticipantRequest,
    // The owner's view of the row, device string and join time included.
    response: BASKET_SHARING_SCHEMA_IDS.participantView,
  },
  [BASKET_SHARING_PATTERNS.participantLeave]: {
    request: BASKET_SHARING_SCHEMA_IDS.leaveRequest,
    response: BASKET_SHARING_SCHEMA_IDS.revokeParticipantResult,
  },
  [BASKET_SHARING_PATTERNS.participantResolve]: {
    request: BASKET_SHARING_SCHEMA_IDS.resolveParticipantRequest,
    response: BASKET_SHARING_SCHEMA_IDS.participantContext,
  },
  [BASKET_SHARING_PATTERNS.participantRefresh]: {
    request: BASKET_SHARING_SCHEMA_IDS.resolveParticipantRequest,
    response: BASKET_SHARING_SCHEMA_IDS.participantTokenResult,
  },
};
