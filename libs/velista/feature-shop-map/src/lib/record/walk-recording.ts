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
  GYRO_HEARD_MS,
  keepPathPoint,
  mapPoint,
  TURN_NOW_MS,
  wrapDegrees,
  type PathPoint,
  type PoseSample,
  type RigidTransform,
  type TrackingEvent,
  type TrackingGuard,
} from '@portfolio/luna-shopper/shop-map/recorder';
import type {
  WalkEntryDraft,
  WalkGuardEvent,
} from '@portfolio/velista/data-access';
import type { ShopWalkEntryKind } from '@portfolio/velista/models';
import type {
  WalkCompassReading,
  WalkGyroReading,
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

/**
 * A resume is turned by the gyro only this soon after the stopped session's
 * last trusted gyro reading (velista `0136`, section 1). The gyro drifts about
 * 0.33 degrees a second (recorder plan 0005), so 120 s is 40 degrees at worst;
 * the stops of 2026-10-08 lasted 35 to 45 s.
 */
export const GYRO_RESUME_MAX_MS = 120_000;

/**
 * A resume by the compass needs it to agree with pointing this closely
 * (velista `0136`, section 1). A person facing the mark's arrow is seldom
 * 45 degrees wrong; a compass bent by a freezer is.
 */
export const COMPASS_RESUME_AGREES_DEGREES = 45;

/**
 * How long the gyro offsets of a session are kept, so a stop can reach back
 * past the last 2 s, which a frame that turned may already be in.
 */
const GYRO_SNAPSHOTS_MS = 5_000;

/** Which rule turned a resumed session (velista `0136`, section 1). */
export type ResumeRule = 'gyro' | 'compass' | 'pointing';

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
 *
 * A yes that comes before the guard judged the frame that came back
 * (`awaitingTurnJudgement`, recorder plan 0005) is held: the walk goes on, but
 * the purple points and those kept since stay unsaved until the guard has
 * judged it. A stop meanwhile drops them all and keeps the walk up to the
 * first loss of the resume (the recorder README's host contract). Marks and
 * "Section left" made meanwhile wait with them, in the order they came.
 *
 * ## What the guard saw (velista `0136`)
 *
 * Each loss, compass notice and settling goes into the open entry as a `guard`
 * event, and each guard stop's cause and number into its `stopped` entry. They
 * are held with the session's points, so a session that adds nothing still
 * sends nothing.
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
  /** The person said yes before the guard judged the frame: the purple points wait for it. */
  private _judging = false;
  /**
   * Marks and "Section left" made while a yes is held, each with how many
   * purple points came before it: they wait for the judgement with the points.
   */
  private _held: HeldEdit[] = [];
  /** `guard` events for the open entry, sent with the session's points. */
  private _guardEvents: WalkEvent[] = [];

  /** When the gyro was heard last, and since when without a gap of more than 1 s. */
  private _gyroLast: number | null = null;
  private _gyroSince: number | null = null;
  /** The session guard's gyro offset at its recent trusted poses. */
  private _gyroSnapshots: GyroSnapshot[] = [];
  /** The stopped session's gyro offset, for a resume by the gyro. */
  private _gyroAtStop: GyroSnapshot | null = null;
  private _resumedBy: ResumeRule | null = null;

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

  /** Which rule turned the last manual resume, for the spec (velista `0136`). */
  get resumedBy(): ResumeRule | null {
    return this._resumedBy;
  }

  /** Whether a manual resume can line up now: the camera is tracking. */
  get canResume(): boolean {
    return this._lastRaw !== null;
  }

  /**
   * Whether a manual resume can line up now: the camera is tracking, and either
   * the gyro can turn it (velista `0136`), or the walk's baseline is unknown, or
   * the probe has a compass offset to weigh against pointing. Without a
   * baseline there is nothing to wait for: it lines up by pointing.
   */
  get readyToResume(): boolean {
    const raw = this._lastRaw;
    return (
      this.canResume &&
      ((raw !== null && this._gyroRotation(raw.t) !== null) ||
        this._baseline === null ||
        (this._probe?.state().offset !== undefined &&
          this._probeCompassMs() >= PROBE_COMPASS_MS))
    );
  }

  /**
   * The rotation the gyro gives a new session at `now` (velista `0136`, section
   * 1, rule 1), or null when it cannot: no stop in this page visit with a gyro
   * offset, a gap of more than 1 s in the gyro since then, the stop 120 s ago or
   * more, or no gyro offset in the probe yet.
   *
   * The stopped session's offset was read from a guard fed aligned poses, so it
   * already holds that session's rotation (recorder `AlignSessionByRotation`):
   * the rotation is that offset minus the probe's.
   */
  private _gyroRotation(now: number): number | null {
    const atStop = this._gyroAtStop;
    const probe = this._probe?.state().gyroOffset;
    if (
      atStop === null ||
      probe === undefined ||
      this._gyroSince === null ||
      this._gyroLast === null ||
      this._gyroSince > atStop.t ||
      now - this._gyroLast > GYRO_HEARD_MS ||
      now - atStop.t >= GYRO_RESUME_MAX_MS
    ) {
      return null;
    }
    return normalizeDegrees(atStop.offset - probe);
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
   * shows (target 7), placed half a metre behind the mark. The new session is
   * turned in this order (velista `0136`, section 1):
   *
   * 1. by the gyro, when it was heard without a gap since a stop in this page
   *    visit less than 120 s ago;
   * 2. by the compass against the walk's baseline, when it agrees with pointing
   *    within 45 degrees;
   * 3. by pointing: the phone faces the mark's heading now.
   *
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
    const pointing = normalizeDegrees(mark.heading - cameraHeading(raw));
    const byGyro = this._gyroRotation(raw.t);
    let rotation = pointing;
    let rule: ResumeRule = 'pointing';
    if (byGyro !== null) {
      rotation = byGyro;
      rule = 'gyro';
    } else if (this._baseline !== null && offset !== undefined) {
      const byCompass = normalizeDegrees(offset - this._baseline);
      if (
        Math.abs(wrapDegrees(byCompass - pointing)) <=
        COMPASS_RESUME_AGREES_DEGREES
      ) {
        rotation = byCompass;
        rule = 'compass';
      }
    }
    if (offset !== undefined && this._baseline === null) {
      // The compass reading here, turned as the session is, is the walk's
      // baseline from now on.
      this._baseline = normalizeDegrees(offset - rotation);
      this._output.baseline(this._baseline);
    }
    const transform = alignSession({ mark, standingAt, rotation });
    // The walk's baseline whenever it has one: a resume by the gyro can go
    // before the probe heard the compass, and its guard still needs it.
    const guard = createTrackingGuard(
      this._baseline !== null ? { baseline: this._baseline } : {}
    );
    this._probe = null;
    this._resumedBy = rule;
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
    this._settleJudgement(guard);
    if (this._guard !== guard || !aligned.tracked) {
      return;
    }
    this._lastAligned = aligned;

    const logMs = this._log(raw.t);
    const at = mapPoint(aligned);
    const state = guard.state();
    // Good, and in a frame the guard has judged: the walk keeps it.
    const trusted = state.kind === 'good' && !this._judging;
    if (trusted && !state.awaitingTurnJudgement) {
      this._snapshotGyro(raw.t, state.gyroOffset);
    }
    if (trusted) {
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
    if (trusted) {
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
    const guard = this._guard;
    if (guard !== null && this._phase !== 'stopped') {
      this._handle(guard.pushCompass(reading));
      this._settleJudgement(guard);
    }
  }

  /**
   * One gyro reading (velista `0136`, target 1): to the guard, which tells a
   * frame that turned from a bent compass by it, and to the probe of a manual
   * resume, which turns the new session by it.
   */
  gyro(reading: WalkGyroReading): void {
    if (this._gyroLast === null || reading.t - this._gyroLast > GYRO_HEARD_MS) {
      this._gyroSince = reading.t;
    }
    this._gyroLast = Math.max(reading.t, this._gyroLast ?? reading.t);
    this._probe?.pushGyro(reading);
    const guard = this._guard;
    if (guard !== null && this._phase !== 'stopped') {
      this._handle(guard.pushGyro(reading));
      this._settleJudgement(guard);
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
        this._guardEvents.length > 0 ||
        this._pending.length >= PATH_BATCH_POINTS);
    if (due && this._pending.length > 0) {
      events.push({ type: 'path', points: this._pending });
      this._pending = [];
    }
    if (due && this._guardEvents.length > 0) {
      events.push(...this._guardEvents);
      this._guardEvents = [];
    }
    events.push(...snapshot.events);
    if (events.length > 0) {
      // While a loss waits for an answer the log stays at the loss: the time
      // walked since belongs to the purple path, which is not saved yet. That
      // holds after a yes too, until the guard has judged the frame.
      const logTo = this._lossLog === null ? this._lastLog : this._lossLog;
      this._output.add(events, logTo);
      this._wrote = true;
    }
    return snapshot;
  }

  /**
   * A mark, where the phone is and the way it points at this moment (target 3).
   * While a yes is held it waits with the purple points: the frame it was made
   * in may yet be judged turned (velista `0136`).
   */
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
    if (this._judging) {
      this._held.push({ after: this._purple.length, mark });
    } else {
      this._live.mark(mark);
    }
    return mark;
  }

  /** "Section left" (target 4). It waits with a held yes, as a mark does. */
  sectionLeft(): void {
    if (this._judging) {
      this._held.push({ after: this._purple.length, mark: null });
      return;
    }
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

  /**
   * "Yes, keep it": the purple path joins the walk (target 7). When the guard
   * has not judged the frame that came back yet, the walk goes on and the
   * purple points wait for its judgement (velista `0136`).
   */
  confirm(): void {
    const guard = this._guard;
    if (this._phase !== 'unconfirmed' || guard === null) {
      return;
    }
    this._handle(guard.confirm(this._lastT));
    if (this._guard !== guard) {
      return;
    }
    this._live.setTracking('good');
    this._phase = 'walking';
    if (guard.state().awaitingTurnJudgement) {
      this._judging = true;
      return;
    }
    this._keepPurple();
  }

  /** The purple path joins the session it belongs to, and the next entry is `resumed`. */
  private _keepPurple(): void {
    this._judging = false;
    const purple = this._purple;
    const held = this._held;
    this._purple = [];
    this._held = [];
    // The live map gets the points and the held edits in the order they came,
    // as it would have while walking.
    let next = 0;
    const editsUpTo = (count: number) => {
      for (; next < held.length && held[next].after <= count; next += 1) {
        const { mark } = held[next];
        if (mark === null) {
          this._live.sectionLeft();
        } else {
          this._live.mark(mark);
        }
      }
    };
    purple.forEach(([logMs, x, y], index) => {
      editsUpTo(index);
      this._live.push({ logMs, x, y });
    });
    editsUpTo(purple.length);
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
    this._held = [];
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
    const waiting =
      this._phase === 'unconfirmed' || this._phase === 'lost' || this._judging;
    this._purple = [];
    this._held = [];
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
    this._held = [];
    this._lossLog = null;
    this._judging = false;
    this._guardEvents = [];
    this._gyroSnapshots = [];
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
          this._guardEvents.push(guardEvent('lost', this._log(event.t)));
          if (this._phase === 'walking') {
            // A loss while a yes waits for the guard's judgement keeps the
            // first loss: nothing since it is vouched for (recorder README).
            this._lossLog ??= this._log(event.t);
            this._judging = false;
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
            // The marks made while the yes was held go with the points.
            this._purple = [];
            this._held = [];
          }
          const played = this._phase === 'lost';
          this.flush();
          const at =
            this._lossLog !== null &&
            (event.reason === 'tracking-lost' || event.unconfirmedDropped)
              ? this._lossLog
              : this._log(event.t);
          // The stop's cause and number, where the walk now ends.
          const why = guardEvent(event.cause, at, {
            degrees: event.degrees,
            metres: event.metres,
          });
          this._end([
            {
              kind: 'stopped',
              reason: event.reason,
              logTo: at,
              events: [why],
            },
          ]);
          if (!played) {
            this._output.tone('stopped');
          }
          this._stopped(event.reason);
          break;
        }
        case 'compass-disturbed':
        case 'compass-settled':
          // A notice and no more: the walk goes on (recorder plan 0005).
          this._guardEvents.push(
            guardEvent(event.kind, this._log(event.t), {
              degrees: event.drift,
            })
          );
          break;
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

  /**
   * After the guard's events: a yes held for the guard's judgement is kept
   * once the guard has judged the frame and the walk did not stop.
   */
  private _settleJudgement(guard: TrackingGuard): void {
    if (
      this._judging &&
      this._guard === guard &&
      this._phase === 'walking' &&
      !guard.state().awaitingTurnJudgement
    ) {
      this._keepPurple();
    }
  }

  /** Keeps the session guard's gyro offset at a trusted pose, for a later resume. */
  private _snapshotGyro(t: number, offset: number | undefined): void {
    if (offset === undefined) {
      return;
    }
    this._gyroSnapshots = this._gyroSnapshots.filter(
      (one) => one.t >= t - GYRO_SNAPSHOTS_MS
    );
    this._gyroSnapshots.push({ t, offset });
  }

  private _stopped(reason: RecordingStop): void {
    // The gyro offset a resume turns by: the last one read 2 s or more before
    // the stop, because the last 2 s may hold a frame that just turned.
    const before = this._lastT - TURN_NOW_MS;
    this._gyroAtStop =
      [...this._gyroSnapshots].reverse().find((one) => one.t <= before) ?? null;
    this._gyroSnapshots = [];
    this._judging = false;
    this._guardEvents = [];
    this._guard = null;
    this._transform = null;
    this._lossLog = null;
    this._purple = [];
    this._held = [];
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

/**
 * A mark (or "Section left", as null) made while a yes is held, after this
 * many of the purple points.
 */
interface HeldEdit {
  readonly after: number;
  readonly mark: MapMark | null;
}

/** A session guard's gyro offset (`state().gyroOffset`) at a camera time. */
interface GyroSnapshot {
  readonly t: number;
  readonly offset: number;
}

/**
 * One `guard` event of the walk log (backend `0197`): one kind, one time and
 * at most one number, never a raw reading. Degrees to a tenth, metres to a
 * centimetre.
 */
function guardEvent(
  what: WalkGuardEvent['what'],
  logMs: number,
  numbers: { degrees?: number; metres?: number } = {}
): WalkGuardEvent {
  return {
    type: 'guard',
    logMs,
    what,
    ...(numbers.degrees !== undefined
      ? { degrees: roundDegrees(numbers.degrees) }
      : {}),
    ...(numbers.metres !== undefined ? { metres: round2(numbers.metres) } : {}),
  };
}

/**
 * Degrees to a tenth, in (-180, 180]. Wrapped after rounding, so -179.96 is
 * 180, not -180.
 */
export function roundDegrees(degrees: number): number {
  const wrapped = wrapDegrees(Math.round(degrees * 10) / 10);
  const r = Math.round(wrapped * 10) / 10;
  return r === 0 ? 0 : r;
}

function round2(value: number): number {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r;
}

function normalizeDegrees(degrees: number): number {
  const r = degrees % 360;
  return r < 0 ? r + 360 : r;
}
