/**
 * Regenerates the synthetic fixtures of recorder plans 0001 and 0002.
 *
 *   npx nx run luna-shopper/shop-map/recorder:generate-fixtures
 *
 * Writes, for each script below:
 * - `src/__fixtures__/walks/<name>/<walk file name>.geojson`: the walk file of
 *   plan 0002 inside the GeoJSON of its section 3, with every mode drawn;
 * - `src/__fixtures__/walks/<name>/expected.json`: per mode and step model,
 *   the numbers this implementation computes, plus the true path's numbers;
 * - `src/__fixtures__/traces/<name>.trace.json` and `.expected.json`: plan
 *   0001's motion samples and the `Walk` its recorder answers.
 *
 * The walks are synthetic (see `synthesize.ts`), because no phone recording
 * existed when the library was built. Real ones join them after the field
 * test. Never edit the output by hand: rerun this script.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  availableModes,
  computeTrack,
  createWalkRecorder,
  parseWalkImport,
  trackMetrics,
  walkFileName,
  walkToGeoJson,
  type Track,
  type TrackOptions,
  type WalkFile,
} from '../src/index';
import { synthesize, type Script } from './synthesize';

const FIXTURES = join(__dirname, '..', 'src', '__fixtures__');

/** An aisle there and back: "door" at both ends of the walk. */
const straight: Script = {
  id: '6f1c2a90-0d5e-4b7a-9c43-2f6a1d9e0001',
  name: 'Straight aisle',
  startedAt: '2026-09-28T10:00:00+02:00',
  bearing: 212.5,
  streams: { absolute: true, location: true },
  seed: 1,
  actions: [
    { stand: 500 },
    { mark: 'checkpoint', label: 'door' },
    { mark: 'entrance' },
    { stand: 1500 },
    { walk: 20 },
    { scan: '8480000123457' },
    { mark: 'checkpoint', label: 'aisle end' },
    { turn: 180 },
    { walk: 20 },
    { mark: 'checkpoint', label: 'door' },
    { stand: 1000 },
  ],
};

/** An L: fourteen steps, a right turn, ten steps. No compass, no location. */
const lShape: Script = {
  id: '6f1c2a90-0d5e-4b7a-9c43-2f6a1d9e0002',
  name: 'L shape',
  startedAt: '2026-09-28T10:10:00+02:00',
  bearing: 212.5,
  streams: { absolute: false, location: false },
  seed: 2,
  actions: [
    { stand: 500 },
    { mark: 'entrance' },
    { stand: 1500 },
    { walk: 14 },
    { mark: 'checkpoint', label: 'corner' },
    { turn: 90 },
    { walk: 10 },
    { mark: 'checkout' },
    { stand: 1000 },
  ],
};

/** Six aisles of seventeen steps in a serpentine, then back to the door. */
function serpentineActions(): Script['actions'] {
  const actions: Script['actions'] = [
    { stand: 500 },
    { mark: 'checkpoint', label: 'door' },
    { mark: 'entrance' },
    { stand: 1500 },
  ];
  for (let aisle = 1; aisle <= 6; aisle++) {
    actions.push({ walk: 17 });
    if (aisle === 3) actions.push({ scan: '8410000000017' });
    if (aisle === 6) break;
    const side = aisle % 2 === 1 ? 90 : -90;
    actions.push({ turn: side }, { walk: 3 }, { turn: side });
    if (aisle === 4) actions.push({ mark: 'note', label: 'fish counter' });
  }
  actions.push(
    { turn: 90 },
    { walk: 15 },
    { mark: 'checkout' },
    { mark: 'checkpoint', label: 'door' },
    { stand: 1000 }
  );
  return actions;
}

const serpentine: Script = {
  id: '6f1c2a90-0d5e-4b7a-9c43-2f6a1d9e0003',
  name: 'Six aisle serpentine',
  startedAt: '2026-09-28T10:20:00+02:00',
  bearing: 212.5,
  streams: { absolute: true, location: true },
  seed: 3,
  actions: serpentineActions(),
};

const SCRIPTS: Record<string, Script> = {
  'straight-aisle': straight,
  'l-shape': lShape,
  serpentine,
};

const r4 = (v: number) => {
  const out = Math.round(v * 1e4) / 1e4;
  return out === 0 ? 0 : out;
};

function summary(walk: WalkFile, track: Track) {
  const m = trackMetrics(walk, track);
  const last = track.points[track.points.length - 1];
  return {
    steps: m.steps,
    turns: m.turns,
    distanceMetres: r4(m.distanceMetres),
    endToStartMetres: r4(m.endToStartMetres),
    final: { x: r4(last.x), y: r4(last.y) },
    rotation: r4(track.rotation),
    ...(track.bearing !== undefined ? { bearing: r4(track.bearing) } : {}),
    points: track.points.length,
    segments: track.segments.length,
    checkpoints: m.checkpoints.map((c) => ({
      label: c.label,
      count: c.count,
      errorMetres: r4(c.errorMetres),
    })),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

rmSync(join(FIXTURES, 'walks'), { recursive: true, force: true });
rmSync(join(FIXTURES, 'traces'), { recursive: true, force: true });
mkdirSync(join(FIXTURES, 'traces'), { recursive: true });

for (const [name, script] of Object.entries(SCRIPTS)) {
  const { walk, trace, truth } = synthesize(script);
  const modes = availableModes(walk);
  const tracks = modes.map((m) => computeTrack(walk, m));
  const geo = walkToGeoJson(walk, tracks, 'pdr:own:gyro:snap');
  const dir = join(FIXTURES, 'walks', name);
  mkdirSync(dir, { recursive: true });
  const fileName = walkFileName(walk);
  // Compact: a walk file is megabytes, and one row per line would be worse.
  writeFileSync(join(dir, fileName), JSON.stringify(geo) + '\n');

  // What is replayed is what was written, so read it back like an importer.
  const replayed = parseWalkImport(JSON.stringify(geo));
  if (replayed.kind !== 'walk') throw new Error('fixture did not replay');
  const models: Record<string, TrackOptions> = {
    fixed: {},
    weinberg: { stepModel: 'weinberg' },
  };
  const expected: Record<string, Record<string, unknown>> = {};
  for (const mode of modes) {
    expected[mode] = {};
    for (const [model, options] of Object.entries(models)) {
      if (model === 'weinberg' && !mode.startsWith('pdr:')) continue;
      expected[mode][model] = summary(
        replayed.walk,
        computeTrack(replayed.walk, mode, options)
      );
    }
  }
  const last = truth.path[truth.path.length - 1];
  writeFileSync(
    join(dir, 'expected.json'),
    json({
      file: fileName,
      synthetic: true,
      truth: {
        steps: truth.steps,
        turns: truth.turns,
        distanceMetres: r4(truth.distanceMetres),
        endToStartMetres: r4(Math.hypot(last.x, last.y)),
        final: { x: r4(last.x), y: r4(last.y) },
        absoluteBearing: script.streams.absolute ? script.bearing : null,
      },
      availableModes: modes,
      modes: expected,
    })
  );

  // Plan 0001: the same motion, as samples with a precomputed yaw rate.
  writeFileSync(
    join(FIXTURES, 'traces', `${name}.trace.json`),
    JSON.stringify({ start: { x: 0, y: 0, heading: 'n' }, ...trace }) + '\n'
  );
  const recorder = createWalkRecorder({ start: { x: 0, y: 0, heading: 'n' } });
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
  writeFileSync(
    join(FIXTURES, 'traces', `${name}.expected.json`),
    json(recorder.finish())
  );
  console.log(`${name}: ${modes.length} modes, ${fileName}`);
}
