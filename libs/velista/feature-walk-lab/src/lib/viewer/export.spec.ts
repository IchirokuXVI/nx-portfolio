import {
  parseWalkImport,
  type WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { computeAndExport, pickMode } from './export';

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

describe('export', () => {
  it('writes a file that imports back as the same walk, with a line per mode', async () => {
    const walk = fixture('serpentine');

    const out = await computeAndExport(walk, {});
    const back = parseWalkImport(out.text);
    const geojson = JSON.parse(out.text);

    expect(out.fileName).toBe(
      'walk-20260928-1020-six-aisle-serpentine.geojson'
    );
    expect(back.kind).toBe('walk');
    expect(back.kind === 'walk' && back.walk).toEqual(walk);
    expect(
      geojson.features.filter(
        (f: { geometry: { type: string } }) => f.geometry.type === 'LineString'
      )
    ).toHaveLength(14);
  });

  it('puts the marks on the recorder of plan 0001 unless told otherwise', () => {
    expect(pickMode(['vio', 'pdr:own:gyro:snap'])).toBe('pdr:own:gyro:snap');
    expect(pickMode(['vio', 'pdr:own:gyro:snap'], 'vio')).toBe('vio');
    expect(pickMode(['gps', 'pdr:hw:game'])).toBe('pdr:hw:game');
    expect(pickMode([])).toBeNull();
  });
});
