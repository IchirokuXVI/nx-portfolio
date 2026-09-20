import {
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
} from '../../lib/enums/basket.enums';
import { BASKET_PATTERNS } from '../../lib/messages/basket.messages';
import { LINE_QUANTITY_MAX } from '../../lib/messages/list.messages';
import {
  array,
  boolean,
  enumOf,
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
import { GENERATED_LIST_SHARING_SCHEMA_IDS } from './generated-list-sharing.schemas';
import { GENERATED_LIST_SCHEMA_IDS } from './generated-list.schemas';

/**
 * The basket, as a language neutral contract (plan 0136).
 *
 * Every shape here carries `additionalProperties: false`, which is what keeps a
 * field reaching the wire without a schema from happening again: `waitingSettled`
 * did exactly that, and the sharing schemas never listed it.
 */
export const BASKET_SCHEMA_IDS = {
  rowState: schemaId('enums/BasketRowState'),
  rowNote: schemaId('enums/BasketRowNote'),
  rowMark: schemaId('enums/BasketRowMark'),
  listRef: schemaId('basket/BasketListRef'),
  rowEntryView: schemaId('basket/BasketRowEntryView'),
  rowView: schemaId('basket/BasketRowView'),
  progress: schemaId('basket/BasketProgress'),
  view: schemaId('basket/BasketView'),
  summaryView: schemaId('basket/BasketSummaryView'),
  /** The gateway's composed answer: core's view plus the catalog half. */
  result: schemaId('basket/BasketResult'),
  priceScopeView: schemaId('basket/BasketPriceScopeView'),
  scopeLocationView: schemaId('basket/BasketScopeLocationView'),
  allocationEntry: schemaId('basket/BasketAllocationEntry'),
  rowResult: schemaId('basket/BasketRowResult'),
  searchScope: schemaId('basket/BasketSearchScope'),
  getRequest: schemaId('msg/basket.get/request'),
  liveRequest: schemaId('msg/basket.live/request'),
  settleRequest: schemaId('msg/basket.row.settle/request'),
  revertRequest: schemaId('msg/basket.row.revert/request'),
  demandRequest: schemaId('msg/basket.row.demand/request'),
  renameRequest: schemaId('msg/basket.row.rename/request'),
  skipRequest: schemaId('msg/basket.row.skip/request'),
  addLineRequest: schemaId('msg/basket.line.add/request'),
} as const;

const rowState = enumOf(
  BASKET_SCHEMA_IDS.rowState,
  Object.values(BasketRowState)
);
const rowNote = enumOf(BASKET_SCHEMA_IDS.rowNote, Object.values(BasketRowNote));
const rowMark = enumOf(BASKET_SCHEMA_IDS.rowMark, Object.values(BasketRowMark));

const listRef = object(
  BASKET_SCHEMA_IDS.listRef,
  {
    listId: nonEmptyString(),
    name: string(),
    zoneId: nonEmptyString(),
    zoneName: string(),
  },
  ['listId', 'name', 'zoneId', 'zoneName']
);

const rowEntryView = object(
  BASKET_SCHEMA_IDS.rowEntryView,
  {
    lineId: nonEmptyString(),
    // Optional and never null: a list the reader does not write is absent
    // rather than nulled (plan 0130, section 6). Redaction by absence is the
    // rule, so the schema must not make the field mandatory.
    listId: nonEmptyString(),
    left: integer({ minimum: 0 }),
    bought: integer({ minimum: 0 }),
    state: ref(BASKET_SCHEMA_IDS.rowState),
    approvalStatus: ref(ENUM_IDS.lineApprovalStatus),
    demandEditable: boolean(),
  },
  ['lineId', 'left', 'bought', 'state', 'approvalStatus', 'demandEditable']
);

const rowView = object(
  BASKET_SCHEMA_IDS.rowView,
  {
    rowKey: nonEmptyString(),
    content: string(),
    left: integer({ minimum: 0 }),
    bought: integer({ minimum: 0 }),
    asked: integer({ minimum: 0 }),
    state: ref(BASKET_SCHEMA_IDS.rowState),
    note: { anyOf: [ref(BASKET_SCHEMA_IDS.rowNote), { type: 'null' }] },
    noteAt: nullableString(),
    mark: { anyOf: [ref(BASKET_SCHEMA_IDS.rowMark), { type: 'null' }] },
    awaitingApproval: boolean(),
    optionIds: array(nonEmptyString()),
    touchedBy: nullableString(),
    touchedAt: nullableString(),
    entries: array(ref(BASKET_SCHEMA_IDS.rowEntryView)),
  },
  [
    'rowKey',
    'content',
    'left',
    'bought',
    'asked',
    'state',
    'note',
    'noteAt',
    'mark',
    'awaitingApproval',
    'optionIds',
    'touchedBy',
    'touchedAt',
    'entries',
  ]
);

const progress = object(
  BASKET_SCHEMA_IDS.progress,
  {
    done: integer({ minimum: 0 }),
    unavailable: integer({ minimum: 0 }),
    total: integer({ minimum: 0 }),
    pending: integer({ minimum: 0 }),
  },
  ['done', 'unavailable', 'total', 'pending']
);

/** Core's own answer. The gateway's adds `products` and `scopes` below. */
const viewProperties = {
  id: nonEmptyString(),
  kind: ref(GENERATED_LIST_SCHEMA_IDS.basketKind),
  name: nullableString(),
  status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
  createdAt: nonEmptyString(),
  rows: array(ref(BASKET_SCHEMA_IDS.rowView)),
  lists: array(ref(BASKET_SCHEMA_IDS.listRef)),
  participants: array(ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView)),
  me: ref(GENERATED_LIST_SHARING_SCHEMA_IDS.participantView),
  progress: ref(BASKET_SCHEMA_IDS.progress),
  truncated: boolean(),
  servesLocations: boolean(),
  // What this viewer has not seen (plan 0138, section 7). Both are required, so
  // a client can draw the banner without asking whether the server told it.
  unseenChangeCount: integer({ minimum: 0 }),
  newestUnseenChangeId: nullableString(),
};

const viewRequired = [
  'id',
  'kind',
  'name',
  'status',
  'createdAt',
  'rows',
  'lists',
  'participants',
  'me',
  'progress',
  'truncated',
  'servesLocations',
  'unseenChangeCount',
  'newestUnseenChangeId',
];

const view = object(BASKET_SCHEMA_IDS.view, viewProperties, viewRequired);

const summaryView = object(
  BASKET_SCHEMA_IDS.summaryView,
  {
    id: nonEmptyString(),
    kind: ref(GENERATED_LIST_SCHEMA_IDS.basketKind),
    progress: ref(BASKET_SCHEMA_IDS.progress),
  },
  ['id', 'kind', 'progress']
);

const scopeLocationView = object(
  BASKET_SCHEMA_IDS.scopeLocationView,
  {
    supermarketLocationId: nonEmptyString(),
    label: { anyOf: [ref(CATALOG_SCHEMA_IDS.localizedText), { type: 'null' }] },
    address: nullableString(),
    city: nullableString(),
    postalCode: nullableString(),
  },
  ['supermarketLocationId', 'label', 'address', 'city', 'postalCode']
);

const priceScopeView = object(
  BASKET_SCHEMA_IDS.priceScopeView,
  {
    priceScopeId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    supermarketName: ref(CATALOG_SCHEMA_IDS.localizedText),
    locations: array(ref(BASKET_SCHEMA_IDS.scopeLocationView)),
  },
  ['priceScopeId', 'supermarketId', 'supermarketName', 'locations']
);

const result = object(
  BASKET_SCHEMA_IDS.result,
  {
    ...viewProperties,
    products: array(ref(CATALOG_SCHEMA_IDS.itemView)),
    // Required and possibly empty, never absent: nothing about it is redacted
    // as a whole, only the shops inside each entry are.
    scopes: array(ref(BASKET_SCHEMA_IDS.priceScopeView)),
  },
  [...viewRequired, 'products', 'scopes']
);

const allocationEntry = object(
  BASKET_SCHEMA_IDS.allocationEntry,
  {
    lineId: nonEmptyString(),
    quantity: integer({ minimum: 0, maximum: LINE_QUANTITY_MAX }),
  },
  ['lineId', 'quantity']
);

const rowResult = object(
  BASKET_SCHEMA_IDS.rowResult,
  {
    row: ref(BASKET_SCHEMA_IDS.rowView),
    progress: ref(BASKET_SCHEMA_IDS.progress),
    skippedCount: integer({ minimum: 0 }),
    replacedRowKey: nonEmptyString(),
  },
  ['row', 'progress']
);

const searchScope = object(
  BASKET_SCHEMA_IDS.searchScope,
  {
    ownerUserId: nonEmptyString(),
    profileId: nullableString(),
  },
  ['ownerUserId', 'profileId']
);

const getRequest = object(
  BASKET_SCHEMA_IDS.getRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
  },
  ['basketId', 'participantId']
);

const liveRequest = object(
  BASKET_SCHEMA_IDS.liveRequest,
  { userId: nonEmptyString() },
  ['userId']
);

const settleRequest = object(
  BASKET_SCHEMA_IDS.settleRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
    outcome: ref(ENUM_IDS.settlementOutcome),
    quantity: integer({ minimum: 1, maximum: LINE_QUANTITY_MAX }),
    from: integer({ minimum: 0 }),
    itemId: nonEmptyString(),
    allocations: array(ref(BASKET_SCHEMA_IDS.allocationEntry)),
  },
  ['basketId', 'participantId', 'rowKey', 'outcome', 'from']
);

/**
 * The two targets of a revert, as one schema with a discriminating `target`.
 *
 * A `oneOf` over the two members would be the faithful rendering, and it renders
 * badly in the published OpenAPI document, where a client author reads one
 * request body. So the members are flattened and `units` and `from` are optional,
 * which the service then requires for `UNITS` and refuses for `CLOSE`.
 */
const revertRequest = object(
  BASKET_SCHEMA_IDS.revertRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
    target: { type: 'string', enum: ['UNITS', 'CLOSE'] },
    units: integer({ minimum: 1, maximum: LINE_QUANTITY_MAX }),
    from: integer({ minimum: 0 }),
  },
  ['basketId', 'participantId', 'rowKey', 'target']
);

const demandRequest = object(
  BASKET_SCHEMA_IDS.demandRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
    lineId: nonEmptyString(),
    quantity: integer({ minimum: 0, maximum: LINE_QUANTITY_MAX }),
    from: integer({ minimum: 0 }),
  },
  ['basketId', 'participantId', 'rowKey', 'quantity', 'from']
);

const renameRequest = object(
  BASKET_SCHEMA_IDS.renameRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    userId: nonEmptyString(),
    rowKey: nonEmptyString(),
    content: nonEmptyString(),
    confirmMerge: boolean(),
  },
  ['basketId', 'participantId', 'userId', 'rowKey', 'content']
);

/**
 * One shape for both directions of a skip (plan 0137, section 5).
 *
 * The `PUT` and the `DELETE` take the same three fields, all of them from the
 * path and the guard, so one schema serves both patterns and neither takes a
 * body.
 */
const skipRequest = object(
  BASKET_SCHEMA_IDS.skipRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
  },
  ['basketId', 'participantId', 'rowKey']
);

const addLineRequest = object(
  BASKET_SCHEMA_IDS.addLineRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    userId: nonEmptyString(),
    targetListId: nonEmptyString(),
    content: nonEmptyString(),
    quantity: integer({ minimum: 0, maximum: LINE_QUANTITY_MAX }),
    itemIds: array(nonEmptyString()),
  },
  ['basketId', 'participantId', 'userId', 'targetListId', 'content']
);

export const basketSchemas: JsonSchema[] = [
  rowState,
  rowNote,
  rowMark,
  listRef,
  rowEntryView,
  rowView,
  progress,
  view,
  summaryView,
  scopeLocationView,
  priceScopeView,
  result,
  allocationEntry,
  rowResult,
  searchScope,
  getRequest,
  liveRequest,
  settleRequest,
  revertRequest,
  demandRequest,
  renameRequest,
  addLineRequest,
];

export const basketMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [BASKET_PATTERNS.live]: {
    request: BASKET_SCHEMA_IDS.liveRequest,
    response: BASKET_SCHEMA_IDS.view,
  },
  [BASKET_PATTERNS.liveSummary]: {
    request: BASKET_SCHEMA_IDS.liveRequest,
    response: BASKET_SCHEMA_IDS.summaryView,
  },
  [BASKET_PATTERNS.get]: {
    request: BASKET_SCHEMA_IDS.getRequest,
    response: BASKET_SCHEMA_IDS.view,
  },
  [BASKET_PATTERNS.rowSettle]: {
    request: BASKET_SCHEMA_IDS.settleRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.rowRevert]: {
    request: BASKET_SCHEMA_IDS.revertRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.rowDemand]: {
    request: BASKET_SCHEMA_IDS.demandRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.rowRename]: {
    request: BASKET_SCHEMA_IDS.renameRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.rowSkip]: {
    request: BASKET_SCHEMA_IDS.skipRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.rowUnskip]: {
    request: BASKET_SCHEMA_IDS.skipRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.lineAdd]: {
    request: BASKET_SCHEMA_IDS.addLineRequest,
    response: BASKET_SCHEMA_IDS.rowResult,
  },
  [BASKET_PATTERNS.searchScope]: {
    request: BASKET_SCHEMA_IDS.getRequest,
    response: BASKET_SCHEMA_IDS.searchScope,
  },
};
