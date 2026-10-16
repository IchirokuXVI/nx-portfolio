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
 * A window of a tracking fixture. `game` is the gyro stream, cut since
 * recorder plan 0005.
 */
interface Window {
  from: number;
  to: number;
  pose: number[][];
  absolute: number[][];
  game: number[][];
  events: { t: number; kind: string }[];
}

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', '__fixtures__', 'tracking', name),
      'utf8'
    )
  ) as T;
}

/**
 * The fixture of plans 0003 and 0005, cut from the second El Jamón walk by
 * `tools/cut-tracking-fixture.ts`. ARCore wrote its tracking state as
 * events rather than per pose, so a `tracking-lost` event is replayed as an
 * untracked pose at its time, which is what a host reading the state per
 * frame would push.
 */
const EL_JAMON = fixture<{ windows: { baseline: Window; incident: Window } }>(
  'el-jamon-2.tracking.json'
);

/**
 * The SYNTHETIC bent compass of plan 0005 section 5, written by
 * `tools/synthesize-bent-compass.ts`. No recording of the freezer aisles
 * exists yet; the owner's walk lab recording replaces it.
 */
const BENT_COMPASS = fixture<{
  synthetic: true;
  source: { baseline: number };
  windows: { walk: Window };
}>('bent-compass.synthetic.tracking.json');

type Row =
  | { t: number; order: 0; pose: PoseSample }
  | { t: number; order: 1; compass: CompassSample }
  | { t: number; order: 2; gyro: CompassSample };

function rowsOf(w: Window, gyro: boolean): Row[] {
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
  if (gyro) {
    for (const [t, qx, qy, qz, qw] of w.game) {
      rows.push({ t, order: 2, gyro: { t, qx, qy, qz, qw } });
    }
  }
  for (const e of w.events) {
    if (e.kind !== 'tracking-lost') continue;
    const pose = { t: e.t, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    rows.push({ t: e.t, order: 0, pose: { ...pose, tracked: false } });
  }
  return rows.sort((a, b) => a.t - b.t || a.order - b.order);
}

/**
 * Replays a window, with its gyro stream unless `gyro` is false. `answer`
 * plays the person, called before each row.
 */
function replay(
  guard: TrackingGuard,
  w: Window,
  answer: (t: number, g: TrackingGuard) => void = () => undefined,
  gyro = true
): TrackingGuard {
  for (const row of rowsOf(w, gyro)) {
    answer(row.t, guard);
    if (row.order === 0) guard.pushPose(row.pose);
    else if (row.order === 1) guard.pushCompass(row.compass);
    else guard.pushGyro(row.gyro);
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

const kinds = (events: readonly TrackingEvent[]) =>
  events.map((x) => [x.kind, 'cause' in x ? x.cause : '']);

describe('the tracking guard over the second El Jamón walk', () => {
  const learned = replay(createTrackingGuard(), EL_JAMON.windows.baseline);
  const baseline = learned.state().baseline as number;

  it('learns a baseline from the first 60 s and stays good for two minutes', () => {
    const e = first(learned.events(), (x) => x.kind === 'baseline');
    expect(seconds(e)).toBeGreaterThanOrEqual(60);
    expect(seconds(e)).toBeLessThan(63);
    expect(baseline).toBeCloseTo(316.6, 1);
    expect(learned.events().map((x) => x.kind)).toEqual(['baseline']);
    expect(learned.state()).toMatchObject({
      kind: 'good',
      compassDisturbed: false,
    });
  });

  it('learns the same baseline without the gyro', () => {
    const g = replay(
      createTrackingGuard(),
      EL_JAMON.windows.baseline,
      undefined,
      false
    );
    expect(g.state().baseline).toBeCloseTo(baseline, 6);
  });

  describe('with the gyro heard, left alone (plan 0005)', () => {
    const guard = replay(
      createTrackingGuard({ baseline }),
      EL_JAMON.windows.incident
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

    it('stops the walk because the frame turned, within 2 s of 922.0 s', () => {
      const turned = first(
        events,
        (x) => x.kind === 'suspect' && x.cause === 'turned'
      );
      const stop = first(events, (x) => x.kind === 'stopped');
      expect(stop.t).toBe(turned.t);
      expect(seconds(turned) - 922.0).toBeGreaterThan(0);
      expect(seconds(turned) - 922.0).toBeLessThanOrEqual(2.0);
      if (stop.kind !== 'stopped') throw new Error('not stopped');
      expect(stop).toMatchObject({
        reason: 'frame-moved',
        cause: 'turned',
        unconfirmedDropped: true,
      });
      // The flip of 2026-09-29 was 158.5 degrees; the medians read 148.
      expect(Math.abs(stop.degrees ?? 0)).toBeGreaterThan(140);
      expect(stop.metres).toBeUndefined();
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

    it('sees no bent compass anywhere, and stops only once', () => {
      expect(
        guard
          .events()
          .filter((x) => x.kind.startsWith('compass-'))
          .map((x) => x.kind)
      ).toEqual([]);
      // The jump back onto the old map turns the frame back as well, which
      // the turn rule sees once the 2 s median holds the new frame.
      expect(kinds(events)).toEqual([
        ['lost', 'emulated'],
        ['suspect', 'returned'],
        ['suspect', 'turned'],
        ['stopped', 'turned'],
        ['suspect', 'jump'],
        ['suspect', 'turned'],
      ]);
      expect(guard.state()).toMatchObject({
        kind: 'suspect',
        automaticResume: false,
        stopped: 'frame-moved',
        compassDisturbed: false,
      });
    });

    it('also replays the baseline window with no stop and no notice', () => {
      expect(
        replay(createTrackingGuard({ baseline }), EL_JAMON.windows.baseline)
          .events()
          .map((x) => x.kind)
      ).toEqual([]);
    });
  });

  describe('without the gyro, left alone (plan 0003, as before)', () => {
    const guard = replay(
      createTrackingGuard({ baseline }),
      EL_JAMON.windows.incident,
      undefined,
      false
    );
    const events = guard.events();

    it('stops the walk for the flipped frame by the compass, within 5 s of 922.0 s', () => {
      const heading = first(
        events,
        (x) => x.kind === 'suspect' && x.cause === 'heading'
      );
      const stop = first(events, (x) => x.kind === 'stopped');
      expect(stop).toMatchObject({
        reason: 'frame-moved',
        cause: 'heading',
        unconfirmedDropped: true,
      });
      expect(stop.t).toBe(heading.t);
      expect(seconds(stop) - 922.0).toBeGreaterThan(0);
      expect(seconds(stop) - 922.0).toBeLessThan(5);
      if (heading.kind !== 'suspect' || stop.kind !== 'stopped') {
        throw new Error('not suspect and stopped');
      }
      expect(Math.abs(heading.drift ?? 0)).toBeGreaterThan(150);
      expect(stop.degrees).toBe(heading.drift);
    });

    it('decides nothing else, and stops only once', () => {
      expect(kinds(events)).toEqual([
        ['lost', 'emulated'],
        ['suspect', 'returned'],
        ['suspect', 'heading'],
        ['stopped', 'heading'],
        ['suspect', 'jump'],
      ]);
      expect(guard.state()).toMatchObject({
        kind: 'suspect',
        automaticResume: false,
        stopped: 'frame-moved',
      });
    });
  });

  it('suspects again at the next pose when somebody confirms the flipped frame without a gyro', () => {
    let confirmed = false;
    const guard = replay(
      createTrackingGuard({ baseline }),
      EL_JAMON.windows.incident,
      (t, g) => {
        if (!confirmed && t >= 930_000) {
          confirmed = true;
          g.confirm(t);
        }
      },
      false
    );
    const after = guard.events().filter((e) => e.t >= 930_000);
    expect(after[0].kind).toBe('confirmed');
    expect(after[1]).toMatchObject({ kind: 'suspect', cause: 'heading' });
    expect(after[2]).toMatchObject({
      kind: 'stopped',
      reason: 'frame-moved',
      cause: 'heading',
    });
    expect(after[1].t - after[0].t).toBeLessThan(200);
  });

  it('takes a confirmed flipped frame as the frame, and the compass as bent, with the gyro', () => {
    let confirmed = false;
    const guard = replay(
      createTrackingGuard({ baseline }),
      EL_JAMON.windows.incident,
      (t, g) => {
        if (!confirmed && t >= 930_000) {
          confirmed = true;
          g.confirm(t);
        }
      }
    );
    const after = guard.events().filter((e) => e.t >= 930_000);
    expect(after[0].kind).toBe('confirmed');
    expect(after[1]).toMatchObject({ kind: 'compass-disturbed' });
    expect(after[1].t - after[0].t).toBeLessThan(200);
    expect(after.some((e) => e.kind === 'stopped' && e.t < 1_013_000)).toBe(
      false
    );
  });

  // Velista confirms during an automatic resume, as soon as poses come back
  // and before any stop. Such a confirm must not hide the flip from the turn
  // rule, which answers at 923.9 s against the readings from before the loss,
  // and it does not vouch for the points kept in the flipped frame either.
  it.each([922_360, 923_000, 923_700])(
    'still stops for the turned frame, and drops the points since the return, when the automatic resume is confirmed at %d ms',
    (at) => {
      let confirmed = false;
      const guard = replay(
        createTrackingGuard({ baseline }),
        EL_JAMON.windows.incident,
        (t, g) => {
          if (!confirmed && t >= at) {
            confirmed = true;
            expect(g.state()).toMatchObject({
              kind: 'suspect',
              cause: 'returned',
              automaticResume: true,
            });
            g.confirm(t);
            expect(g.state()).toMatchObject({
              kind: 'good',
              awaitingTurnJudgement: true,
            });
          }
        }
      );
      const events = guard.events();
      expect(events.some((e) => e.kind === 'confirmed')).toBe(true);
      const stop = first(events, (x) => x.kind === 'stopped');
      expect(stop).toMatchObject({
        reason: 'frame-moved',
        cause: 'turned',
        unconfirmedDropped: true,
      });
      expect(seconds(stop) - 922.0).toBeLessThanOrEqual(2.0);
      if (stop.kind !== 'stopped') throw new Error('not stopped');
      expect(Math.abs(stop.degrees ?? 0)).toBeGreaterThan(140);
      // The compass notice waits for the turn rule, which stops the walk.
      expect(
        events.filter((e) => e.t <= stop.t && e.kind.startsWith('compass-'))
      ).toEqual([]);
      expect(guard.state().awaitingTurnJudgement).toBe(false);
    }
  );

  it.each([true, false])(
    'stays good once confirmed after the frame jumped back onto the walk (gyro %s)',
    (gyro) => {
      let confirmed = false;
      const guard = replay(
        createTrackingGuard({ baseline }),
        EL_JAMON.windows.incident,
        (t, g) => {
          if (!confirmed && t >= 1_020_000) {
            confirmed = true;
            g.confirm(t);
          }
        },
        gyro
      );
      const after = guard.events().filter((e) => e.t >= 1_020_000);
      expect(after.map((e) => e.kind)).toEqual(['confirmed']);
      expect(guard.state().kind).toBe('good');
    }
  );

  it('keeps no path point once the walk stopped, and ends on discard', () => {
    let discarded = false;
    const guard = replay(
      createTrackingGuard({ baseline }),
      EL_JAMON.windows.incident,
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

describe('the SYNTHETIC bent compass of plan 0005 section 5', () => {
  // Made up until the walk lab recording of the freezer aisles exists.
  const w = BENT_COMPASS.windows.walk;
  const baseline = BENT_COMPASS.source.baseline;

  it('is marked synthetic', () => {
    expect(BENT_COMPASS.synthetic).toBe(true);
  });

  it('with the gyro: one notice, one settle, and no stop', () => {
    const guard = replay(createTrackingGuard({ baseline }), w);
    const events = guard.events();
    expect(events.map((e) => e.kind)).toEqual([
      'compass-disturbed',
      'compass-settled',
    ]);
    const [disturbed, settled] = events;
    if (disturbed.kind !== 'compass-disturbed') throw new Error('not bent');
    expect(Math.abs(disturbed.drift)).toBeGreaterThan(45);
    // The swing starts at 8 s, and the 5 s median follows it.
    expect(seconds(disturbed)).toBeGreaterThan(8);
    expect(seconds(settled)).toBeGreaterThan(seconds(disturbed));
    expect(guard.state()).toMatchObject({
      kind: 'good',
      compassDisturbed: false,
    });
  });

  it('reads compassDisturbed while the compass is bent', () => {
    const states = new Map<number, boolean>();
    replay(createTrackingGuard({ baseline }), w, (t, g) => {
      if (t === 5_000 || t === 15_000) {
        states.set(t, g.state().compassDisturbed);
      }
    });
    expect([...states]).toEqual([
      [5_000, false],
      [15_000, true],
    ]);
  });

  it('without the gyro: one stop with the cause heading', () => {
    const guard = replay(
      createTrackingGuard({ baseline }),
      w,
      undefined,
      false
    );
    const stops = guard.events().filter((e) => e.kind === 'stopped');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      reason: 'frame-moved',
      cause: 'heading',
    });
    if (stops[0].kind !== 'stopped') throw new Error('not stopped');
    expect(Math.abs(stops[0].degrees ?? 0)).toBeGreaterThan(45);
    expect(guard.events().some((e) => e.kind.startsWith('compass-'))).toBe(
      false
    );
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

/** A flat phone's compass (or gyro) sample pointing at `bearing` degrees. */
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
  /**
   * A guard with baseline 0 and a camera and compass that agree. With
   * `gyro`, a gyro whose heading is `gyro` (the camera's by default) is fed
   * before each pose.
   */
  function steady(guard = createTrackingGuard({ baseline: 0 })) {
    return {
      guard,
      at(t: number, heading = 0, x = 0, z = 0, compass = heading) {
        guard.pushCompass(compassAt(t, compass));
        return guard.pushPose(facing(t, heading, x, z));
      },
      withGyro(
        t: number,
        heading = 0,
        x = 0,
        z = 0,
        compass = heading,
        gyro = heading
      ) {
        guard.pushCompass(compassAt(t, compass));
        guard.pushGyro(compassAt(t, gyro));
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

  it('runs the clock on gyro samples too', () => {
    const s = steady();
    for (let t = 0; t <= 1000; t += 100) s.withGyro(t);
    expect(s.guard.pushGyro(compassAt(1600, 0))).toEqual([
      { t: 1500, kind: 'lost', cause: 'no-pose' },
    ]);
  });

  it('stops the walk when tracking stays lost for 3 s, and resumes only by hand', () => {
    const s = steady();
    s.at(0);
    s.guard.pushPose({ ...facing(100, 0), tracked: false });
    expect(s.guard.pushCompass(compassAt(3000, 0))).toEqual([]);
    expect(s.guard.pushCompass(compassAt(3100, 0))).toEqual([
      { t: 3100, kind: 'stopped', reason: 'tracking-lost', cause: 'lost' },
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
        cause: 'lost',
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
      {
        t: 1800,
        kind: 'stopped',
        reason: 'frame-moved',
        cause: 'jump',
        metres: 2.5,
      },
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

  describe('with the gyro (plan 0005)', () => {
    it('stops for a camera frame that turns more than 60 degrees against the gyro', () => {
      const s = steady();
      for (let t = 0; t < 20_000; t += 100) expect(s.withGyro(t)).toEqual([]);
      // The camera frame turns by 70 degrees with no loss; the phone does not.
      const out: TrackingEvent[] = [];
      for (let t = 20_000; t <= 24_000; t += 100) {
        out.push(...s.withGyro(t, 70, 0, 0, 0, 0));
      }
      expect(out.map((e) => [e.kind, 'cause' in e ? e.cause : ''])).toEqual([
        ['suspect', 'turned'],
        ['stopped', 'turned'],
      ]);
      const [, stop] = out;
      if (stop.kind !== 'stopped') throw new Error('not stopped');
      expect(stop.degrees).toBeCloseTo(70, 6);
      expect(stop.reason).toBe('frame-moved');
      // The 2 s median holds the new frame once more than half of it does.
      expect(stop.t).toBe(21_000);
    });

    it('lets the walk go on for a turn under 60 degrees, and calls the compass bent', () => {
      const s = steady();
      for (let t = 0; t < 20_000; t += 100) s.withGyro(t);
      const out: TrackingEvent[] = [];
      for (let t = 20_000; t <= 34_000; t += 100) {
        out.push(...s.withGyro(t, 55, 0, 0, 0, 0));
      }
      expect(out.map((e) => e.kind)).toEqual(['compass-disturbed']);
      expect(s.guard.state()).toMatchObject({
        kind: 'good',
        compassDisturbed: true,
      });
    });

    it('waits 1.8 s of poses after a loss before it answers', () => {
      const s = steady();
      for (let t = 0; t < 10_000; t += 100) s.withGyro(t);
      s.guard.pushPose({ ...facing(10_000, 0), tracked: false });
      const out: TrackingEvent[] = [];
      for (let t = 10_100; t < 11_000; t += 100) {
        s.guard.pushCompass(compassAt(t, 0));
        s.guard.pushGyro(compassAt(t, 0));
      }
      // Poses return at 11 s in a frame turned by 90 degrees.
      for (let t = 11_000; t <= 14_000; t += 100) {
        out.push(...s.withGyro(t, 90, 0, 0, 0, 0));
      }
      expect(
        out.map((e) => [e.t, e.kind, 'cause' in e ? e.cause : ''])
      ).toEqual([
        [11_000, 'suspect', 'returned'],
        [12_800, 'suspect', 'turned'],
        [12_800, 'stopped', 'turned'],
      ]);
      expect(out[2]).toMatchObject({ unconfirmedDropped: true });
    });

    it('does not report a confirmed turn again', () => {
      const s = steady();
      for (let t = 0; t < 20_000; t += 100) s.withGyro(t);
      for (let t = 20_000; t <= 21_000; t += 100)
        s.withGyro(t, 70, 0, 0, 70, 0);
      expect(s.guard.state()).toMatchObject({ cause: 'turned' });
      s.guard.confirm(21_050);
      const out: TrackingEvent[] = [];
      for (let t = 21_100; t <= 40_000; t += 100) {
        out.push(...s.withGyro(t, 70, 0, 0, 70, 0));
      }
      expect(out).toEqual([]);
    });

    it('starts over when the gyro is heard again with another zero', () => {
      const s = steady();
      for (let t = 0; t < 20_000; t += 100) expect(s.withGyro(t)).toEqual([]);
      // The gyro falls silent for 3 s, then comes back 100 degrees away, as
      // when the browser falls back to another stream with another zero.
      for (let t = 20_000; t < 23_000; t += 100) expect(s.at(t)).toEqual([]);
      for (let t = 23_000; t < 40_000; t += 100) {
        expect(s.withGyro(t, 0, 0, 0, 0, 100)).toEqual([]);
      }
      expect(s.guard.state()).toMatchObject({ kind: 'good' });
      // A frame that turns against the new zero is still caught.
      const out: TrackingEvent[] = [];
      for (let t = 40_000; t <= 44_000; t += 100) {
        out.push(...s.withGyro(t, 70, 0, 0, 0, 100));
      }
      expect(out.map((e) => [e.kind, 'cause' in e ? e.cause : ''])).toEqual([
        ['suspect', 'turned'],
        ['stopped', 'turned'],
      ]);
    });

    it('still stops a frame that turned during a 2 s gyro silence', () => {
      const s = steady();
      for (let t = 0; t < 20_000; t += 100) expect(s.withGyro(t)).toEqual([]);
      // The gyro falls silent at 20 s and tracking is lost; poses come back
      // at 21 s in a frame turned by 90 degrees, and the gyro at 22 s with
      // the same zero, which a silence short of 3 s keeps.
      s.guard.pushPose({ ...facing(20_000, 0), tracked: false });
      for (let t = 20_100; t < 21_000; t += 100) {
        s.guard.pushCompass(compassAt(t, 0));
      }
      const out: TrackingEvent[] = [];
      for (let t = 21_000; t < 22_000; t += 100) {
        out.push(...s.at(t, 90, 0, 0, 0));
      }
      for (let t = 22_000; t <= 25_000; t += 100) {
        out.push(...s.withGyro(t, 90, 0, 0, 0, 0));
      }
      expect(
        out.map((e) => [e.t, e.kind, 'cause' in e ? e.cause : ''])
      ).toEqual([
        [21_000, 'suspect', 'returned'],
        [22_800, 'suspect', 'turned'],
        [22_800, 'stopped', 'turned'],
      ]);
      expect(out[2]).toMatchObject({ unconfirmedDropped: true });
    });

    it('fires the turn rule again for a frame that is still turned after a loss', () => {
      const s = steady();
      for (let t = 0; t < 20_000; t += 100) s.withGyro(t);
      // The frame turns by 70 degrees: a stop that nobody answers.
      for (let t = 20_000; t < 22_000; t += 100) s.withGyro(t, 70, 0, 0, 0, 0);
      expect(s.guard.state()).toMatchObject({ stopped: 'frame-moved' });
      // A loss, poses back in the same turned frame, and a confirm at once.
      s.guard.pushPose({ ...facing(22_000, 70), tracked: false });
      for (let t = 22_100; t < 23_000; t += 100) {
        s.guard.pushCompass(compassAt(t, 0));
        s.guard.pushGyro(compassAt(t, 0));
      }
      s.withGyro(23_000, 70, 0, 0, 0, 0);
      s.guard.confirm(23_050);
      const out: TrackingEvent[] = [];
      for (let t = 23_100; t <= 26_000; t += 100) {
        out.push(...s.withGyro(t, 70, 0, 0, 0, 0));
      }
      expect(out).toMatchObject([
        { t: 24_800, kind: 'suspect', cause: 'turned' },
        {
          t: 24_800,
          kind: 'stopped',
          cause: 'turned',
          unconfirmedDropped: true,
        },
      ]);
    });

    it('holds the compass notice after an early confirm until the turn rule answers', () => {
      const s = steady();
      for (let t = 0; t <= 10_000; t += 100) s.withGyro(t);
      // A 2.8 s loss; poses come back turned by 50 degrees, under the turn
      // limit, so the compass reads 50 degrees off the baseline.
      s.guard.pushPose({ ...facing(10_100, 0), tracked: false });
      for (let t = 10_200; t < 12_900; t += 100) {
        s.guard.pushCompass(compassAt(t, 0));
        s.guard.pushGyro(compassAt(t, 0));
      }
      const out: TrackingEvent[] = [];
      const waiting = new Map<number, boolean>();
      for (let t = 12_900; t <= 16_000; t += 100) {
        out.push(...s.withGyro(t, 50, 0, 0, 0, 0));
        if (t === 13_000) out.push(...s.guard.confirm(t));
        if (t === 14_600 || t === 14_700) {
          waiting.set(t, s.guard.state().awaitingTurnJudgement);
        }
      }
      // The 5 s median leaves the baseline before 14.7 s; the notice waits
      // for the rule's answer, 1.8 s after the return.
      expect(out.map((e) => [e.t, e.kind])).toEqual([
        [12_900, 'suspect'],
        [13_000, 'confirmed'],
        [14_700, 'compass-disturbed'],
      ]);
      expect([...waiting]).toEqual([
        [14_600, true],
        [14_700, false],
      ]);
    });

    it('stops by the compass rule once the gyro falls silent for 1 s', () => {
      const s = steady();
      for (let t = 0; t < 5_000; t += 100) s.withGyro(t);
      // The gyro is heard: a bent compass is a notice.
      const bent: TrackingEvent[] = [];
      for (let t = 5_000; t < 10_000; t += 100) {
        bent.push(...s.withGyro(t, 0, 0, 0, 90));
      }
      expect(bent.map((e) => e.kind)).toEqual(['compass-disturbed']);
      // Its last sample is at 9.9 s; at 10.9 s it is no longer heard.
      for (let t = 10_000; t <= 10_800; t += 100) {
        expect(s.at(t, 0, 0, 0, 90)).toEqual([]);
      }
      expect(s.at(10_900, 0, 0, 0, 90)).toMatchObject([
        { kind: 'suspect', cause: 'heading' },
        { kind: 'stopped', reason: 'frame-moved', cause: 'heading' },
      ]);
    });

    it('drops the points since the return for a confirm in a 1 to 3 s gyro gap', () => {
      const s = steady();
      for (let t = 0; t < 15_000; t += 100) s.withGyro(t);
      // Lost from 15.0 to 16.0 s; the gyro falls silent from 15.5 to 17.0 s,
      // short of the 3 s that would give it another zero.
      s.guard.pushPose({ ...facing(15_000, 0), tracked: false });
      for (let t = 15_100; t < 16_000; t += 100) {
        s.guard.pushCompass(compassAt(t, 0));
        if (t < 15_500) s.guard.pushGyro(compassAt(t, 0));
      }
      // Poses come back at 16.0 s in a frame turned by 150 degrees, and the
      // confirm at 16.6 s comes while the gyro is not heard.
      const out: TrackingEvent[] = [];
      for (let t = 16_000; t < 17_000; t += 100) {
        out.push(...s.at(t, 150, 0, 0, 0));
        if (t === 16_600) out.push(...s.guard.confirm(t));
      }
      expect(s.guard.state().awaitingTurnJudgement).toBe(true);
      for (let t = 17_000; t <= 19_000; t += 100) {
        out.push(...s.withGyro(t, 150, 0, 0, 0, 0));
      }
      expect(out).toMatchObject([
        { t: 16_000, kind: 'suspect', cause: 'returned' },
        { t: 16_600, kind: 'confirmed' },
        { t: 17_800, kind: 'suspect', cause: 'turned' },
        {
          t: 17_800,
          kind: 'stopped',
          cause: 'turned',
          unconfirmedDropped: true,
        },
      ]);
    });

    /** A 1 s loss from 15 s, poses back at 16 s, and a confirm at 16.6 s. */
    function confirmedEarly() {
      const s = steady();
      for (let t = 0; t < 15_000; t += 100) s.withGyro(t);
      s.guard.pushPose({ ...facing(15_000, 0), tracked: false });
      for (let t = 15_100; t < 16_000; t += 100) {
        s.guard.pushCompass(compassAt(t, 0));
        s.guard.pushGyro(compassAt(t, 0));
      }
      for (let t = 16_000; t < 17_000; t += 100) {
        s.withGyro(t);
        if (t === 16_600) s.guard.confirm(t);
      }
      expect(s.guard.state()).toMatchObject({
        kind: 'good',
        awaitingTurnJudgement: true,
      });
      return s;
    }

    it('drops the points since the return for a jump stop after an early confirm', () => {
      const s = confirmedEarly();
      expect(s.withGyro(17_000, 0, 3, 0)).toMatchObject([
        { t: 17_000, kind: 'suspect', cause: 'jump' },
        {
          t: 17_000,
          kind: 'stopped',
          cause: 'jump',
          metres: 3,
          unconfirmedDropped: true,
        },
      ]);
      expect(s.guard.state().awaitingTurnJudgement).toBe(false);
    });

    it('drops the points since the return for a lost stop after an early confirm', () => {
      const s = confirmedEarly();
      const out: TrackingEvent[] = [];
      out.push(...s.guard.pushPose({ ...facing(17_000, 0), tracked: false }));
      for (let t = 17_100; t <= 20_000; t += 100) {
        out.push(...s.guard.pushCompass(compassAt(t, 0)));
        out.push(...s.guard.pushGyro(compassAt(t, 0)));
      }
      expect(out).toEqual([
        { t: 17_000, kind: 'lost', cause: 'emulated' },
        {
          t: 20_000,
          kind: 'stopped',
          reason: 'tracking-lost',
          cause: 'lost',
          unconfirmedDropped: true,
        },
      ]);
    });

    it('settles when the 5 s median is back inside the limit', () => {
      const s = steady();
      const out: TrackingEvent[] = [];
      for (let t = 0; t < 10_000; t += 100)
        out.push(...s.withGyro(t, 0, 0, 0, 90));
      for (let t = 10_000; t < 20_000; t += 100) out.push(...s.withGyro(t));
      // Bent from the first pose; settled once most of the 5 s window is not.
      expect(out.map((e) => [e.t, e.kind])).toEqual([
        [0, 'compass-disturbed'],
        [12_400, 'compass-settled'],
      ]);
      expect(s.guard.state().compassDisturbed).toBe(false);
    });

    it('answers the gyro offset over the last 2 s, and none once the gyro is silent', () => {
      const s = steady();
      for (let t = 0; t <= 3_000; t += 100) s.withGyro(t, 40, 0, 0, 40, 10);
      expect(s.guard.state().gyroOffset).toBeCloseTo(30, 6);
      s.at(4_100, 40);
      expect(s.guard.state().gyroOffset).toBeUndefined();
    });

    it('leaves the compass out of the baseline while it turns and the phone does not', () => {
      /** A compass offset that wanders by 10 degrees, bent by 90 from 20 s to 30 s. */
      const compass = (t: number) =>
        (t >= 20_000 && t < 30_000 ? 90 : 0) + (((t / 100) % 21) - 10);
      const learn = (gyro: boolean) => {
        const guard = createTrackingGuard();
        for (let t = 0; t <= 61_000; t += 100) {
          guard.pushCompass(compassAt(t, compass(t)));
          if (gyro) guard.pushGyro(compassAt(t, 0));
          guard.pushPose(facing(t, 0));
        }
        return wrapDegrees(guard.state().baseline as number);
      };
      const without = learn(false);
      const heard = learn(true);
      expect(Math.abs(heard)).toBeLessThan(Math.abs(without));
      expect(Math.abs(heard)).toBeLessThan(1);
    });
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

  it('takes a rotation from the gyro offsets in place of the compass (plan 0005)', () => {
    // The stopped session already had a rotation of 15 degrees, and its
    // gyro offset at the stop was 40. The new session reads 110 against the
    // same gyro, so what the old frame read as 20 degrees it reads as 90.
    const oldRotation = 15;
    const rotation = 40 - 110 + oldRotation;
    const pose = facing(0, 90, 3, -1);
    const t = alignSession({
      mark: { x: -2, y: 5, heading: 90 },
      standingAt: mapPoint(pose),
      rotation,
    });
    expect(t.rotation).toBeCloseTo(305, 6);
    const aligned = alignPose(t, pose);
    expect(mapPoint(aligned).x).toBeCloseTo(-1.5, 6);
    expect(mapPoint(aligned).y).toBeCloseTo(5, 6);
    // The old session saw this way as 20 degrees, plus its own rotation.
    expect(
      wrapDegrees(cameraHeading(aligned) - (20 + oldRotation))
    ).toBeCloseTo(0, 6);
  });
});
