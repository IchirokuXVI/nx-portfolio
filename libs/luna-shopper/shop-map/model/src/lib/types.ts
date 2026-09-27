/**
 * The shop map document (shop-map plan 0001, section 1): a grid, rectangles on
 * it with a kind, and anchors that say what is where. Version one is the only
 * version; the field exists so a later change can migrate.
 */
export interface ShopMapDocument {
  version: 1;
  /** Metres per cell, informative. 0.5 by default. Nothing computes with it. */
  cell: number;
  size: { cols: number; rows: number };
  /** The building outline in cells, from OpenStreetMap, for size and orientation only. */
  outline?: { points: [number, number][]; bearing: number };
  fixtures: ShopMapFixture[];
  anchors: ShopMapAnchor[];
}

/**
 * Every kind blocks walking except `entrance` and `exit`, which sit on the
 * border and are walked through.
 */
export type FixtureKind =
  | 'shelf'
  | 'fridge'
  | 'freezer'
  | 'counter'
  | 'checkout'
  | 'wall'
  | 'pillar'
  | 'entrance'
  | 'exit';

export interface ShopMapFixture {
  id: string;
  kind: FixtureKind;
  /** Cells, integers, `w` and `h` at least 1. */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export type AnchorKind = 'section' | 'product' | 'note';

export type AnchorFace = 'n' | 's' | 'e' | 'w';

export interface ShopMapAnchor {
  id: string;
  kind: AnchorKind;
  /** The cell it sits on. A section or product anchor sits on a fixture cell. */
  at: { x: number; y: number };
  /** Which side a shopper stands on. Derived from the nearest free cell when absent. */
  face?: AnchorFace;
  /** kind section: a chain section (backend 0167), or an app category when the chain has none yet. */
  sectionId?: string;
  categoryId?: string;
  /** kind product: the catalog product, or the barcode the recorder scanned before it was resolved. */
  itemId?: string;
  ean?: string;
  /** kind note, and an optional label on the other two. */
  text?: string;
}

/** A cell on the grid: `x` is the column, `y` the row, both from the top left. */
export interface ShopMapCell {
  x: number;
  y: number;
}

/** The codes of section 2, in the order `validateShopMap` checks them. */
export type ShopMapProblemCode =
  | 'OUT_OF_BOUNDS'
  | 'BLOCKING_OVERLAP'
  | 'ENTRANCE_INSIDE'
  | 'NO_ENTRANCE'
  | 'ANCHOR_OFF_FIXTURE'
  | 'ANCHOR_UNREACHABLE'
  | 'ANCHOR_UNNAMED'
  | 'DISCONNECTED';

export interface ShopMapProblem {
  code: ShopMapProblemCode;
  /** The fixture or anchor the problem names, when it names one. */
  id?: string;
  /** The cell the problem is about, when it is about one. */
  cell?: ShopMapCell;
}

/** The answer of `walkOrder` (section 4). */
export interface WalkOrder {
  /** Section anchors in the order they are walked past; `at` is cells along the walk. */
  sections: {
    anchorId: string;
    sectionId?: string;
    categoryId?: string;
    at: number;
  }[];
  /** Product anchors in walk order, each with the section anchor it belongs to. */
  products: {
    anchorId: string;
    itemId?: string;
    ean?: string;
    sectionAnchorId: string | null;
    at: number;
  }[];
  /** The cells walked, for drawing. */
  route: ShopMapCell[];
  endsAtCheckout: boolean;
}
