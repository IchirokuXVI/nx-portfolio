import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alignPose,
  alignSession,
  applyRigid,
  cameraHeading,
  circularMedian,
  compassHeading,
  createTrackingGuard,
  keepPathPoint,
  mapPoint,
  wrapDegrees,
  type CompassSample,
  type PoseSample,
  type TrackingEvent,
  type TrackingGuard,
} from './tracking-guard';

/**
 * The fixture of plan 0003, cut from the second El Jamón walk by
 * `tools/cut-tracking-fixture.ts`. ARCore wrote its tracking state as
 * events rather than per pose, so a `tracking-lost` event is replayed as an
 * untracked pose at its time, which is what a host reading the state per
 * frame would push.
 */
interface Window {
  from: number;
  to: number;
  pose: number[][];
  absolute: number[][];
  events: { t: number; kind: string }[];
}
const FIXTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '__fixtures__',
      'tracking',
      'el-jamon-2.tracking.json'
    ),
    'utf8'
  )
) as { windows: { baseline: Window; incident: Window } };

type Row =
  | { t: number; order: 0; pose: PoseSample }
  | { t: number; order: 1; compass: CompassSample };

function rowsOf(w: Window): Row[] {
  const rows: Row[] = [];
  for (const [t, x, y, z, qx, qy, qz, qw] of w.pose) {
    rows.push({
      t,
      order: 0,
      pose: { t, x, y, z, qx, qy, qz, qw, tracked: true },
    });
  }
  for (const [t, qx, qy, qz, qw] of w.absolute) {
    rows.push({ t, order: 1, compass: { t, qx, qy, qz, qw } });
  }
  for (const e of w.events) {
    if (e.kind !== 'tracking-lost') continue;
    const pose = { t: e.t, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    rows.push({ t: e.t, order: 0, pose: { ...pose, tracked: false } });
  }
  return rows.sort((a, b) => a.t - b.t || a.order - b.order);
}

/** Replays a window. `answer` plays the person, called before each row. */
function replay(
  guard: TrackingGuard,
  w: Window,
  answer: (t: number, g: TrackingGuard) => void = () => undefined
): TrackingGuard {
  for (const row of rowsOf(w)) {
    answer(row.t, guard);
    if (row.order === 0) guard.pushPose(row.pose);
    else guard.pushCompass(row.compass);
  }
  return guard;
}

function first(
  events: readonly TrackingEvent[],
  match: (e: TrackingEvent) => boolean
): TrackingEvent {
  const e = events.find(match);
  if (!e) throw new Error('no such event');
  return e;
}

const seconds = (e: TrackingEvent) => e.t / 1000;

describe('the tracking guard over the second El Jamón walk', () => {
  const learned = replay(createTrackingGuard(), FIXTURE.windows.baseline);
  const baseline = learned.state().baseline as number;

  it('learns a baseline from the first 60 s and stays good for two minutes', () => {
    const e = first(learned.events(), (x) => x.kind === 'baseline');
    expect(seconds(e)).toBeGreaterThanOrEqual(60);
    expect(seconds(e)).toBeLessThan(63);
    expect(baseline).toBeCloseTo(316.6, 1);
    expect(learned.events().map((x) => x.kind)).toEqual(['baseline']);
    expect(learned.state().kind).toBe('good');
  });

  describe('left alone, with nobody answering', () => {
    const guard = replay(
      createTrackingGuard({ baseline }),
      FIXTURE.windows.incident
    );
    const events = guard.events();

    it('is lost at 920.5 s', () => {
      const e = first(events, (x) => x.kind === 'lost');
      expect(seconds(e)).toBeCloseTo(920.5, 1);
      expect(events[0]).toBe(e);
    });

    it('is suspect with an automatic resume when poses return at 922.0 s', () => {
      const e = first(events, (x) => x.kind === 'suspect');
      expect(e).toMatchObject({ cause: 'returned', automaticResume: true });
      expect(seconds(e)).toBeCloseTo(922.0, 1);
    });

    it('stops the walk for the flipped frame within 5 s of 922.0 s', () => {
      const heading = first(
        events,
        (x) => x.kind === 'suspect' && x.cause === 'heading'
      );
      const stop = first(events, (x) => x.kind === 'stopped');
      expect(stop).toMatchObject({ reason: 'frame-moved' });
      expect(stop.t).toBe(heading.t);
      // The points kept since 922.0 s are in the flipped frame.
      expect(stop).toMatchObject({ unconfirmedDropped: true });
      expect(seconds(stop) - 922.0).toBeGreaterThan(0);
      expect(seconds(stop) - 922.0).toBeLessThan(5);
      if (heading.kind !== 'suspect') throw new Error('not suspect');
      expect(Math.abs(heading.drift ?? 0)).toBeGreaterThan(150);
    });

    it('sees the frame jump 28.8 m at 1013.4 s', () => {
      const e = first(
        events,
        (x) => x.kind === 'suspect' && x.cause === 'jump'
      );
      expect(seconds(e)).toBeCloseTo(1013.4, 1);
      if (e.kind !== 'suspect') throw new Error('not suspect');
      expect(e.metres).toBeCloseTo(28.8, 1);
    });

    it('decides nothing else, and stops only once', () => {
      expect(events.map((x) => [x.kind, 'cause' in x ? x.cause : ''])).toEqual([
        ['lost', 'emulated'],
        ['suspect', 'returned'],
        ['suspect', 'heading'],
        ['stopped', ''],
        ['suspect', 'jump'],
      ]);
      expect(guard.state()).toMatchObject({
        kind: 'suspect',
        automaticResume: false,
        stopped: 'frame-moved',
      });
    });
  });

  it('suspects again at the next pose when somebody confirms the flipped frame', () => {
    let confirmed = false;
    const guard = replay(
      createTrackingGuard({ baseline }),
      FIXTURE.windows.incident,
      (t, g) => {
        if (!confirmed && t >= 930_000) {
          confirmed = true;
          g.confirm(t);
        }
      }
    );
    const after = guard.events().filter((e) => e.t >= 930_000);
    expect(after[0].kind).toBe('confirmed');
    expect(after[1]).toMatchObject({ kind: 'suspect', cause: 'heading' });
    expect(after[2]).toMatchObject({ kind: 'stopped', reason: 'frame-moved' });
    expect(after[1].t - after[0].t).toBeLessThan(200);
  });

  it('stays good once confirmed after the frame jumped back onto the walk', () => {
    let confirmed = false;
    const guard = replay(
      createTrackingGuard({ baseline }),
      FIXTURE.windows.incident,
      (t, g) => {
        if (!confirmed && t >= 1_020_000) {
          confirmed = true;
          g.confirm(t);
        }
      }
    );
    const after = guard.events().filter((e) => e.t >= 1_020_000);
    expect(after.map((e) => e.kind)).toEqual(['confirmed']);
    expect(guard.state().kind).toBe('good');
  });

  it('keeps no path point once the walk stopped, and ends on discard', () => {
    let discarded = false;
    const guard = replay(
      createTrackingGuard({ baseline }),
      FIXTURE.windows.incident,
      (t, g) => {
        if (!discarded && t >= 930_000) {
          discarded = true;
          expect(keepPathPoint(null, { t, x: 0, y: 0 }, g.state())).toBe(false);
          g.discard(t);
        }
      }
    );
    expect(guard.state().ended).toBe(true);
    expect(guard.events().at(-1)?.kind).toBe('discarded');
  });
});

/** A camera pose facing `heading` in the map frame, standing at `x, z`. */
function facing(t: number, heading: number, x = 0, z = 0): PoseSample {
  // A heading turns clockwise from above, which is a negative turn about +y,
  // from the camera facing map +y (camera +z): 180 degrees about +y.
  const a = ((180 - heading) * Math.PI) / 180 / 2;
  return {
    t,
    x,
    y: 1.2,
    z,
    qx: 0,
    qy: Math.sin(a),
    qz: 0,
    qw: Math.cos(a),
    tracked: true,
  };
}

/** A flat phone's compass sample pointing at `bearing` degrees from north. */
function compassAt(t: number, bearing: number): CompassSample {
  // Device +y at north turned clockwise from above is a negative turn about +z.
  const a = -(bearing * Math.PI) / 180 / 2;
  return { t, qx: 0, qy: 0, qz: Math.sin(a), qw: Math.cos(a) };
}

describe('the headings', () => {
  it.each([0, 45, 90, 180, 270])('a camera facing %s reads back', (h) => {
    expect(wrapDegrees(cameraHeading(facing(0, h)) - h)).toBeCloseTo(0, 6);
  });

  it('reads heading 90 for a camera looking along map -x', () => {
    // A camera turned 90 degrees about +y looks from -z to -x.
    const a = Math.PI / 4;
    const pose = { qx: 0, qy: Math.sin(a), qz: 0, qw: Math.cos(a) };
    expect(cameraHeading(pose)).toBeCloseTo(90, 6);
  });

  it('reads the camera top for a phone held flat', () => {
    // Flat, screen up: camera -z points down and its +y points along map -y.
    const a = -Math.PI / 4;
    const pose = { qx: Math.sin(a), qy: 0, qz: 0, qw: Math.cos(a) };
    expect(cameraHeading(pose)).toBeCloseTo(180, 6);
  });

  it.each([0, 30, 90, 200])('a compass at %s reads back', (b) => {
    expect(wrapDegrees(compassHeading(compassAt(0, b)) - b)).toBeCloseTo(0, 6);
  });

  it('takes the circular median across north', () => {
    expect(circularMedian([350, 355, 10, 5, 0])).toBeCloseTo(0, 6);
    expect(circularMedian([170, -170, 180])).toBeCloseTo(180, 6);
    expect(circularMedian([])).toBeUndefined();
  });
});

describe('the rules, one at a time', () => {
  /** A guard with baseline 0 and a camera and compass that agree. */
  function steady(guard = createTrackingGuard({ baseline: 0 })) {
    return {
      guard,
      at(t: number, heading = 0, x = 0, z = 0, compass = heading) {
        guard.pushCompass(compassAt(t, compass));
        return guard.pushPose(facing(t, heading, x, z));
      },
    };
  }

  it('is lost 0.5 s after the last pose when only the compass keeps coming', () => {
    const s = steady();
    for (let t = 0; t <= 1000; t += 100) s.at(t);
    const out = s.guard.pushCompass(compassAt(1400, 0));
    expect(out).toEqual([]);
    const lost = s.guard.pushCompass(compassAt(1600, 0));
    expect(lost).toEqual([{ t: 1500, kind: 'lost', cause: 'no-pose' }]);
  });

  it('stops the walk when tracking stays lost for 3 s, and resumes only by hand', () => {
    const s = steady();
    s.at(0);
    s.guard.pushPose({ ...facing(100, 0), tracked: false });
    expect(s.guard.pushCompass(compassAt(3000, 0))).toEqual([]);
    expect(s.guard.pushCompass(compassAt(3100, 0))).toEqual([
      { t: 3100, kind: 'stopped', reason: 'tracking-lost' },
    ]);
    const back = s.at(4000);
    expect(back).toEqual([
      { t: 4000, kind: 'suspect', cause: 'returned', automaticResume: false },
    ]);
    expect(keepPathPoint(null, { t: 4000, x: 0, y: 0 }, s.guard.state())).toBe(
      false
    );
  });

  it('drops the unconfirmed segment when a loss during an automatic resume stops the walk', () => {
    const s = steady();
    s.at(0);
    s.guard.pushPose({ ...facing(100, 0), tracked: false });
    expect(s.at(1500)).toMatchObject([
      { kind: 'suspect', automaticResume: true },
    ]);
    s.guard.pushPose({ ...facing(1600, 0), tracked: false });
    expect(s.guard.pushCompass(compassAt(4600, 0))).toEqual([
      {
        t: 4600,
        kind: 'stopped',
        reason: 'tracking-lost',
        unconfirmedDropped: true,
      },
    ]);
  });

  it('does not count the distance across a loss as a jump', () => {
    const s = steady();
    s.at(0);
    s.guard.pushPose({ ...facing(100, 0), tracked: false });
    expect(s.at(1500, 0, 5, 0).map((e) => e.kind)).toEqual(['suspect']);
    s.guard.confirm(1600);
    expect(s.at(1700, 0, 5.5, 0)).toEqual([]);
    expect(s.at(1800, 0, 8, 0)).toEqual([
      {
        t: 1800,
        kind: 'suspect',
        cause: 'jump',
        automaticResume: false,
        metres: 2.5,
      },
      { t: 1800, kind: 'stopped', reason: 'frame-moved' },
    ]);
  });

  it('never learns the baseline while tracking is not good', () => {
    const guard = createTrackingGuard();
    guard.pushPose({ ...facing(0, 0), tracked: false });
    for (let t = 100; t <= 70_000; t += 100) {
      guard.pushCompass(compassAt(t, 90));
      guard.pushPose(facing(t, 0));
    }
    expect(guard.state().baseline).toBeUndefined();
    guard.confirm(70_000);
    for (let t = 70_100; t <= 131_000; t += 100) {
      guard.pushCompass(compassAt(t, 90));
      guard.pushPose(facing(t, 0));
    }
    expect(guard.state().baseline).toBeCloseTo(90, 6);
  });

  it('learns the baseline over 60 s of good tracking, not of wall time', () => {
    const guard = createTrackingGuard();
    const at = (t: number, compass: number) => {
      guard.pushCompass(compassAt(t, compass));
      return guard.pushPose(facing(t, 0));
    };
    // Good for 20 s with the compass at 90, then a 1 s loss.
    for (let t = 0; t <= 20_000; t += 100) at(t, 90);
    guard.pushPose({ ...facing(20_100, 0), tracked: false });
    // Poses return in a frame where the compass reads 30, and somebody
    // confirms at 22 s.
    expect(at(21_100, 30).map((e) => e.kind)).toEqual(['suspect']);
    const baselines: TrackingEvent[] = [];
    for (let t = 21_200; t <= 90_000; t += 100) {
      if (t === 22_000) guard.confirm(t);
      baselines.push(...at(t, 30).filter((e) => e.kind === 'baseline'));
    }
    // Not at 60 s of wall time, and not from the stretch before the loss.
    expect(baselines).toHaveLength(1);
    expect(baselines[0].t).toBe(82_000);
    if (baselines[0].kind !== 'baseline') throw new Error('not a baseline');
    expect(baselines[0].degrees).toBeCloseTo(30, 6);
  });

  it('does not fix the baseline on the first pose after a late confirm', () => {
    const guard = createTrackingGuard();
    const at = (t: number) => {
      guard.pushCompass(compassAt(t, 90));
      return guard.pushPose(facing(t, 0));
    };
    for (let t = 0; t <= 1_000; t += 100) at(t);
    guard.pushPose({ ...facing(1_100, 0), tracked: false });
    for (let t = 1_500; t < 70_000; t += 100) at(t);
    guard.confirm(70_000);
    expect(at(70_100)).toEqual([]);
    expect(guard.state().baseline).toBeUndefined();
  });

  it('keeps the camera trusted while the compass stays within 45 degrees', () => {
    const s = steady();
    for (let t = 0; t <= 10_000; t += 100) {
      expect(s.at(t, (t / 100) % 360, 0, 0, ((t / 100) % 360) + 40)).toEqual(
        []
      );
    }
    expect(s.guard.state()).toMatchObject({ kind: 'good' });
    expect(s.guard.state().offset).toBeCloseTo(40, 6);
  });
});

describe('keepPathPoint', () => {
  const good = { kind: 'good', automaticResume: false } as const;
  const resuming = { kind: 'suspect', automaticResume: true } as const;
  const suspect = { kind: 'suspect', automaticResume: false } as const;
  const lost = { kind: 'lost', automaticResume: false } as const;
  const p = { t: 0, x: 0, y: 0 };

  it('keeps the first point and then one per 0.25 m or per second', () => {
    expect(keepPathPoint(null, p, good)).toBe(true);
    expect(keepPathPoint(p, { t: 500, x: 0.2, y: 0 }, good)).toBe(false);
    expect(keepPathPoint(p, { t: 500, x: 0.25, y: 0 }, good)).toBe(true);
    expect(keepPathPoint(p, { t: 999, x: 0, y: 0 }, good)).toBe(false);
    expect(keepPathPoint(p, { t: 1000, x: 0, y: 0 }, good)).toBe(true);
  });

  it('keeps points only while good or resuming on its own', () => {
    const next = { t: 2000, x: 1, y: 1 };
    expect(keepPathPoint(p, next, resuming)).toBe(true);
    expect(keepPathPoint(p, next, suspect)).toBe(false);
    expect(keepPathPoint(p, next, lost)).toBe(false);
  });
});

describe('alignSession', () => {
  it('turns by the compass offset and stands 0.5 m behind the mark', () => {
    const mark = { x: 4, y: 10, heading: 90 };
    const t = alignSession({
      mark,
      standingAt: { x: 1, y: 2 },
      compassOffset: 100,
      baseline: 10,
    });
    expect(t.rotation).toBeCloseTo(90, 6);
    // Heading 90 points along -x, so 0.5 m behind it is +x.
    const at = applyRigid(t, { x: 1, y: 2 });
    expect(at.x).toBeCloseTo(4.5, 6);
    expect(at.y).toBeCloseTo(10, 6);
  });

  it('puts an aligned pose where the walk expects it, facing the same way', () => {
    const baseline = 30;
    // The new session's frame is turned: the same wall reads 70 degrees less.
    const pose = facing(0, 20, 3, -1);
    const compassOffset = baseline + 70;
    const t = alignSession({
      mark: { x: -2, y: 5, heading: 90 },
      standingAt: mapPoint(pose),
      compassOffset,
      baseline,
    });
    const aligned = alignPose(t, pose);
    expect(mapPoint(aligned).x).toBeCloseTo(-1.5, 6);
    expect(mapPoint(aligned).y).toBeCloseTo(5, 6);
    expect(wrapDegrees(cameraHeading(aligned) - 90)).toBeCloseTo(0, 6);
    expect(aligned.y).toBe(pose.y);
  });
});
