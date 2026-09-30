/**
 * Reduces the second El Jamón walk of 2026-09-29 to the walk log fixture of
 * shop-map plan 0002, and writes the document and the walk order it folds to.
 *
 *   npx tsx tools/shop-map/reduce-el-jamon-walk.ts [path to the walk file]
 *
 * The walk file is 18 MB of raw streams and is never committed. It lives in
 * the owner's main checkout at `tmp/walk-20260929-1242-el-jamon-2.geojson`.
 * The output goes to
 * `libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon/`:
 * `walk-log.json`, `expected-map.json` and `expected-walk-order.json`.
 * Never edit them by hand: rerun this script.
 *
 * The script sits outside both libraries because it reads the walk with the
 * recorder, and the recorder already depends on the model: a script inside
 * the model importing the recorder would make the two a cycle.
 *
 * What is recorded and what is authored:
 *
 * - Recorded: the camera path (`vio`, not aligned) at one point per second,
 *   and all 57 marks with the heading the camera faced. The map's x is the
 *   camera's x and its y is the camera's z.
 * - Recorded: tracking was lost at 920.5 s. ARCore resumed at 922.0 s in a
 *   frame turned 158.5 degrees, and at 1013.4 s one frame jumped back onto the
 *   original map. So the log has a `stopped` entry (tracking lost), the
 *   automatic resume as a `resumed` entry holding the turned segment and its
 *   five marks, a `discarded` entry for that segment, and a manual `resumed`
 *   entry from 1013.4 s to the end. The 1.5 s gap of the stop is removed from
 *   log time.
 * - Authored: rewind 1 goes back to 1041.6 s, before the last two marks.
 *   Then the same tail is walked again (the recorded tail, replayed as a new
 *   `resumed` entry a week later, with new mark ids). Rewind 2 goes to 15 s
 *   into that replay, which is past rewind 1.
 * - Authored: one `edited` entry draws a gondola or a counter in front of the
 *   first mark of every section still on the map, an entrance, a checkout, a
 *   pillar and a hand drawn floor, moves the Frutería mark, removes a
 *   repeated Mascotas mark and adds a note. A gondola starts at the first
 *   floor nobody walked in the direction the phone faced, is up to 1 m deep,
 *   and grows along the aisle both ways while the aisle in front of it was
 *   walked, until walked floor crosses it or it meets another area, up to 9 m
 *   long (a counter up to 4 m).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  foldWalk,
  normalizeShopMapV2,
  validateShopMapV2,
  walkOrderV2,
  type MapArea,
  type MapMark,
  type WalkEntry,
  type WalkEvent,
} from '../../libs/luna-shopper/shop-map/model/src/index';
import { createLiveMap } from '../../libs/luna-shopper/shop-map/model/src/lib/v2/live-map';
import {
  computeTrack,
  positionAt,
  readWalkFile,
  type WalkMark,
} from '../../libs/luna-shopper/shop-map/recorder/src/index';

const SOURCE =
  process.argv[2] ??
  'D:/Projects/nx-portfolio/tmp/walk-20260929-1242-el-jamon-2.geojson';
const OUT = join(
  __dirname,
  '..',
  '..',
  'libs',
  'luna-shopper',
  'shop-map',
  'model',
  'src',
  'lib',
  '__fixtures__',
  'el-jamon'
);

/** Checkpoints that are counters in this shop; every other one is a section. */
const COUNTERS = new Set([
  'Horno de pan',
  'Pescadería',
  'Carnicería',
  'Charcutería',
]);

const r2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
};
const uuid = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entryId = (n: number) => uuid('ee000000', n);
const markId = (n: number) => uuid('aa000000', n);
const areaId = (n: number) => uuid('bb000000', n);

const file = JSON.parse(readFileSync(SOURCE, 'utf8'));
const walk = readWalkFile(file.walk);
const vio = computeTrack(walk, 'vio', { align: false });
const pose = walk.streams.pose ?? [];
const startedAtMs = Date.parse(walk.startedAt);
const wallIso = (t: number) =>
  new Date(startedAtMs + Math.round(t)).toISOString();

// The map frame: x is the camera's x, y is the camera's z.
const points = vio.points.map((p) => ({ t: p.t, x: p.x, y: -p.y }));
const at = (t: number) => {
  const p = positionAt(vio, t);
  return { x: p.x, y: -p.y };
};

/** Degrees, 0 along +y, clockwise as drawn: the phone faced (-sin h, cos h). */
function headingAt(t: number): number {
  let k = 0;
  while (k < pose.length - 1 && pose[k + 1][0] <= t) k++;
  const [qx, qy, qz, qw] = pose[k].slice(4);
  const fx = -2 * (qx * qz + qw * qy);
  const fz = -(1 - 2 * (qx * qx + qy * qy));
  return ((((Math.atan2(-fx, fz) * 180) / Math.PI) % 360) + 360) % 360;
}

// The tracking stop and the frame jump, read from the file.
const lost = walk.events.find((e) => e.kind === 'tracking-lost');
if (!lost) throw new Error('The walk has no tracking loss.');
const stopT = lost.t;
const resumeT = points.find((p) => p.t > stopT)?.t;
if (resumeT === undefined) throw new Error('Tracking never resumed.');
let jumpT: number | undefined;
for (let i = 1; i < points.length; i++) {
  const a = points[i - 1];
  const b = points[i];
  if (a.t > resumeT && Math.hypot(b.x - a.x, b.y - a.y) > 5) {
    jumpT = b.t;
    break;
  }
}
if (jumpT === undefined) throw new Error('The frame never jumped back.');
const endT = points[points.length - 1].t;
const gap = resumeT - stopT;
/** Log time: recorded time with the gap of the stop removed. */
const logOf = (t: number) => Math.round(t <= stopT ? t : t - gap);

let marksMade = 0;
function markOf(m: WalkMark, logMs: number): MapMark {
  const p = at(m.t);
  const kind =
    m.kind === 'entrance'
      ? 'note'
      : COUNTERS.has(m.label ?? '')
        ? 'counter'
        : 'section';
  return {
    id: markId(++marksMade),
    kind,
    x: r2(p.x),
    y: r2(p.y),
    heading: r2(headingAt(m.t)),
    text: m.kind === 'entrance' ? 'Entrada' : (m.label ?? ''),
    logMs,
  };
}

/**
 * The events of a stretch of the walk: the path at one point per second
 * split at every mark, each mark in its place, and `section-left` at the
 * wall times given. `shift` moves log time, for the replayed tail.
 */
function sessionEvents(
  from: number,
  to: number,
  shift: number,
  sectionLeftAt: number[] = []
): WalkEvent[] {
  const kept: { t: number; x: number; y: number }[] = [];
  const inside = points.filter((p) => p.t >= from && p.t < to);
  for (const p of inside) {
    if (kept.length === 0 || p.t >= kept[kept.length - 1].t + 1000)
      kept.push(p);
  }
  const lastInside = inside[inside.length - 1];
  if (lastInside && kept[kept.length - 1] !== lastInside) kept.push(lastInside);

  const happenings = [
    ...walk.marks
      .filter((m) => m.t >= from && m.t < to)
      .map((m) => ({ t: m.t, mark: m })),
    ...sectionLeftAt.map((t) => ({ t, mark: null })),
  ].sort((a, b) => a.t - b.t);

  const events: WalkEvent[] = [];
  let k = 0;
  const flush = (until: number) => {
    const chunk: [number, number, number][] = [];
    while (k < kept.length && kept[k].t <= until) {
      const p = kept[k++];
      chunk.push([logOf(p.t) + shift, r2(p.x), r2(p.y)]);
    }
    if (chunk.length > 0) events.push({ type: 'path', points: chunk });
  };
  for (const h of happenings) {
    flush(h.t);
    const logMs = logOf(h.t) + shift;
    events.push(
      h.mark
        ? { type: 'mark-put', mark: markOf(h.mark, logMs) }
        : { type: 'section-left', logMs }
    );
  }
  flush(Infinity);
  return events;
}

const entries: WalkEntry[] = [];
const push = (e: Omit<WalkEntry, 'seq'>) =>
  entries.push({ ...e, seq: entries.length + 1 } as WalkEntry);

const stopLog = logOf(stopT);
const jumpLog = logOf(jumpT);
const endLog = logOf(endT);

push({
  id: entryId(1),
  kind: 'started',
  at: wallIso(stopT),
  logFrom: 0,
  logTo: stopLog,
  events: sessionEvents(0, stopT + 1, 0, [235000]),
});
push({
  id: entryId(2),
  kind: 'stopped',
  at: wallIso(stopT),
  logFrom: stopLog,
  logTo: stopLog,
  events: [],
  reason: 'tracking-lost',
});
push({
  id: entryId(3),
  kind: 'resumed',
  at: wallIso(jumpT),
  logFrom: stopLog,
  logTo: jumpLog,
  events: sessionEvents(resumeT, jumpT, 0),
});
push({
  id: entryId(4),
  kind: 'discarded',
  at: wallIso(jumpT + 4000),
  logFrom: stopLog,
  logTo: jumpLog,
  events: [],
});
push({
  id: entryId(5),
  kind: 'resumed',
  at: wallIso(endT),
  logFrom: jumpLog,
  logTo: endLog,
  events: sessionEvents(jumpT, endT + 1, 0),
});

// Rewind 1, to before the last two marks of the walk.
const rewind1Wall = 1041600;
const rewind1 = logOf(rewind1Wall);
push({
  id: entryId(6),
  kind: 'rewound',
  at: '2026-09-29T18:05:00.000Z',
  logFrom: endLog,
  logTo: endLog,
  events: [],
  rewoundTo: rewind1,
});

// The tail walked again a week later, from where rewind 1 left the map.
const replayShift = endLog - rewind1;
const replayEnd = endLog + (endLog - rewind1);
push({
  id: entryId(7),
  kind: 'resumed',
  at: '2026-10-06T10:40:00.000Z',
  logFrom: endLog,
  logTo: replayEnd,
  events: sessionEvents(rewind1Wall, endT + 1, replayShift),
});

// Rewind 2, fifteen seconds into the replay: past rewind 1.
const rewind2 = endLog + 15000;
push({
  id: entryId(8),
  kind: 'rewound',
  at: '2026-10-06T19:12:00.000Z',
  logFrom: replayEnd,
  logTo: replayEnd,
  events: [],
  rewoundTo: rewind2,
});

// The edit, drawn on the map rewind 2 left.
const before = foldWalk(entries);
const areas: MapArea[] = [];
const skipped: string[] = [];
const overlaps = (a: MapArea) =>
  areas.some(
    (b) =>
      b.kind !== 'path' &&
      b.kind !== 'entrance' &&
      Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.1 &&
      Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.1
  );
const firstMarks = new Map<string, MapMark>();
for (const m of [...before.marks].sort((a, b) => a.logMs - b.logMs)) {
  if (m.kind !== 'note' && !firstMarks.has(m.text)) firstMarks.set(m.text, m);
}
let counters = 0;
let shelves = 0;
/** The walked cells of the live map (within 0.5 m of the path), cell (i, j) covering [i·0.5, (i+1)·0.5). */
const walkedCells = new Set(
  createLiveMap({
    document: { version: 2, areas: [], marks: [], path: before.path },
    settings: { idPrefix: 'x', idSeed: 1 },
  })
    .snapshot()
    .walkedCells.map((c) => `${c.x},${c.y}`)
);
const CELL = 0.5;
const floor = { x0: 0, y0: 0 };
/** Every kept path point with its log time, outside the discarded segment. */
const timed = entries
  .filter((e) => e.seq !== 3)
  .flatMap((e) => e.events)
  .flatMap((ev) => (ev.type === 'path' ? ev.points : []))
  .sort((a, b) => a[0] - b[0]);
/** The walking direction around a log time, over two seconds each way. */
function walkingAt(logMs: number): [number, number] | null {
  const near = (t: number) =>
    timed.reduce((best, p) =>
      Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best
    );
  const a = near(logMs - 2000);
  const b = near(logMs + 2000);
  const d = Math.hypot(b[1] - a[1], b[2] - a[2]);
  return d > 0.5 ? [(b[1] - a[1]) / d, (b[2] - a[2]) / d] : null;
}
const walkedAt = (i: number, j: number) => walkedCells.has(`${i},${j}`);
/** Cells of the gondola: up to this deep... */
const GONDOLA_DEPTH_CELLS = 2;
/** ...and up to this long, a counter shorter. */
const GONDOLA_MAX_CELLS = 18;
const COUNTER_MAX_CELLS = 8;
/** How far in front of the person the shelf face is looked for (2 m). */
const FACE_REACH_CELLS = 4;

/**
 * A gondola or a counter in front of a mark: its near face at the first cell
 * nobody walked in the direction the phone faced, up to 1 m deep, grown along
 * the aisle both ways over unwalked cells while the aisle in front was walked,
 * until it meets walked floor or another area. `null` when there is no room.
 */
function areaInFront(m: MapMark, section: string): MapArea | null {
  const counter = m.kind === 'counter';
  const h = (m.heading * Math.PI) / 180;
  const dx = -Math.sin(h);
  const dy = Math.cos(h);
  // The gondola lines the aisle: its long side runs the way the person
  // walked, and it stands on the side the phone faced. Standing still, the
  // phone's own main axis decides.
  const walking = walkingAt(m.logMs);
  const alongX = walking
    ? Math.abs(walking[1]) >= Math.abs(walking[0])
    : Math.abs(dx) >= Math.abs(dy);
  const step = (alongX ? Math.sign(dx) : Math.sign(dy)) || 1;
  const mi = Math.floor((m.x - floor.x0) / CELL);
  const mj = Math.floor((m.y - floor.y0) / CELL);
  // Depth runs along the facing axis (n); length runs across it (t).
  const cellAt = (n: number, t: number): [number, number] =>
    alongX ? [n, t] : [t, n];
  const n0 = alongX ? mi : mj;
  const t0 = alongX ? mj : mi;
  let near: number | null = null;
  for (let k = 1; k <= FACE_REACH_CELLS; k++) {
    if (!walkedAt(...cellAt(n0 + k * step, t0))) {
      near = n0 + k * step;
      break;
    }
  }
  if (near === null) near = n0 + step;
  let depth = 1;
  while (
    depth < GONDOLA_DEPTH_CELLS &&
    !walkedAt(...cellAt(near + depth * step, t0))
  ) {
    depth++;
  }
  const nLo = Math.min(near, near + (depth - 1) * step);
  const nHi = Math.max(near, near + (depth - 1) * step);
  const rect = (tLo: number, tHi: number): MapArea => {
    const [iLo, jLo] = cellAt(nLo, tLo);
    const [iHi, jHi] = cellAt(nHi, tHi);
    return {
      id: areaId(areas.length + 1),
      kind: counter ? 'counter' : 'shelf',
      x: r2(floor.x0 + iLo * CELL),
      y: r2(floor.y0 + jLo * CELL),
      w: r2((iHi - iLo + 1) * CELL),
      h: r2((jHi - jLo + 1) * CELL),
      section,
      colour: { mode: 'default' },
      origin: 'drawn',
    };
  };
  // A column continues the gondola while the aisle in front of it was walked
  // within 1.5 m and its back row was not: a gondola lines an aisle, and ends
  // where the aisle does or where walked floor crosses it. A path that wanders
  // into its front row is the aisle's edge, not a gap.
  const back = near + (depth - 1) * step;
  const columnOpen = (t: number) => {
    let aisle = false;
    for (let k = 1; k <= 3; k++) {
      if (walkedAt(...cellAt(near - k * step, t))) aisle = true;
    }
    if (!aisle || walkedAt(...cellAt(back, t))) return false;
    return !overlaps(rect(t, t));
  };
  if (overlaps(rect(t0, t0))) return null;
  const max = counter ? COUNTER_MAX_CELLS : GONDOLA_MAX_CELLS;
  let tLo = t0;
  let tHi = t0;
  let grew = true;
  while (grew && tHi - tLo + 1 < max) {
    grew = false;
    if (columnOpen(tLo - 1)) {
      tLo--;
      grew = true;
    }
    if (tHi - tLo + 1 < max && columnOpen(tHi + 1)) {
      tHi++;
      grew = true;
    }
  }
  return rect(tLo, tHi);
}
for (const m of firstMarks.values()) {
  const counter = m.kind === 'counter';
  const area = areaInFront(m, m.text);
  if (!area) {
    skipped.push(m.text);
    continue;
  }
  if (counter && counters++ === 0) {
    area.colour = { mode: 'custom', value: '#C0392B' };
    area.label = `${m.text} (counter)`;
  }
  if (!counter && shelves++ === 0) area.colour = { mode: 'category' };
  areas.push(area);
}
// A second shelf of one section, typed differently: one stop in the walk order.
const hygiene = before.marks
  .filter((m) => m.text === 'Higiene y perfumería')
  .sort((a, b) => a.logMs - b.logMs)[1];
if (!hygiene) throw new Error('No second Higiene y perfumería mark.');
const second = areaInFront(hygiene, 'higiene y perfumería ');
if (!second) throw new Error('No room for the second hygiene shelf.');
areas.push(second);

const door = before.marks.find((m) => m.kind === 'note');
if (!door) throw new Error('No entrance note.');
const extra: MapArea[] = [
  {
    id: areaId(areas.length + 1),
    kind: 'entrance',
    x: r2(door.x - 1),
    y: r2(door.y + 0.25),
    w: 2,
    h: 0.5,
    label: 'Entrada',
    colour: { mode: 'default' },
    origin: 'drawn',
  },
  {
    id: areaId(areas.length + 2),
    kind: 'checkout',
    x: r2(door.x + 3),
    y: r2(door.y - 1.5),
    w: 2,
    h: 1,
    colour: { mode: 'default' },
    origin: 'drawn',
  },
  {
    id: areaId(areas.length + 3),
    kind: 'blocked',
    x: 15,
    y: -10,
    w: 0.5,
    h: 0.5,
    label: 'Columna',
    colour: { mode: 'default' },
    origin: 'drawn',
  },
  {
    id: areaId(areas.length + 4),
    kind: 'path',
    x: r2(door.x + 5.5),
    y: r2(door.y - 4),
    w: 1,
    h: 3,
    colour: { mode: 'default' },
    origin: 'drawn',
  },
];
for (const a of extra) {
  if (overlaps(a)) throw new Error(`${a.kind} overlaps a drawn area.`);
  areas.push(a);
}

const fruit = before.marks.find((m) => m.text === 'Frutería');
const mascotas = before.marks
  .filter((m) => m.text === 'Mascotas')
  .sort((a, b) => a.logMs - b.logMs);
if (!fruit || mascotas.length < 2) throw new Error('Marks moved.');
const checkout = extra[1];
push({
  id: entryId(9),
  kind: 'edited',
  at: '2026-10-06T19:20:00.000Z',
  logFrom: replayEnd,
  logTo: replayEnd,
  events: [
    ...areas.map((area): WalkEvent => ({ type: 'area-put', area })),
    { type: 'mark-put', mark: { ...fruit, x: r2(fruit.x + 0.3) } },
    { type: 'mark-removed', id: mascotas[1].id },
    {
      type: 'mark-put',
      mark: {
        id: markId(++marksMade),
        kind: 'note',
        x: r2(checkout.x + checkout.w / 2),
        y: r2(checkout.y - 0.5),
        heading: 0,
        text: 'Cajas',
        logMs: replayEnd,
      },
    },
  ],
});

const document = normalizeShopMapV2(foldWalk(entries));
const problems = validateShopMapV2(document);
if (problems.length > 0) {
  throw new Error(
    `The folded document is invalid: ${JSON.stringify(problems)}`
  );
}
const order = walkOrderV2(document);

mkdirSync(OUT, { recursive: true });
const log = {
  '//': 'Reduced from walk-20260929-1242-el-jamon-2.geojson by tools/shop-map/reduce-el-jamon-walk.ts (shop-map plan 0002). Never edit by hand: rerun the script.',
  walk: { id: walk.id, name: walk.name, startedAt: walk.startedAt },
  stop: { wallMs: stopT, resumeWallMs: resumeT, frameBackWallMs: jumpT },
  entries,
};
/** Two space JSON with every array of numbers kept on one line. */
const write = (name: string, value: unknown) => {
  const text = `${JSON.stringify(value, null, 2).replace(
    /\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g,
    (_, inner: string) => `[${inner.replace(/,\s+/g, ', ')}]`
  )}\n`;
  writeFileSync(join(OUT, name), text);
  return text.length;
};
const size = write('walk-log.json', log);
write('expected-map.json', document);
write('expected-walk-order.json', order);

const markPuts = entries.flatMap((e) =>
  e.events.filter((ev) => ev.type === 'mark-put')
).length;
const pathPoints = entries
  .flatMap((e) => e.events)
  .reduce((n, ev) => n + (ev.type === 'path' ? ev.points.length : 0), 0);
console.log(
  JSON.stringify(
    {
      entries: entries.map(
        (e) => `${e.seq} ${e.kind} ${e.logFrom}..${e.logTo}`
      ),
      stopT,
      resumeT,
      jumpT,
      gap,
      rewind1,
      rewind2,
      replayEnd,
      logBytes: size,
      pathPoints,
      markPuts,
      areas: document.areas.length,
      marks: document.marks.length,
      polylines: document.path.length,
      skipped,
      order: order.sections.map((s) => `${s.name} @${s.atMetres}`),
      startsAtEntrance: order.startsAtEntrance,
      endsAtCheckout: order.endsAtCheckout,
    },
    null,
    2
  )
);
