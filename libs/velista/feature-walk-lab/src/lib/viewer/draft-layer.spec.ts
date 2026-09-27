import {
  computeTrack,
  parseWalkImport,
  type WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { draftRects } from './draft-layer';

const FIXTURES = resolve(
  __dirname,
  '../../../../../luna-shopper/shop-map/recorder/src/__fixtures__/walks'
);

function fixture(name: string): WalkFile {
  const dir = join(FIXTURES, name);
  const file = readdirSync(dir).find((f) => f.endsWith('.geojson')) as string;
  const parsed = parseWalkImport(readFileSync(join(dir, file), 'utf8'));
  if (parsed.kind !== 'walk') {
    throw new Error('expected a walk');
  }
  return parsed.walk;
}

describe('draftRects', () => {
  it.each(['straight-aisle', 'l-shape', 'serpentine'])(
    'lays the %s draft beside the snap track, never on it',
    (name) => {
      const walk = fixture(name);
      const track = computeTrack(walk, 'pdr:own:gyro:snap');
      const rects = draftRects(walk, track).filter((r) => r.kind === 'shelf');
      const cell = walk.settings.cellMetres;

      expect(rects.length).toBeGreaterThan(0);

      // No walked point sits inside a shelf, beyond half a cell of rounding.
      const inset = cell / 2 + 0.01;
      for (const p of track.points) {
        const inside = rects.some(
          (r) =>
            p.x > r.x + inset &&
            p.x < r.x + r.w - inset &&
            p.y > r.y + inset &&
            p.y < r.y + r.h - inset
        );
        expect(inside).toBe(false);
      }

      // And the shelves hug the path: every point has a shelf within two cells.
      for (const p of track.points) {
        const near = rects.some(
          (r) =>
            p.x > r.x - 2 * cell &&
            p.x < r.x + r.w + 2 * cell &&
            p.y > r.y - 2 * cell &&
            p.y < r.y + r.h + 2 * cell
        );
        expect(near).toBe(true);
      }
    }
  );
});
