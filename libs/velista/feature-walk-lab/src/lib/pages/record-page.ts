import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  createTrackEngine,
  type ModeId,
  type TrackEngine,
  type TrackPoint,
  type WalkFile,
  type WalkMark,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { APP_VERSION } from '@portfolio/velista/models';
import { ReloadBlocker, watchKeyboardInset } from '@portfolio/velista/platform';
import { replayRows } from '../capture/replay';
import { WalkCapture, type StopReason } from '../capture/walk-capture';
import { formatDuration, formatMetres } from '../format';
import { WalkFiles } from '../storage/walk-files';
import { modeStyle } from '../viewer/mode-style';
import { WalkPlot, type PlotLine, type PlotMark } from '../viewer/walk-plot';
import { WalkLabState } from '../walk-lab-state';

type Phase = 'setup' | 'recording' | 'stopped';
type Panel = 'checkpoint' | 'note' | null;

/** The modes the live track can follow. `vio` only with the camera on. */
const LIVE_MODES: readonly ModeId[] = [
  'pdr:own:gyro:snap',
  'pdr:own:gyro',
  'pdr:own:game:snap',
  'pdr:own:absolute:snap',
];

/** How often the live track and the clock are redrawn. */
const REDRAW_MS = 500;

/** How long Finish waits for its second tap. */
const FINISH_CONFIRM_MS = 4_000;

/**
 * The recording screen (recorder plan 0002, section 7.2).
 *
 * Before Start: a name, how the phone is held, the step length, camera tracking where
 * WebXR offers it, and which mode the live track follows. After Start: the time, the
 * step count, the live track, big buttons for the four marks, and Finish.
 *
 * Every browser API is behind `WalkCapture`; this component only lays it out. It
 * holds a `ReloadBlocker` while recording, so neither a new build nor the connection
 * coming back reloads the page halfway through a walk, and leaving the screen by any
 * route ends the recording and keeps it.
 */
@Component({
  selector: 'lib-record-page',
  imports: [RokuTranslatorPipe, RouterLink, WalkPlot],
  templateUrl: './record-page.html',
  styleUrl: './record-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPage {
  private readonly _capture = inject(WalkCapture);
  private readonly _files = inject(WalkFiles);
  private readonly _state = inject(WalkLabState);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _reload = inject(ReloadBlocker);
  private readonly _version = inject(APP_VERSION);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _document = inject(DOCUMENT);

  private readonly _root = viewChild<ElementRef<HTMLElement>>('root');

  // The form.
  readonly name = signal('');
  readonly holding = signal<'flat' | 'upright'>('flat');
  readonly stepMetres = signal(0.7);
  readonly camera = signal(false);
  readonly cameraSupported = signal(false);
  readonly liveMode = signal<ModeId>('pdr:own:gyro:snap');

  readonly liveModes = computed(() =>
    this.camera() ? [...LIVE_MODES, 'vio'] : LIVE_MODES
  );

  // The recording.
  readonly phase = signal<Phase>('setup');
  readonly elapsed = signal(0);
  readonly steps = signal(0);
  readonly distance = signal(0);
  readonly liveAvailable = signal(true);
  readonly marks = signal<WalkMark[]>([]);
  readonly panel = signal<Panel>(null);
  readonly draft = signal('');
  /** How far the visual viewport's bottom is above the layout viewport's, in pixels. */
  readonly panelInset = signal(0);
  /** The visual viewport's height while the panel is open, in pixels. */
  readonly panelMaxHeight = signal<number | null>(null);
  readonly lastMark = signal<WalkMark | null>(null);
  readonly finishArmed = signal(false);
  readonly stopReason = signal<StopReason | null>(null);
  readonly stoppedWalk = signal<WalkFile | null>(null);
  readonly saveFailed = signal(false);
  readonly busy = signal(false);

  readonly status = this._capture.status;
  readonly cameraState = this._capture.camera;

  private readonly _points = signal<readonly TrackPoint[]>([]);

  readonly lines = computed<PlotLine[]>(() => [
    {
      id: this.liveMode(),
      points: this._points(),
      style: modeStyle(this.liveMode()),
    },
  ]);

  /** The marks on the live track, each at the last point at or before it. */
  readonly plotMarks = computed<PlotMark[]>(() => {
    const points = this._points();
    if (points.length === 0) {
      return [];
    }
    return this.marks().map((mark) => {
      const at = lastAtOrBefore(points, mark.t);
      return { x: at.x, y: at.y, kind: mark.kind, label: mark.label };
    });
  });

  /** Checkpoint names already used in this walk, most recent first, each once. */
  readonly usedLabels = computed(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const mark of [...this.marks()].reverse()) {
      if (mark.kind === 'checkpoint' && mark.label && !seen.has(mark.label)) {
        seen.add(mark.label);
        out.push(mark.label);
      }
    }
    return out;
  });

  readonly elapsedText = computed(() => formatDuration(this.elapsed()));
  readonly distanceText = computed(() =>
    formatMetres(this.distance(), this._locale())
  );

  readonly savedAgo = computed(() => {
    const saved = this.status().savedAt;
    return saved === null
      ? null
      : Math.max(0, Math.round((this.elapsed() - saved) / 1000));
  });

  private _engine: TrackEngine | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _finishTimer: ReturnType<typeof setTimeout> | null = null;
  private _releaseReload: (() => void) | null = null;
  private _unwatch: (() => void) | null = null;
  private _pendingT = 0;

  constructor() {
    void this._capture
      .cameraSupported()
      .then((yes) => this.cameraSupported.set(yes));

    inject(DestroyRef).onDestroy(() => {
      this._stopTimers();
      this._unwatchViewport();
      if (this._capture.recording()) {
        // Leaving by the back button or a link: the walk is kept, not lost.
        void this._capture.stop('left').then(() => this._releaseReload?.());
        this._state.notice.set('walkLab.record.stopped.left');
      } else {
        this._releaseReload?.();
      }
    });
  }

  markTime(mark: WalkMark): string {
    return formatDuration(mark.t);
  }

  setName(value: string): void {
    this.name.set(value);
  }

  setStep(value: string): void {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0.2 && parsed < 1.5) {
      this.stepMetres.set(parsed);
    }
  }

  toggleCamera(): void {
    this.camera.update((on) => !on);
    if (!this.camera() && this.liveMode() === 'vio') {
      this.liveMode.set(LIVE_MODES[0]);
    }
  }

  /**
   * Start, straight from the tap. `WalkCapture.start` asks for the motion permission
   * and the camera session before it awaits anything, so the tap's activation reaches
   * both.
   */
  start(): void {
    if (this.phase() !== 'setup') {
      return;
    }

    const settings = {
      name: this.name().trim() || undefined,
      holding: this.holding(),
      stepMetres: this.stepMetres(),
      cellMetres: 0.5,
      appVersion: this._version,
      camera: this.camera() && this.cameraSupported(),
      overlayRoot: this._root()?.nativeElement ?? null,
    };

    this._engine = this._makeEngine(this.liveMode(), {
      settings: {
        stepMetres: settings.stepMetres,
        cellMetres: settings.cellMetres,
      },
    });
    this._releaseReload = this._reload.block();
    this.phase.set('recording');

    const started = this._capture.start(settings, {
      row: (stream, row) => {
        if (!this._engine) {
          return;
        }
        try {
          this._engine.push(stream, row);
        } catch {
          this._engine = null;
          this.liveAvailable.set(false);
        }
      },
      stopped: (reason, walk) => this._stopped(reason, walk),
    });

    // Not awaited: the camera session can sit behind a permission prompt for as long
    // as the person leaves it, and every control of the recording works meanwhile.
    void started.catch(() => undefined);
    this._timer = setInterval(() => this._redraw(), REDRAW_MS);
  }

  /** Switch the live track, replaying the walk so far into the new mode. */
  chooseLive(mode: ModeId): void {
    this.liveMode.set(mode);
    if (this.phase() !== 'recording') {
      return;
    }

    const walk = this._capture.snapshot();
    if (!walk) {
      return;
    }
    const engine = this._makeEngine(mode, walk);
    if (engine) {
      try {
        replayRows(walk, (stream, row) => engine.push(stream, row));
      } catch {
        this.liveAvailable.set(false);
        this._engine = null;
        return;
      }
    }
    this._engine = engine;
    this._redraw();
  }

  markNow(kind: 'entrance' | 'checkout'): void {
    const mark = this._capture.mark(kind);
    this._marked(mark);
  }

  /** Checkpoint and Note open a name field; the mark's moment is this tap. */
  openPanel(kind: 'checkpoint' | 'note'): void {
    this._pendingT = this._capture.now();
    this.draft.set('');
    this._setPanel(kind);
  }

  closePanel(): void {
    this._setPanel(null);
  }

  saveLabel(label?: string): void {
    const kind = this.panel();
    const text = (label ?? this.draft()).trim();
    if (!kind || !text) {
      return;
    }
    const mark = this._capture.mark(kind, text, this._pendingT);
    this._setPanel(null);
    this._marked(mark);
  }

  /**
   * Takes back the most recent mark, with no question: one tap undoes one wrong tap,
   * and the status line then names the mark before it.
   */
  deleteLastMark(): void {
    const left = this._capture.deleteLastMark();
    if (!left) {
      return;
    }
    this.marks.set(left);
    this.lastMark.set(left[left.length - 1] ?? null);
    this._capture.buzz();
  }

  /** Finish takes two taps, four seconds apart at most, so a pocket cannot end a walk. */
  async finish(): Promise<void> {
    if (!this.finishArmed()) {
      this.finishArmed.set(true);
      this._finishTimer = setTimeout(
        () => this.finishArmed.set(false),
        FINISH_CONFIRM_MS
      );
      return;
    }

    this.finishArmed.set(false);
    this._stopTimers();
    this.busy.set(true);
    const walk = await this._capture.stop('finished');
    this._releaseReload?.();
    this._releaseReload = null;
    this.busy.set(false);

    if (!walk) {
      return;
    }
    if (this._capture.saveFailed()) {
      this._showStopped('finished', walk, true);
      return;
    }
    await this._router.navigate(['..', walk.id], {
      relativeTo: this._route,
      replaceUrl: true,
    });
  }

  /** The one copy left when storage refused the walk. */
  downloadStopped(): void {
    const walk = this.stoppedWalk();
    if (walk) {
      this._files.download(
        `walk-${walk.id}.json`,
        JSON.stringify(walk),
        'application/json'
      );
    }
  }

  async openStopped(): Promise<void> {
    const walk = this.stoppedWalk();
    if (walk) {
      await this._router.navigate(['..', walk.id], { relativeTo: this._route });
    }
  }

  private _stopped(reason: StopReason, walk: WalkFile): void {
    this._stopTimers();
    this._releaseReload?.();
    this._releaseReload = null;
    this._showStopped(reason, walk, this._capture.saveFailed());
  }

  private _showStopped(
    reason: StopReason,
    walk: WalkFile,
    failed: boolean
  ): void {
    this.stopReason.set(reason);
    this.stoppedWalk.set(walk);
    this.saveFailed.set(failed);
    this.elapsed.set(walk.durationMs);
    this._setPanel(null);
    this.phase.set('stopped');
  }

  private _marked(mark: WalkMark | null): void {
    if (!mark) {
      return;
    }
    this.marks.update((list) => [...list, mark]);
    this.lastMark.set(mark);
    this._capture.buzz();
  }

  private _setPanel(kind: Panel): void {
    this.panel.set(kind);
    if (kind) {
      this._watchViewport();
    } else {
      this._unwatchViewport();
    }
  }

  /**
   * Keeps the open panel against the bottom of the visual viewport, which is the
   * height the on screen keyboard leaves. The page cannot scroll (inside WebXR's DOM
   * overlay nothing does), so a panel drawn in the flow would sit under the keyboard
   * with its Save button out of reach. Chrome for Android reports the keyboard
   * through `visualViewport` in the overlay too. Without `visualViewport` the panel
   * stays at the bottom of the layout viewport. It uses platform's
   * `watchKeyboardInset`, which the recording screen uses too.
   */
  private _watchViewport(): void {
    this._unwatchViewport();
    const win = this._document.defaultView;
    if (!win?.visualViewport) {
      return;
    }
    this._unwatch = watchKeyboardInset(win, (inset) => {
      this.panelInset.set(inset.bottom);
      this.panelMaxHeight.set(inset.height);
    });
  }

  private _unwatchViewport(): void {
    this._unwatch?.();
    this._unwatch = null;
    this.panelInset.set(0);
    this.panelMaxHeight.set(null);
  }

  private _makeEngine(
    mode: ModeId,
    walk: Pick<WalkFile, 'settings' | 'origin'>
  ): TrackEngine | null {
    try {
      const engine = createTrackEngine(mode, {
        settings: walk.settings,
        origin: walk.origin,
      });
      this.liveAvailable.set(true);
      return engine;
    } catch {
      this.liveAvailable.set(false);
      return null;
    }
  }

  private _redraw(): void {
    this.elapsed.set(this._capture.now());
    if (!this._engine) {
      return;
    }
    try {
      const track = this._engine.track();
      this._points.set(track.points);
      this.steps.set(track.steps);
      this.distance.set(track.distanceMetres);
    } catch {
      this._engine = null;
      this.liveAvailable.set(false);
    }
  }

  private _stopTimers(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._finishTimer !== null) {
      clearTimeout(this._finishTimer);
      this._finishTimer = null;
    }
  }
}

function lastAtOrBefore(points: readonly TrackPoint[], t: number): TrackPoint {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return points[lo];
}
