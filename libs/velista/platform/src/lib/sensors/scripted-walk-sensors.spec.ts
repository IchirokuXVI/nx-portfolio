import {
  cameraHeading,
  compassHeading,
  createTrackingGuard,
  type TrackingEvent,
} from '@portfolio/luna-shopper/shop-map/recorder';
import {
  compassBendAt,
  compassQuaternion,
  EL_JAMON_SCRIPT,
  headingAt,
  pathAt,
  SCRIPTED_COMPASS_OFFSET,
  ScriptedWalkSensors,
  scriptSegments,
  uprightQuaternion,
} from './scripted-walk-sensors';
import type {
  WalkCompassReading,
  WalkGyroReading,
  WalkPoseReading,
} from './walk-sensors';

describe('the scripted walk (velista 0126)', () => {
  it('turns a heading into a pose and a bearing the recorder reads back', () => {
    for (const heading of [0, 45, 90, 171.3, 270, 316.6]) {
      const [qx, qy, qz, qw] = uprightQuaternion(heading);
      expect(cameraHeading({ qx, qy, qz, qw })).toBeCloseTo(heading, 6);
      const [cx, cy, cz, cw] = compassQuaternion(heading);
      expect(compassHeading({ qx: cx, qy: cy, qz: cz, qw: cw })).toBeCloseTo(
        heading,
        6
      );
    }
  });

  it('interpolates the path and faces what was marked', () => {
    const [t0, x0, y0] = EL_JAMON_SCRIPT.path[10];
    expect(pathAt(EL_JAMON_SCRIPT.path, t0)).toEqual({ x: x0, y: y0 });
    const [at, heading] = EL_JAMON_SCRIPT.facing[1];
    expect(headingAt(EL_JAMON_SCRIPT, at, 0)).toBe(heading);
  });

  it('lays the three incidents out in script time', () => {
    const segments = scriptSegments(EL_JAMON_SCRIPT);
    expect(segments.map((one) => one.kind)).toEqual([
      'walk',
      'lost',
      'walk',
      'lost',
      'walk',
      'stand',
      'walk',
      'lost',
      'stand',
      'walk',
    ]);
    expect(segments[1]).toMatchObject({ from: 100_000, to: 101_500 });
    expect(segments[5]).toMatchObject({ kind: 'stand', pathMs: 109_100 });
    expect(segments[7]).toMatchObject({ from: 330_000, to: 334_000 });
  });

  it('gives the tracking guard what the browser check needs', async () => {
    jest.useFakeTimers();
    try {
      const poses: WalkPoseReading[] = [];
      const compass: WalkCompassReading[] = [];
      const gyro: WalkGyroReading[] = [];
      const sensors = new ScriptedWalkSensors(document, { speed: 20 });
      expect(await sensors.supported()).toBe(true);
      const session = await sensors.start(null, {
        pose: (one) => poses.push(one),
        compass: (one) => compass.push(one),
        gyro: (one) => gyro.push(one),
        ended: () => undefined,
      });
      jest.advanceTimersByTime(18_000);
      session.end();

      expect(gyro).toHaveLength(poses.length);
      const guard = createTrackingGuard();
      const events: TrackingEvent[] = [];
      const base = poses[0].t;
      poses.forEach((pose, i) => {
        events.push(...guard.pushCompass(compass[i]));
        events.push(...guard.pushGyro(gyro[i]));
        events.push(...guard.pushPose(pose));
        if (i === Math.floor(105_000 / 100)) {
          // The person says yes to the first automatic resume.
          events.push(...guard.confirm(pose.t));
        }
      });
      const at = (event: TrackingEvent) => Math.round(event.t - base);
      const baseline = events.find((one) => one.kind === 'baseline');
      expect(baseline).toBeDefined();
      expect(
        baseline?.kind === 'baseline' ? baseline.degrees : null
      ).toBeCloseTo(SCRIPTED_COMPASS_OFFSET, 1);
      const lost = events.filter((one) => one.kind === 'lost').map(at);
      expect(lost[0]).toBeGreaterThanOrEqual(100_000);
      expect(lost[0]).toBeLessThan(100_600);
      expect(
        events.some(
          (one) =>
            one.kind === 'suspect' &&
            one.cause === 'returned' &&
            one.automaticResume
        )
      ).toBe(true);
      expect(events.some((one) => one.kind === 'confirmed')).toBe(true);

      // Velista 0136, target 2: the bent compass next to the Horno mark is a
      // notice and a settling, and no stop comes before the first loss.
      const notices = events
        .filter(
          (one) =>
            one.kind === 'compass-disturbed' || one.kind === 'compass-settled'
        )
        .map((one) => [one.kind, at(one)]);
      expect(notices.map(([kind]) => kind)).toEqual([
        'compass-disturbed',
        'compass-settled',
      ]);
      expect(notices[0][1]).toBeGreaterThan(72_000);
      expect(notices[1][1]).toBeLessThan(95_000);
      const stops = events.filter((one) => one.kind === 'stopped').map(at);
      expect(stops.every((t) => t > 100_000)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('bends the compass and nothing else for the stretch of 72 s', () => {
    expect(compassBendAt(EL_JAMON_SCRIPT, 71_000)).toBe(0);
    expect(compassBendAt(EL_JAMON_SCRIPT, 73_500)).toBeCloseTo(45, 6);
    expect(compassBendAt(EL_JAMON_SCRIPT, 80_000)).toBe(90);
    expect(compassBendAt(EL_JAMON_SCRIPT, 84_500)).toBeCloseTo(45, 6);
    expect(compassBendAt(EL_JAMON_SCRIPT, 86_000)).toBe(0);
  });

  it('gives the guard a walk with no stop through the bend while the gyro is heard, and a heading stop without it', async () => {
    jest.useFakeTimers();
    try {
      const poses: WalkPoseReading[] = [];
      const compass: WalkCompassReading[] = [];
      const gyro: WalkGyroReading[] = [];
      const session = await new ScriptedWalkSensors(document, {
        speed: 20,
      }).start(null, {
        pose: (one) => poses.push(one),
        compass: (one) => compass.push(one),
        gyro: (one) => gyro.push(one),
        ended: () => undefined,
      });
      // 95 s of the script: past the bend, before the first loss.
      jest.advanceTimersByTime(4_800);
      session.end();
      expect(poses[poses.length - 1].t - poses[0].t).toBeGreaterThan(94_000);

      const heard = createTrackingGuard();
      const deaf = createTrackingGuard();
      const withGyro: TrackingEvent[] = [];
      const without: TrackingEvent[] = [];
      poses.forEach((pose, i) => {
        withGyro.push(
          ...heard.pushCompass(compass[i]),
          ...heard.pushGyro(gyro[i]),
          ...heard.pushPose(pose)
        );
        without.push(...deaf.pushCompass(compass[i]), ...deaf.pushPose(pose));
      });

      expect(withGyro.filter((one) => one.kind === 'stopped')).toEqual([]);
      expect(heard.state().kind).toBe('good');
      expect(without.filter((one) => one.kind === 'stopped')).toEqual([
        expect.objectContaining({ reason: 'frame-moved', cause: 'heading' }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
