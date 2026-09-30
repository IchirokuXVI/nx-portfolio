import type {
  AreaKind,
  LiveSnapshot,
  MapArea,
  ShopMapDocumentV2,
} from '@portfolio/luna-shopper/shop-map/model';

/**
 * A shop laid out like the mock's board "The shop map", in metres, so the
 * demo can be held against the boards. The El Jamón fixture is the real
 * walk and stays the default.
 */
let n = 0;
function area(
  kind: AreaKind,
  x: number,
  y: number,
  w: number,
  h: number,
  section?: string,
  extra: Partial<MapArea> = {}
): MapArea {
  return {
    id: `s${String(++n).padStart(2, '0')}`,
    kind,
    x,
    y,
    w,
    h,
    ...(section ? { section } : {}),
    colour: { mode: 'default' },
    origin: 'drawn',
    ...extra,
  };
}

export const sampleDocument: ShopMapDocumentV2 = {
  version: 2,
  areas: [
    area('path', 0, 0, 12.8, 19.4),
    area('counter', 0, 0, 4.2, 1.5, 'Charcutería'),
    area('counter', 4.2, 0, 4.1, 1.5, 'Carnicería'),
    area('counter', 8.3, 0, 4.5, 1.5, 'Pescadería'),
    area('shelf', 0, 3.1, 1.1, 4.4, 'Menaje'),
    area('shelf', 0, 7.5, 1.1, 5.4, 'Desayuno y dulces'),
    area('shelf', 11.7, 3.1, 1.1, 4.4, 'Agua'),
    area('shelf', 11.7, 7.5, 1.1, 5.4, 'Bebida y cervezas'),
    area('shelf', 2.4, 2.7, 7.7, 1.1, 'Bodega'),
    area('shelf', 2.4, 4.7, 3.9, 1.1, 'Despensa'),
    area('shelf', 6.3, 4.7, 3.8, 1.1, 'Pastas'),
    area('shelf', 2.4, 6.7, 7.7, 1.1, 'Abrir y comer'),
    area('shelf', 2.4, 8.7, 7.7, 1.1, 'Lácteos'),
    area('shelf', 2.4, 10.7, 7.7, 1.1, 'Congelados'),
    area('shelf', 2.4, 12.7, 3.9, 1.1, 'Limpieza'),
    area('shelf', 6.3, 12.7, 3.8, 1.1, 'Hogar'),
    area('shelf', 2.4, 14.7, 5.1, 1.1, 'Higiene y perfumería'),
    area('shelf', 7.5, 14.7, 2.6, 1.1, 'Mascotas'),
    area('counter', 0, 16.3, 4.3, 1.6, 'Horno de pan'),
    area('counter', 5, 16.4, 3, 1.3, 'Frutería'),
    area('checkout', 9.1, 16.9, 0.8, 0.8),
    area('checkout', 10.1, 16.9, 0.8, 0.8),
    area('checkout', 11.1, 16.9, 0.8, 0.8),
    area('checkout', 12, 16.9, 0.8, 0.8),
    area('entrance', 1.2, 18.6, 2.4, 0.8, undefined, { label: 'Entrance' }),
  ],
  marks: [
    {
      id: 'm1',
      kind: 'section',
      x: 1.9,
      y: 5.2,
      heading: 270,
      text: 'Menaje',
      logMs: 10_000,
    },
    {
      id: 'm2',
      kind: 'section',
      x: 1.9,
      y: 9.2,
      heading: 90,
      text: 'Lácteos',
      logMs: 40_000,
    },
    {
      id: 'm3',
      kind: 'counter',
      x: 6.1,
      y: 2.1,
      heading: 180,
      text: 'Carnicería',
      logMs: 70_000,
    },
    {
      id: 'm4',
      kind: 'note',
      x: 10.9,
      y: 13.6,
      heading: 0,
      text: 'Fresh bread at nine',
      logMs: 90_000,
    },
  ],
  path: [
    {
      points: [
        [1.8, 18],
        [1.8, 2.2],
        [11, 2.2],
        [11, 16],
      ],
    },
  ],
};

/** A live state like the board "Walking": a suggestion, the person in an aisle, a path to check. */
export const sampleLive: {
  snapshot: LiveSnapshot;
  person: { x: number; y: number; heading: number };
  unconfirmed: [number, number][];
} = {
  snapshot: {
    walkedCells: [],
    suggestions: [{ id: 'sg1', x: 10.3, y: 8.7, w: 1, h: 3.1 }],
    sectionRun: { section: 'Lácteos', areaId: 's13' },
    events: [],
  },
  person: { x: 6.4, y: 9.9, heading: 180 },
  unconfirmed: [
    [6.4, 10.25],
    [10.9, 10.25],
    [10.9, 14.2],
  ],
};
