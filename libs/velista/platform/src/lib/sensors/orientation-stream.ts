import type {
  CaptureWindow,
  OrientationSensorConstructor,
  OrientationSensorLike,
  SensorErrorEventLike,
} from './browser-types';
import { eulerToQuaternion } from './orientation-math';

/** The two orientation streams of a walk file: relative, and relative to north. */
export type OrientationStream = 'game' | 'absolute';

/** Where a stream's readings come from. */
export type OrientationSource = 'sensor' | 'event' | 'none';

/** What an orientation stream reports. */
export interface OrientationListener {
  /**
   * One reading: the quaternion `[qx, qy, qz, qw]` that rotates device frame
   * vectors into the world frame, and the reading's own timestamp on the
   * `performance.now()` clock where it has one.
   */
  reading(
    source: 'sensor' | 'event',
    quaternion: readonly [number, number, number, number],
    eventTime: number | undefined
  ): void;
  /** Something worth writing down: a sensor that is missing, or a permission refused. */
  event(kind: 'sensor-missing' | 'permission-denied', detail: string): void;
}

/** How long a sensor may stay silent after it started before the event fallback takes over. */
const SILENCE_MS = 3_000;

/**
 * One orientation stream, moved here from the walk lab so the recording screen of
 * velista `0126` reads the compass the same way (target 10).
 *
 * The Generic Sensor API at 50 Hz where it can be built and started, else the
 * `deviceorientation` (`game`) or `deviceorientationabsolute` (`absolute`) events
 * converted to quaternions. A sensor that throws, reports an error or reads nothing
 * for three seconds falls back to the events, and says so through `event`.
 *
 * Answers the function that stops listening.
 */
export function listenToOrientation(
  win: (Window & CaptureWindow) | null,
  stream: OrientationStream,
  listener: OrientationListener
): () => void {
  const cleanups: (() => void)[] = [];
  const Sensor =
    stream === 'game'
      ? win?.RelativeOrientationSensor
      : win?.AbsoluteOrientationSensor;
  const fallbackEvent =
    stream === 'game' ? 'deviceorientation' : 'deviceorientationabsolute';

  const listenToEvents = () => {
    if (!win) {
      return;
    }
    const onOrientation = (event: DeviceOrientationEvent) => {
      // `deviceorientation` on a browser that only has absolute data says so with
      // `absolute: true`; it is still the best the `game` stream can get.
      const q = eulerToQuaternion(event.alpha, event.beta, event.gamma);
      if (!q) {
        return;
      }
      listener.reading('event', q, event.timeStamp);
    };
    win.addEventListener(fallbackEvent, onOrientation as EventListener);
    cleanups.push(() =>
      win.removeEventListener(fallbackEvent, onOrientation as EventListener)
    );
  };

  const fallback = (why: string) => {
    listener.event(
      'sensor-missing',
      `${stream} sensor: ${why}; using ${fallbackEvent}`
    );
    listenToEvents();
  };

  const stop = () => {
    while (cleanups.length > 0) {
      try {
        cleanups.pop()?.();
      } catch {
        // A listener that will not come off is no reason to keep the others on.
      }
    }
  };

  if (typeof Sensor !== 'function') {
    listenToEvents();
    return stop;
  }

  startSensor(Sensor, stream, listener, fallback, cleanups);
  return stop;
}

function startSensor(
  Sensor: OrientationSensorConstructor,
  stream: OrientationStream,
  listener: OrientationListener,
  fallback: (why: string) => void,
  cleanups: (() => void)[]
): void {
  let sensor: OrientationSensorLike;
  try {
    sensor = new Sensor({ frequency: 50, referenceFrame: 'device' });
  } catch (error) {
    // SecurityError: blocked by a permissions policy. ReferenceError: not exposed.
    fallback(describeError(error));
    return;
  }

  let fellBack = false;
  let readings = 0;
  const giveUp = (why: string) => {
    if (fellBack) {
      return;
    }
    fellBack = true;
    try {
      sensor.stop();
    } catch {
      // Already stopped, which is what was wanted.
    }
    fallback(why);
  };

  const onReading = () => {
    const q = sensor.quaternion;
    if (!q || q.length < 4 || fellBack) {
      return;
    }
    readings++;
    listener.reading(
      'sensor',
      [q[0], q[1], q[2], q[3]],
      sensor.timestamp ?? undefined
    );
  };

  // NotAllowedError: the permission was refused. NotReadableError: the sensor
  // could not be started. Either way the event based fallback may still work.
  const onError = (event: Event) => {
    const error = (event as SensorErrorEventLike).error;
    if (error?.name === 'NotAllowedError') {
      listener.event('permission-denied', `${stream} sensor`);
    }
    giveUp(error ? `${error.name}: ${error.message}` : 'error');
  };

  sensor.addEventListener('reading', onReading);
  sensor.addEventListener('error', onError);

  try {
    sensor.start();
  } catch (error) {
    giveUp(describeError(error));
    return;
  }

  // A sensor that starts and never reads is as missing as one that throws.
  const watchdog = setTimeout(() => {
    if (readings === 0) {
      giveUp('no readings');
    }
  }, SILENCE_MS);

  cleanups.push(() => {
    clearTimeout(watchdog);
    sensor.removeEventListener('reading', onReading);
    sensor.removeEventListener('error', onError);
    try {
      sensor.stop();
    } catch {
      // Nothing to stop.
    }
  });
}

/** An error as one line: its name and message where it has them. */
export function describeError(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
