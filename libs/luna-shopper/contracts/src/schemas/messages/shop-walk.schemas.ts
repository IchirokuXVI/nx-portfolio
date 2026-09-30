import {
  SHOP_MAP_AREA_KINDS,
  SHOP_MAP_AREA_ORIGINS,
  SHOP_MAP_MARK_KINDS,
  SHOP_MAP_PROBLEM_CODES,
  SHOP_WALK_ENTRY_KINDS,
  SHOP_WALK_LIMITS,
  SHOP_WALK_PATTERNS,
  SHOP_WALK_STOP_REASONS,
} from '../../lib/messages/shop-walk.messages';
import {
  array,
  boolean,
  enumOf,
  integer,
  JsonSchema,
  nonEmptyString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { COMMON_IDS } from '../common.schemas';

/**
 * A shop's walks and its map (backend plan 0168). The document and the walk
 * log restate `@portfolio/luna-shopper/shop-map/model` version 2 on the wire.
 */
export const SHOP_WALK_SCHEMA_IDS = {
  shopWalkEntryKind: schemaId('enums/ShopWalkEntryKind'),
  shopWalkStopReason: schemaId('enums/ShopWalkStopReason'),
  shopMapAreaKind: schemaId('enums/ShopMapAreaKind'),
  shopMapAreaOrigin: schemaId('enums/ShopMapAreaOrigin'),
  shopMapMarkKind: schemaId('enums/ShopMapMarkKind'),
  shopMapProblemCode: schemaId('enums/ShopMapProblemCode'),
  shopMapAreaColour: schemaId('catalog/ShopMapAreaColour'),
  shopMapArea: schemaId('catalog/ShopMapArea'),
  shopMapMark: schemaId('catalog/ShopMapMark'),
  shopMapPolyline: schemaId('catalog/ShopMapPolyline'),
  shopMapDocument: schemaId('catalog/ShopMapDocument'),
  shopMapProblem: schemaId('catalog/ShopMapProblem'),
  shopWalkPathEvent: schemaId('catalog/ShopWalkPathEvent'),
  shopWalkMarkPutEvent: schemaId('catalog/ShopWalkMarkPutEvent'),
  shopWalkMarkRemovedEvent: schemaId('catalog/ShopWalkMarkRemovedEvent'),
  shopWalkAreaPutEvent: schemaId('catalog/ShopWalkAreaPutEvent'),
  shopWalkAreaRemovedEvent: schemaId('catalog/ShopWalkAreaRemovedEvent'),
  shopWalkSectionLeftEvent: schemaId('catalog/ShopWalkSectionLeftEvent'),
  shopWalkEvent: schemaId('catalog/ShopWalkEvent'),
  shopWalkEntryView: schemaId('catalog/ShopWalkEntryView'),
  shopWalkTimelineEntry: schemaId('catalog/ShopWalkTimelineEntry'),
  shopWalkSummaryView: schemaId('catalog/ShopWalkSummaryView'),
  shopWalkListView: schemaId('catalog/ShopWalkListView'),
  shopWalkView: schemaId('catalog/ShopWalkView'),
  shopWalkSnapshotView: schemaId('catalog/ShopWalkSnapshotView'),
  shopWalkLogView: schemaId('catalog/ShopWalkLogView'),
  shopperMapArea: schemaId('catalog/ShopperMapArea'),
  shopperMapNote: schemaId('catalog/ShopperMapNote'),
  shopperMapBounds: schemaId('catalog/ShopperMapBounds'),
  shopperMapView: schemaId('catalog/ShopperMapView'),
  shopMapSectionView: schemaId('catalog/ShopMapSectionView'),
  shopMapView: schemaId('catalog/ShopMapView'),
  locationShopMapView: schemaId('catalog/LocationShopMapView'),
  appendShopWalkEntryResult: schemaId('catalog/AppendShopWalkEntryResult'),
  locationShopMapRequest: schemaId('msg/shopWalk.mapForLocation/request'),
  listShopWalksRequest: schemaId('msg/shopWalk.list/request'),
  createShopWalkRequest: schemaId('msg/shopWalk.create/request'),
  updateShopWalkRequest: schemaId('msg/shopWalk.update/request'),
  shopWalkIdRequest: schemaId('msg/shopWalk.id/request'),
  shopWalkLogRequest: schemaId('msg/shopWalk.log/request'),
  appendShopWalkEntryRequest: schemaId('msg/shopWalk.append/request'),
} as const;

const IDS = SHOP_WALK_SCHEMA_IDS;

const num = (): JsonSchema => ({ type: 'number' });

/** A fixed length list of numbers, `[x, y]` or `[logMs, x, y]`. */
const tuple = (length: number): JsonSchema => ({
  ...array(num()),
  minItems: length,
  maxItems: length,
});

/** A literal discriminator. `enum` rather than `const`, which the wire types generator reads as a value. */
const literal = (value: string): JsonSchema => ({
  type: 'string',
  enum: [value],
});

const logMs = (): JsonSchema => integer({ minimum: 0 });

const shopMapAreaColour: JsonSchema = {
  $id: IDS.shopMapAreaColour,
  description:
    'The colour of an area: the one default, the category colour, or a custom `#rrggbb` the mapper picked.',
  oneOf: [
    {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['default', 'category'] } },
      required: ['mode'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        mode: literal('custom'),
        value: nonEmptyString({ maxLength: 7 }),
      },
      required: ['mode', 'value'],
      additionalProperties: false,
    },
  ],
};

const shopMapArea = object(
  IDS.shopMapArea,
  {
    id: nonEmptyString(),
    kind: ref(IDS.shopMapAreaKind),
    x: num(),
    y: num(),
    w: num(),
    h: num(),
    section: string({ maxLength: 120 }),
    label: string({ maxLength: 120 }),
    colour: ref(IDS.shopMapAreaColour),
    origin: ref(IDS.shopMapAreaOrigin),
  },
  ['id', 'kind', 'x', 'y', 'w', 'h', 'colour', 'origin']
);

const shopMapMark = object(
  IDS.shopMapMark,
  {
    id: nonEmptyString(),
    kind: ref(IDS.shopMapMarkKind),
    x: num(),
    y: num(),
    heading: num(),
    text: string({ maxLength: 500 }),
    logMs: num(),
  },
  ['id', 'kind', 'x', 'y', 'heading', 'text', 'logMs']
);

const shopMapPolyline = object(
  IDS.shopMapPolyline,
  { points: array(tuple(2)) },
  ['points']
);

const shopMapDocument = object(
  IDS.shopMapDocument,
  {
    version: { type: 'integer', enum: [2] },
    areas: array(ref(IDS.shopMapArea)),
    marks: array(ref(IDS.shopMapMark)),
    path: array(ref(IDS.shopMapPolyline)),
  },
  ['version', 'areas', 'marks', 'path']
);

const shopMapProblem = object(
  IDS.shopMapProblem,
  {
    code: ref(IDS.shopMapProblemCode),
    id: nonEmptyString(),
    otherId: nonEmptyString(),
  },
  ['code', 'id']
);

const pathEvent = object(
  IDS.shopWalkPathEvent,
  { type: literal('path'), points: array(tuple(3)) },
  ['type', 'points']
);
const markPutEvent = object(
  IDS.shopWalkMarkPutEvent,
  { type: literal('mark-put'), mark: ref(IDS.shopMapMark) },
  ['type', 'mark']
);
const markRemovedEvent = object(
  IDS.shopWalkMarkRemovedEvent,
  { type: literal('mark-removed'), id: nonEmptyString() },
  ['type', 'id']
);
const areaPutEvent = object(
  IDS.shopWalkAreaPutEvent,
  { type: literal('area-put'), area: ref(IDS.shopMapArea) },
  ['type', 'area']
);
const areaRemovedEvent = object(
  IDS.shopWalkAreaRemovedEvent,
  { type: literal('area-removed'), id: nonEmptyString() },
  ['type', 'id']
);
const sectionLeftEvent = object(
  IDS.shopWalkSectionLeftEvent,
  { type: literal('section-left'), logMs: num() },
  ['type', 'logMs']
);

const shopWalkEvent: JsonSchema = {
  $id: IDS.shopWalkEvent,
  description: 'One event of a walk entry, told apart by `type`.',
  oneOf: [
    ref(IDS.shopWalkPathEvent),
    ref(IDS.shopWalkMarkPutEvent),
    ref(IDS.shopWalkMarkRemovedEvent),
    ref(IDS.shopWalkAreaPutEvent),
    ref(IDS.shopWalkAreaRemovedEvent),
    ref(IDS.shopWalkSectionLeftEvent),
  ],
};

/** The fields every entry shape shares, events aside. */
const entryHead = {
  id: nonEmptyString(),
  kind: ref(IDS.shopWalkEntryKind),
  at: nonEmptyString({ format: 'date-time' }),
  logFrom: logMs(),
  logTo: logMs(),
  rewoundTo: logMs(),
  reason: ref(IDS.shopWalkStopReason),
};

const shopWalkEntryView = object(
  IDS.shopWalkEntryView,
  {
    ...entryHead,
    seq: integer({ minimum: 1 }),
    events: array(ref(IDS.shopWalkEvent)),
  },
  ['id', 'seq', 'kind', 'at', 'logFrom', 'logTo', 'events']
);

const shopWalkTimelineEntry = object(
  IDS.shopWalkTimelineEntry,
  {
    ...entryHead,
    seq: integer({ minimum: 1 }),
    logMs: logMs(),
  },
  ['id', 'seq', 'kind', 'at', 'logMs', 'logFrom', 'logTo']
);

const shopWalkSummaryView = object(
  IDS.shopWalkSummaryView,
  {
    id: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    name: nonEmptyString({ maxLength: SHOP_WALK_LIMITS.nameMaxLength }),
    shown: boolean(),
    lastSeq: integer({ minimum: 0 }),
    entryCount: integer({ minimum: 0 }),
    markCount: integer({ minimum: 0 }),
    createdAt: nonEmptyString(),
    lastChangedAt: nonEmptyString(),
  },
  [
    'id',
    'supermarketLocationId',
    'name',
    'shown',
    'lastSeq',
    'entryCount',
    'markCount',
    'createdAt',
    'lastChangedAt',
  ]
);

const shopWalkListView = object(
  IDS.shopWalkListView,
  { walks: array(ref(IDS.shopWalkSummaryView)) },
  ['walks']
);

const shopWalkView = object(
  IDS.shopWalkView,
  {
    walk: ref(IDS.shopWalkSummaryView),
    document: ref(IDS.shopMapDocument),
    timeline: array(ref(IDS.shopWalkTimelineEntry)),
  },
  ['walk', 'document', 'timeline']
);

const shopWalkSnapshotView = object(
  IDS.shopWalkSnapshotView,
  { seq: integer({ minimum: 1 }), document: ref(IDS.shopMapDocument) },
  ['seq', 'document']
);

const shopWalkLogView = object(
  IDS.shopWalkLogView,
  {
    walkId: nonEmptyString(),
    snapshot: {
      anyOf: [ref(IDS.shopWalkSnapshotView), { type: 'null' }],
    },
    entries: array(ref(IDS.shopWalkEntryView)),
    lastSeq: integer({ minimum: 0 }),
  },
  ['walkId', 'snapshot', 'entries', 'lastSeq']
);

const shopperMapArea = object(
  IDS.shopperMapArea,
  {
    id: nonEmptyString(),
    kind: {
      type: 'string',
      enum: SHOP_MAP_AREA_KINDS.filter((kind) => kind !== 'path'),
    },
    x: num(),
    y: num(),
    w: num(),
    h: num(),
    section: string(),
    label: string(),
    colour: ref(IDS.shopMapAreaColour),
  },
  ['id', 'kind', 'x', 'y', 'w', 'h', 'colour']
);

const shopperMapNote = object(
  IDS.shopperMapNote,
  { id: nonEmptyString(), x: num(), y: num(), text: string() },
  ['id', 'x', 'y', 'text']
);

const shopperMapBounds = object(
  IDS.shopperMapBounds,
  { x: num(), y: num(), w: num(), h: num() },
  ['x', 'y', 'w', 'h']
);

const shopperMapView = object(
  IDS.shopperMapView,
  {
    walkway: {
      ...array(array(tuple(2))),
      description:
        'Closed rings of `[x, y]` metres with no repeated last point. Outer rings run clockwise as drawn and holes the other way; draw them together with the even odd rule.',
    },
    areas: array(ref(IDS.shopperMapArea)),
    notes: array(ref(IDS.shopperMapNote)),
    bounds: ref(IDS.shopperMapBounds),
  },
  ['walkway', 'areas', 'notes', 'bounds']
);

const shopMapSectionView = object(
  IDS.shopMapSectionView,
  { name: nonEmptyString(), sectionId: nonEmptyString() },
  ['name', 'sectionId']
);

const shopMapView = object(
  IDS.shopMapView,
  {
    walkId: nonEmptyString(),
    savedAt: nonEmptyString(),
    view: ref(IDS.shopperMapView),
    sections: {
      ...array(ref(IDS.shopMapSectionView)),
      description:
        'The chain sections the walk’s section names resolved to, in walk order.',
    },
  },
  ['walkId', 'savedAt', 'view', 'sections']
);

const locationShopMapView = object(
  IDS.locationShopMapView,
  {
    map: {
      anyOf: [ref(IDS.shopMapView), { type: 'null' }],
      description: 'Null when the shop has no walk shown to shoppers.',
    },
  },
  ['map']
);

const appendShopWalkEntryResult = object(
  IDS.appendShopWalkEntryResult,
  {
    walk: ref(IDS.shopWalkSummaryView),
    entry: ref(IDS.shopWalkTimelineEntry),
    replayed: {
      ...boolean(),
      description:
        'True when this entry id was already stored: nothing was written and `entry` is what the first save stored. The next append builds on `entry.seq`, never on `walk.lastSeq`: after another phone saved, `walk.lastSeq` names an entry this client never folded, and building on `entry.seq` is refused with `walk_changed`, so the client reloads.',
    },
  },
  ['walk', 'entry', 'replayed']
);

// No userId: a guest reads a shop's map.
const locationShopMapRequest = object(
  IDS.locationShopMapRequest,
  { supermarketLocationId: nonEmptyString() },
  ['supermarketLocationId']
);
const listShopWalksRequest = object(
  IDS.listShopWalksRequest,
  { userId: nonEmptyString(), supermarketLocationId: nonEmptyString() },
  ['userId', 'supermarketLocationId']
);
const createShopWalkRequest = object(
  IDS.createShopWalkRequest,
  {
    userId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    name: nonEmptyString({ maxLength: SHOP_WALK_LIMITS.nameMaxLength }),
  },
  ['userId', 'supermarketLocationId', 'name']
);
const updateShopWalkRequest = object(
  IDS.updateShopWalkRequest,
  {
    userId: nonEmptyString(),
    walkId: nonEmptyString(),
    name: nonEmptyString({ maxLength: SHOP_WALK_LIMITS.nameMaxLength }),
    shown: boolean(),
  },
  ['userId', 'walkId']
);
const shopWalkIdRequest = object(
  IDS.shopWalkIdRequest,
  { userId: nonEmptyString(), walkId: nonEmptyString() },
  ['userId', 'walkId']
);
const shopWalkLogRequest = object(
  IDS.shopWalkLogRequest,
  {
    userId: nonEmptyString(),
    walkId: nonEmptyString(),
    fromSeq: integer({ minimum: 0 }),
  },
  ['userId', 'walkId']
);
const appendShopWalkEntryRequest = object(
  IDS.appendShopWalkEntryRequest,
  {
    userId: nonEmptyString(),
    walkId: nonEmptyString(),
    ...entryHead,
    baseSeq: integer({ minimum: 0 }),
    events: array(ref(IDS.shopWalkEvent)),
  },
  [
    'userId',
    'walkId',
    'id',
    'baseSeq',
    'kind',
    'at',
    'logFrom',
    'logTo',
    'events',
  ]
);

export const shopWalkSchemas: JsonSchema[] = [
  enumOf(IDS.shopWalkEntryKind, SHOP_WALK_ENTRY_KINDS),
  enumOf(IDS.shopWalkStopReason, SHOP_WALK_STOP_REASONS),
  enumOf(IDS.shopMapAreaKind, SHOP_MAP_AREA_KINDS),
  enumOf(IDS.shopMapAreaOrigin, SHOP_MAP_AREA_ORIGINS),
  enumOf(IDS.shopMapMarkKind, SHOP_MAP_MARK_KINDS),
  enumOf(IDS.shopMapProblemCode, SHOP_MAP_PROBLEM_CODES),
  shopMapAreaColour,
  shopMapArea,
  shopMapMark,
  shopMapPolyline,
  shopMapDocument,
  shopMapProblem,
  pathEvent,
  markPutEvent,
  markRemovedEvent,
  areaPutEvent,
  areaRemovedEvent,
  sectionLeftEvent,
  shopWalkEvent,
  shopWalkEntryView,
  shopWalkTimelineEntry,
  shopWalkSummaryView,
  shopWalkListView,
  shopWalkView,
  shopWalkSnapshotView,
  shopWalkLogView,
  shopperMapArea,
  shopperMapNote,
  shopperMapBounds,
  shopperMapView,
  shopMapSectionView,
  shopMapView,
  locationShopMapView,
  appendShopWalkEntryResult,
  locationShopMapRequest,
  listShopWalksRequest,
  createShopWalkRequest,
  updateShopWalkRequest,
  shopWalkIdRequest,
  shopWalkLogRequest,
  appendShopWalkEntryRequest,
];

export const shopWalkMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [SHOP_WALK_PATTERNS.mapForLocation]: {
    request: IDS.locationShopMapRequest,
    response: IDS.locationShopMapView,
  },
  [SHOP_WALK_PATTERNS.list]: {
    request: IDS.listShopWalksRequest,
    response: IDS.shopWalkListView,
  },
  [SHOP_WALK_PATTERNS.create]: {
    request: IDS.createShopWalkRequest,
    response: IDS.shopWalkSummaryView,
  },
  [SHOP_WALK_PATTERNS.update]: {
    request: IDS.updateShopWalkRequest,
    response: IDS.shopWalkSummaryView,
  },
  [SHOP_WALK_PATTERNS.delete]: {
    request: IDS.shopWalkIdRequest,
    response: COMMON_IDS.idResult,
  },
  [SHOP_WALK_PATTERNS.get]: {
    request: IDS.shopWalkIdRequest,
    response: IDS.shopWalkView,
  },
  [SHOP_WALK_PATTERNS.log]: {
    request: IDS.shopWalkLogRequest,
    response: IDS.shopWalkLogView,
  },
  [SHOP_WALK_PATTERNS.append]: {
    request: IDS.appendShopWalkEntryRequest,
    response: IDS.appendShopWalkEntryResult,
  },
};
