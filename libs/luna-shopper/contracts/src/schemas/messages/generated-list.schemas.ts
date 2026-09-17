import {
  GeneratedLineOrigin,
  GeneratedListStatus,
} from '../../lib/enums/generated-list.enums';
import { GENERATED_LIST_SHARING_LIMITS } from '../../lib/messages/generated-list-sharing.messages';
import {
  GENERATED_LIST_LIMITS,
  GENERATED_LIST_PATTERNS,
} from '../../lib/messages/generated-list.messages';
import {
  array,
  boolean,
  enumOf,
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
import { COMMON_IDS } from '../common.schemas';
import { AUTH_SCHEMA_IDS } from './auth.schemas';

/**
 * Generated shopping list schemas (plan 0050, section 9). Core owns the tables and
 * the gateway is the only caller, so these are the contract both sides hold, and
 * the shape plan 0019 documents the HTTP responses from without a hand written
 * DTO.
 *
 * The caps are spread from {@link GENERATED_LIST_LIMITS} rather than written
 * again here, so the schema and the service cannot disagree about what five
 * hundred means.
 */
export const GENERATED_LIST_SCHEMA_IDS = {
  generatedListStatus: schemaId('enums/GeneratedListStatus'),
  generatedLineOrigin: schemaId('enums/GeneratedLineOrigin'),
  lineOriginView: schemaId('generated-list/GeneratedListLineOriginView'),
  lineView: schemaId('generated-list/GeneratedListLineView'),
  sourceSnapshotEntry: schemaId(
    'generated-list/GeneratedListSourceSnapshotEntry'
  ),
  sourceSnapshot: schemaId('generated-list/GeneratedListSourceSnapshot'),
  listView: schemaId('generated-list/GeneratedListView'),
  summaryView: schemaId('generated-list/GeneratedListSummaryView'),
  skippedLineView: schemaId('generated-list/GeneratedListSkippedLineView'),
  runResult: schemaId('generated-list/GeneratedListRunResult'),
  page: schemaId('generated-list/GeneratedListPage'),
  sourceInput: schemaId('generated-list/GeneratedListSourceInput'),
  createRequest: schemaId('msg/generatedList.create/request'),
  idRequest: schemaId('msg/generatedList.id/request'),
  listMineRequest: schemaId('msg/generatedList.listMine/request'),
  updateRequest: schemaId('msg/generatedList.update/request'),
  addLineRequest: schemaId('msg/generatedList.addLine/request'),
  updateLineRequest: schemaId('msg/generatedList.updateLine/request'),
  /** The line, and the basket line a rename merged away (plan 0113). */
  updateLineResult: schemaId('generated-list/UpdateGeneratedListLineResult'),
  lineIdRequest: schemaId('msg/generatedList.lineId/request'),
  reorderRequest: schemaId('msg/generatedList.reorderLines/request'),
  // The baskets shared with the caller (plan 0114, section 8).
  listSharedRequest: schemaId('msg/generatedList.listShared/request'),
  sharedCoreView: schemaId('generated-list/SharedGeneratedListCoreView'),
  sharedCorePage: schemaId('generated-list/SharedGeneratedListCorePage'),
  ownerView: schemaId('generated-list/GeneratedListOwnerView'),
  /** The gateway's composed row: core's, with the owner named (section 9). */
  sharedView: schemaId('generated-list/SharedGeneratedListView'),
  sharedPage: schemaId('generated-list/SharedGeneratedListPage'),
} as const;

const lineOriginView = object(
  GENERATED_LIST_SCHEMA_IDS.lineOriginView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    quantity: integer({ minimum: 0 }),
    settled: integer({ minimum: 0 }),
    lineVersion: integer({ minimum: 1 }),
  },
  ['id', 'zoneId', 'listId', 'lineId', 'quantity', 'settled', 'lineVersion']
);

const lineViewProperties = {
  id: nonEmptyString(),
  content: string(),
  quantity: integer({ minimum: 0 }),
  settledQuantity: integer({ minimum: 0 }),
  // Nullable rather than absent: a free text line has no product identity, so
  // it has no pick to make (plan 0050, section 1).
  itemId: nullableString(),
  options: array(nonEmptyString()),
  origin: ref(GENERATED_LIST_SCHEMA_IDS.generatedLineOrigin),
  targetListId: nullableString(),
  position: integer({ minimum: 0 }),
  origins: array(ref(GENERATED_LIST_SCHEMA_IDS.lineOriginView)),
};

const lineViewRequired = [
  'id',
  'content',
  'quantity',
  'settledQuantity',
  'itemId',
  'options',
  'origin',
  'targetListId',
  'position',
  'origins',
];

const lineView = object(
  GENERATED_LIST_SCHEMA_IDS.lineView,
  lineViewProperties,
  lineViewRequired
);

// What an owner's line edit answers: the surviving line, and the basket line a
// rename merged away when there was one (plan 0113). Absent when nothing merged.
const updateLineResult = object(
  GENERATED_LIST_SCHEMA_IDS.updateLineResult,
  { ...lineViewProperties, absorbedLineId: nonEmptyString() },
  lineViewRequired
);

/**
 * One (zone, list) pair a run actually read.
 *
 * A registered schema of its own rather than an object inlined into the snapshot
 * below, and that is a rule of this file rather than a preference: a nested
 * `$id` opens a new resolution scope inside its parent, which leaves the sibling
 * schemas registered after it unreachable and turns every `$ref` to them into
 * "can't resolve reference" at compile time. Every schema here is top level and
 * referenced by id.
 */
const sourceSnapshotEntry = object(
  GENERATED_LIST_SCHEMA_IDS.sourceSnapshotEntry,
  { zoneId: nonEmptyString(), listId: nonEmptyString() },
  ['zoneId', 'listId']
);

const sourceSnapshot = object(
  GENERATED_LIST_SCHEMA_IDS.sourceSnapshot,
  {
    profileId: nullableString(),
    // Required and nullable, not optional: a run composed before plan 0078 has
    // no such key in its stored `jsonb`, and the mapper reads that absence as
    // null so the wire shape is the same for every run.
    pricingProfileId: nullableString(),
    sources: array(ref(GENERATED_LIST_SCHEMA_IDS.sourceSnapshotEntry)),
  },
  ['profileId', 'pricingProfileId', 'sources']
);

const listView = object(
  GENERATED_LIST_SCHEMA_IDS.listView,
  {
    id: nonEmptyString(),
    // Null is the value the client renders as the generation date, because core
    // has no locale to render it in (plan 0050, section 1).
    name: nullableString(),
    status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
    generatedAt: nonEmptyString(),
    sourceSnapshot: ref(GENERATED_LIST_SCHEMA_IDS.sourceSnapshot),
    lines: array(ref(GENERATED_LIST_SCHEMA_IDS.lineView)),
  },
  ['id', 'name', 'status', 'generatedAt', 'sourceSnapshot', 'lines']
);

const summaryViewProperties = {
  id: nonEmptyString(),
  name: nullableString(),
  status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
  generatedAt: nonEmptyString(),
  lineCount: integer({ minimum: 0 }),
  settledLineCount: integer({ minimum: 0 }),
  boughtLineCount: integer({ minimum: 0 }),
  notAvailableLineCount: integer({ minimum: 0 }),
  presentCount: integer({ minimum: 0 }),
};

const summaryViewRequired = [
  'id',
  'name',
  'status',
  'generatedAt',
  'lineCount',
  'settledLineCount',
  'boughtLineCount',
  'notAvailableLineCount',
  'presentCount',
];

const summaryView = object(
  GENERATED_LIST_SCHEMA_IDS.summaryView,
  summaryViewProperties,
  summaryViewRequired
);

// A shared basket as core answers it (plan 0114, section 8): a history row, its
// owner, the owner's name in the one group the two people share, and the date.
const sharedCoreView = object(
  GENERATED_LIST_SCHEMA_IDS.sharedCoreView,
  {
    ...summaryViewProperties,
    ownerUserId: nonEmptyString(),
    // Null when the two people share no approved group or several, which is the
    // gateway's cue to ask auth for the global name (section 9).
    ownerZoneUsername: nullableString(),
    sharedAt: nonEmptyString(),
  },
  [...summaryViewRequired, 'ownerUserId', 'ownerZoneUsername', 'sharedAt']
);

const ownerView = object(
  GENERATED_LIST_SCHEMA_IDS.ownerView,
  { userId: nonEmptyString(), name: string() },
  ['userId', 'name']
);

// The same row once the gateway has named the owner, which is what the route
// answers.
const sharedView = object(
  GENERATED_LIST_SCHEMA_IDS.sharedView,
  {
    ...summaryViewProperties,
    owner: ref(GENERATED_LIST_SCHEMA_IDS.ownerView),
    sharedAt: nonEmptyString(),
  },
  [...summaryViewRequired, 'owner', 'sharedAt']
);

const skippedLineView = object(
  GENERATED_LIST_SCHEMA_IDS.skippedLineView,
  {
    zoneId: nonEmptyString(),
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    content: string(),
    carriedByGeneratedListId: nonEmptyString(),
  },
  ['zoneId', 'listId', 'lineId', 'content', 'carriedByGeneratedListId']
);

const runResult = object(
  GENERATED_LIST_SCHEMA_IDS.runResult,
  {
    list: ref(GENERATED_LIST_SCHEMA_IDS.listView),
    skipped: array(ref(GENERATED_LIST_SCHEMA_IDS.skippedLineView)),
  },
  ['list', 'skipped']
);

const sourceInput = object(
  GENERATED_LIST_SCHEMA_IDS.sourceInput,
  { zoneId: nonEmptyString(), listId: nullableString() },
  ['zoneId']
);

const createRequest = object(
  GENERATED_LIST_SCHEMA_IDS.createRequest,
  {
    userId: nonEmptyString(),
    sources: array(ref(GENERATED_LIST_SCHEMA_IDS.sourceInput)),
    profileId: nonEmptyString(),
    name: {
      type: ['string', 'null'],
      maxLength: GENERATED_LIST_LIMITS.nameMaxLength,
    },
    defaultTargetListId: nullableString(),
    idempotencyKey: nonEmptyString(),
    // The people to share the basket with as it is created (plan 0114, section 4).
    memberUserIds: {
      ...array(nonEmptyString()),
      maxItems: GENERATED_LIST_SHARING_LIMITS.maxParticipants - 1,
      uniqueItems: true,
    },
    globalUsernames: array(ref(AUTH_SCHEMA_IDS.userUsernameView)),
  },
  ['userId']
);

const idRequest = object(
  GENERATED_LIST_SCHEMA_IDS.idRequest,
  { userId: nonEmptyString(), generatedListId: nonEmptyString() },
  ['userId', 'generatedListId']
);

const listMineRequest = object(
  GENERATED_LIST_SCHEMA_IDS.listMineRequest,
  {
    userId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
    includeArchived: boolean(),
  },
  ['userId']
);

const listSharedRequest = object(
  GENERATED_LIST_SCHEMA_IDS.listSharedRequest,
  {
    userId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId']
);

const updateRequest = object(
  GENERATED_LIST_SCHEMA_IDS.updateRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    name: {
      type: ['string', 'null'],
      maxLength: GENERATED_LIST_LIMITS.nameMaxLength,
    },
    status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
    defaultTargetListId: nullableString(),
  },
  ['userId', 'generatedListId']
);

const addLineRequest = object(
  GENERATED_LIST_SCHEMA_IDS.addLineRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    content: nonEmptyString({
      maxLength: GENERATED_LIST_LIMITS.contentMaxLength,
    }),
    quantity: integer({
      minimum: 1,
      maximum: GENERATED_LIST_LIMITS.maxQuantity,
    }),
    itemId: nullableString(),
    options: array(nonEmptyString()),
    targetListId: nullableString(),
  },
  ['userId', 'generatedListId', 'content']
);

const updateLineRequest = object(
  GENERATED_LIST_SCHEMA_IDS.updateLineRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
    content: nonEmptyString({
      maxLength: GENERATED_LIST_LIMITS.contentMaxLength,
    }),
    quantity: integer({
      minimum: 0,
      maximum: GENERATED_LIST_LIMITS.maxQuantity,
    }),
    itemId: nullableString(),
    targetListId: nullableString(),
    // A new content renames the zone lines too (plan 0113). Anything but `true`
    // refuses such a rename where the name is taken, and writes nothing.
    confirmMerge: boolean(),
  },
  ['userId', 'generatedListId', 'lineId']
);

const lineIdRequest = object(
  GENERATED_LIST_SCHEMA_IDS.lineIdRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    lineId: nonEmptyString(),
  },
  ['userId', 'generatedListId', 'lineId']
);

const reorderRequest = object(
  GENERATED_LIST_SCHEMA_IDS.reorderRequest,
  {
    userId: nonEmptyString(),
    generatedListId: nonEmptyString(),
    lineIds: array(nonEmptyString()),
  },
  ['userId', 'generatedListId', 'lineIds']
);

export const generatedListSchemas: JsonSchema[] = [
  enumOf(
    GENERATED_LIST_SCHEMA_IDS.generatedListStatus,
    Object.values(GeneratedListStatus)
  ),
  enumOf(
    GENERATED_LIST_SCHEMA_IDS.generatedLineOrigin,
    Object.values(GeneratedLineOrigin)
  ),
  lineOriginView,
  lineView,
  sourceSnapshotEntry,
  sourceSnapshot,
  listView,
  summaryView,
  skippedLineView,
  runResult,
  paginated(
    GENERATED_LIST_SCHEMA_IDS.page,
    GENERATED_LIST_SCHEMA_IDS.summaryView
  ),
  sharedCoreView,
  ownerView,
  sharedView,
  paginated(
    GENERATED_LIST_SCHEMA_IDS.sharedCorePage,
    GENERATED_LIST_SCHEMA_IDS.sharedCoreView
  ),
  paginated(
    GENERATED_LIST_SCHEMA_IDS.sharedPage,
    GENERATED_LIST_SCHEMA_IDS.sharedView
  ),
  sourceInput,
  createRequest,
  idRequest,
  listMineRequest,
  listSharedRequest,
  updateRequest,
  addLineRequest,
  updateLineRequest,
  updateLineResult,
  lineIdRequest,
  reorderRequest,
];

export const generatedListMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [GENERATED_LIST_PATTERNS.create]: {
    request: GENERATED_LIST_SCHEMA_IDS.createRequest,
    response: GENERATED_LIST_SCHEMA_IDS.runResult,
  },
  [GENERATED_LIST_PATTERNS.listMine]: {
    request: GENERATED_LIST_SCHEMA_IDS.listMineRequest,
    response: GENERATED_LIST_SCHEMA_IDS.page,
  },
  [GENERATED_LIST_PATTERNS.listShared]: {
    request: GENERATED_LIST_SCHEMA_IDS.listSharedRequest,
    // Core's page, with the owner half named. The route answers `sharedPage`,
    // which the gateway composes from this and auth.
    response: GENERATED_LIST_SCHEMA_IDS.sharedCorePage,
  },
  [GENERATED_LIST_PATTERNS.get]: {
    request: GENERATED_LIST_SCHEMA_IDS.idRequest,
    response: GENERATED_LIST_SCHEMA_IDS.listView,
  },
  [GENERATED_LIST_PATTERNS.update]: {
    request: GENERATED_LIST_SCHEMA_IDS.updateRequest,
    response: GENERATED_LIST_SCHEMA_IDS.listView,
  },
  [GENERATED_LIST_PATTERNS.delete]: {
    request: GENERATED_LIST_SCHEMA_IDS.idRequest,
    response: COMMON_IDS.idResult,
  },
  [GENERATED_LIST_PATTERNS.addLine]: {
    request: GENERATED_LIST_SCHEMA_IDS.addLineRequest,
    response: GENERATED_LIST_SCHEMA_IDS.lineView,
  },
  [GENERATED_LIST_PATTERNS.updateLine]: {
    request: GENERATED_LIST_SCHEMA_IDS.updateLineRequest,
    response: GENERATED_LIST_SCHEMA_IDS.updateLineResult,
  },
  [GENERATED_LIST_PATTERNS.deleteLine]: {
    request: GENERATED_LIST_SCHEMA_IDS.lineIdRequest,
    response: COMMON_IDS.idResult,
  },
  [GENERATED_LIST_PATTERNS.reorderLines]: {
    request: GENERATED_LIST_SCHEMA_IDS.reorderRequest,
    response: GENERATED_LIST_SCHEMA_IDS.listView,
  },
};
