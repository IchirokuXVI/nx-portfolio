/**
 * Cuts the tracking guard's fixture (recorder plan 0003) out of the second
 * El Jamón walk of 2026-09-29.
 *
 *   npx nx run luna-shopper/shop-map/recorder:cut-tracking-fixture --args="<walk file>"
 *
 * The source walk is 18 MB and is never committed. It lives in the owner's
 * checkout as `tmp/walk-20260929-1242-el-jamon-2.geojson`. This script keeps
 * the `pose` and `absolute` streams of two windows, down sampled to 10 Hz:
 *
 * - `baseline`: the first two minutes, where the compass offset is learned;
 * - `incident`: 860 s to 1040 s, which holds the tracking loss at 920.5 s, the
 *   frame that came back rotated at 922.0 s and the jump at 1013.4 s.
 *
 * Down sampling keeps the first row of a stream at or after 100 ms from the
 * last row it kept. The `tracking-lost` and `tracking-resumed` events of each
 * window are kept as they were written. Never edit the output by hand: rerun
 * this script.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const WINDOWS = {
  baseline: [0, 120_000],
  incident: [860_000, 1_040_000],
} as const;
const STEP_MS = 100;

const OUT = join(
  __dirname,
  '..',
  'src',
  '__fixtures__',
  'tracking',
  'el-jamon-2.tracking.json'
);

interface SourceWalk {
  id: string;
  startedAt: string;
  poseSource?: string;
  source: { platform: string; device?: string };
  streams: { pose?: number[][]; absolute?: number[][] };
  events: { t: number; kind: string; detail?: string }[];
}

function downSample(rows: number[][], from: number, to: number): number[][] {
  const kept: number[][] = [];
  let last = -Infinity;
  for (const row of rows) {
    const t = row[0];
    if (t < from || t >= to || t < last + STEP_MS) continue;
    kept.push(row);
    last = t;
  }
  return kept;
}

const path = process.argv[2];
if (!path) {
  console.error('usage: cut-tracking-fixture.ts <walk file>');
  process.exit(1);
}
const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
  walk?: SourceWalk;
} & SourceWalk;
const walk: SourceWalk = parsed.walk ?? parsed;
const pose = walk.streams.pose ?? [];
const absolute = walk.streams.absolute ?? [];

const windows = Object.fromEntries(
  Object.entries(WINDOWS).map(([name, [from, to]]) => [
    name,
    {
      from,
      to,
      pose: downSample(pose, from, to),
      absolute: downSample(absolute, from, to),
      events: walk.events.filter(
        (e) => e.t >= from && e.t < to && e.kind.startsWith('tracking-')
      ),
    },
  ])
);

const fixture = {
  source: {
    walkId: walk.id,
    startedAt: walk.startedAt,
    platform: walk.source.platform,
    device: walk.source.device,
    poseSource: walk.poseSource,
    stepMs: STEP_MS,
  },
  windows,
};

// One row per line, so a diff of a recut stays readable.
const text = JSON.stringify(fixture, null, 1).replace(
  /\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g,
  (_m, inner: string) => `[${inner.replace(/,\s+/g, ',')}]`
);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text + '\n');
for (const [name, w] of Object.entries(windows)) {
  console.log(
    `${name}: ${w.pose.length} poses, ${w.absolute.length} compass rows, ${w.events.length} events`
  );
}
