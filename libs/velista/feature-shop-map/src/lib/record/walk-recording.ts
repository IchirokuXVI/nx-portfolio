import {
  createLiveMap,
  type LiveMapHandle,
  type LiveMapSettings,
  type LiveSnapshot,
  type MapMark,
  type MarkKind,
  type ShopMapDocumentV2,
  type WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  alignPose,
  alignSession,
  cameraHeading,
  createTrackingGuard,
  keepPathPoint,
  mapPoint,
  type PathPoint,
  type PoseSample,
  type RigidTransform,
  type TrackingEvent,
  type TrackingGuard,
} from '@portfolio/luna-shopper/shop-map/recorder';
import type { WalkEntryDraft } from '@portfolio/velista/data-access';
import type { ShopWalkEntryKind } from '@portfolio/velista/models';
import type {
  WalkCompassReading,
  WalkPoseReading,
} from '@portfolio/velista/platform';

/**
 * Where a recording stands.
 *
 * - `idle`: no session has started yet.
 * - `walking`: the guard says `good`, and the walk is drawn and saved.
 * - `lost`: tracking is lost, for less than the 3 s that stop the walk. Nothing
 *   is drawn. It may come back by itself.
 * - `unconfirmed`: it came back by itself, and the person has not said whether
 *   the purple path is right. Only the purple path is drawn, and it is not saved.
 * - `stopped`: the walk stopped. Only a manual resume at a mark goes on.
 */
export type RecordingPhase =
  | 'idle'
  | 'walking'
  | 'lost'
  | 'unconfirmed'
  | 'stopped';

/** Why the walk stopped, as the page says it. */
export type RecordingStop =
  | 'tracking-lost'
  | 'frame-moved'
  | 'discarded'
  | 'button'
  | 'left-page';

/** What a recording hands to the page, which owns the saver and the speakers. */
export interface RecordingOutput {
  /** Events for the open entry, with the log time they reach. `WalkEntrySaver.add`. */
  add(events: readonly WalkEvent[], logTo: number): void;
  /** A whole entry. `WalkEntrySaver.push`. */
  push(draft: WalkEntryDraft): void;
  /** The kind of the next entry opened. `WalkEntrySaver.openNext`. */
  openNext(kind: ShopWalkEntryKind): void;
  /** Where the log ends now. `WalkEntrySaver.logEnd`. */
  logEnd(): number;
  /**
   * Whether the entry `openNext` named was opened: something was added since.
   * The opposite of `WalkEntrySaver.nextWaits`.
   */
  sessionOpened(): boolean;
  /** Forget the kind `openNext` named. `WalkEntrySaver.dropNext`. */
  forgetNext(): void;
  /** Send what is held now: a stop, or the start of a loss. */
  save(): void;
  tone(kind: 'stopped' | 'resumed'): void;
  /** The guard learned the walk's compass baseline: keep it for later resumes. */
  baseline(degrees: number): void;
}

export interface WalkRecordingOptions {
  /** The walk's map as it was read. The live map starts from it. */
  readonly document: ShopMapDocumentV2;
  readonly settings: LiveMapSettings;
  /** The compass baseline this device kept for the walk, if any. */
  readonly baseline: number | null;
  readonly output: RecordingOutput;
  /** Ids for marks. */
  readonly createId: () => string;
}

/**
 * A resume by the compass waits for this much of it, so the rotation rests on
 * the median of a second of readings rather than on one.
 */
export const PROBE_COMPASS_MS = 1_000;

/** The page flushes path points to the log once this many have been kept (about 2 s of walking). */
export const PATH_BATCH_POINTS = 8;

/**
 * A session has walked once it is this far from where it started: one step of
 * the kept path. Until then its points say where somebody stands, which a point
 * is kept for every second, and they are held back.
 */
export const SESSION_MOVED_METRES = 0.25;

/** Where the phone points, next to where the person walks. */
export type RecordingPointing = 'left' | 'right' | 'ahead' | 'behind';

/** Where the person is, for the canvas. */
export interface RecordingPerson {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

/**
 * One recording (velista `0126`, targets 2 to 8): the tracking guard and the live
 * map fed from the camera and the compass, the path points the log keeps, the
 * purple path of an automatic resume, the stops and both kinds of resume. No
 * Angular and no browser: the page feeds it readings and draws what it answers,
 * so the spec plays a walk through it without a screen.
 *
 * ## Log time
 *
 * A session's log time starts where the log ended and runs with the camera's
 * clock, so the gaps between sessions are removed (shop-map plan 0002). A loss
 * inside a session is not a gap: the walk kept going.
 *
 * ## What is saved, and when
 *
 * Only the kept path points (`keepPathPoint`), the live map's events and the
 * marks. Nothing of the purple path until the person says yes. A loss saves what
 * came before it straight away, so "Everything up to this moment is saved".
 *
 * A session that adds nothing sends nothing (velista `0129`, target 9). A
 * session's points are held back until it has moved a step, a mark was made or
 * the map was edited, so a resume that is stopped at once opens no `resumed`
 * entry. Its `stopped` entry goes out only when the entry that opened the
 * session did, so such a visit leaves the history as it was.
 *
 * An automatic resume confirmed keeps the purple points in the session they
 * belong to, appends `confirmed`, and opens the next entry as `resumed`. One
 * discarded, or a stop that drops it, appends `stopped` at the loss (and
 * `discarded` for the person's no), so the walk ends up to the problem.
 */
export class WalkRecording {
  private readonly _live: LiveMapHandle;
  private readonly _output: RecordingOutput;
  private readonly _createId: () => string;

  private _phase: RecordingPhase = 'idle';
  private _stop: RecordingStop | null = null;
  private _guard: TrackingGuard | null = null;
  private _probe: TrackingGuard | null = null;
  private _transform: RigidTransform | null = null;
  private _baseline: number | null;

  /** The camera time the session's log time counts from, set by its first pose. */
  private _sessionStart: number | null = null;
  /** The log time the session started at. */
  private _logBase = 0;

  /** The last pose, while it is tracked: null from the first untracked one. */
  private _lastRaw: WalkPoseReading | null = null;
  /** The camera time of the last pose, tracked or not. */
  private _lastT = 0;
  /** When the probe heard the compass first and last. */
  private _probeCompass: { first: number; last: number } | null = null;
  private _lastAligned: PoseSample | null = null;
  private _lastKept: PathPoint | null = null;
  /** The last few kept points, for the direction the person walks. */
  private _recent: PathPoint[] = [];
  private _pending: [number, number, number][] = [];
  /** The session's first kept point, which `_moved` is measured from. */
  private _first: PathPoint | null = null;
  /** True once the session is a step from where it started. */
  private _moved = false;
  /** True once this session added something to the log. */
  private _wrote = false;
  private _purple: [number, number, number][] = [];
  /** The log time tracking was lost at, while a loss or its resume waits. */
  private _lossLog: number | null = null;
  private _lastLog = 0;

  constructor(options: WalkRecordingOptions) {
    this._live = createLiveMap({
      document: options.document,
      settings: options.settings,
    });
    this._output = options.output;
    this._createId = options.createId;
    this._baseline = options.baseline;
  }

  get phase(): RecordingPhase {
    return this._phase;
  }

  /** Why the walk stopped, while `stopped`. */
  get stop(): RecordingStop | null {
    return this._stop;
  }

  /** The compass baseline in use, when known. */
  get baseline(): number | null {
    return this._baseline;
  }

  /** Whether a manual resume can line up now: the camera is tracking. */
  get canResume(): boolean {
    return this._lastRaw !== null;
  }

  /**
   * Whether a manual resume can line up by the compass: the camera is tracking,
   * and when the walk's baseline is known, the probe has a compass offset too.
   * Without a baseline there is nothing to wait for: it lines up by pointing.
   */
  get readyToResume(): boolean {
    return (
      this.canResume &&
      (this._baseline === null ||
        (this._probe?.state().offset !== undefined &&
          this._probeCompassMs() >= PROBE_COMPASS_MS))
    );
  }

  /** How long the probe has been hearing the compass, so its offset is a median. */
  private _probeCompassMs(): number {
    const span = this._probeCompass;
    return span === null ? 0 : span.last - span.first;
  }

  /** Where the person stands and faces, while walking. */
  person(): RecordingPerson | null {
    const pose = this._lastAligned;
    if (this._phase !== 'walking' || pose === null || !pose.tracked) {
      return null;
    }
    const at = mapPoint(pose);
    return { x: at.x, y: at.y, heading: cameraHeading(pose) };
  }

  /**
   * Where the phone points next to the way the person walks, for the mark sheet's
   * "Now pointing at the shelf on your left": null until they walked a metre.
   */
  pointing(): RecordingPointing | null {
    const pose = this._lastAligned;
    const last = this._recent[this._recent.length - 1];
    const from = this._recent.find(
      (one) =>
        last !== undefined && Math.hypot(last.x - one.x, last.y - one.y) >= 1
    );
    if (this._phase !== 'walking' || pose === null || !last || !from) {
      return null;
    }
    // Heading h points along (-sin h, cos h).
    const walking =
      (Math.atan2(-(last.x - from.x), last.y - from.y) * 180) / Math.PI;
    const turn = normalizeDegrees(cameraHeading(pose) - walking);
    if (turn <= 45 || turn >= 315) {
      return 'ahead';
    }
    if (turn >= 135 && turn <= 225) {
      return 'behind';
    }
    return turn < 180 ? 'right' : 'left';
  }

  /** The purple path, as `[x, y]` metres, while an automatic resume waits. */
  purple(): [number, number][] {
    return this._purple.map(([, x, y]) => [x, y]);
  }

  /** The first session of a walk with nothing recorded: the camera's frame is the walk's. */
  beginFirst(): void {
    this._begin('started', null, createTrackingGuard());
  }

  /** Feed the tracking probe of a manual resume from now on (target 7). */
  startProbe(): void {
    this._probe = createTrackingGuard();
    this._probeCompass = null;
  }

  /**
   * A manual resume at a mark the person stands next to, facing the way its arrow
   * shows (target 7): the new session is turned by the compass (`alignSession`
   * with the walk's baseline), or by the direction the phone points when the
   * baseline or the compass is unknown, and placed half a metre behind the mark.
   * Answers false when no tracked pose has arrived yet.
   */
  resumeAt(mark: Pick<MapMark, 'x' | 'y' | 'heading'>): boolean {
    const raw = this._lastRaw;
    if (raw === null || !raw.tracked) {
      return false;
    }
    // A resume always follows a stop.
    this.endSession();
    const offset = this._probe?.state().offset;
    const standingAt = mapPoint(raw);
    let baseline = this._baseline;
    if (baseline === null || offset === undefined) {
      // Line up by pointing: the phone faces the mark's heading now.
      const rotation = mark.heading - cameraHeading(raw);
      baseline = (offset ?? 0) - rotation;
      if (offset !== undefined && this._baseline === null) {
        this._baseline = normalizeDegrees(baseline);
        this._output.baseline(this._baseline);
      }
    }
    const transform = alignSession({
      mark,
      standingAt,
      compassOffset: offset ?? 0,
      baseline,
    });
    const guard = createTrackingGuard(
      offset !== undefined ? { baseline: normalizeDegrees(baseline) } : {}
    );
    this._probe = null;
    this._begin('resumed', transform, guard);
    return true;
  }

  /** One camera frame. */
  pose(raw: WalkPoseReading): void {
    this._lastT = raw.t;
    this._lastRaw = raw.tracked ? raw : null;
    this._probe?.pushPose(sampleOf(raw));
    const guard = this._guard;
    if (guard === null || this._phase === 'idle' || this._phase === 'stopped') {
      return;
    }
    // A camera takes some seconds to find its place after it opens, and until
    // then every pose is untracked. That is a session that has not started, not
    // a loss: the guard would stop the walk after three seconds of it, with no
    // mark to resume from. The session starts at its first tracked pose.
    if (this._sessionStart === null && !raw.tracked) {
      return;
    }

    const aligned =
      this._transform !== null && raw.tracked
        ? alignPose(this._transform, sampleOf(raw))
        : sampleOf(raw);
    this._sessionStart ??= raw.t;
    this._handle(guard.pushPose(aligned));
    if (this._guard !== guard || !aligned.tracked) {
      return;
    }
    this._lastAligned = aligned;

    const logMs = this._log(raw.t);
    const at = mapPoint(aligned);
    const state = guard.state();
    if (state.kind === 'good') {
      this._live.push({ logMs, x: at.x, y: at.y });
    }
    const point: PathPoint = { t: logMs, x: at.x, y: at.y };
    if (!keepPathPoint(this._lastKept, point, state)) {
      return;
    }
    this._lastKept = point;
    if (this._first === null) {
      this._first = point;
    } else if (
      !this._moved &&
      Math.hypot(point.x - this._first.x, point.y - this._first.y) >=
        SESSION_MOVED_METRES
    ) {
      this._moved = true;
    }
    this._recent = [...this._recent, point].filter(
      (one) => Math.hypot(point.x - one.x, point.y - one.y) <= 3
    );
    const row: [number, number, number] = [logMs, round2(at.x), round2(at.y)];
    if (state.kind === 'good') {
      this._pending.push(row);
    } else {
      this._purple.push(row);
    }
  }

  /** One compass reading. */
  compass(reading: WalkCompassReading): void {
    if (this._probe !== null) {
      this._probe.pushCompass(reading);
      this._probeCompass = {
        first: this._probeCompass?.first ?? reading.t,
        last: reading.t,
      };
    }
    if (this._guard !== null && this._phase !== 'stopped') {
      this._handle(this._guard.pushCompass(reading));
    }
  }

  /**
   * What the canvas draws, and the events the log keeps since the last call:
   * the kept path points first, then what the live map made. The page calls it
   * at most ten times a second with `force` false, so path points wait for a
   * few more; every other caller takes them all.
   */
  flush(force = true): LiveSnapshot {
    const snapshot = this._live.snapshot();
    const events: WalkEvent[] = [];
    // Path points go out a few at a time, so an entry holds a handful of path
    // events rather than one per point; anything else, and every stop, takes
    // them along at once.
    //
    // Until the session has moved a step its points are held: they say where
    // somebody stands, not where they walked. A mark, an event of the live map
    // or an edit on the page opens the session's entry, and they go with it.
    const held =
      !this._moved && snapshot.events.length === 0 && !this._sessionOpened();
    const due =
      !held &&
      (force ||
        snapshot.events.length > 0 ||
        this._pending.length >= PATH_BATCH_POINTS);
    if (due && this._pending.length > 0) {
      events.push({ type: 'path', points: this._pending });
      this._pending = [];
    }
    events.push(...snapshot.events);
    if (events.length > 0) {
      // While a loss waits for an answer the log stays at the loss: the time
      // walked since belongs to the purple path, which is not saved yet.
      const logTo =
        this._phase === 'walking' || this._lossLog === null
          ? this._lastLog
          : this._lossLog;
      this._output.add(events, logTo);
      this._wrote = true;
    }
    return snapshot;
  }

  /** A mark, where the phone is and the way it points at this moment (target 3). */
  mark(kind: MarkKind, text: string): MapMark | null {
    const pose = this._lastAligned;
    if (this._phase !== 'walking' || pose === null) {
      return null;
    }
    const at = mapPoint(pose);
    const mark: MapMark = {
      id: this._createId(),
      kind,
      x: round2(at.x),
      y: round2(at.y),
      heading: Math.round(cameraHeading(pose) * 100) / 100,
      text,
      logMs: this._lastLog,
    };
    this._live.mark(mark);
    return mark;
  }

  /** "Section left" (target 4). */
  sectionLeft(): void {
    this._live.sectionLeft();
  }

  /** "Fill as shelf". The area comes out of the next `flush`. */
  acceptSuggestion(id: string): void {
    this._live.acceptSuggestion(id);
  }

  /** "Not a shelf". */
  dismissSuggestion(id: string): void {
    this._live.dismissSuggestion(id);
  }

  /** "Yes, keep it": the purple path joins the walk (target 7). */
  confirm(): void {
    const guard = this._guard;
    if (this._phase !== 'unconfirmed' || guard === null) {
      return;
    }
    this._handle(guard.confirm(this._lastT));
    this._live.setTracking('good');
    const purple = this._purple;
    this._purple = [];
    for (const [logMs, x, y] of purple) {
      this._live.push({ logMs, x, y });
    }
    this._pending.push(...purple);
    this._lossLog = null;
    this._phase = 'walking';
    this.flush();
    this._output.push({ kind: 'confirmed' });
    this._output.openNext('resumed');
    // The next session's polyline starts where the purple path ended.
    const last = purple[purple.length - 1];
    if (last !== undefined) {
      this._pending.push([...last]);
    }
  }

  /** "No, stop here": the walk ends up to the problem (target 7). */
  discard(): void {
    const guard = this._guard;
    if (this._phase !== 'unconfirmed' || guard === null) {
      return;
    }
    guard.discard(this._lastT);
    this._purple = [];
    this.flush();
    const at = this._lossLog ?? this._lastLog;
    this._end([
      { kind: 'stopped', reason: 'tracking-lost', logTo: at },
      { kind: 'discarded', logTo: at },
    ]);
    this._stopped('discarded');
  }

  /**
   * Ends what is left of the session before a manual resume, so the new session
   * always follows a `stopped` entry: a loss still waiting stops at the loss, an
   * unconfirmed path is discarded as "No, stop here" would, and walking stops as
   * Stop would. Nothing when the walk is already stopped or never started.
   */
  endSession(): void {
    switch (this._phase) {
      case 'walking':
        this.stopWalk('button');
        break;
      case 'unconfirmed':
        this.discard();
        break;
      case 'lost': {
        this.flush();
        const at = this._lossLog ?? this._lastLog;
        this._end([{ kind: 'stopped', reason: 'tracking-lost', logTo: at }]);
        this._stopped('tracking-lost');
        break;
      }
      default:
        break;
    }
  }

  /** Stop, or leaving the page (target 6). Nothing of an unconfirmed path is kept. */
  stopWalk(reason: 'button' | 'left-page'): void {
    if (this._phase === 'idle' || this._phase === 'stopped') {
      return;
    }
    const waiting = this._phase === 'unconfirmed' || this._phase === 'lost';
    this._purple = [];
    this.flush();
    const at =
      waiting && this._lossLog !== null ? this._lossLog : this._lastLog;
    this._end([{ kind: 'stopped', reason, logTo: at }]);
    this._stopped(reason);
  }

  /** Whether the entry that opens this session went out or is queued. */
  private _sessionOpened(): boolean {
    return this._wrote || this._output.sessionOpened();
  }

  /**
   * The entries that end a session. They go out only when the entry that opened
   * the session did: a session that added nothing leaves no entry at all.
   */
  private _end(drafts: readonly WalkEntryDraft[]): void {
    if (!this._sessionOpened()) {
      return;
    }
    for (const draft of drafts) {
      this._output.push(draft);
    }
  }

  private _begin(
    kind: 'started' | 'resumed',
    transform: RigidTransform | null,
    guard: TrackingGuard
  ): void {
    this._guard = guard;
    this._transform = transform;
    this._sessionStart = null;
    this._logBase = this._output.logEnd();
    this._lastLog = this._logBase;
    this._lastKept = null;
    this._recent = [];
    this._lastAligned = null;
    this._pending = [];
    this._first = null;
    this._moved = false;
    this._wrote = false;
    this._purple = [];
    this._lossLog = null;
    this._stop = null;
    this._output.openNext(kind);
    this._live.setTracking('good');
    this._phase = 'walking';
  }

  private _log(t: number): number {
    const log = Math.round(this._logBase + (t - (this._sessionStart ?? t)));
    this._lastLog = Math.max(this._lastLog, log);
    return this._lastLog;
  }

  private _handle(events: readonly TrackingEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'lost':
          if (this._phase === 'walking') {
            this._lossLog = this._log(event.t);
            this.flush();
            this._output.save();
            this._output.tone('stopped');
          }
          this._live.setTracking('lost');
          this._phase = 'lost';
          break;
        case 'suspect':
          this._live.setTracking('suspect');
          if (event.cause === 'returned' && event.automaticResume) {
            this._phase = 'unconfirmed';
            this._output.tone('resumed');
          }
          break;
        case 'stopped': {
          if (event.unconfirmedDropped) {
            this._purple = [];
          }
          const played = this._phase === 'lost';
          this.flush();
          const at =
            this._lossLog !== null &&
            (event.reason === 'tracking-lost' || event.unconfirmedDropped)
              ? this._lossLog
              : this._log(event.t);
          this._end([{ kind: 'stopped', reason: event.reason, logTo: at }]);
          if (!played) {
            this._output.tone('stopped');
          }
          this._stopped(event.reason);
          break;
        }
        case 'baseline':
          if (this._baseline === null) {
            this._baseline = event.degrees;
            this._output.baseline(event.degrees);
          }
          break;
        default:
          break;
      }
    }
  }

  private _stopped(reason: RecordingStop): void {
    this._guard = null;
    this._transform = null;
    this._lossLog = null;
    this._purple = [];
    this._pending = [];
    this._live.setTracking('lost');
    this._stop = reason;
    this._phase = 'stopped';
    // No session waits to open any more: an edit made now is not a resume.
    this._output.forgetNext();
    this._output.save();
  }
}

function sampleOf(reading: WalkPoseReading): PoseSample {
  return {
    t: reading.t,
    x: reading.x,
    y: reading.y,
    z: reading.z,
    qx: reading.qx,
    qy: reading.qy,
    qz: reading.qz,
    qw: reading.qw,
    tracked: reading.tracked,
  };
}

function round2(value: number): number {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r;
}

function normalizeDegrees(degrees: number): number {
  const r = degrees % 360;
  return r < 0 ? r + 360 : r;
}
