import {
  onPerformanceClock,
  WebXrWalkSensors,
  type WalkCompassReading,
  type WalkGyroReading,
} from './walk-sensors';

describe('onPerformanceClock', () => {
  it('keeps a timestamp within a second of now', () => {
    expect(onPerformanceClock(9_950.5, 10_000)).toBe(9_950.5);
    expect(onPerformanceClock(10_020, 10_000)).toBe(10_020);
  });

  it('answers now for a timestamp on another clock', () => {
    // The time since boot, days ahead of a page opened a minute ago.
    expect(onPerformanceClock(400_000_000, 60_000)).toBe(60_000);
    expect(onPerformanceClock(12, 60_000)).toBe(60_000);
  });

  it('answers now for a timestamp that is missing or not a number', () => {
    expect(onPerformanceClock(undefined, 10_000)).toBe(10_000);
    expect(onPerformanceClock(Number.NaN, 10_000)).toBe(10_000);
  });
});

/** Velista `0136`, target 1. */
describe('WebXrWalkSensors, the gyro', () => {
  /**
   * A window with no Generic Sensor API, so both streams fall back to their
   * events, and a camera whose session is still being asked for.
   */
  function browser(now: number, session?: unknown) {
    const win = Object.assign(new EventTarget(), {
      performance: { now: () => now },
      XRWebGLLayer: class {},
      navigator: {
        xr: {
          isSessionSupported: async () => true,
          requestSession: () =>
            session === undefined
              ? new Promise<never>(() => undefined)
              : Promise.resolve(session),
        },
      },
    });
    const doc = Object.assign(new EventTarget(), {
      defaultView: win,
      visibilityState: 'visible',
      createElement: () => ({ getContext: () => ({}) }),
    }) as unknown as Document;
    return { win, doc };
  }

  /** An `immersive-ar` session that opens and draws no frame. */
  function xrSession() {
    return Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      renderState: {},
      end: async () => undefined,
      updateRenderState: () => undefined,
      requestReferenceSpace: async () => ({}),
      requestAnimationFrame: () => 0,
    });
  }

  function orientation(type: string, timeStamp: number, alpha: number): Event {
    const event = new Event(type);
    Object.defineProperties(event, {
      alpha: { value: alpha },
      beta: { value: 0 },
      gamma: { value: 0 },
      timeStamp: { value: timeStamp },
    });
    return event;
  }

  it('hears the game stream beside the compass, on the camera clock', () => {
    const { win, doc } = browser(5_000);
    const compass: WalkCompassReading[] = [];
    const gyro: WalkGyroReading[] = [];
    void new WebXrWalkSensors(doc).start(null, {
      pose: () => undefined,
      compass: (one) => compass.push(one),
      gyro: (one) => gyro.push(one),
      ended: () => undefined,
    });

    win.dispatchEvent(orientation('deviceorientation', 4_990, 30));
    win.dispatchEvent(orientation('deviceorientationabsolute', 4_995, 300));
    // A timestamp on another clock is stamped now, as the compass's is.
    win.dispatchEvent(orientation('deviceorientation', 90_000_000, 31));

    expect(compass.map((one) => one.t)).toEqual([4_995]);
    expect(gyro.map((one) => one.t)).toEqual([4_990, 5_000]);
    // A turn of 30 degrees about the vertical.
    expect(gyro[0].qz).toBeCloseTo(Math.sin((15 * Math.PI) / 180), 6);
    expect(gyro[0].qw).toBeCloseTo(Math.cos((15 * Math.PI) / 180), 6);
  });

  it('stops hearing the gyro once the session ends', async () => {
    const { win, doc } = browser(5_000, xrSession());
    const compass: WalkCompassReading[] = [];
    const gyro: WalkGyroReading[] = [];
    const session = await new WebXrWalkSensors(doc).start(null, {
      pose: () => undefined,
      compass: (one) => compass.push(one),
      gyro: (one) => gyro.push(one),
      ended: () => undefined,
    });
    if (typeof session === 'string') {
      throw new Error(`the session did not open: ${session}`);
    }
    win.dispatchEvent(orientation('deviceorientation', 4_990, 30));
    expect(gyro).toHaveLength(1);

    session.end();
    win.dispatchEvent(orientation('deviceorientation', 4_995, 31));
    win.dispatchEvent(orientation('deviceorientationabsolute', 4_996, 300));

    expect(gyro).toHaveLength(1);
    expect(compass).toEqual([]);
  });
});
