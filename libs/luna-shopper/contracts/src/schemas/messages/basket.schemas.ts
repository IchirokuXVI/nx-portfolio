import {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  BasketRowUsualState,
  BasketStatus,
} from '../../lib/enums/basket.enums';
import { SettlementOutcome } from '../../lib/enums/list.enums';
import { BASKET_SHARING_LIMITS } from '../../lib/messages/basket-sharing.messages';
import {
  BASKET_ACT_SKIPPED,
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
  // What `basket.linesChanged` carries since plan 0204, and the act both it and
  // the entry view name.
  entryActOutcome: schemaId('enums/BasketEntryActOutcome'),
  entryAct: schemaId('basket/BasketEntryAct'),
  entryPatch: schemaId('basket/BasketEntryPatch'),
  linesChangedEvent: schemaId('event/BasketLinesChangedEvent'),
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
  // The product of a line, and the read that asks which lines need a price
  // (plan 0201, section 1).
  linePick: schemaId('basket/BasketLinePick'),
  priceChoice: schemaId('basket/BasketPriceChoice'),
  priceChoicesView: schemaId('basket/BasketPriceChoicesView'),
  priceChoicesRequest: schemaId('msg/basket.priceChoices/request'),
  livePriceChoicesRequest: schemaId('msg/basket.live.priceChoices/request'),
  // The covered lists that can still take a product (plan 0201, section 5).
  productListView: schemaId('basket/BasketProductListView'),
  productListsView: schemaId('basket/BasketProductListsView'),
  productListsRequest: schemaId('msg/basket.productLists/request'),
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

const entryActOutcome = enumOf(BASKET_SCHEMA_IDS.entryActOutcome, [
  ...Object.values(SettlementOutcome),
  BASKET_ACT_SKIPPED,
]);

const entryAct = object(
  BASKET_SCHEMA_IDS.entryAct,
  {
    participantId: nullableString(),
    at: nonEmptyString(),
    outcome: ref(BASKET_SCHEMA_IDS.entryActOutcome),
  },
  ['participantId', 'at', 'outcome']
);

/**
 * What an entry and a patch of it both state (plan 0204, sections 2 and 5).
 *
 * One object for the two, so a field a patch gains is a field a client already
 * holds on the entry it applies the patch over.
 */
const entryNumbers = {
  lineId: nonEmptyString(),
  version: integer({ minimum: 0 }),
  left: integer({ minimum: 0 }),
  bought: integer({ minimum: 0 }),
  // Bought lately through another basket or through none (plan 0188). A
  // count alone: the row never names who bought.
  boughtElsewhere: integer({ minimum: 0 }),
  state: ref(BASKET_SCHEMA_IDS.rowState),
  approvalStatus: ref(ENUM_IDS.lineApprovalStatus),
  skipped: boolean(),
  closed: boolean(),
  act: { anyOf: [ref(BASKET_SCHEMA_IDS.entryAct), { type: 'null' }] },
  // The product of the latest buy of the line in this trip (plan 0201, section
  // 1; plan 0204, section 7). A product id is catalog data, so a room carries it.
  tripItemId: nullableString(),
};

const entryNumbersRequired = [
  'lineId',
  'version',
  'left',
  'bought',
  'boughtElsewhere',
  'state',
  'approvalStatus',
  'skipped',
  'closed',
  'act',
  'tripItemId',
];

/**
 * The lines a write on a row names (plan 0201, section 4).
 *
 * At least one, so a write that names nothing is refused before it is routed.
 */
const writeLineIds = {
  ...array(nonEmptyString()),
  minItems: 1,
  maxItems: BASKET_LIMITS.maxWriteLines,
  uniqueItems: true,
};

const rowEntryView = object(
  BASKET_SCHEMA_IDS.rowEntryView,
  {
    ...entryNumbers,
    // Optional and never null: a list the reader does not write is absent
    // rather than nulled (plan 0130, section 6). Redaction by absence is the
    // rule, so the schema must not make the field mandatory.
    listId: nonEmptyString(),
    // The line itself (plan 0201, section 3): its name, its products in order
    // and its favourite. The names of its list and zone are in `lists`.
    content: string(),
    itemIds: array(nonEmptyString()),
    favoriteItemId: nullableString(),
    canWrite: boolean(),
    demandEditable: boolean(),
  },
  [
    ...entryNumbersRequired,
    'content',
    'itemIds',
    'favoriteItemId',
    'canWrite',
    'demandEditable',
  ]
);

/** No `listId` and no `demandEditable`: a room holds guests (plan 0204). */
const entryPatch = object(
  BASKET_SCHEMA_IDS.entryPatch,
  entryNumbers,
  entryNumbersRequired
);

/**
 * The payload of `basket.linesChanged` (plan 0204, section 2).
 *
 * The two fields after `lineIds` are optional: an envelope written before that
 * plan has neither, and a client reads the basket again for it.
 */
const linesChangedEvent = object(
  BASKET_SCHEMA_IDS.linesChangedEvent,
  {
    lineIds: array(nonEmptyString()),
    entries: array(ref(BASKET_SCHEMA_IDS.entryPatch)),
    marksMoved: boolean(),
  },
  ['lineIds']
);

const rowView = object(
  BASKET_SCHEMA_IDS.rowView,
  {
    rowKey: nonEmptyString(),
    content: string(),
    // The product every entry counts as, or null (plan 0201, section 2).
    productId: nullableString(),
    left: integer({ minimum: 0 }),
    bought: integer({ minimum: 0 }),
    asked: integer({ minimum: 0 }),
    boughtElsewhere: integer({ minimum: 0 }),
    state: ref(BASKET_SCHEMA_IDS.rowState),
    note: { anyOf: [ref(BASKET_SCHEMA_IDS.rowNote), { type: 'null' }] },
    noteAt: nullableString(),
    mark: { anyOf: [ref(BASKET_SCHEMA_IDS.rowMark), { type: 'null' }] },
    awaitingApproval: boolean(),
    touchedBy: nullableString(),
    touchedAt: nullableString(),
    entries: array(ref(BASKET_SCHEMA_IDS.rowEntryView)),
    // Required and nullable: null means the read had no shop (plan 0165).
    usual: { anyOf: [ref(BASKET_SCHEMA_IDS.rowUsualView), { type: 'null' }] },
  },
  [
    'rowKey',
    'content',
    'productId',
    'left',
    'bought',
    'asked',
    'boughtElsewhere',
    'state',
    'note',
    'noteAt',
    'mark',
    'awaitingApproval',
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
    // Plan 0170: the shop's section names, always present.
    sections: array(ref(CATALOG_SCHEMA_IDS.locationSectionNameView)),
  },
  [
    'supermarketLocationId',
    'label',
    'address',
    'city',
    'postalCode',
    'sections',
  ]
);

const priceScopeView = object(
  BASKET_SCHEMA_IDS.priceScopeView,
  {
    priceScopeId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    supermarketName: ref(CATALOG_SCHEMA_IDS.localizedText),
    supermarketLogoUrl: nullableString(),
    locations: array(ref(BASKET_SCHEMA_IDS.scopeLocationView)),
  },
  [
    'priceScopeId',
    'supermarketId',
    'supermarketName',
    'supermarketLogoUrl',
    'locations',
  ]
);

const shopView = object(
  BASKET_SCHEMA_IDS.shopView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    supermarketName: ref(CATALOG_SCHEMA_IDS.localizedText),
    // Plan 0170: the chain's logo, and the shop's section names.
    supermarketLogoUrl: nullableString(),
    label: { anyOf: [ref(CATALOG_SCHEMA_IDS.localizedText), { type: 'null' }] },
    address: nullableString(),
    city: nullableString(),
    postalCode: nullableString(),
    inProfile: boolean(),
    sections: array(ref(CATALOG_SCHEMA_IDS.locationSectionNameView)),
  },
  [
    'id',
    'supermarketId',
    'supermarketName',
    'supermarketLogoUrl',
    'label',
    'address',
    'city',
    'postalCode',
    'inProfile',
    'sections',
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
    // Plan 0167: deliberately NOT required. Present only on a read with a shop
    // whose rule catalog answered; absent otherwise, never null.
    sectionIds: array(nonEmptyString()),
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
    // The lines of the write as they are now, and no row (plan 0201, section
    // 4). A line that is absent left the basket.
    entries: array(ref(BASKET_SCHEMA_IDS.rowEntryView)),
    progress: ref(BASKET_SCHEMA_IDS.progress),
    skippedCount: integer({ minimum: 0 }),
  },
  ['entries', 'progress']
);

const linePick = object(
  BASKET_SCHEMA_IDS.linePick,
  { lineId: nonEmptyString(), itemId: nonEmptyString() },
  ['lineId', 'itemId']
);

const priceChoice = object(
  BASKET_SCHEMA_IDS.priceChoice,
  { lineId: nonEmptyString(), itemIds: array(nonEmptyString()) },
  ['lineId', 'itemIds']
);

const priceChoicesView = object(
  BASKET_SCHEMA_IDS.priceChoicesView,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    lines: array(ref(BASKET_SCHEMA_IDS.priceChoice)),
  },
  ['basketId', 'participantId', 'lines']
);

const priceChoicesRequest = object(
  BASKET_SCHEMA_IDS.priceChoicesRequest,
  { basketId: nonEmptyString(), participantId: nonEmptyString() },
  ['basketId', 'participantId']
);

const livePriceChoicesRequest = object(
  BASKET_SCHEMA_IDS.livePriceChoicesRequest,
  { userId: nonEmptyString() },
  ['userId']
);

const productListView = object(
  BASKET_SCHEMA_IDS.productListView,
  {
    listId: nonEmptyString(),
    listName: string(),
    zoneId: nonEmptyString(),
    zoneName: string(),
    // The three are null together: the list holds no line with the product.
    lineId: nullableString(),
    lineName: nullableString(),
    quantity: { type: ['integer', 'null'], minimum: 0 },
  },
  ['listId', 'listName', 'zoneId', 'zoneName', 'lineId', 'lineName', 'quantity']
);

const productListsView = object(
  BASKET_SCHEMA_IDS.productListsView,
  { lists: array(ref(BASKET_SCHEMA_IDS.productListView)) },
  ['lists']
);

const productListsRequest = object(
  BASKET_SCHEMA_IDS.productListsRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    itemId: nonEmptyString(),
  },
  ['basketId', 'participantId', 'itemId']
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
    // The cheapest product of each line that needs a price (plan 0201).
    picks: array(ref(BASKET_SCHEMA_IDS.linePick)),
  },
  ['basketId', 'participantId']
);

const searchScopeRequest = object(
  BASKET_SCHEMA_IDS.searchScopeRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    lineIds: writeLineIds,
  },
  ['basketId', 'participantId']
);

const liveRequest = object(
  BASKET_SCHEMA_IDS.liveRequest,
  {
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    picks: array(ref(BASKET_SCHEMA_IDS.linePick)),
  },
  ['userId']
);

const settleRequest = object(
  BASKET_SCHEMA_IDS.settleRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
    lineIds: writeLineIds,
    outcome: ref(ENUM_IDS.settlementOutcome),
    quantity: integer({ minimum: 1, maximum: LINE_QUANTITY_MAX }),
    from: integer({ minimum: 0 }),
    itemId: nonEmptyString(),
    allocations: array(ref(BASKET_SCHEMA_IDS.allocationEntry)),
    // Written by the gateway (plan 0143). A client body has no field for it.
    paid: ref(LIST_SCHEMA_IDS.settlementPaid),
  },
  ['basketId', 'participantId', 'rowKey', 'lineIds', 'outcome', 'from']
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
    lineIds: writeLineIds,
    target: { type: 'string', enum: ['UNITS', 'CLOSE'] },
    units: integer({ minimum: 1, maximum: LINE_QUANTITY_MAX }),
    from: integer({ minimum: 0 }),
  },
  ['basketId', 'participantId', 'rowKey', 'lineIds', 'target']
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
  ['basketId', 'participantId', 'rowKey', 'lineId', 'quantity', 'from']
);

const renameRequest = object(
  BASKET_SCHEMA_IDS.renameRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    userId: nonEmptyString(),
    rowKey: nonEmptyString(),
    lineIds: writeLineIds,
    content: nonEmptyString(),
    confirmMerge: boolean(),
  },
  ['basketId', 'participantId', 'userId', 'rowKey', 'lineIds', 'content']
);

/**
 * One shape for both directions of a skip (plan 0137, section 5).
 *
 * The `PUT` and the `DELETE` take the same fields, so one schema serves both
 * patterns. Both name their lines in a body since plan 0201.
 */
const skipRequest = object(
  BASKET_SCHEMA_IDS.skipRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    rowKey: nonEmptyString(),
    lineIds: writeLineIds,
  },
  ['basketId', 'participantId', 'rowKey', 'lineIds']
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
  entryActOutcome,
  entryAct,
  rowEntryView,
  entryPatch,
  linesChangedEvent,
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
  linePick,
  priceChoice,
  priceChoicesView,
  priceChoicesRequest,
  livePriceChoicesRequest,
  productListView,
  productListsView,
  productListsRequest,
  searchScope,
  getRequest,
  searchScopeRequest,
  liveRequest,
  settleRequest,
  revertRequest,
  demandRequest,
  renameRequest,
  // Registered since plan 0201. It was declared and left out of this list, so
  // nothing could check a skip. It now names its lines, which is worth checking.
  skipRequest,
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
  [BASKET_PATTERNS.priceChoices]: {
    request: BASKET_SCHEMA_IDS.priceChoicesRequest,
    response: BASKET_SCHEMA_IDS.priceChoicesView,
  },
  [BASKET_PATTERNS.livePriceChoices]: {
    request: BASKET_SCHEMA_IDS.livePriceChoicesRequest,
    response: BASKET_SCHEMA_IDS.priceChoicesView,
  },
  [BASKET_PATTERNS.productLists]: {
    request: BASKET_SCHEMA_IDS.productListsRequest,
    response: BASKET_SCHEMA_IDS.productListsView,
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
