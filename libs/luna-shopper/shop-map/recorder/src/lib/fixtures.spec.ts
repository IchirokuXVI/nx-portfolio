import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeTrack } from './engine';
import { trackMetrics } from './metrics';
import { availableModes, describeMode } from './modes';
import { createWalkRecorder } from './recorder';
import type { TrackOptions } from './track-types';
import type { WalkFile } from './walk-file';
import { parseWalkImport } from './walk-import';

/**
 * The golden fixtures of plan 0002. The Android app replays the same files
 * and asserts the same numbers, so a change here is a change on both sides.
 */
const FIXTURES = join(__dirname, '..', '__fixtures__');
const WALKS = join(FIXTURES, 'walks');

interface Summary {
  steps: number;
  turns: number;
  distanceMetres: number;
  endToStartMetres: number;
  final: { x: number; y: number };
  rotation: number;
  bearing?: number;
  points: number;
  segments: number;
  checkpoints: { label: string; count: number; errorMetres: number }[];
}

interface Expected {
  file: string;
  truth: {
    steps: number;
    turns: number;
    endToStartMetres: number;
    absoluteBearing: number | null;
  };
  availableModes: string[];
  modes: Record<string, Record<string, Summary>>;
}

const MODELS: Record<string, TrackOptions> = {
  fixed: {},
  weinberg: { stepModel: 'weinberg' },
};

const names = readdirSync(WALKS);

it('has the three walks of the brief', () => {
  expect(names.sort()).toEqual(['l-shape', 'serpentine', 'straight-aisle']);
});

describe.each(names)('walk fixture %s', (name) => {
  const expected = JSON.parse(
    readFileSync(join(WALKS, name, 'expected.json'), 'utf8')
  ) as Expected;
  const imported = parseWalkImport(
    readFileSync(join(WALKS, name, expected.file), 'utf8')
  );
  if (imported.kind !== 'walk') throw new Error(`${name} did not replay`);
  const walk: WalkFile = imported.walk;

  it('offers the expected modes', () => {
    expect(availableModes(walk)).toEqual(expected.availableModes);
  });

  const cases = Object.entries(expected.modes).flatMap(([mode, models]) =>
    Object.keys(models).map((model) => [mode, model] as const)
  );
  it.each(cases)('%s %s matches expected.json', (mode, model) => {
    const e = expected.modes[mode][model];
    const track = computeTrack(walk, mode, MODELS[model]);
    const m = trackMetrics(walk, track);
    const last = track.points[track.points.length - 1];
    expect(m.steps).toBe(e.steps);
    expect(m.turns).toBe(e.turns);
    expect(track.points.length).toBe(e.points);
    expect(track.segments.length).toBe(e.segments);
    expect(m.distanceMetres).toBeCloseTo(e.distanceMetres, 3);
    expect(m.endToStartMetres).toBeCloseTo(e.endToStartMetres, 3);
    expect(last.x).toBeCloseTo(e.final.x, 3);
    expect(last.y).toBeCloseTo(e.final.y, 3);
    expect(track.rotation).toBeCloseTo(e.rotation, 3);
    if (e.bearing === undefined) expect(track.bearing).toBeUndefined();
    else expect(track.bearing).toBeCloseTo(e.bearing, 3);
    expect(m.checkpoints.length).toBe(e.checkpoints.length);
    m.checkpoints.forEach((c, i) => {
      expect(c.label).toBe(e.checkpoints[i].label);
      expect(c.errorMetres).toBeCloseTo(e.checkpoints[i].errorMetres, 3);
    });
  });

  it('snap modes reproduce the true turn count and close where the truth closes', () => {
    for (const mode of expected.availableModes) {
      if (!describeMode(mode).snap) continue;
      const e = expected.modes[mode]['fixed'];
      expect(e.turns).toBe(expected.truth.turns);
      expect(e.steps).toBe(expected.truth.steps);
      expect(
        Math.abs(e.endToStartMetres - expected.truth.endToStartMetres)
      ).toBeLessThan(2);
    }
  });

  it('absolute modes recover the start bearing', () => {
    if (expected.truth.absoluteBearing === null) return;
    for (const mode of expected.availableModes) {
      if (describeMode(mode).heading !== 'absolute') continue;
      const b = expected.modes[mode]['fixed'].bearing ?? NaN;
      expect(Math.abs(b - expected.truth.absoluteBearing)).toBeLessThan(2);
    }
  });
});

describe.each(['straight-aisle', 'l-shape', 'serpentine'])(
  'plan 0001 trace %s',
  (name) => {
    const trace = JSON.parse(
      readFileSync(join(FIXTURES, 'traces', `${name}.trace.json`), 'utf8')
    ) as {
      samples: number[][];
      actions: { t: number; kind: string; label?: string; ean?: string }[];
    };
    const expected = JSON.parse(
      readFileSync(join(FIXTURES, 'traces', `${name}.expected.json`), 'utf8')
    );

    it('replays to the expected walk', () => {
      const recorder = createWalkRecorder({
        start: { x: 0, y: 0, heading: 'n' },
      });
      let next = 0;
      for (const [t, ax, ay, az, yawRate] of trace.samples) {
        while (next < trace.actions.length && trace.actions[next].t <= t) {
          const a = trace.actions[next++];
          if (a.kind === 'scan' && a.ean) recorder.scan(a.ean);
          else if (a.kind === 'note') recorder.note(a.label ?? '');
          else if (
            a.kind === 'entrance' ||
            a.kind === 'checkout' ||
            a.kind === 'checkpoint'
          ) {
            recorder.mark(a.kind, a.label);
          }
        }
        recorder.push({ t, accel: { x: ax, y: ay, z: az }, yawRate });
      }
      expect(recorder.finish()).toEqual(expected);
    });
  }
);

it('the serpentine trace walks six aisles and comes back to the door', () => {
  const walk = JSON.parse(
    readFileSync(join(FIXTURES, 'traces', 'serpentine.expected.json'), 'utf8')
  );
  expect(walk.segments).toHaveLength(12);
  expect(walk.segments[walk.segments.length - 1].to).toEqual({ x: 0, y: 0 });
});
