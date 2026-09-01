import { GENERATED_LIST_SHARING_PATTERNS } from '../../lib/messages/generated-list-sharing.messages';
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
  settlementRef: schemaId('generated-list-sharing/SettlementRef'),
  settleSkip: schemaId('generated-list-sharing/SettleSkip'),
  allocationEntry: schemaId('generated-list-sharing/AllocationEntry'),
  settleResult: schemaId('generated-list-sharing/SettleResult'),
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
  settleRequest: schemaId('msg/generatedList.settleLine/request'),
  /** Zero links or one, so `link` is optional rather than nullable (section 3). */
  shareLinkResult: schemaId('generated-list-sharing/ShareLinkResult'),
  /** A basket line as a participant reads it, redacted by section 5.2. */
  basketLineView: schemaId('generated-list-sharing/BasketLineView'),
  /** The basket, its people and the reader's own row, in one read. */
  basketView: schemaId('generated-list-sharing/BasketView'),
  /** The gateway's composed body: core's basket plus the products it names. */
  basketResult: schemaId('generated-list-sharing/BasketResult'),
  /** One source list, named, for the "from" caption on a row. */
  sourceName: schemaId('generated-list-sharing/SourceName'),
  basketRequest: schemaId('msg/generatedList.basket.get/request'),
  setPickRequest: schemaId('msg/generatedList.setPick/request'),
  /** What the basket's room hears when a line is settled or its pick swapped. */
  lineMovedEvent: schemaId('generated-list-sharing/LineMovedEvent'),
  /** One list's contribution to a basket line (plan 0057, section 3.1). */
  lineOriginDetail: schemaId('generated-list-sharing/LineOriginDetail'),
  /** A list holding the same thing that is not an origin yet (section 3.2). */
  originCandidate: schemaId('generated-list-sharing/OriginCandidate'),
  lineOriginsRequest: schemaId('msg/generatedList.lineOrigins/request'),
  lineOriginsResult: schemaId('msg/generatedList.lineOrigins/response'),
  setOriginQuantityRequest: schemaId(
    'msg/generatedList.setOriginQuantity/request'
  ),
  setOriginQuantityResult: schemaId(
    'msg/generatedList.setOriginQuantity/response'
  ),
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
  [
    'id',
    'kind',
    'displayName',
    'guestNumber',
    'userId',
    'joinedAt',
    'lastSeenAt',
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
    seesZoneData: boolean(),
  },
  ['participantId', 'generatedListId', 'kind', 'userId', 'seesZoneData']
);

const settlementRef = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.settlementRef,
  {
    settlementId: nonEmptyString(),
    lineId: nonEmptyString(),
    listId: nonEmptyString(),
    quantity: integer({ minimum: 0 }),
  },
  ['settlementId', 'lineId', 'listId', 'quantity']
);

const settleSkip = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.settleSkip,
  {
    lineId: nonEmptyString(),
    listId: nonEmptyString(),
    reason: { type: 'string', enum: ['ACCESS_GONE', 'ORIGIN_DELETED'] },
    listName: nullableString(),
    zoneName: nullableString(),
  },
  ['lineId', 'listId', 'reason', 'listName', 'zoneName']
);

const allocationEntry = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.allocationEntry,
  { listId: nonEmptyString(), quantity: integer({ minimum: 0 }) },
  ['listId', 'quantity']
);

/**
 * A basket line as a participant reads it (section 5).
 *
 * The three zone naming fields are **absent** rather than nullable for a reader
 * who does not pass section 5.2, which is why they are not in the required list:
 * a guest's payload does not carry them at all.
 */
const basketLineView = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView,
  {
    id: nonEmptyString(),
    content: string(),
    quantity: integer({ minimum: 0 }),
    settledQuantity: integer({ minimum: 0 }),
    itemId: nullableString(),
    options: array(nonEmptyString()),
    position: integer({ minimum: 0 }),
    // Who got the bread (velista 0044, section 4.3). An id and never a name:
    // two guests can both type "Dani".
    lastEditedByParticipantId: nullableString(),
    lastEditedAt: nullableString(),
    // Null until somebody settles. Without it a NOT_AVAILABLE line reads as a
    // bought one, because both close the outstanding amount.
    lastOutcome: {
      type: ['string', 'null'],
      enum: ['BOUGHT', 'NOT_AVAILABLE', null],
    },
    origins: array(ref(GENERATED_LIST_SCHEMA_IDS.lineOriginView)),
    targetListId: nullableString(),
    origin: ref(GENERATED_LIST_SCHEMA_IDS.generatedLineOrigin),
  },
  [
    'id',
    'content',
    'quantity',
    'settledQuantity',
    'itemId',
    'options',
    'position',
    'lastEditedByParticipantId',
    'lastEditedAt',
    'lastOutcome',
  ]
);

const sourceName = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.sourceName,
  {
    listId: nonEmptyString(),
    name: string(),
    zoneName: nullableString(),
  },
  ['listId', 'name', 'zoneName']
);

const basketView = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.basketView,
  {
    id: nonEmptyString(),
    name: nullableString(),
    status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
    generatedAt: nonEmptyString(),
    lines: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView)),
    participants: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView)),
    me: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView),
    seesZoneData: boolean(),
    // Zone data, so absent under section 5.2 like the line's three fields.
    sourceSnapshot: ref(GENERATED_LIST_SCHEMA_IDS.sourceSnapshot),
    sourceNames: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.sourceName)),
  },
  [
    'id',
    'name',
    'status',
    'generatedAt',
    'lines',
    'participants',
    'me',
    'seesZoneData',
  ]
);

/**
 * What one settle did, for the participant who did it (sections 5.2 and 6.4).
 *
 * `skippedCount` is required and the two named lists are not: the fact that an
 * origin was missed is the actor's business whoever they are, and only the names
 * of the lists it was missed on are gated.
 */
const settleResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.settleResult,
  {
    line: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView),
    skippedCount: integer({ minimum: 0 }),
    settlements: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.settlementRef)),
    // As much the answer as the settlements are: a client that ignores it will
    // silently under report what the shopper actually bought (section 6.4).
    skipped: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.settleSkip)),
  },
  ['line', 'skippedCount']
);

/**
 * What the **gateway** answers a basket read with: core's view plus the products
 * it names (velista `0044`, section 4.4).
 *
 * An HTTP shape rather than a NATS one, like `joinResult` and
 * `participantTokenResult` above it, and for the same reason: core holds the
 * basket and references products by an opaque id, catalog holds the products, and
 * neither can answer alone.
 */
const basketResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.basketResult,
  {
    id: nonEmptyString(),
    name: nullableString(),
    status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
    generatedAt: nonEmptyString(),
    lines: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView)),
    participants: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView)),
    me: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView),
    seesZoneData: boolean(),
    sourceSnapshot: ref(GENERATED_LIST_SCHEMA_IDS.sourceSnapshot),
    sourceNames: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.sourceName)),
    products: array(ref(CATALOG_SCHEMA_IDS.itemView)),
  },
  [
    'id',
    'name',
    'status',
    'generatedAt',
    'lines',
    'participants',
    'me',
    'seesZoneData',
    'products',
  ]
);

/**
 * The basket room's line event (section 10), redacted to the least privileged
 * reader in the room, because a broadcast cannot be projected per socket.
 */
const lineMovedEvent = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.lineMovedEvent,
  {
    generatedListId: nonEmptyString(),
    line: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView),
  },
  ['generatedListId', 'line']
);

/**
 * One list's contribution to a basket line (plan 0057, section 3.1).
 *
 * The three quantities are all required and all different: what this list put
 * into the basket, what its own line asks for now, and what has already been
 * bought against it. They diverge the moment anybody edits either side, and a
 * sheet showing one of them without the others is how somebody sets a number
 * that looks right and is not.
 */
const lineOriginDetail = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginDetail,
  {
    originId: nonEmptyString(),
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    zoneId: nonEmptyString(),
    // Null rather than absent: a basket outlives the lists it drew from, and a
    // name nobody can supply is better null than invented.
    listName: nullableString(),
    zoneName: nullableString(),
    contributed: integer({ minimum: 0 }),
    listQuantity: integer({ minimum: 0 }),
    settledHere: integer({ minimum: 0 }),
    writable: boolean(),
  },
  [
    'originId',
    'listId',
    'lineId',
    'zoneId',
    'listName',
    'zoneName',
    'contributed',
    'listQuantity',
    'settledHere',
    'writable',
  ]
);

/**
 * A list holding the same thing that is not an origin yet (section 3.2).
 *
 * `unavailable` is **optional**, which is the whole of the redaction-free half
 * of this shape: a candidate that can be adopted says nothing about why it could
 * not be, and one that cannot is served with its reason rather than filtered out.
 */
const originCandidate = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.originCandidate,
  {
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    zoneId: nonEmptyString(),
    listName: nullableString(),
    zoneName: nullableString(),
    listQuantity: integer({ minimum: 0 }),
    content: string(),
    matchedOnText: boolean(),
    unavailable: ref(ENUM_IDS.originUnavailableReason),
  },
  [
    'listId',
    'lineId',
    'zoneId',
    'listName',
    'zoneName',
    'listQuantity',
    'content',
    'matchedOnText',
  ]
);

const lineOriginsResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginsResult,
  {
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
    origins: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginDetail)),
    candidates: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.originCandidate)),
  },
  ['generatedListId', 'lineId', 'origins', 'candidates']
);

/**
 * What setting a contribution did (plan 0057, section 6).
 *
 * **No settlement refs and no skip report**, and that absence is the contract
 * rather than an omission: the same control one screen up means "bought", and a
 * client must not be able to draw "got it" from a response the server never made.
 */
const setOriginQuantityResult = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.setOriginQuantityResult,
  {
    line: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView),
    // Null when the contribution was set to zero and the list left the line
    // (section 5.3), which is a state rather than a failure to answer.
    origin: {
      oneOf: [
        ref(GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginDetail),
        { type: 'null' },
      ],
    },
    listQuantity: integer({ minimum: 0 }),
  },
  ['line', 'origin', 'listQuantity']
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

/**
 * Read a basket as a participant. No `userId`, deliberately: the participant id
 * is the whole of the identity here, and an owner arrives as their own
 * participant row like everybody else.
 */
const basketRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.basketRequest,
  { generatedListId: nonEmptyString(), participantId: nonEmptyString() },
  ['generatedListId', 'participantId']
);

const setPickRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.setPickRequest,
  {
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
    participantId: nonEmptyString(),
    itemId: nonEmptyString(),
  },
  ['generatedListId', 'lineId', 'participantId', 'itemId']
);

const joinRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.joinRequest,
  {
    secret: nonEmptyString(),
    displayName: string(),
    userId: nonEmptyString(),
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

const settleRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.settleRequest,
  {
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
    participantId: nonEmptyString(),
    outcome: ref(ENUM_IDS.settlementOutcome),
    quantity: integer({ minimum: 1 }),
    allocations: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.allocationEntry)),
    itemId: nonEmptyString(),
  },
  ['generatedListId', 'lineId', 'participantId', 'outcome']
);

const lineOriginsRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginsRequest,
  {
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
    participantId: nonEmptyString(),
  },
  ['generatedListId', 'lineId', 'participantId']
);

/**
 * Set one list's contribution (plan 0057, section 5).
 *
 * `quantity` may be zero, which is what takes the list off the line, and `from`
 * may be zero, which is what an adoption always sends. Neither is a floor
 * expressed here: the real floor is per origin and per basket, and only the
 * service can know it.
 */
const setOriginQuantityRequest = object(
  GENERATED_LIST_SHARING_SCHEMA_IDS.setOriginQuantityRequest,
  {
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
    participantId: nonEmptyString(),
    sourceListId: nonEmptyString(),
    sourceLineId: nonEmptyString(),
    quantity: integer({ minimum: 0 }),
    from: integer({ minimum: 0 }),
  },
  [
    'generatedListId',
    'lineId',
    'participantId',
    'sourceListId',
    'sourceLineId',
    'quantity',
    'from',
  ]
);

export const generatedListSharingSchemas: JsonSchema[] = [
  shareLinkView,
  shareLinkResult,
  participantView,
  participantListResult,
  linkPreview,
  joinCoreResult,
  joinResult,
  participantTokenResult,
  participantContext,
  settlementRef,
  settleSkip,
  allocationEntry,
  settleResult,
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
  settleRequest,
  basketLineView,
  basketView,
  basketResult,
  sourceName,
  lineMovedEvent,
  basketRequest,
  setPickRequest,
  lineOriginDetail,
  originCandidate,
  lineOriginsRequest,
  lineOriginsResult,
  setOriginQuantityRequest,
  setOriginQuantityResult,
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
  [GENERATED_LIST_SHARING_PATTERNS.participantResolve]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.resolveParticipantRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.participantContext,
  },
  [GENERATED_LIST_SHARING_PATTERNS.participantRefresh]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.resolveParticipantRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.participantTokenResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.settleLine]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.settleRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.settleResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.basketGet]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.basketRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.basketView,
  },
  [GENERATED_LIST_SHARING_PATTERNS.setPick]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.setPickRequest,
    // The same shape a settle answers with, and for the same reason: both move
    // one line, and the screen updates one row from either.
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.basketLineView,
  },
  [GENERATED_LIST_SHARING_PATTERNS.lineOrigins]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginsRequest,
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.lineOriginsResult,
  },
  [GENERATED_LIST_SHARING_PATTERNS.setOriginQuantity]: {
    request: GENERATED_LIST_SHARING_SCHEMA_IDS.setOriginQuantityRequest,
    // Deliberately **not** the settle result (plan 0057, section 6): no
    // settlement refs and no skip report, because this bought nothing.
    response: GENERATED_LIST_SHARING_SCHEMA_IDS.setOriginQuantityResult,
  },
};
