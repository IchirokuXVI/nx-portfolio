/**
 * Temporary: the document of shop-map plan 0001, copied until
 * `@portfolio/luna-shopper/shop-map/model` lands, then re-exported from it.
 */
export interface ShopMapDocument {
  version: 1;
  cell: number;
  size: { cols: number; rows: number };
  outline?: { points: [number, number][]; bearing: number };
  fixtures: {
    id: string;
    kind:
      | 'shelf'
      | 'fridge'
      | 'freezer'
      | 'counter'
      | 'checkout'
      | 'wall'
      | 'pillar'
      | 'entrance'
      | 'exit';
    x: number;
    y: number;
    w: number;
    h: number;
    label?: string;
  }[];
  anchors: {
    id: string;
    kind: 'section' | 'product' | 'note';
    at: { x: number; y: number };
    face?: 'n' | 's' | 'e' | 'w';
    sectionId?: string;
    categoryId?: string;
    itemId?: string;
    ean?: string;
    text?: string;
  }[];
}
