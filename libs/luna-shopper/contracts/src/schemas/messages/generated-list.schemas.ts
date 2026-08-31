import {
  GeneratedLineOrigin,
  GeneratedListStatus,
} from '../../lib/enums/generated-list.enums';
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
  lineOriginView: schemaId('generatedList/GeneratedListLineOriginView'),
  lineView: schemaId('generatedList/GeneratedListLineView'),
  sourceSnapshot: schemaId('generatedList/GeneratedListSourceSnapshot'),
  listView: schemaId('generatedList/GeneratedListView'),
  summaryView: schemaId('generatedList/GeneratedListSummaryView'),
  skippedLineView: schemaId('generatedList/GeneratedListSkippedLineView'),
  runResult: schemaId('generatedList/GeneratedListRunResult'),
  page: schemaId('generatedList/GeneratedListPage'),
  sourceInput: schemaId('generatedList/GeneratedListSourceInput'),
  createRequest: schemaId('msg/generatedList.create/request'),
  idRequest: schemaId('msg/generatedList.id/request'),
  listMineRequest: schemaId('msg/generatedList.listMine/request'),
  updateRequest: schemaId('msg/generatedList.update/request'),
  addLineRequest: schemaId('msg/generatedList.addLine/request'),
  updateLineRequest: schemaId('msg/generatedList.updateLine/request'),
  lineIdRequest: schemaId('msg/generatedList.lineId/request'),
  reorderRequest: schemaId('msg/generatedList.reorderLines/request'),
} as const;

const lineOriginView = object(
  GENERATED_LIST_SCHEMA_IDS.lineOriginView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    quantity: integer({ minimum: 0 }),
    lineVersion: integer({ minimum: 1 }),
  },
  ['id', 'zoneId', 'listId', 'lineId', 'quantity', 'lineVersion']
);

const lineView = object(
  GENERATED_LIST_SCHEMA_IDS.lineView,
  {
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
  },
  [
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
  ]
);

const sourceSnapshot = object(
  GENERATED_LIST_SCHEMA_IDS.sourceSnapshot,
  {
    profileId: nullableString(),
    sources: array(
      object(
        schemaId('generatedList/GeneratedListSourceSnapshotEntry'),
        { zoneId: nonEmptyString(), listId: nonEmptyString() },
        ['zoneId', 'listId']
      )
    ),
  },
  ['profileId', 'sources']
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

const summaryView = object(
  GENERATED_LIST_SCHEMA_IDS.summaryView,
  {
    id: nonEmptyString(),
    name: nullableString(),
    status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
    generatedAt: nonEmptyString(),
    lineCount: integer({ minimum: 0 }),
    settledLineCount: integer({ minimum: 0 }),
  },
  ['id', 'name', 'status', 'generatedAt', 'lineCount', 'settledLineCount']
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
    quantity: integer({ minimum: 1, maximum: GENERATED_LIST_LIMITS.maxQuantity }),
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
    quantity: integer({ minimum: 0, maximum: GENERATED_LIST_LIMITS.maxQuantity }),
    itemId: nullableString(),
    targetListId: nullableString(),
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
  sourceSnapshot,
  listView,
  summaryView,
  skippedLineView,
  runResult,
  paginated(GENERATED_LIST_SCHEMA_IDS.page, GENERATED_LIST_SCHEMA_IDS.summaryView),
  sourceInput,
  createRequest,
  idRequest,
  listMineRequest,
  updateRequest,
  addLineRequest,
  updateLineRequest,
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
    response: GENERATED_LIST_SCHEMA_IDS.lineView,
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
