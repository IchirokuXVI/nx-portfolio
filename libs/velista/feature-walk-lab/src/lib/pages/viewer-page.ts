import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  availableModes,
  computeTrack,
  positionAt,
  trackMetrics,
  type ModeId,
  type StreamName,
  type Track,
  type TrackMetrics,
  type TrackOptions,
  type WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { formatDuration, formatMetres, formatStarted } from '../format';
import { WalkDb } from '../storage/walk-db';
import { WalkFiles, type ShareOutcome } from '../storage/walk-files';
import {
  computeTracksInTurns,
  type ComputedTrack,
} from '../viewer/compute-tracks';
import { draftRects } from '../viewer/draft-layer';
import { exportWalk, pickMode } from '../viewer/export';
import {
  isSnapMode,
  modeStyle,
  sortModes,
  type ModeStyle,
} from '../viewer/mode-style';
import {
  WalkPlot,
  type PlotLine,
  type PlotMark,
  type PlotRect,
} from '../viewer/walk-plot';
import { WalkLabState } from '../walk-lab-state';

type Load = 'loading' | 'ready' | 'missing';

/** One row of the legend and of the metrics table. */
interface ModeRow {
  mode: ModeId;
  style: ModeStyle;
  visible: boolean;
  state: 'pending' | 'ready' | 'failed';
  error?: string;
  ms?: number;
  metrics: TrackMetrics | null;
}

/** How long the step controls wait for the typing to stop before recomputing. */
const RECOMPUTE_AFTER_MS = 350;

/** Streams listed in the details, in the file's order. */
const STREAMS: readonly StreamName[] = [
  'motion',
  'game',
  'absolute',
  'magnetic',
  'steps',
  'location',
  'pose',
  'pressure',
];

/**
 * The viewer (recorder plan 0002, section 7.3): every available mode drawn over a
 * grid of `cellMetres` in its own colour, a legend that turns each on and off, the
 * marks, the metrics of section 6, the step controls of 5.5 that recompute every
 * track, and the draft map of recorder plan 0001 over the selected snap mode.
 *
 * Tracks are computed one mode per turn of the event loop (`computeTracksInTurns`),
 * so a long walk draws mode by mode instead of freezing the page, and the time each
 * mode took is shown beside its metrics.
 *
 * Also opens a tracks only import, which has no recording behind it: drawn, measured
 * from the lines alone, and not exportable.
 */
@Component({
  selector: 'lib-viewer-page',
  imports: [RokuTranslatorPipe, RouterLink, WalkPlot],
  templateUrl: './viewer-page.html',
  styleUrl: './viewer-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerPage {
  private readonly _db = inject(WalkDb);
  private readonly _files = inject(WalkFiles);
  private readonly _state = inject(WalkLabState);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly load = signal<Load>('loading');
  readonly walk = signal<WalkFile | null>(null);
  readonly importedName = signal<string | null>(null);

  readonly stepModel = signal<'fixed' | 'weinberg'>('fixed');
  readonly stepMetres = signal(0.7);
  readonly weinbergK = signal(0.48);

  readonly modes = signal<ModeId[]>([]);
  readonly hidden = signal<ReadonlySet<ModeId>>(new Set());
  readonly selected = signal<ModeId | null>(null);
  readonly showDraft = signal(true);
  readonly tracks = signal<ReadonlyMap<ModeId, ComputedTrack>>(new Map());
  readonly computing = signal(false);
  readonly done = signal(0);
  readonly shareResult = signal<ShareOutcome | null>(null);
  readonly canShare = signal(false);

  readonly cellMetres = computed(() => this.walk()?.settings.cellMetres ?? 0.5);

  readonly title = computed(
    () => this.walk()?.name || this.importedName() || ''
  );

  readonly subtitle = computed(() => {
    const walk = this.walk();
    if (!walk) {
      return '';
    }
    return `${formatStarted(walk.startedAt, this._locale())} · ${formatDuration(walk.durationMs)}`;
  });

  readonly progress = computed(() => ({
    done: this.done(),
    total: this.modes().length,
  }));

  readonly totalMs = computed(() => {
    let sum = 0;
    for (const result of this.tracks().values()) {
      sum += result.ms;
    }
    return Math.round(sum);
  });

  readonly rows = computed<ModeRow[]>(() => {
    const walk = this.walk();
    const tracks = this.tracks();
    const hidden = this.hidden();

    return this.modes().map((mode) => {
      const result = tracks.get(mode);
      let metrics: TrackMetrics | null = null;
      if (result?.track) {
        metrics = walk
          ? safeMetrics(walk, result.track)
          : metricsOfLine(result.track);
      }
      return {
        mode,
        style: modeStyle(mode),
        visible: !hidden.has(mode),
        state: !result ? 'pending' : result.track ? 'ready' : 'failed',
        error: result?.error,
        ms: result ? Math.round(result.ms) : undefined,
        metrics,
      };
    });
  });

  /** Every checkpoint label marked more than once, the columns of the error table. */
  readonly checkpointLabels = computed(() => {
    const counts = new Map<string, number>();
    for (const mark of this.walk()?.marks ?? []) {
      if (mark.kind === 'checkpoint') {
        const label = mark.label ?? '';
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts].filter(([, n]) => n > 1).map(([label]) => label);
  });

  readonly lines = computed<PlotLine[]>(() => {
    const out: PlotLine[] = [];
    const tracks = this.tracks();
    const hidden = this.hidden();
    // Drawn in reverse legend order, so the camera track ends up on top.
    for (const mode of [...this.modes()].reverse()) {
      const track = tracks.get(mode)?.track;
      if (track && !hidden.has(mode)) {
        out.push({ id: mode, points: track.points, style: modeStyle(mode) });
      }
    }
    return out;
  });

  readonly marks = computed<PlotMark[]>(() => {
    const walk = this.walk();
    const mode = this.selected();
    const track = mode ? this.tracks().get(mode)?.track : null;
    if (!walk || !track) {
      return [];
    }
    return walk.marks.map((mark) => {
      const at = positionAt(track, mark.t);
      return { x: at.x, y: at.y, kind: mark.kind, label: mark.label };
    });
  });

  readonly draftNeedsSnap = computed(() => {
    const mode = this.selected();
    return mode !== null && !isSnapMode(mode);
  });

  readonly rects = computed<PlotRect[]>(() => {
    const walk = this.walk();
    const mode = this.selected();
    if (!walk || !mode || !this.showDraft() || !isSnapMode(mode)) {
      return [];
    }
    const track = this.tracks().get(mode)?.track;
    return track ? draftRects(walk, track) : [];
  });

  readonly streams = computed(() => {
    const walk = this.walk();
    if (!walk) {
      return [];
    }
    return STREAMS.map((name) => ({
      name,
      rows: (walk.streams[name] as unknown[] | undefined)?.length ?? 0,
    })).filter((s) => s.rows > 0);
  });

  private _generation = 0;
  private _recomputeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._generation++;
      if (this._recomputeTimer !== null) {
        clearTimeout(this._recomputeTimer);
      }
    });
    void this._load();
  }

  metres(value: number | undefined): string {
    return value === undefined ? '' : formatMetres(value, this._locale());
  }

  checkpointError(row: ModeRow, label: string): string {
    const found = row.metrics?.checkpoints.find((c) => c.label === label);
    return found ? this.metres(found.errorMetres) : '';
  }

  toggle(mode: ModeId): void {
    this.hidden.update((set) => {
      const next = new Set(set);
      if (next.has(mode)) {
        next.delete(mode);
      } else {
        next.add(mode);
      }
      return next;
    });
  }

  showAll(visible: boolean): void {
    this.hidden.set(visible ? new Set() : new Set(this.modes()));
  }

  select(mode: string): void {
    this.selected.set(mode);
  }

  setStepModel(model: 'fixed' | 'weinberg'): void {
    this.stepModel.set(model);
    this._scheduleRecompute();
  }

  setStepMetres(value: string): void {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0.2 && parsed < 1.5) {
      this.stepMetres.set(parsed);
      this._scheduleRecompute();
    }
  }

  setWeinbergK(value: string): void {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0.1 && parsed < 1.5) {
      this.weinbergK.set(parsed);
      this._scheduleRecompute();
    }
  }

  download(): void {
    const file = this._export();
    if (file) {
      this._files.download(file.fileName, file.text);
    }
  }

  /** Share, with nothing awaited before the share sheet so the tap still counts. */
  async share(): Promise<void> {
    const file = this._export();
    if (!file) {
      return;
    }
    this.shareResult.set(await this._files.share(file.fileName, file.text));
  }

  private _export(): { fileName: string; text: string } | null {
    const walk = this.walk();
    if (!walk) {
      return null;
    }
    const tracks = [...this.tracks().values()]
      .map((r) => r.track)
      .filter((t): t is Track => t !== null);
    return exportWalk(walk, tracks, this.selected());
  }

  private async _load(): Promise<void> {
    if (this._route.snapshot.data['imported'] === true) {
      const imported = this._state.imported();
      if (!imported) {
        this.load.set('missing');
        return;
      }
      const results = new Map<ModeId, ComputedTrack>();
      const modes: ModeId[] = [];
      imported.tracks.forEach((track, i) => {
        // A plain GeoJSON may repeat a mode, or name none; each line stays its own row.
        const id =
          modes.includes(track.mode) || !track.mode
            ? `${track.mode || 'line'} ${i + 1}`
            : track.mode;
        modes.push(id);
        results.set(id, { mode: id, track: { ...track, mode: id }, ms: 0 });
      });
      this.importedName.set(imported.fileName);
      this.modes.set(modes);
      this.tracks.set(results);
      this.selected.set(modes[0] ?? null);
      this.load.set('ready');
      return;
    }

    const id = this._route.snapshot.paramMap.get('walkId') ?? '';
    const walk = await this._db.get(id);
    if (!walk) {
      this.load.set('missing');
      return;
    }

    const modes = sortModes(safeModes(walk));
    this.walk.set(walk);
    this.stepMetres.set(walk.settings.stepMetres);
    this.modes.set(modes);
    this.selected.set(pickMode(modes));
    this.canShare.set(this._files.canShare('walk.geojson'));
    this.load.set('ready');
    await this._compute();
  }

  private _scheduleRecompute(): void {
    if (this._recomputeTimer !== null) {
      clearTimeout(this._recomputeTimer);
    }
    this._recomputeTimer = setTimeout(() => {
      this._recomputeTimer = null;
      void this._compute();
    }, RECOMPUTE_AFTER_MS);
  }

  /**
   * Every mode again with the current step options. The old run is abandoned rather
   * than finished, and the old tracks stay drawn until each new one replaces them.
   */
  private async _compute(): Promise<void> {
    const walk = this.walk();
    if (!walk) {
      return;
    }

    const generation = ++this._generation;
    const options: TrackOptions = {
      stepModel: this.stepModel(),
      stepMetres: this.stepMetres(),
      weinbergK: this.weinbergK(),
    };
    const fresh = new Map<ModeId, ComputedTrack>();
    this.computing.set(true);
    this.done.set(0);

    await computeTracksInTurns(
      walk,
      this.modes(),
      options,
      (result) => {
        fresh.set(result.mode, result);
        this.done.set(fresh.size);
        // Merged over the previous run so nothing blinks out while it recomputes.
        this.tracks.update((old) => {
          const next = new Map(old);
          next.set(result.mode, result);
          return next;
        });
      },
      () => generation !== this._generation,
      computeTrack
    );

    if (generation === this._generation) {
      this.tracks.set(fresh);
      this.computing.set(false);
    }
  }
}

function safeModes(walk: WalkFile): ModeId[] {
  try {
    return availableModes(walk);
  } catch {
    return [];
  }
}

function safeMetrics(walk: WalkFile, track: Track): TrackMetrics | null {
  try {
    return trackMetrics(walk, track);
  } catch {
    return null;
  }
}

/** The metrics a line alone can answer, for a tracks only import. */
function metricsOfLine(track: Track): TrackMetrics {
  const first = track.points[0];
  const last = track.points[track.points.length - 1];
  return {
    steps: track.steps,
    turns: track.turns,
    distanceMetres: track.distanceMetres,
    endToStartMetres:
      first && last ? Math.hypot(last.x - first.x, last.y - first.y) : 0,
    checkpoints: [],
  };
}
