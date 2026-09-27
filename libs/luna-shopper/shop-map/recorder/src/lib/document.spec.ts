import { validateShopMap } from '@portfolio/luna-shopper/shop-map/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkToDocument } from './document';
import { trackToWalk } from './draft';
import { computeTrack } from './engine';
import type { Walk } from './walk';
import { parseWalkImport } from './walk-import';

const FIXTURES = join(__dirname, '..', '__fixtures__');

function traceWalk(name: string): Walk {
  return JSON.parse(
    readFileSync(join(FIXTURES, 'traces', `${name}.expected.json`), 'utf8')
  );
}

const L: Walk = {
  segments: [
    {
      from: { x: 0, y: 0 },
      to: { x: 0, y: 4 },
      heading: 'n',
      steps: 3,
      confidence: 1,
    },
    {
      from: { x: 0, y: 4 },
      to: { x: 3, y: 4 },
      heading: 'e',
      steps: 2,
      confidence: 1,
    },
  ],
  marks: [
    { kind: 'entrance', at: { x: 0, y: 0 } },
    { kind: 'checkout', at: { x: 3, y: 4 }, label: 'till 1' },
  ],
  scans: [{ ean: '8480000123457', at: { x: 0, y: 2 }, heading: 'n' }],
  notes: [{ text: 'bread', at: { x: 0, y: 4 } }],
  startedAt: 0,
  finishedAt: 10_000,
};

describe('walkToDocument', () => {
  it('draws an L with shelves beside it, an entrance, a checkout and a scan', () => {
    const doc = walkToDocument(L);
    expect(validateShopMap(doc)).toEqual([]);
    // Box 4 x 5 cells, plus two on every side.
    expect(doc.size).toEqual({ cols: 8, rows: 9 });
    // The start (0, 0) is column 2, row 6; the nearest border is the bottom.
    expect(doc.fixtures).toContainEqual({
      id: 'entrance-1',
      kind: 'entrance',
      x: 2,
      y: 8,
      w: 1,
      h: 1,
    });
    // The checkout is to the right of the east leg's end: south, one row down.
    expect(doc.fixtures).toContainEqual({
      id: 'checkout-1',
      kind: 'checkout',
      x: 5,
      y: 3,
      w: 1,
      h: 1,
      label: 'till 1',
    });
    // The scan at (0, 2) heading north: the product sits east, facing west.
    expect(doc.anchors).toEqual([
      {
        id: 'product-1',
        kind: 'product',
        at: { x: 3, y: 4 },
        face: 'w',
        ean: '8480000123457',
      },
      { id: 'note-1', kind: 'note', at: { x: 2, y: 2 }, text: 'bread' },
    ]);
    expect(
      doc.fixtures.filter((f) => f.kind === 'shelf').length
    ).toBeGreaterThan(0);
  });

  it('puts the product on the left for a left handed host', () => {
    const doc = walkToDocument(L, { hand: 'left' });
    expect(doc.anchors[0]).toMatchObject({ at: { x: 1, y: 4 }, face: 'e' });
    expect(validateShopMap(doc)).toEqual([]);
  });

  it('adds an entrance at the start when the walk marked none', () => {
    const doc = walkToDocument({ ...L, marks: [] });
    expect(doc.fixtures.filter((f) => f.kind === 'entrance')).toHaveLength(1);
    expect(validateShopMap(doc)).toEqual([]);
  });

  it('draws an empty walk as a valid empty room', () => {
    const doc = walkToDocument({
      segments: [],
      marks: [],
      scans: [],
      notes: [],
      startedAt: 0,
      finishedAt: 0,
    });
    expect(validateShopMap(doc)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(walkToDocument(L)).toEqual(walkToDocument(L));
  });

  it.each(['straight-aisle', 'l-shape', 'serpentine'])(
    'the %s trace draws a valid draft',
    (name) => {
      const doc = walkToDocument(traceWalk(name));
      expect(validateShopMap(doc)).toEqual([]);
    }
  );

  it.each([
    ['straight-aisle', 'walk-20260928-1000-straight-aisle.geojson'],
    ['l-shape', 'walk-20260928-1010-l-shape.geojson'],
    ['serpentine', 'walk-20260928-1020-six-aisle-serpentine.geojson'],
  ])(
    'the %s walk file draws a valid draft through its snap track',
    (dir, file) => {
      const imported = parseWalkImport(
        readFileSync(join(FIXTURES, 'walks', dir, file), 'utf8')
      );
      if (imported.kind !== 'walk') throw new Error('not a walk');
      const track = computeTrack(imported.walk, 'pdr:own:gyro:snap');
      const walk = trackToWalk(imported.walk, track);
      expect(walk.segments.length).toBe(track.segments.length);
      const doc = walkToDocument(walk);
      expect(validateShopMap(doc)).toEqual([]);
    }
  );
});
