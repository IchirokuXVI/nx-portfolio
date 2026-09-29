/**
 * The shop map document, version 2 (shop-map plan 0002, section 1): areas,
 * marks and the walked path, all in metres in the frame of the walk. The map's
 * `x` is the camera's `x` and its `y` is the camera's `z`, so `y` grows
 * towards the camera at the start and a drawing puts it downwards.
 */
export interface ShopMapDocumentV2 {
  version: 2;
  /** Metres, in the walk's frame. */
  areas: MapArea[];
  marks: MapMark[];
  /** The walked path, as polylines. A gap between two means tracking stopped. */
  path: { points: [number, number][] }[];
}

export type AreaKind =
  | 'shelf'
  | 'counter'
  | 'checkout'
  | 'entrance'
  | 'blocked'
  | 'path';

/** The colour of an area: the one default, the category's, or one the mapper picked. */
export type AreaColour =
  | { mode: 'default' }
  | { mode: 'category' }
  | { mode: 'custom'; value: string };

/** Where an area came from: a tapped suggestion, a section run, a counter mark, or drawn by hand. */
export type AreaOrigin = 'suggested' | 'section-run' | 'counter-mark' | 'drawn';

export interface MapArea {
  id: string;
  kind: AreaKind;
  /** Metres, the top left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** A section's name as the mapper typed or picked it. Backend 0168 resolves it to a chain section. */
  section?: string;
  label?: string;
  /** `value` is `#rrggbb`. */
  colour: AreaColour;
  origin: AreaOrigin;
}

export type MarkKind = 'section' | 'counter' | 'note';

export interface MapMark {
  id: string;
  kind: MarkKind;
  x: number;
  y: number;
  /**
   * Degrees, 0 along +y, clockwise as the map is drawn (with +y downwards):
   * 90 is along -x, 180 along -y and 270 along +x. The direction the phone
   * pointed is `(-sin h, cos h)`.
   */
  heading: number;
  text: string;
  /** Log milliseconds, for the timeline and for rewinding. */
  logMs: number;
}

/** The codes of section 2, in the order `validateShopMapV2` checks them. */
export type ShopMapProblemCodeV2 =
  | 'AREA_TOO_SMALL'
  | 'BLOCKING_OVERLAP'
  | 'SECTION_ON_WRONG_KIND'
  | 'BAD_COLOUR'
  | 'MARK_UNNAMED';

export interface ShopMapProblemV2 {
  code: ShopMapProblemCodeV2;
  /** The area or mark the problem names. For an overlap, the later of the two. */
  id: string;
  /** `BLOCKING_OVERLAP` only: the earlier area it overlaps. */
  otherId?: string;
}

/** Section 3. */
export type WalkEntryKind =
  | 'started'
  | 'resumed'
  | 'stopped'
  | 'edited'
  | 'rewound'
  | 'confirmed'
  | 'discarded';

export interface WalkEntry {
  /** Given by the client, so a retried save is the same entry. */
  id: string;
  /** 1, 2, 3 per walk, assigned by the server. */
  seq: number;
  kind: WalkEntryKind;
  /** Wall clock, ISO. */
  at: string;
  /** Log time this entry covers. A recording entry advances it; an edit or a rewind does not. */
  logFrom: number;
  logTo: number;
  events: WalkEvent[];
  /** kind rewound: the point of the log the map returns to. */
  rewoundTo?: number;
  /** kind stopped: why. */
  reason?: 'button' | 'left-page' | 'tracking-lost' | 'frame-moved';
}

export type WalkEvent =
  /** `[logMs, x, y]`; a new polyline starts after a stop. */
  | { type: 'path'; points: [number, number, number][] }
  | { type: 'mark-put'; mark: MapMark }
  | { type: 'mark-removed'; id: string }
  | { type: 'area-put'; area: MapArea }
  | { type: 'area-removed'; id: string }
  | { type: 'section-left'; logMs: number };

/** One marker of the rewind slider, per entry. */
export interface WalkTimelineMarker {
  id: string;
  seq: number;
  kind: WalkEntryKind;
  /** Wall clock, ISO. */
  at: string;
  /** Where the marker sits: `logFrom` for `started` and `resumed`, else `logTo`. */
  logMs: number;
  logFrom: number;
  logTo: number;
  rewoundTo?: number;
  reason?: WalkEntry['reason'];
}

/** The answer of `walkOrderV2` (section 4). */
export interface WalkOrderV2 {
  /** One stop per section name, in walk order. */
  sections: {
    /** The name as the first area of the stop spells it, trimmed. */
    name: string;
    /** Every area with this name, by id. */
    areaIds: string[];
    /** Metres along the walk from the start to where a shopper stands for it. */
    atMetres: number;
  }[];
  /** False when the document has no reachable entrance and the walk starts at the first walked point. */
  startsAtEntrance: boolean;
  /** False when the document has no reachable checkout and the walk ends at the last walked point. */
  endsAtCheckout: boolean;
}

/** An area as a shopper is shown it: no origin. */
export interface ShopperArea {
  id: string;
  kind: Exclude<AreaKind, 'path'>;
  x: number;
  y: number;
  w: number;
  h: number;
  section?: string;
  label?: string;
  colour: AreaColour;
}

export interface ShopperNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** The answer of `shopperView` (section 5). */
export interface ShopperView {
  /**
   * The walkway as closed rings of `[x, y]` metres, with no repeated last
   * point. Outer rings run clockwise as drawn and holes the other way, so the
   * rings drawn together with the even odd rule give the walkway.
   */
  walkway: [number, number][][];
  areas: ShopperArea[];
  notes: ShopperNote[];
  /** The box around all of it, for fitting. Zero sized for an empty map. */
  bounds: { x: number; y: number; w: number; h: number };
}
