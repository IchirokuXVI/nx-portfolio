/**
 * A shop has walks, and one of them is its map (backend plan 0168).
 *
 * A **walk** is an append only log of entries, and its map is what the log
 * folds to (`foldWalk` of `@portfolio/luna-shopper/shop-map/model`). A shop has
 * any number of walks, each with a name, and at most one is **shown** to
 * shoppers. Saving a walk appends an entry, rewinding appends an entry, and
 * nothing is ever rewritten.
 *
 * The shapes below restate the model library's version 2 document and walk log
 * on the wire, field for field, so a client that does not import the model
 * library still has one written contract. Catalog passes them into the library
 * unchanged, so a field that drifts from the library fails catalog's build.
 *
 * Who may call what: {@link SHOP_WALK_PATTERNS.mapForLocation} is public and
 * carries no `userId`. Every other subject is reached only through gateway
 * routes behind `@RequirePermission('shopMap.record')`, and catalog trusts the
 * `userId` it is handed as the author of what it writes.
 */
export const SHOP_WALK_PATTERNS = {
  /**
   * The shown walk's map as a shopper sees it, through `shopperView`, or null
   * when the shop has no shown walk. No `userId`: a guest asks. An unknown shop
   * is the ordinary 404 for a location.
   */
  mapForLocation: 'shopWalk.mapForLocation',
  /** A shop's walks that are not deleted, the shown one first, then by last change. */
  list: 'shopWalk.list',
  /** A new empty walk on a shop, not shown. */
  create: 'shopWalk.create',
  /**
   * Rename a walk, show it or stop showing it. `shown: true` stops showing the
   * shop's other walk in the same transaction, and rewrites the shop's section
   * list in this walk's order.
   */
  update: 'shopWalk.update',
  /**
   * Sets `deletedAt` and keeps every entry. A shown walk stops being shown and
   * the shop has no map.
   */
  delete: 'shopWalk.delete',
  /** One walk, its folded document, and its timeline (one row per entry, no events). */
  get: 'shopWalk.get',
  /**
   * Entries with their events after the latest snapshot at or before
   * `fromSeq`, for a rewind preview folded on the phone.
   */
  log: 'shopWalk.log',
  /**
   * Append one entry (plan 0168, section 2). Idempotent on the entry's id,
   * refused with `walk_changed` when `baseSeq` is not the walk's `lastSeq`, and
   * refused with `shop_map_invalid` when the fold does not validate.
   */
  append: 'shopWalk.append',
} as const;

/** The bounds of plan 0168. */
export const SHOP_WALK_LIMITS = {
  /** A walk's name, trimmed. */
  nameMaxLength: 80,
  /** One entry as JSON, events included. */
  entryMaxBytes: 256 * 1024,
  /** One folded document as JSON. */
  documentMaxBytes: 2 * 1024 * 1024,
  /** A snapshot is stored on every entry whose `seq` is a multiple of this, and on every rewind. */
  snapshotEvery: 20,
  /** The longest a stop reason may be. */
  reasonMaxLength: 40,
} as const;

/**
 * The kinds of a walk entry, as `WalkEntryKind` of the model library.
 * `continued` is a save while walking after the first one of a session: it
 * extends the session's path under a new id.
 */
export const SHOP_WALK_ENTRY_KINDS = [
  'started',
  'resumed',
  'continued',
  'stopped',
  'edited',
  'rewound',
  'confirmed',
  'discarded',
] as const;

export type ShopWalkEntryKind = (typeof SHOP_WALK_ENTRY_KINDS)[number];

/** Why a `stopped` entry stopped. */
export const SHOP_WALK_STOP_REASONS = [
  'button',
  'left-page',
  'tracking-lost',
  'frame-moved',
] as const;

export type ShopWalkStopReason = (typeof SHOP_WALK_STOP_REASONS)[number];

export const SHOP_MAP_AREA_KINDS = [
  'shelf',
  'counter',
  'checkout',
  'entrance',
  'blocked',
  'path',
] as const;

export type ShopMapAreaKind = (typeof SHOP_MAP_AREA_KINDS)[number];

export const SHOP_MAP_AREA_ORIGINS = [
  'suggested',
  'section-run',
  'counter-mark',
  'drawn',
] as const;

export type ShopMapAreaOrigin = (typeof SHOP_MAP_AREA_ORIGINS)[number];

export const SHOP_MAP_MARK_KINDS = ['section', 'counter', 'note'] as const;

export type ShopMapMarkKind = (typeof SHOP_MAP_MARK_KINDS)[number];

/** The codes `validateShopMapV2` answers, in the order it checks them. */
export const SHOP_MAP_PROBLEM_CODES = [
  'AREA_TOO_SMALL',
  'BLOCKING_OVERLAP',
  'SECTION_ON_WRONG_KIND',
  'BAD_COLOUR',
  'MARK_UNNAMED',
] as const;

export type ShopMapProblemCode = (typeof SHOP_MAP_PROBLEM_CODES)[number];

/** The colour of an area: the one default, the category's, or `#rrggbb`. */
export type ShopMapAreaColour =
  | { mode: 'default' }
  | { mode: 'category' }
  | { mode: 'custom'; value: string };

/** A rectangle in metres, the top left corner and its size. */
export interface ShopMapArea {
  id: string;
  kind: ShopMapAreaKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A section's name as the mapper typed or picked it. */
  section?: string;
  label?: string;
  colour: ShopMapAreaColour;
  origin: ShopMapAreaOrigin;
}

export interface ShopMapMark {
  id: string;
  kind: ShopMapMarkKind;
  x: number;
  y: number;
  /** Degrees, 0 along +y, clockwise as drawn. */
  heading: number;
  text: string;
  /** Log milliseconds. */
  logMs: number;
}

/** `ShopMapDocumentV2` of the model library: metres, in the frame of the walk. */
export interface ShopMapDocument {
  version: 2;
  areas: ShopMapArea[];
  marks: ShopMapMark[];
  /** The walked path as polylines of `[x, y]`. */
  path: { points: [number, number][] }[];
}

/** One event of an entry, as `WalkEvent` of the model library. */
export type ShopWalkEvent =
  /** `[logMs, x, y]`. */
  | { type: 'path'; points: [number, number, number][] }
  | { type: 'mark-put'; mark: ShopMapMark }
  | { type: 'mark-removed'; id: string }
  | { type: 'area-put'; area: ShopMapArea }
  | { type: 'area-removed'; id: string }
  | { type: 'section-left'; logMs: number };

/** One problem `validateShopMapV2` found. */
export interface ShopMapProblem {
  code: ShopMapProblemCode;
  id: string;
  otherId?: string;
}

/**
 * One entry of a walk's log with its events, as `WalkEntry` of the model
 * library. `seq` is 1, 2, 3 per walk, assigned by catalog.
 */
export interface ShopWalkEntryView {
  id: string;
  seq: number;
  kind: ShopWalkEntryKind;
  /** Wall clock, ISO. */
  at: string;
  logFrom: number;
  logTo: number;
  events: ShopWalkEvent[];
  rewoundTo?: number;
  reason?: ShopWalkStopReason;
}

/**
 * One row of a walk's timeline: an entry without its events, as
 * `WalkTimelineMarker` of the model library, which the rewind slider and the
 * history list draw.
 */
export interface ShopWalkTimelineEntry {
  id: string;
  seq: number;
  kind: ShopWalkEntryKind;
  at: string;
  /** Where the marker sits: `logFrom` for `started` and `resumed`, else `logTo`. */
  logMs: number;
  logFrom: number;
  logTo: number;
  rewoundTo?: number;
  reason?: ShopWalkStopReason;
}

/** One walk as the list of a shop's walks draws it. */
export interface ShopWalkSummaryView {
  id: string;
  supermarketLocationId: string;
  name: string;
  /** Whether shoppers see this walk. At most one per shop. */
  shown: boolean;
  /**
   * The `seq` of the newest entry, 0 for a walk with none. A client that reads
   * a walk builds its first append on this. After an append it builds on the
   * answered `entry.seq` instead (see {@link AppendShopWalkEntryResult}).
   */
  lastSeq: number;
  /** How many entries the log holds. Equal to {@link lastSeq}, since `seq` counts from 1 with no gap. */
  entryCount: number;
  /** How many marks the folded document holds. */
  markCount: number;
  createdAt: string;
  /** When the walk was last renamed, shown, hidden or appended to. */
  lastChangedAt: string;
}

export interface ShopWalkListView {
  /** The shown walk first, then the rest by last change, newest first. */
  walks: ShopWalkSummaryView[];
}

/** One walk, its folded document, and its timeline. */
export interface ShopWalkView {
  walk: ShopWalkSummaryView;
  /** The folded document, normalized. */
  document: ShopMapDocument;
  /** One row per entry, in `seq` order. */
  timeline: ShopWalkTimelineEntry[];
}

/** A stored fold: the document after the entry `seq`. */
export interface ShopWalkSnapshotView {
  seq: number;
  document: ShopMapDocument;
}

/**
 * The log from a snapshot on (plan 0168, section 3): `foldWalk(entries,
 * snapshot.document)` on the phone answers the walk's document, and
 * `stateAt` over the same entries answers a point after the snapshot.
 */
export interface ShopWalkLogView {
  walkId: string;
  /** The latest snapshot at or before `fromSeq`, or null when there is none and `entries` starts at 1. */
  snapshot: ShopWalkSnapshotView | null;
  /** Every entry after the snapshot, in `seq` order, with its events. */
  entries: ShopWalkEntryView[];
  lastSeq: number;
}

/** A shopper's view of a shop, the answer of `shopperView` in the model library. */
export interface ShopperMapArea {
  id: string;
  kind: Exclude<ShopMapAreaKind, 'path'>;
  x: number;
  y: number;
  w: number;
  h: number;
  section?: string;
  label?: string;
  colour: ShopMapAreaColour;
}

export interface ShopperMapNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface ShopperMapView {
  /** Closed rings of `[x, y]` metres, drawn together with the even odd rule. */
  walkway: [number, number][][];
  areas: ShopperMapArea[];
  notes: ShopperMapNote[];
  bounds: { x: number; y: number; w: number; h: number };
}

/** One section name of the shown walk and the chain section it resolved to. */
export interface ShopMapSectionView {
  name: string;
  sectionId: string;
}

/** The map of a shop (plan 0168, section 3). */
export interface ShopMapView {
  walkId: string;
  /** When the shown walk was last saved, ISO. */
  savedAt: string;
  view: ShopperMapView;
  /** The chain sections the walk's section names resolved to, in walk order. */
  sections: ShopMapSectionView[];
}

export interface LocationShopMapView {
  map: ShopMapView | null;
}

// --- Requests ----------------------------------------------------------------

/** No `userId`: a guest asks. */
export interface LocationShopMapRequest {
  supermarketLocationId: string;
}

export interface ListShopWalksRequest {
  userId: string;
  supermarketLocationId: string;
}

export interface CreateShopWalkRequest {
  userId: string;
  supermarketLocationId: string;
  name: string;
}

export interface UpdateShopWalkRequest {
  userId: string;
  walkId: string;
  name?: string;
  shown?: boolean;
}

export interface ShopWalkIdRequest {
  userId: string;
  walkId: string;
}

export interface ShopWalkLogRequest {
  userId: string;
  walkId: string;
  /** Absent or 0 answers the whole log with no snapshot. */
  fromSeq?: number;
}

/** Section 2: one entry to append, and the `seq` it was built on. */
export interface AppendShopWalkEntryRequest {
  userId: string;
  walkId: string;
  /** Given by the client, so a retried save is the same entry. */
  id: string;
  /**
   * The `seq` this entry was built on: the walk's `lastSeq` when the client
   * read the walk, then the `entry.seq` of each append it made. Anything but
   * the walk's current `lastSeq` is refused with `walk_changed`.
   */
  baseSeq: number;
  kind: ShopWalkEntryKind;
  at: string;
  logFrom: number;
  logTo: number;
  events: ShopWalkEvent[];
  rewoundTo?: number;
  reason?: ShopWalkStopReason;
}

export interface AppendShopWalkEntryResult {
  /**
   * The walk after the append, or as it stands now for a retried entry. On a
   * replay after another phone saved, its `lastSeq` names that phone's entry,
   * which this client never folded, so it is **not** the next base.
   */
  walk: ShopWalkSummaryView;
  /**
   * The entry as stored. A retried id answers the entry stored the first time.
   *
   * **The next append's `baseSeq` is this `seq`, never `walk.lastSeq`.** On a
   * fresh append the two are equal. On a replay after another phone saved,
   * building on this `seq` is refused with `walk_changed`, and the client
   * reloads instead of extending the other phone's path.
   */
  entry: ShopWalkTimelineEntry;
  /** True when this id was already stored and nothing was written. */
  replayed: boolean;
}
