import {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  BasketRowUsualState,
  BasketStatus,
} from '../../lib/enums/basket.enums';
import { BASKET_SHARING_LIMITS } from '../../lib/messages/basket-sharing.messages';
import {
  BASKET_LIMITS,
  BASKET_PATTERNS,
  BASKET_USUAL_WINDOW,
} from '../../lib/messages/basket.messages';
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
  paginated,
  ref,
  schemaId,
  string,
} from '../builders';
import { COMMON_IDS } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';
import { AUTH_SCHEMA_IDS } from './auth.schemas';
import { BASKET_SHARING_SCHEMA_IDS } from './basket-sharing.schemas';
import {
  CATALOG_SCHEMA_IDS,
  itemViewProperties,
  itemViewRequired,
} from './catalog.schemas';
import { LIST_SCHEMA_IDS } from './list.schemas';

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
  // Where a row is usually bought, at the read's chain (plan 0165).
  rowUsualState: schemaId('enums/BasketRowUsualState'),
  rowUsualView: schemaId('basket/BasketRowUsualView'),
  progress: schemaId('basket/BasketProgress'),
  view: schemaId('basket/BasketView'),
  summaryView: schemaId('basket/BasketSummaryView'),
  /** The gateway's composed answer: core's view plus the catalog half. */
  result: schemaId('basket/BasketResult'),
  priceScopeView: schemaId('basket/BasketPriceScopeView'),
  scopeLocationView: schemaId('basket/BasketScopeLocationView'),
  // A read at a shop (plan 0163): the basket's own shop, and each product at it.
  shopView: schemaId('basket/BasketShopView'),
  productView: schemaId('basket/BasketProductView'),
  productAtShopView: schemaId('basket/BasketProductAtShopView'),
  allocationEntry: schemaId('basket/BasketAllocationEntry'),
  rowResult: schemaId('basket/BasketRowResult'),
  searchScope: schemaId('basket/BasketSearchScope'),
  getRequest: schemaId('msg/basket.get/request'),
  searchScopeRequest: schemaId('msg/basket.searchScope/request'),
  liveRequest: schemaId('msg/basket.live/request'),
  settleRequest: schemaId('msg/basket.row.settle/request'),
  revertRequest: schemaId('msg/basket.row.revert/request'),
  demandRequest: schemaId('msg/basket.row.demand/request'),
  renameRequest: schemaId('msg/basket.row.rename/request'),
  skipRequest: schemaId('msg/basket.row.skip/request'),
  addLineRequest: schemaId('msg/basket.line.add/request'),
  basketKind: schemaId('enums/BasketKind'),
  basketStatus: schemaId('enums/BasketStatus'),
  basketSourceView: schemaId('basket/BasketSourceView'),
  /** The header a run answers: the basket's own fields and its sources. */
  headerView: schemaId('basket/BasketHeaderView'),
  /** One row of the history listing (plan 0050, section 7). */
  historyView: schemaId('basket/BasketHistoryView'),
  runResult: schemaId('basket/BasketRunResult'),
  page: schemaId('basket/BasketPage'),
  sourceInput: schemaId('basket/BasketSourceInput'),
  createRequest: schemaId('msg/basket.create/request'),
  idRequest: schemaId('msg/basket.id/request'),
  listMineRequest: schemaId('msg/basket.listMine/request'),
  updateRequest: schemaId('msg/basket.update/request'),
  // The baskets shared with the caller (plan 0114, section 8).
  listSharedRequest: schemaId('msg/basket.listShared/request'),
  sharedCoreView: schemaId('basket/SharedBasketCoreView'),
  sharedCorePage: schemaId('basket/SharedBasketCorePage'),
  ownerView: schemaId('basket/BasketOwnerView'),
  /** The gateway's composed row: core's, with the owner named (section 9). */
  sharedView: schemaId('basket/SharedBasketView'),
  sharedPage: schemaId('basket/SharedBasketPage'),
} as const;

const rowState = enumOf(
  BASKET_SCHEMA_IDS.rowState,
  Object.values(BasketRowState)
);
const rowNote = enumOf(BASKET_SCHEMA_IDS.rowNote, Object.values(BasketRowNote));
const rowMark = enumOf(BASKET_SCHEMA_IDS.rowMark, Object.values(BasketRowMark));
const rowUsualState = enumOf(
  BASKET_SCHEMA_IDS.rowUsualState,
  Object.values(BasketRowUsualState)
);

/** Counts only (plan 0165, section 2): no person, no time, no other chain. */
const rowUsualView = object(
  BASKET_SCHEMA_IDS.rowUsualView,
  {
    state: ref(BASKET_SCHEMA_IDS.rowUsualState),
    bought: integer({ minimum: 0, maximum: BASKET_USUAL_WINDOW }),
    of: integer({ minimum: 0, maximum: BASKET_USUAL_WINDOW }),
  },
  ['state', 'bought', 'of']
);

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
    // Required and nullable: null means the read had no shop (plan 0165).
    usual: { anyOf: [ref(BASKET_SCHEMA_IDS.rowUsualView), { type: 'null' }] },
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
    'usual',
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
  kind: ref(BASKET_SCHEMA_IDS.basketKind),
  name: nullableString(),
  status: ref(BASKET_SCHEMA_IDS.basketStatus),
  createdAt: nonEmptyString(),
  rows: array(ref(BASKET_SCHEMA_IDS.rowView)),
  lists: array(ref(BASKET_SCHEMA_IDS.listRef)),
  participants: array(ref(BASKET_SHARING_SCHEMA_IDS.participantView)),
  me: ref(BASKET_SHARING_SCHEMA_IDS.participantView),
  progress: ref(BASKET_SCHEMA_IDS.progress),
  truncated: boolean(),
  servesLocations: boolean(),
  // What this viewer has not seen (plan 0138, section 7). Both are required, so
  // a client can draw the banner without asking whether the server told it.
  unseenChangeCount: integer({ minimum: 0 }),
  newestUnseenChangeId: nullableString(),
  // The shop the basket was started at (plan 0163). Null on every `LIVE`
  // basket, and required, so a client can tell "no shop" from "not told".
  supermarketLocationId: nullableString(),
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
  'supermarketLocationId',
];

const view = object(BASKET_SCHEMA_IDS.view, viewProperties, viewRequired);

const summaryView = object(
  BASKET_SCHEMA_IDS.summaryView,
  {
    id: nonEmptyString(),
    kind: ref(BASKET_SCHEMA_IDS.basketKind),
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

const shopView = object(
  BASKET_SCHEMA_IDS.shopView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    supermarketName: ref(CATALOG_SCHEMA_IDS.localizedText),
    label: { anyOf: [ref(CATALOG_SCHEMA_IDS.localizedText), { type: 'null' }] },
    address: nullableString(),
    city: nullableString(),
    postalCode: nullableString(),
    inProfile: boolean(),
  },
  [
    'id',
    'supermarketId',
    'supermarketName',
    'label',
    'address',
    'city',
    'postalCode',
    'inProfile',
  ]
);

const productAtShopView = object(
  BASKET_SCHEMA_IDS.productAtShopView,
  {
    priceScopeId: nullableString(),
    price: { type: ['number', 'null'] },
    currency: nullableString(),
    // The stored value, or null when the shop holds no row for the product.
    available: { type: ['boolean', 'null'] },
  },
  ['priceScopeId', 'price', 'currency', 'available']
);

// A catalog product plus what the read's shop says about it. The product's own
// fields are catalog's, listed once over there.
const productView = object(
  BASKET_SCHEMA_IDS.productView,
  {
    ...itemViewProperties,
    atShop: {
      anyOf: [ref(BASKET_SCHEMA_IDS.productAtShopView), { type: 'null' }],
    },
  },
  [...itemViewRequired, 'atShop']
);

const result = object(
  BASKET_SCHEMA_IDS.result,
  {
    ...viewProperties,
    products: array(ref(BASKET_SCHEMA_IDS.productView)),
    // The basket's own shop, named (plan 0163). Null when it has none, or when
    // catalog could not name it this time.
    shop: { anyOf: [ref(BASKET_SCHEMA_IDS.shopView), { type: 'null' }] },
    // Required and possibly empty, never absent: nothing about it is redacted
    // as a whole, only the shops inside each entry are.
    scopes: array(ref(BASKET_SCHEMA_IDS.priceScopeView)),
  },
  [...viewRequired, 'products', 'shop', 'scopes']
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
    // The actor's flag, where the two above it are the basket's: whether this
    // participant is served shop addresses (plan 0136, section 2). The settle
    // of plan 0143 reads it here rather than reading a whole basket for one
    // boolean.
    servesLocations: boolean(),
    // Only when the request named a row: which product a settle that names
    // none records there, answered by core, which writes it (plan 0151).
    pick: ref(LIST_SCHEMA_IDS.settlePick),
    // The basket's own shop, which a settle records and may not contradict
    // (plan 0163, section 5).
    supermarketLocationId: nullableString(),
  },
  ['ownerUserId', 'profileId', 'servesLocations', 'supermarketLocationId']
);

const getRequest = object(
  BASKET_SCHEMA_IDS.getRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    // The read's chain, sent when the read has a shop (plan 0165).
    supermarketId: nonEmptyString(),
  },
  ['basketId', 'participantId']
);

const searchScopeRequest = object(
  BASKET_SCHEMA_IDS.searchScopeRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
  },
  ['basketId', 'participantId']
);

const liveRequest = object(
  BASKET_SCHEMA_IDS.liveRequest,
  { userId: nonEmptyString(), supermarketId: nonEmptyString() },
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
    // Written by the gateway (plan 0143). A client body has no field for it.
    paid: ref(LIST_SCHEMA_IDS.settlementPaid),
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





// --- Schemas for the header, the history and the run (plan 0050) -------------

// What an owner's line edit answers: the surviving line, and the basket line a
// rename merged away when there was one (plan 0113). Absent when nothing merged.
/**
 * One source of a basket, as it was named (plan 0133, section 4).
 *
 * A registered schema of its own rather than an object inlined into the views
 * that hold it, and that is a rule of this file rather than a preference: a
 * nested `$id` opens a new resolution scope inside its parent, which leaves the
 * sibling schemas registered after it unreachable and turns every `$ref` to them
 * into "can't resolve reference" at compile time. Every schema here is top level
 * and referenced by id.
 *
 * `listId` is nullable and null is the meaning rather than the absence: it says
 * every list of the zone the owner can write.
 */
const basketSourceView = object(
  BASKET_SCHEMA_IDS.basketSourceView,
  { zoneId: nonEmptyString(), listId: nullableString() },
  ['zoneId', 'listId']
);

const headerView = object(
  BASKET_SCHEMA_IDS.headerView,
  {
    id: nonEmptyString(),
    kind: ref(BASKET_SCHEMA_IDS.basketKind),
    // Null is the value the client renders as the generation date, because core
    // has no locale to render it in (plan 0050, section 1).
    name: nullableString(),
    status: ref(BASKET_SCHEMA_IDS.basketStatus),
    generatedAt: nonEmptyString(),
    sources: array(ref(BASKET_SCHEMA_IDS.basketSourceView)),
    // The shop the basket was started at, fixed for its life (plan 0163).
    supermarketLocationId: nullableString(),
  },
  [
    'id',
    'kind',
    'name',
    'status',
    'generatedAt',
    'sources',
    'supermarketLocationId',
  ]
);

const historyViewProperties = {
  id: nonEmptyString(),
  kind: ref(BASKET_SCHEMA_IDS.basketKind),
  name: nullableString(),
  status: ref(BASKET_SCHEMA_IDS.basketStatus),
  generatedAt: nonEmptyString(),
  lineCount: integer({ minimum: 0 }),
  settledLineCount: integer({ minimum: 0 }),
  boughtLineCount: integer({ minimum: 0 }),
  notAvailableLineCount: integer({ minimum: 0 }),
  presentCount: integer({ minimum: 0 }),
};

const historyViewRequired = [
  'id',
  'kind',
  'name',
  'status',
  'generatedAt',
  'lineCount',
  'settledLineCount',
  'boughtLineCount',
  'notAvailableLineCount',
  'presentCount',
];

const historyView = object(
  BASKET_SCHEMA_IDS.historyView,
  historyViewProperties,
  historyViewRequired
);

// A shared basket as core answers it (plan 0114, section 8): a history row, its
// owner, the owner's name in the one group the two people share, and the date.
const sharedCoreView = object(
  BASKET_SCHEMA_IDS.sharedCoreView,
  {
    ...historyViewProperties,
    ownerUserId: nonEmptyString(),
    // Null when the two people share no approved group or several, which is the
    // gateway's cue to ask auth for the global name (section 9).
    ownerZoneUsername: nullableString(),
    sharedAt: nonEmptyString(),
  },
  [...historyViewRequired, 'ownerUserId', 'ownerZoneUsername', 'sharedAt']
);

const ownerView = object(
  BASKET_SCHEMA_IDS.ownerView,
  { userId: nonEmptyString(), name: string() },
  ['userId', 'name']
);

// The same row once the gateway has named the owner, which is what the route
// answers.
const sharedView = object(
  BASKET_SCHEMA_IDS.sharedView,
  {
    ...historyViewProperties,
    owner: ref(BASKET_SCHEMA_IDS.ownerView),
    sharedAt: nonEmptyString(),
  },
  [...historyViewRequired, 'owner', 'sharedAt']
);

const runResult = object(
  BASKET_SCHEMA_IDS.runResult,
  {
    basket: ref(BASKET_SCHEMA_IDS.headerView),
    // The same value under its old key, for one release (plan 0159).
    list: {
      ...ref(BASKET_SCHEMA_IDS.headerView),
      deprecated: true,
      description: 'The same value as `basket`. Read `basket`.',
    },
  },
  ['basket', 'list']
);

const sourceInput = object(
  BASKET_SCHEMA_IDS.sourceInput,
  { zoneId: nonEmptyString(), listId: nullableString() },
  ['zoneId']
);

const createRequest = object(
  BASKET_SCHEMA_IDS.createRequest,
  {
    userId: nonEmptyString(),
    sources: array(ref(BASKET_SCHEMA_IDS.sourceInput)),
    profileId: nonEmptyString(),
    name: {
      type: ['string', 'null'],
      maxLength: BASKET_LIMITS.nameMaxLength,
    },
    defaultTargetListId: nullableString(),
    idempotencyKey: nonEmptyString(),
    // The people to share the basket with as it is created (plan 0114, section 4).
    memberUserIds: {
      ...array(nonEmptyString()),
      maxItems: BASKET_SHARING_LIMITS.maxParticipants - 1,
      uniqueItems: true,
    },
    globalUsernames: array(ref(AUTH_SCHEMA_IDS.userUsernameView)),
    // The shop the basket is bought at, checked by the gateway against catalog
    // before this message is sent (plan 0163, section 1).
    supermarketLocationId: nonEmptyString(),
  },
  ['userId']
);

const idRequest = object(
  BASKET_SCHEMA_IDS.idRequest,
  { userId: nonEmptyString(), basketId: nonEmptyString() },
  ['userId', 'basketId']
);

const listMineRequest = object(
  BASKET_SCHEMA_IDS.listMineRequest,
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
  BASKET_SCHEMA_IDS.listSharedRequest,
  {
    userId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId']
);

const updateRequest = object(
  BASKET_SCHEMA_IDS.updateRequest,
  {
    userId: nonEmptyString(),
    basketId: nonEmptyString(),
    name: {
      type: ['string', 'null'],
      maxLength: BASKET_LIMITS.nameMaxLength,
    },
    status: ref(BASKET_SCHEMA_IDS.basketStatus),
    defaultTargetListId: nullableString(),
  },
  ['userId', 'basketId']
);

export const basketSchemas: JsonSchema[] = [
  rowState,
  rowNote,
  rowMark,
  rowUsualState,
  rowUsualView,
  listRef,
  rowEntryView,
  rowView,
  progress,
  view,
  summaryView,
  scopeLocationView,
  priceScopeView,
  shopView,
  productAtShopView,
  productView,
  result,
  allocationEntry,
  rowResult,
  searchScope,
  getRequest,
  searchScopeRequest,
  liveRequest,
  settleRequest,
  revertRequest,
  demandRequest,
  renameRequest,
  addLineRequest,
  enumOf(BASKET_SCHEMA_IDS.basketKind, Object.values(BasketKind)),
  enumOf(BASKET_SCHEMA_IDS.basketStatus, Object.values(BasketStatus)),
  basketSourceView,
  headerView,
  historyView,
  runResult,
  paginated(BASKET_SCHEMA_IDS.page, BASKET_SCHEMA_IDS.historyView),
  sharedCoreView,
  ownerView,
  sharedView,
  paginated(BASKET_SCHEMA_IDS.sharedCorePage, BASKET_SCHEMA_IDS.sharedCoreView),
  paginated(BASKET_SCHEMA_IDS.sharedPage, BASKET_SCHEMA_IDS.sharedView),
  sourceInput,
  createRequest,
  idRequest,
  listMineRequest,
  listSharedRequest,
  updateRequest,
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
    request: BASKET_SCHEMA_IDS.searchScopeRequest,
    response: BASKET_SCHEMA_IDS.searchScope,
  },
  [BASKET_PATTERNS.create]: {
    request: BASKET_SCHEMA_IDS.createRequest,
    response: BASKET_SCHEMA_IDS.runResult,
  },
  [BASKET_PATTERNS.listMine]: {
    request: BASKET_SCHEMA_IDS.listMineRequest,
    response: BASKET_SCHEMA_IDS.page,
  },
  [BASKET_PATTERNS.listShared]: {
    request: BASKET_SCHEMA_IDS.listSharedRequest,
    // Core's page, with the owner half named. The route answers `sharedPage`,
    // which the gateway composes from this and auth.
    response: BASKET_SCHEMA_IDS.sharedCorePage,
  },
  [BASKET_PATTERNS.update]: {
    request: BASKET_SCHEMA_IDS.updateRequest,
    response: BASKET_SCHEMA_IDS.headerView,
  },
  [BASKET_PATTERNS.delete]: {
    request: BASKET_SCHEMA_IDS.idRequest,
    response: COMMON_IDS.idResult,
  },
};
