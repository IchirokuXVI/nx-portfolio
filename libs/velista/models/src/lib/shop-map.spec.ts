import {
  shopperView,
  validateShopMapV2,
  type ShopMapDocumentV2,
  type ShopperView,
} from '@portfolio/luna-shopper/shop-map/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  drawsAsView,
  roundedFootprint,
  shopMapBadges,
  shopMapDocumentOf,
  shopMapSectionNote,
  shopMapSectionPosition,
  type ShopMap,
  type ShopMapLine,
} from './shop-map';

/** The El Jamón walk of model plan 0002, read from disk rather than imported. */
function elJamon(): ShopMapDocumentV2 {
  const file = join(
    __dirname,
    '../../../../luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon/expected-map.json'
  );
  return JSON.parse(readFileSync(file, 'utf8')) as ShopMapDocumentV2;
}

function smallView(): ShopperView {
  // A 6 m by 4 m shop: a walkway ring round one shelf, the shelf in the middle.
  const document: ShopMapDocumentV2 = {
    version: 2,
    areas: [
      {
        id: 'a-milk',
        kind: 'shelf',
        x: 2,
        y: 1.5,
        w: 2,
        h: 1,
        section: 'Lácteos',
        colour: { mode: 'default' },
        origin: 'drawn',
      },
    ],
    marks: [
      {
        id: 'n-1',
        kind: 'note',
        x: 4.5,
        y: 2,
        heading: 0,
        text: 'Lactose free at the far end',
        logMs: 10,
      },
    ],
    path: [
      {
        points: [
          [1, 1],
          [5, 1],
          [5, 3],
          [1, 3],
          [1, 1],
        ],
      },
    ],
  };
  return shopperView(document);
}

/** The walkway's area in square metres: outer rings clockwise, holes the other way. */
function walkwayArea(rings: ShopperView['walkway']): number {
  let sum = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      sum += x1 * y2 - x2 * y1;
    }
  }
  return sum / 2;
}

function line(
  rowKey: string,
  state: ShopMapLine['state'],
  sectionIds: string[]
): ShopMapLine {
  return { rowKey, content: rowKey, quantity: 1, state, sectionIds };
}

describe('shopMapDocumentOf', () => {
  it('rebuilds a document the canvas draws as the view it came from', () => {
    const view = smallView();
    const document = shopMapDocumentOf(view);

    expect(drawsAsView(document, view)).toBe(true);
    expect(validateShopMapV2(document)).toEqual([]);
  });

  it('draws the El Jamón walk as the server showed it', () => {
    const view = shopperView(elJamon());
    const document = shopMapDocumentOf(view);
    const redrawn = shopperView(document);

    expect(redrawn.areas).toEqual(view.areas);
    expect(redrawn.notes).toEqual(view.notes);
    // Growing the walked lines back can draw a cell more than the view at a
    // ragged edge, and never a cell less.
    const drawn = walkwayArea(view.walkway);
    const extra = walkwayArea(redrawn.walkway) - drawn;
    expect(extra).toBeGreaterThanOrEqual(0);
    expect(extra / drawn).toBeLessThan(0.01);
    expect(validateShopMapV2(document)).toEqual([]);
  });

  it('keeps notes as note marks and no other mark', () => {
    const document = shopMapDocumentOf(smallView());

    expect(document.marks.map((mark) => mark.kind)).toEqual(['note']);
    expect(document.marks[0].text).toBe('Lactose free at the far end');
  });

  it('answers an empty document for an empty view', () => {
    const document = shopMapDocumentOf({
      walkway: [],
      areas: [],
      notes: [],
      bounds: { x: 0, y: 0, w: 0, h: 0 },
    });

    expect(document.path).toEqual([]);
    expect(document.areas).toEqual([]);
  });
});

describe('the badges and the sheet', () => {
  const view = smallView();
  const map: ShopMap = {
    walkId: 'w1',
    savedAt: null,
    document: shopMapDocumentOf(view),
    notes: view.notes,
    sections: [
      { name: 'Frutería', sectionId: 's-fruit' },
      { name: 'lácteos ', sectionId: 's-milk' },
    ],
  };

  it('counts the lines still to get in a section, by the name its areas use', () => {
    const badges = shopMapBadges(map, [
      line('milk', 'WANTED', ['s-milk']),
      line('yoghurt', 'PARTLY', ['s-milk']),
      line('butter', 'DONE', ['s-milk']),
    ]);

    expect(badges).toEqual({ Lácteos: { count: 2, done: false } });
  });

  it('turns a section done with the number got once every line there is settled', () => {
    const badges = shopMapBadges(map, [
      line('milk', 'DONE', ['s-milk']),
      line('cream', 'NOT_AVAILABLE', ['s-milk']),
    ]);

    expect(badges).toEqual({ Lácteos: { count: 2, done: true } });
  });

  it('gives a section with no line no badge', () => {
    expect(shopMapBadges(map, [line('apples', 'WANTED', ['s-fruit'])])).toEqual(
      {}
    );
  });

  it('finds the note beside a section', () => {
    expect(shopMapSectionNote(map, 'LÁCTEOS')?.text).toBe(
      'Lactose free at the far end'
    );
    expect(shopMapSectionNote(map, 'Frutería')).toBeNull();
  });

  it('says where a section falls on the way round', () => {
    expect(shopMapSectionPosition(map, 's-milk')).toEqual({
      position: 2,
      total: 2,
    });
    expect(shopMapSectionPosition(map, 'nope')).toBeNull();
  });
});

describe('roundedFootprint', () => {
  it('rounds to the nearest hundred', () => {
    expect(roundedFootprint(1187)).toBe(1200);
    expect(roundedFootprint(149)).toBe(100);
  });

  it('rounds a small shop to the nearest ten', () => {
    expect(roundedFootprint(43)).toBe(40);
    expect(roundedFootprint(3)).toBe(10);
  });

  it('says nothing for no size', () => {
    expect(roundedFootprint(null)).toBeNull();
    expect(roundedFootprint(0)).toBeNull();
    expect(roundedFootprint(Number.NaN)).toBeNull();
  });
});
