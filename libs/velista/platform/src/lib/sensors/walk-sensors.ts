import { DOCUMENT } from '@angular/common';
import { inject, InjectionToken, isDevMode } from '@angular/core';
import { BrowserFacade } from '../browser-facade';
import { StorageKeys } from '../storage-keys';
import type { CaptureNavigator, CaptureWindow } from './browser-types';
import { listenToOrientation } from './orientation-stream';
import { loadScriptedWalkSensors } from './scripted-walk-loader';
import { immersiveArSupported, openXrCamera, type XrCamera } from './xr-camera';

/**
 * One camera pose, as the tracking guard of recorder plan 0003 reads it
 * (`PoseSample`): the position and orientation in WebXR's `local` space, and
 * whether it is tracked. An untracked pose only needs `t`.
 */
export interface WalkPoseReading {
  /** Milliseconds on the `performance.now()` clock, the clock of the compass too. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly tracked: boolean;
}

/** One compass reading: the absolute orientation quaternion (`CompassSample`). */
export interface WalkCompassReading {
  readonly t: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
}

/** What a running session reports. */
export interface WalkSensorListener {
  /** Every camera frame. */
  pose(reading: WalkPoseReading): void;
  /** Every compass reading. */
  compass(reading: WalkCompassReading): void;
  /** The session ended by itself: the browser closed it, or the camera failed. */
  ended(): void;
}

/** A running session. */
export interface WalkSensorSession {
  /**
   * Whether the camera session itself is still on screen. While it is, a hidden
   * document is the browser handing the screen to the camera rather than the
   * person leaving (the walk lab's rule, recorder plan 0002, section 7.2).
   */
  showing(): boolean;
  /** Ends the camera, the compass and the wake lock. Safe to call twice. */
  end(): void;
}

/** Why a session did not start. */
export type WalkSensorsRefusal = 'unsupported' | 'failed';

/**
 * The camera and the compass of a walk (velista `0126`, target 2), as the
 * recording screen sees them. An interface behind a token for the reason
 * `NOTIFICATION_TONE` has one: the real one reaches WebXR, which neither a spec
 * nor Playwright has, and both of them need a walk to replay instead.
 *
 * Raw readings go to the listener and nowhere else: nothing here keeps or sends
 * them (the plan's constraint that raw sensor streams are never sent).
 */
export interface WalkSensorsI {
  /** Whether a session can be started here: `immersive-ar` is offered. */
  supported(): Promise<boolean>;
  /**
   * Start the camera with `overlayRoot` as its DOM overlay, the compass, and the
   * wake lock. **Call it straight from a tap**: the camera needs its activation.
   */
  start(
    overlayRoot: Element | null,
    listener: WalkSensorListener
  ): Promise<WalkSensorSession | WalkSensorsRefusal>;
}

/**
 * The real sensors: `openXrCamera` for the poses and `listenToOrientation` on the
 * `absolute` stream for the compass, the pieces the walk lab records with.
 */
export class WebXrWalkSensors implements WalkSensorsI {
  constructor(private readonly _document: Document) {}

  private get _window(): (Window & CaptureWindow) | null {
    return this._document.defaultView as (Window & CaptureWindow) | null;
  }

  private get _navigator(): (Navigator & CaptureNavigator) | null {
    return (this._window?.navigator as Navigator & CaptureNavigator) ?? null;
  }

  supported(): Promise<boolean> {
    return immersiveArSupported(this._navigator);
  }

  async start(
    overlayRoot: Element | null,
    listener: WalkSensorListener
  ): Promise<WalkSensorSession | WalkSensorsRefusal> {
    const win = this._window;
    // The tracking guard measures a loss as the time between a compass reading
    // and the last pose, so both must be on one clock. A browser timestamp that
    // is missing, or that is not within a second of now, is replaced by now: the
    // rule the walk lab stamps its rows by.
    const stamp = (eventTime: number | undefined) =>
      onPerformanceClock(eventTime, win?.performance.now() ?? 0);
    let wanted = true;
    let camera: XrCamera | null = null;
    let wakeLock: WakeLockSentinel | null = null;
    const cleanups: (() => void)[] = [];

    const end = () => {
      if (!wanted) {
        return;
      }
      wanted = false;
      camera?.end();
      camera = null;
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
    };

    // The camera first, while the tap's activation is fresh.
    const opening = openXrCamera({
      window: win,
      navigator: this._navigator,
      document: this._document,
      overlayRoot,
      wanted: () => wanted,
      frame: (time, pose) => {
        const t = stamp(time);
        if (pose === null || pose.emulatedPosition) {
          listener.pose(untracked(t));
          return;
        }
        const { position: p, orientation: o } = pose.transform;
        listener.pose({
          t,
          x: p.x,
          y: p.y,
          z: p.z,
          qx: o.x,
          qy: o.y,
          qz: o.z,
          qw: o.w,
          tracked: true,
        });
      },
      ended: () => {
        camera = null;
        end();
        listener.ended();
      },
    });

    cleanups.push(
      listenToOrientation(win, 'absolute', {
        reading: (_source, q, eventTime) =>
          listener.compass({
            t: stamp(eventTime),
            qx: q[0],
            qy: q[1],
            qz: q[2],
            qw: q[3],
          }),
        event: () => undefined,
      })
    );

    const hold = async () => {
      try {
        const lock = await this._navigator?.wakeLock?.request('screen');
        if (!wanted) {
          await lock?.release();
          return;
        }
        wakeLock = lock ?? null;
      } catch {
        // No wake lock is no reason to stop a walk.
      }
    };
    void hold();
    // A wake lock ends when the page is hidden, so it is asked for again.
    const onVisible = () => {
      if (this._document.visibilityState === 'visible' && wanted) {
        void hold();
      }
    };
    this._document.addEventListener('visibilitychange', onVisible);
    cleanups.push(() =>
      this._document.removeEventListener('visibilitychange', onVisible)
    );

    const opened = await opening;
    if (opened.kind !== 'open') {
      end();
      return opened.kind === 'failed' && opened.stage === 'unavailable'
        ? 'unsupported'
        : 'failed';
    }
    camera = opened.camera;
    const session = opened.camera.session;
    return {
      showing: () => camera !== null && session.visibilityState !== 'hidden',
      end,
    };
  }
}

/** A browser timestamp may be this far from now and still be believed. */
export const CLOCK_SLACK_MS = 1_000;

/**
 * `eventTime` when it is on the `performance.now()` clock, else `now`. A sensor
 * that stamps its readings on another clock (the time since boot, say) is seconds
 * or days away from the camera's frames, which the tracking guard reads as a loss.
 */
export function onPerformanceClock(
  eventTime: number | undefined,
  now: number
): number {
  return typeof eventTime === 'number' &&
    Number.isFinite(eventTime) &&
    Math.abs(eventTime - now) <= CLOCK_SLACK_MS
    ? eventTime
    : now;
}

function untracked(t: number): WalkPoseReading {
  return { t, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, tracked: false };
}

/**
 * The query flag that swaps in the scripted walk, dev builds only: `?fakeWalk=1`,
 * or `?fakeWalk=4` to replay four times as fast. Once seen it holds for the tab
 * (`StorageKeys.fakeWalk`), so it survives the navigations of a walk; `?fakeWalk=0`
 * turns it off again.
 */
export const FAKE_WALK_PARAM = 'fakeWalk';

/** The replay speed the flag asks for, or null for the real sensors. */
export function fakeWalkSpeed(
  browser: BrowserFacade,
  search: string,
  devMode: boolean
): number | null {
  if (!devMode) {
    return null;
  }
  const asked = new URLSearchParams(search).get(FAKE_WALK_PARAM);
  if (asked !== null) {
    if (asked === '0') {
      browser.removeSessionStorage(StorageKeys.fakeWalk);
      return null;
    }
    browser.writeSessionStorage(StorageKeys.fakeWalk, asked);
  }
  const held = browser.readSessionStorage(StorageKeys.fakeWalk);
  if (held === null) {
    return null;
  }
  const speed = Number(held);
  return Number.isFinite(speed) && speed > 0 ? Math.min(speed, 20) : 1;
}

export const WALK_SENSORS = new InjectionToken<WalkSensorsI>('WALK_SENSORS', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    const speed = fakeWalkSpeed(
      inject(BrowserFacade),
      document.defaultView?.location.search ?? '',
      isDevMode()
    );
    if (speed === null) {
      return new WebXrWalkSensors(document);
    }
    // Null in a production build, which swaps the loader for a stub
    // (`fileReplacements` in apps/velista/project.json), so the scripted walk
    // is not even a chunk there.
    return (
      loadScriptedWalkSensors(document, speed) ?? new WebXrWalkSensors(document)
    );
  },
});
