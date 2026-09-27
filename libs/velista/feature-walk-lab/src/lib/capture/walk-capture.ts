import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import type {
  StreamName,
  WalkFile,
  WalkMark,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { WalkDb } from '../storage/walk-db';
import type {
  CaptureNavigator,
  CaptureWindow,
  OrientationSensorConstructor,
  OrientationSensorLike,
  SensorErrorEventLike,
  XrFrameLike,
  XrSessionLike,
} from './browser-types';
import { eulerToQuaternion, motionRow, roundTo } from './orientation-math';
import { WalkBuilder, type WalkHeader } from './walk-builder';

/** How often the rows of a recording are saved (section 7, "a closed tab loses little"). */
export const SAVE_EVERY_MS = 10_000;

/** How long a stream may stay silent after Start before the walk says it is missing. */
const SILENCE_MS = 3_000;

export type OrientationSource = 'sensor' | 'event' | 'none';
export type CameraState = 'off' | 'starting' | 'tracking' | 'lost' | 'failed';
export type StopReason = 'finished' | 'hidden' | 'left';

export interface CaptureSettings {
  name?: string;
  holding: 'flat' | 'upright';
  stepMetres: number;
  cellMetres: number;
  appVersion: string;
  /** Ask for WebXR camera tracking. Only offered where it is supported. */
  camera: boolean;
  /** The element WebXR's DOM overlay shows over the camera: the recording screen. */
  overlayRoot: Element | null;
}

export interface CaptureListener {
  /** Every row, in arrival order, for the live track. */
  row(stream: StreamName, row: number[] | number): void;
  /** The recording stopped on its own, because the page was hidden. */
  stopped(reason: StopReason, walk: WalkFile): void;
}

/** What the screen shows about the streams, refreshed once a second. */
export interface CaptureStatus {
  motion: number;
  game: number;
  absolute: number;
  location: number;
  pose: number;
  gameSource: OrientationSource;
  absoluteSource: OrientationSource;
  accuracyMetres: number | null;
  savedAt: number | null;
}

const EMPTY_STATUS: CaptureStatus = {
  motion: 0,
  game: 0,
  absolute: 0,
  location: 0,
  pose: 0,
  gameSource: 'none',
  absoluteSource: 'none',
  accuracyMetres: null,
  savedAt: null,
};

/**
 * Every browser API the walk lab touches, in one place (recorder plan 0002, section 7).
 *
 * The recorder library is blind to the browser by constraint, so everything that
 * listens, asks or holds lives here: `devicemotion`, the orientation sensors or their
 * `deviceorientation` fallback, `watchPosition`, the screen wake lock, visibility and
 * WebXR. It turns each reading into a row of the walk file and hands it to a
 * `WalkBuilder`, and saves the new rows to IndexedDB every ten seconds.
 *
 * **Nothing here throws at the person holding the phone.** A permission refused, a
 * sensor that will not start or a camera session that fails is written into the walk
 * as an `event` and the recording goes on with what it has, because a walk with three
 * streams out of five still answers most of the test, and a walk that stopped on the
 * first error answers none of it.
 */
@Injectable()
export class WalkCapture {
  private readonly _document = inject(DOCUMENT);
  private readonly _db = inject(WalkDb);

  private readonly _recording = signal(false);
  private readonly _camera = signal<CameraState>('off');
  private readonly _status = signal<CaptureStatus>(EMPTY_STATUS);

  /** True between Start and the end of the recording. */
  readonly recording = this._recording.asReadonly();

  /** Where camera tracking is. */
  readonly camera = this._camera.asReadonly();

  /** Row counts and sources, once a second. */
  readonly status = this._status.asReadonly();

  private _builder: WalkBuilder | null = null;
  private _listener: CaptureListener | null = null;
  private _start = 0;
  private readonly _lastT = new Map<string, number>();
  private readonly _cleanups: (() => void)[] = [];
  private _wakeLock: WakeLockSentinel | null = null;
  private _xr: XrSessionLike | null = null;
  private _accuracy: number | null = null;
  private _savedAt: number | null = null;
  private _sources = {
    game: 'none' as OrientationSource,
    absolute: 'none' as OrientationSource,
  };
  private _saving: Promise<unknown> = Promise.resolve();
  private readonly _reported = new Set<string>();

  private get _window(): (Window & CaptureWindow) | null {
    return this._document.defaultView as (Window & CaptureWindow) | null;
  }

  private get _navigator(): (Navigator & CaptureNavigator) | null {
    return (this._window?.navigator as Navigator & CaptureNavigator) ?? null;
  }

  /** Whether camera tracking can be offered: `isSessionSupported('immersive-ar')`. */
  async cameraSupported(): Promise<boolean> {
    try {
      const xr = this._navigator?.xr;
      return xr ? await xr.isSessionSupported('immersive-ar') : false;
    } catch {
      return false;
    }
  }

  /** Milliseconds since Start, on the clock every row is stamped with. */
  now(): number {
    return this._window ? this._window.performance.now() - this._start : 0;
  }

  /**
   * Start recording. **Call it straight from the tap**: the motion permission and
   * the camera session both need the user activation the tap carries, so nothing is
   * awaited before them.
   */
  async start(settings: CaptureSettings, listener: CaptureListener): Promise<WalkBuilder> {
    this._teardown();

    const win = this._window;
    const header: WalkHeader = {
      format: 'shop-walk',
      version: 1,
      id: uuid(win),
      ...(settings.name ? { name: settings.name } : {}),
      startedAt: isoWithOffset(new Date()),
      source: {
        platform: 'web',
        app: 'velista-walk-lab',
        appVersion: settings.appVersion,
        ...(win?.navigator.userAgent ? { userAgent: win.navigator.userAgent } : {}),
      },
      holding: settings.holding,
      settings: { stepMetres: settings.stepMetres, cellMetres: settings.cellMetres },
      ...(settings.camera ? { poseSource: 'webxr' as const } : {}),
    };

    const builder = new WalkBuilder(header);
    this._builder = builder;
    this._listener = listener;
    this._lastT.clear();
    this._reported.clear();
    this._accuracy = null;
    this._savedAt = null;
    this._sources = { game: 'none', absolute: 'none' };
    this._start = win ? win.performance.now() : 0;
    this._recording.set(true);

    // The two requests that need the tap's activation, first and in this order.
    const motionAllowed = this._askMotionPermission();
    const camera = settings.camera
      ? this._startCamera(settings.overlayRoot)
      : Promise.resolve();

    await motionAllowed;
    this._listenToMotion();
    this._listenToOrientation();
    this._watchLocation();
    this._watchVisibility();
    void this._holdWakeLock();
    this._startSaving(header);
    this._watchSilence();
    this._refreshStatus();
    await camera;

    return builder;
  }

  /**
   * A mark, at the current moment or at `t`.
   *
   * `t` is for a checkpoint or a note, whose moment is the tap that opened the name
   * field rather than the Save after typing: the person marks the door at the door.
   */
  mark(kind: WalkMark['kind'], label?: string, t?: number): WalkMark | null {
    if (!this._builder || !this._recording()) {
      return null;
    }

    const mark: WalkMark = {
      t: roundTo(Math.min(t ?? this.now(), this.now()), 1),
      kind,
      ...(label ? { label } : {}),
    };
    this._builder.mark(mark);
    return mark;
  }

  /**
   * Stop, save the whole walk, and answer it.
   *
   * Safe to call twice, and from a component being destroyed: the second call answers
   * the walk the first one saved.
   */
  async stop(reason: StopReason = 'finished'): Promise<WalkFile | null> {
    const builder = this._builder;
    if (!builder) {
      return null;
    }

    if (this._recording()) {
      builder.setDuration(this.now());
      if (reason !== 'finished') {
        builder.event({ t: roundTo(this.now(), 1), kind: 'stopped', detail: reason });
      }
    }

    this._recording.set(false);
    this._teardown();

    const walk = builder.toWalk();
    await this._saving;
    const saved = await this._db.save(walk);
    if (!saved) {
      // Kept for the screen to offer as a download: the one copy left is in memory.
      this._reported.add('save-failed');
    }
    return walk;
  }

  /** The walk as it stands, for replaying it into a new live track. */
  snapshot(): WalkFile | null {
    return this._builder?.toWalk() ?? null;
  }

  /** A short buzz, so a mark is felt in a noisy shop. Silent where there is no motor. */
  buzz(): void {
    try {
      this._navigator?.vibrate?.(40);
    } catch {
      // No vibration is no loss.
    }
  }

  /** Whether the last `stop` failed to save. */
  saveFailed(): boolean {
    return this._reported.has('save-failed');
  }

  // Streams -----------------------------------------------------------------------

  private async _askMotionPermission(): Promise<void> {
    const ask = this._window?.DeviceMotionEvent?.requestPermission;
    if (typeof ask !== 'function') {
      return;
    }

    try {
      const answer = await ask.call(this._window?.DeviceMotionEvent);
      if (answer !== 'granted') {
        this._event('permission-denied', 'motion');
      }
      const askOrientation = this._window?.DeviceOrientationEvent?.requestPermission;
      if (typeof askOrientation === 'function') {
        await askOrientation.call(this._window?.DeviceOrientationEvent);
      }
    } catch (error) {
      this._event('permission-denied', `motion: ${describe(error)}`);
    }
  }

  private _listenToMotion(): void {
    const win = this._window;
    if (!win || !('DeviceMotionEvent' in win)) {
      this._event('sensor-missing', 'devicemotion');
      return;
    }

    const onMotion = (event: DeviceMotionEvent) => {
      const t = this._stamp('motion', event.timeStamp);
      const row = motionRow(t, event);
      if (!row) {
        this._once('sensor-missing', 'accelerationIncludingGravity');
        return;
      }
      if (event.rotationRate === null || event.rotationRate.alpha === null) {
        this._once('sensor-missing', 'rotationRate');
      }
      this._push('motion', row);
    };

    win.addEventListener('devicemotion', onMotion);
    this._cleanups.push(() => win.removeEventListener('devicemotion', onMotion));
  }

  /**
   * `game` and `absolute`: the Generic Sensor API at 50 Hz where it can be built and
   * started, else the `deviceorientation` events converted to quaternions. Each of
   * the two falls back on its own, since a phone can grant one and not the other.
   */
  private _listenToOrientation(): void {
    const win = this._window;
    this._startOrientation('game', win?.RelativeOrientationSensor, 'deviceorientation');
    this._startOrientation(
      'absolute',
      win?.AbsoluteOrientationSensor,
      'deviceorientationabsolute'
    );
  }

  private _startOrientation(
    stream: 'game' | 'absolute',
    Sensor: OrientationSensorConstructor | undefined,
    fallbackEvent: 'deviceorientation' | 'deviceorientationabsolute'
  ): void {
    const fallback = (why: string) => {
      this._event('sensor-missing', `${stream} sensor: ${why}; using ${fallbackEvent}`);
      this._listenToOrientationEvent(stream, fallbackEvent);
    };

    if (typeof Sensor !== 'function') {
      this._listenToOrientationEvent(stream, fallbackEvent);
      return;
    }

    let sensor: OrientationSensorLike;
    try {
      sensor = new Sensor({ frequency: 50, referenceFrame: 'device' });
    } catch (error) {
      // SecurityError: blocked by a permissions policy. ReferenceError: not exposed.
      fallback(describe(error));
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
      this._sources[stream] = 'sensor';
      const t = this._stamp(stream, sensor.timestamp ?? undefined);
      this._push(stream, [
        roundTo(t, 1),
        roundTo(q[0], 6),
        roundTo(q[1], 6),
        roundTo(q[2], 6),
        roundTo(q[3], 6),
      ]);
    };

    // NotAllowedError: the permission was refused. NotReadableError: the sensor
    // could not be started. Either way the event based fallback may still work.
    const onError = (event: Event) => {
      const error = (event as SensorErrorEventLike).error;
      if (error?.name === 'NotAllowedError') {
        this._event('permission-denied', `${stream} sensor`);
      }
      giveUp(error ? `${error.name}: ${error.message}` : 'error');
    };

    sensor.addEventListener('reading', onReading);
    sensor.addEventListener('error', onError);

    try {
      sensor.start();
    } catch (error) {
      giveUp(describe(error));
      return;
    }

    // A sensor that starts and never reads is as missing as one that throws.
    const watchdog = setTimeout(() => {
      if (readings === 0) {
        giveUp('no readings');
      }
    }, SILENCE_MS);

    this._cleanups.push(() => {
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

  private _listenToOrientationEvent(
    stream: 'game' | 'absolute',
    type: 'deviceorientation' | 'deviceorientationabsolute'
  ): void {
    const win = this._window;
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
      this._sources[stream] = 'event';
      const t = this._stamp(stream, event.timeStamp);
      this._push(stream, [
        roundTo(t, 1),
        roundTo(q[0], 6),
        roundTo(q[1], 6),
        roundTo(q[2], 6),
        roundTo(q[3], 6),
      ]);
    };

    win.addEventListener(type, onOrientation as EventListener);
    this._cleanups.push(() =>
      win.removeEventListener(type, onOrientation as EventListener)
    );
  }

  private _watchLocation(): void {
    const geo = this._navigator?.geolocation;
    if (!geo) {
      this._event('sensor-missing', 'geolocation');
      return;
    }

    try {
      const id = geo.watchPosition(
        (position) => {
          const t = this._stamp('location');
          const { latitude, longitude, accuracy } = position.coords;
          this._accuracy = accuracy;
          this._builder?.offerOrigin({
            lat: roundTo(latitude, 7),
            lon: roundTo(longitude, 7),
            accuracyMetres: roundTo(accuracy, 1),
          });
          this._push('location', [
            roundTo(t, 1),
            roundTo(latitude, 7),
            roundTo(longitude, 7),
            roundTo(accuracy, 1),
          ]);
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            this._once('permission-denied', 'location');
          } else {
            this._once('location-error', `${error.code}: ${error.message}`);
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }
      );
      this._cleanups.push(() => geo.clearWatch(id));
    } catch (error) {
      this._event('sensor-missing', `geolocation: ${describe(error)}`);
    }
  }

  // The page and the screen ---------------------------------------------------------

  /**
   * A hidden page ends the recording and keeps the walk (section 7.2).
   *
   * One exception, and it is there so camera tracking can work at all: while a WebXR
   * session is running and says it is visible, a hidden document is the browser
   * handing the screen to the camera session rather than the person leaving, so the
   * walk writes the event and goes on.
   */
  private _watchVisibility(): void {
    const doc = this._document;
    const onChange = () => {
      if (!this._recording()) {
        return;
      }

      if (doc.visibilityState === 'hidden') {
        const xrVisible = this._xr !== null && this._xr.visibilityState !== 'hidden';
        if (xrVisible) {
          this._event('hidden', 'ignored while camera tracking is on');
          return;
        }
        this._event('hidden');
        void this.stop('hidden').then((walk) => {
          if (walk) {
            this._listener?.stopped('hidden', walk);
          }
        });
        return;
      }

      this._event('visible');
      void this._holdWakeLock();
    };

    doc.addEventListener('visibilitychange', onChange);
    this._cleanups.push(() => doc.removeEventListener('visibilitychange', onChange));
  }

  private async _holdWakeLock(): Promise<void> {
    const lock = this._navigator?.wakeLock;
    if (!lock) {
      this._once('sensor-missing', 'wake lock');
      return;
    }
    if (this._wakeLock && !this._wakeLock.released) {
      return;
    }

    try {
      this._wakeLock = await lock.request('screen');
      if (!this._recording()) {
        await this._releaseWakeLock();
      }
    } catch (error) {
      this._event('wake-lock-failed', describe(error));
    }
  }

  private async _releaseWakeLock(): Promise<void> {
    const held = this._wakeLock;
    this._wakeLock = null;
    try {
      await held?.release();
    } catch {
      // Released already.
    }
  }

  // Camera tracking ------------------------------------------------------------------

  /**
   * WebXR `immersive-ar` with a DOM overlay, `local` reference space, the viewer pose
   * each frame into `pose`. Best effort from end to end: a failure at any step writes
   * an event and the walk goes on without the camera.
   */
  private async _startCamera(root: Element | null): Promise<void> {
    const win = this._window;
    const xr = this._navigator?.xr;
    if (!win || !xr || !win.XRWebGLLayer) {
      this._camera.set('failed');
      this._event('tracking-failed', 'WebXR is not available');
      return;
    }

    this._camera.set('starting');
    let session: XrSessionLike;
    try {
      session = await xr.requestSession('immersive-ar', {
        optionalFeatures: ['dom-overlay'],
        ...(root ? { domOverlay: { root } } : {}),
      });
    } catch (error) {
      this._camera.set('failed');
      this._event('tracking-failed', `requestSession: ${describe(error)}`);
      return;
    }

    if (!this._recording()) {
      void session.end().catch(() => undefined);
      return;
    }
    this._xr = session;

    try {
      const canvas = this._document.createElement('canvas');
      const gl = canvas.getContext('webgl', {
        xrCompatible: true,
        alpha: true,
      } as WebGLContextAttributes) as WebGLRenderingContext | null;
      if (!gl) {
        throw new Error('no WebGL context');
      }
      session.updateRenderState({ baseLayer: new win.XRWebGLLayer(session, gl) });
      const space = await session.requestReferenceSpace('local');

      let tracking = false;
      const onFrame = (time: number, frame: XrFrameLike) => {
        if (this._xr !== session) {
          return;
        }
        session.requestAnimationFrame(onFrame);

        // Clear to transparent so the camera shows through; nothing is drawn.
        const layer = session.renderState.baseLayer;
        if (layer) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        const pose = frame.getViewerPose(space);
        const tracked = pose !== null && !pose.emulatedPosition;
        if (tracked !== tracking) {
          tracking = tracked;
          this._camera.set(tracked ? 'tracking' : 'lost');
          this._event(tracked ? 'tracking-resumed' : 'tracking-lost', 'webxr');
        }
        if (!pose || !tracked) {
          return;
        }

        const { position: p, orientation: o } = pose.transform;
        const t = this._stamp('pose', time);
        this._push('pose', [
          roundTo(t, 1),
          roundTo(p.x, 4),
          roundTo(p.y, 4),
          roundTo(p.z, 4),
          roundTo(o.x, 6),
          roundTo(o.y, 6),
          roundTo(o.z, 6),
          roundTo(o.w, 6),
        ]);
      };

      session.addEventListener('end', () => {
        if (this._xr === session) {
          this._xr = null;
          if (this._recording()) {
            this._camera.set('failed');
            this._event('tracking-ended', 'the camera session ended');
          } else {
            this._camera.set('off');
          }
        }
      });

      session.requestAnimationFrame(onFrame);
    } catch (error) {
      this._camera.set('failed');
      this._event('tracking-failed', describe(error));
      this._xr = null;
      void session.end().catch(() => undefined);
    }
  }

  // Saving -------------------------------------------------------------------------------

  private _startSaving(header: WalkHeader): void {
    this._saving = this._db.begin(header);

    const timer = setInterval(() => {
      const builder = this._builder;
      if (!builder || !this._recording()) {
        return;
      }
      builder.setDuration(this.now());
      const chunk = builder.drainChunk();
      this._saving = this._saving
        .then(() => this._db.append(chunk, header))
        .then((ok) => {
          if (ok) {
            this._savedAt = this.now();
          }
        });
    }, SAVE_EVERY_MS);

    this._cleanups.push(() => clearInterval(timer));
  }

  /** A stream that has said nothing three seconds after Start is written down as missing. */
  private _watchSilence(): void {
    const timer = setTimeout(() => {
      const builder = this._builder;
      if (!builder || !this._recording()) {
        return;
      }
      if (builder.count('motion') === 0) {
        this._event('sensor-missing', 'devicemotion: no events');
      }
      for (const stream of ['game', 'absolute'] as const) {
        if (builder.count(stream) === 0) {
          this._event('sensor-missing', `${stream}: no readings`);
        }
      }
    }, SILENCE_MS + 500);

    this._cleanups.push(() => clearTimeout(timer));
  }

  private _refreshStatus(): void {
    const tick = () => {
      const builder = this._builder;
      if (!builder) {
        return;
      }
      this._status.set({
        motion: builder.count('motion'),
        game: builder.count('game'),
        absolute: builder.count('absolute'),
        location: builder.count('location'),
        pose: builder.count('pose'),
        gameSource: this._sources.game,
        absoluteSource: this._sources.absolute,
        accuracyMetres: this._accuracy,
        savedAt: this._savedAt,
      });
    };

    tick();
    const timer = setInterval(tick, 1_000);
    this._cleanups.push(() => clearInterval(timer));
  }

  // Plumbing -----------------------------------------------------------------------------

  /**
   * A row's `t`, from the event's own timestamp where it has one.
   *
   * Every browser timestamp read here is on the `performance.now()` clock, so the
   * start is subtracted. A timestamp that is missing or absurd falls back to now, and
   * a stream never goes back in time, since rows of a stream are in `t` order.
   */
  private _stamp(stream: string, eventTime?: number): number {
    const now = this.now();
    let t =
      typeof eventTime === 'number' && Number.isFinite(eventTime)
        ? eventTime - this._start
        : now;
    if (t < 0 || t > now + 1_000) {
      t = now;
    }
    const last = this._lastT.get(stream) ?? 0;
    if (t < last) {
      t = last;
    }
    this._lastT.set(stream, t);
    return Math.max(0, t);
  }

  private _push(stream: StreamName, row: number[] | number): void {
    if (!this._builder || !this._recording()) {
      return;
    }
    this._builder.push(stream, row);
    this._listener?.row(stream, row);
  }

  private _event(kind: string, detail?: string): void {
    this._builder?.event({
      t: roundTo(this.now(), 1),
      kind,
      ...(detail ? { detail } : {}),
    });
  }

  /** An event written once per recording, for things that would otherwise repeat. */
  private _once(kind: string, detail: string): void {
    const key = `${kind}:${detail}`;
    if (this._reported.has(key)) {
      return;
    }
    this._reported.add(key);
    this._event(kind, detail);
  }

  private _teardown(): void {
    while (this._cleanups.length > 0) {
      try {
        this._cleanups.pop()?.();
      } catch {
        // A listener that will not come off is no reason to keep the others on.
      }
    }

    const session = this._xr;
    this._xr = null;
    if (session) {
      void session.end().catch(() => undefined);
    }
    if (this._camera() !== 'failed') {
      this._camera.set('off');
    }
    void this._releaseWakeLock();
  }
}

/** A uuid, from `crypto.randomUUID` where it exists (a secure context always has it). */
function uuid(win: Window | null): string {
  const crypto = win?.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (crypto) {
    crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** ISO 8601 with the local offset, as section 2 asks, rather than `toISOString`'s Z. */
export function isoWithOffset(date: Date): string {
  const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

function describe(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
