import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  canAbort,
  failureBlockReason,
  HARVEST_IMPORT,
  HARVEST_NEW_RUN,
  harvestRunPath,
  harvestRunsPath,
  runProgress,
  type HarvestRun,
  type InfoContent,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  BlockNotice,
  CautionLine,
  ConfirmDialog,
  HarvestNotice,
  InfoButton,
  RunProgressView,
  RunRowView,
  Viewport,
  type RunRow,
} from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { formatInstant } from './format-instant';
import { HarvestHeader } from './harvest-header';
import { HarvestShell } from './harvest-shell';
import { HarvestStatus } from './harvest-status';
import { ImportHandoff } from './import-handoff';
import { PresetsPanel } from './presets-panel';

/** The three answers to "has this run been reverted?", in the order shown. */
const REVERTED_OPTIONS = ['any', 'reverted', 'standing'] as const;
type RevertedFilter = (typeof REVERTED_OPTIONS)[number];

/**
 * The order the mode filter offers the run modes in: by how much each does.
 *
 * A record over the generated enum, so a new mode is a compile error here
 * rather than a filter that quietly cannot find it.
 */
const MODE_ORDER: Record<Wire.EnumsHarvestRunMode, number> = {
  STORE_DISCOVERY: 1,
  CATALOG_DISCOVERY: 2,
  FILE_IMPORT: 3,
};

const MODES: readonly Wire.EnumsHarvestRunMode[] = (
  Object.keys(MODE_ORDER) as Wire.EnumsHarvestRunMode[]
).sort((a, b) => MODE_ORDER[a] - MODE_ORDER[b]);

type ModeFilter = Wire.EnumsHarvestRunMode | '';

/**
 * How many pages of presets the screen reads for names and the filter.
 *
 * A preset is a run somebody saves by hand, so there are a few per chain. The
 * bound is there because an unbounded loop against a paging route is a hang.
 */
const MAX_PRESET_PAGES = 5;

/** What the runs list says about the preset a run came from. */
type RunPreset =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'deleted' }
  | null;

/** Whether runs may start, as the header says it. */
export type RunsState = 'on' | 'off' | 'unknown';

/** What the info button beside that state says (admin plan 0041, section 3). */
export const RUNS_STATE_INFO: InfoContent = {
  title: 'harvest.switch.heading',
  points: ['harvest.switch.info.both', 'harvest.switch.info.chain'],
};

/** What the info button of the import panel says. */
export const IMPORT_INFO: InfoContent = {
  title: 'harvest.imports.heading',
  points: ['harvest.imports.info.drop'],
  caution: 'harvest.imports.info.caution',
};

/**
 * Runs: what starts work and what follows it, on one tab (admin plan 0044,
 * target 5).
 *
 * Runs, presets and the file import were three screens. They are one kind of
 * work, so they are one page: the presets and the import at the left on a
 * wide screen, the run in progress and the earlier runs at the right. On a
 * phone the order is the run in progress, the presets, the earlier runs, with
 * the two actions in a bar at the bottom.
 *
 * The harvester's dashboard is gone, and this tab is what it showed: its
 * running run is "Running now", its recent runs are "Earlier runs", and its
 * notice that the harvester did not answer stays at the top.
 *
 * **"Runs may start" is a state in the header**, with an info button. It
 * replaced a panel of two switches that took a third of the screen to say one
 * thing: whether pressing Start will do anything. Whether one chain may be
 * fetched is a switch in Setup, and the info button says so.
 *
 * A run is a process rather than a resource, so a row here links to the run's
 * own screen, which polls, and not to a form.
 */
@Component({
  selector: 'lib-runs-page',
  imports: [
    HarvestHeader,
    FormsModule,
    RouterLink,
    RokuTranslatorPipe,
    BlockNotice,
    CautionLine,
    ConfirmDialog,
    HarvestNotice,
    InfoButton,
    PresetsPanel,
    RunProgressView,
    RunRowView,
  ],
  template: `
    <lib-harvest-header>
      <span [class]="'state ' + state()" pageChip data-runs-state>{{
        'harvest.runs.state.' + state() | rokuT
      }}</span>
      <lib-info-button [info]="stateInfo" align="start" pageChip />
      <!-- One block for each action: a block with two nodes at its root is
           not projected into the action slot. -->
      @if (!compact()) {
        <a [routerLink]="importLink" class="button" pageAction>{{
          'harvest.imports.heading' | rokuT
        }}</a>
      }
      @if (!compact()) {
        <a
          [routerLink]="newRunLink"
          class="button primary"
          pageAction
          data-new-run
          >{{ 'harvest.runs.new' | rokuT }}</a
        >
      }
    </lib-harvest-header>

    <!-- The dashboard read the harvester did not answer. It was the notice of
         the harvester's own dashboard, and it stays at the top of this tab. -->
    @if (status.answered() === false) {
      <lib-block-notice
        (retry)="status.refresh()"
        [heading]="'dashboard.down.harvest'"
      />
    }

    <div class="layout">
      <div class="main">
        @if (running(); as run) {
          <section class="panel running" data-running-now>
            <div class="named">
              <span class="state on">{{
                'harvest.status.' + run.status | rokuT
              }}</span>
              <h2>
                @if (whatOf(run); as chain) {
                  {{ chain }},
                }
                {{ 'harvest.mode.' + run.mode | rokuT }}
              </h2>
              <span class="since">{{
                'harvest.runs.running.since'
                  | rokuT: { when: instant(run.startedAt ?? run.requestedAt) }
              }}</span>
            </div>
            <lib-run-progress [progress]="progress(run)" [run]="run" />
            @if (run.abortRequestedAt !== null) {
              <p class="quiet" role="status" data-stopping>
                {{ 'harvest.run.aborting' | rokuT }}
              </p>
            }
            <div class="controls">
              <a [routerLink]="runLink(run.id)" class="button">{{
                'harvest.runs.running.open' | rokuT
              }}</a>
              @if (canAbort(run)) {
                <button
                  (click)="stopping.set(run)"
                  [disabled]="aborting()"
                  class="danger"
                  type="button"
                  data-stop-run
                >
                  {{ 'harvest.run.abort' | rokuT }}
                </button>
              }
            </div>
            @if (abortFailure() !== null) {
              <p class="field-error" role="alert">
                {{ 'harvest.runs.running.stopFailed' | rokuT }}
                {{ abortFailure() }}
              </p>
            }
          </section>
        }

        <section class="panel earlier">
          <div class="named">
            <h2>{{ 'harvest.runs.earlier' | rokuT }}</h2>
          </div>

          <div class="filters">
            <!-- By mode (admin plan 0034, section 4). One way, for the reason
                 the reverted filter below gives. -->
            <label>
              <span>{{ 'harvest.runs.modeFilter.label' | rokuT }}</span>
              <select
                (ngModelChange)="onModeChange($event)"
                [ngModel]="modeFilter()"
                name="modeFilter"
              >
                <option value="">
                  {{ 'harvest.runs.modeFilter.any' | rokuT }}
                </option>
                @for (mode of modes; track mode) {
                  <option [value]="mode">
                    {{ 'harvest.mode.' + mode | rokuT }}
                  </option>
                }
              </select>
            </label>

            <label>
              <span>{{ 'harvest.runs.filter.reverted' | rokuT }}</span>
              <!-- One way, with the handler setting the signal itself. A
                   banana box beside an explicit ngModelChange fires this
                   handler first and writes the signal second, so the read
                   below it would go out with the filter the operator just
                   moved away from. -->
              <select
                (ngModelChange)="onRevertedChange($event)"
                [ngModel]="reverted()"
                name="reverted"
              >
                @for (option of revertedOptions; track option) {
                  <option [value]="option">
                    {{ 'harvest.runs.filter.revertedOption.' + option | rokuT }}
                  </option>
                }
              </select>
            </label>

            <!-- By preset (admin plan 0030, section 5). Every chain's presets,
                 each named with its chain, because the list is every chain's
                 runs. -->
            <label>
              <span>{{ 'harvest.runs.filter.preset' | rokuT }}</span>
              <select
                (ngModelChange)="onPresetChange($event)"
                [ngModel]="presetFilter()"
                name="preset"
              >
                <option value="">
                  {{ 'harvest.runs.filter.presetAny' | rokuT }}
                </option>
                @for (preset of presets(); track preset.id) {
                  <option [value]="preset.id">
                    {{ preset.name }} ({{ names.nameOf(preset.supermarketId) }})
                  </option>
                }
              </select>
            </label>
          </div>

          @if (failed()) {
            <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
          } @else if (loading()) {
            <p class="quiet">{{ 'resource.list.loading' | rokuT }}</p>
          } @else if (rows().length === 0) {
            <p class="quiet">{{ 'harvest.runs.empty' | rokuT }}</p>
          } @else {
            <ul class="runs">
              @for (row of rows(); track row.id) {
                <li
                  [attr.aria-current]="row.id === highlighted() ? 'true' : null"
                  [class.highlighted]="row.id === highlighted()"
                >
                  <lib-run-row [link]="runLink(row.id)" [row]="row" />
                  @if (presetOf(row.id); as preset) {
                    <p class="preset">
                      @if (preset.kind === 'named') {
                        {{
                          'harvest.runs.row.preset'
                            | rokuT: { name: preset.name }
                        }}
                      } @else {
                        {{ 'harvest.runs.row.deletedPreset' | rokuT }}
                      }
                    </p>
                  }
                </li>
              }
            </ul>
          }
        </section>
      </div>

      <div class="side">
        <lib-presets-panel (started)="started($event)" />

        <section
          (dragleave)="dragging.set(false)"
          (dragover)="dragOver($event)"
          (drop)="drop($event)"
          [class.over]="dragging()"
          class="panel import"
          data-import
        >
          <div class="named">
            <h2>{{ 'harvest.imports.heading' | rokuT }}</h2>
            <lib-info-button [info]="importInfo" />
          </div>
          <div class="zone">
            <span>{{ 'harvest.runs.import.drop' | rokuT }}</span>
            <button (click)="picker.click()" type="button" data-choose-file>
              {{ 'harvest.runs.import.choose' | rokuT }}
            </button>
            <input
              (change)="chosen($event)"
              #picker
              accept="application/json,.json"
              aria-hidden="true"
              class="visually-hidden"
              tabindex="-1"
              type="file"
            />
          </div>
          <lib-caution-line [text]="'harvest.imports.info.caution' | rokuT" />
        </section>
      </div>
    </div>

    <!-- On a phone the two actions sit in a bar above the navigation bar. -->
    @if (compact()) {
      <div class="bar" data-runs-bar>
        <a [routerLink]="importLink" class="button">{{
          'harvest.imports.heading' | rokuT
        }}</a>
        <a [routerLink]="newRunLink" class="button primary" data-new-run>{{
          'harvest.runs.new' | rokuT
        }}</a>
      </div>
    }

    @if (stopping(); as run) {
      <lib-confirm-dialog
        (confirm)="stop(run)"
        (dismiss)="stopping.set(null)"
        [busy]="aborting()"
        bodyKey="harvest.runs.running.stopBody"
        confirmKey="harvest.run.abort"
        headingKey="harvest.runs.running.stopHeading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    h2 {
      font-size: 0.9375rem;
      font-weight: 600;
    }

    /* One column: the run in progress, the presets, the earlier runs. The
       wrapper of the two run panels gives its children to this column, so the
       presets can sit between them. */
    .layout {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    .main {
      display: contents;
    }

    .running {
      order: 1;
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      order: 2;
      min-inline-size: 0;
    }

    .earlier {
      order: 3;
    }

    /* At 72 rem and above the presets and the import are a column 420 px
       wide at the left. */
    @media (min-width: 72rem) {
      .layout {
        display: grid;
        grid-template-columns: 26.25rem minmax(0, 1fr);
        align-items: start;
      }

      .main {
        display: flex;
        flex-direction: column;
        gap: var(--admin-space-4);
        grid-column: 2;
        grid-row: 1;
        min-inline-size: 0;
      }

      .side {
        grid-column: 1;
        grid-row: 1;
      }
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .named {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .named h2 {
      flex: 1;
    }

    .since,
    .quiet,
    .preset {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .state {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .state.on {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .state.off {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      justify-content: flex-end;
    }

    .button,
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .primary {
      border-color: var(--admin-accent);
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-on-wash);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .button:focus-visible,
    button:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .field-error {
      font-size: 0.8125rem;
      color: var(--admin-danger-on-wash);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    label {
      display: flex;
      flex: 1 1 10rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .runs {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .runs li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    /* The run that was just started. An outline rather than a fill, so the
       status chip keeps its colour. */
    .runs li.highlighted lib-run-row {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
      border-radius: var(--admin-radius-control);
    }

    .preset {
      padding-inline-start: var(--admin-space-3);
    }

    /* Where a file is dropped. Dashed, so it reads as a place and not as a
       panel of content. */
    .zone {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: center;
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .import.over .zone {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .visually-hidden {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (max-width: 47.99rem) {
      /* Room for the bar of the two actions. The page already reserves the
         navigation bar under it. */
      :host {
        padding-block-end: 4rem;
      }

      /* A phone has no file to drop. The import is the left of the two
         actions in the bar. */
      .import {
        display: none;
      }

      /* Above the navigation bar, which is fixed at the bottom edge, and
         never under it. */
      .bar {
        position: fixed;
        z-index: 20;
        inset-block-end: var(--admin-bar);
        inset-inline: 0;
        display: flex;
        gap: var(--admin-space-2);
        padding: var(--admin-space-2) var(--admin-space-3);
        border-block-start: 1px solid var(--admin-border);
        background: var(--admin-surface-raised);
      }

      .bar .button {
        flex: 1;
        min-block-size: 2.75rem;
      }

      .controls .button,
      .controls button {
        flex: 1;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunsPage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _router = inject(Router);
  private readonly _handoff = inject(ImportHandoff);

  readonly shell = inject(HarvestShell);
  readonly status = inject(HarvestStatus);
  readonly names = inject(ChainNames);
  readonly compact = inject(Viewport).compact;

  readonly stateInfo = RUNS_STATE_INFO;
  readonly importInfo = IMPORT_INFO;

  readonly newRunLink = harvestRunsPath(HARVEST_NEW_RUN);
  readonly importLink = harvestRunsPath(HARVEST_IMPORT);

  readonly revertedOptions = REVERTED_OPTIONS;
  /** Both by default, which is what the list showed before the filter existed. */
  readonly reverted = signal<RevertedFilter>('any');
  /** The preset whose runs are listed, or `''` for every run. */
  readonly presetFilter = signal('');
  readonly modes = MODES;
  /** The mode whose runs are listed, or `''` for every mode. */
  readonly modeFilter = signal<ModeFilter>('');

  readonly loading = signal(true);
  readonly runs = signal<readonly HarvestRun[]>([]);
  readonly error = signal<GatewayError | null>(null);

  /**
   * Every chain's presets, for the names on the rows and the filter. Null
   * until read, and left null when the read fails, so a run is never called a
   * deleted preset on the strength of a list that never arrived.
   */
  private readonly _presets = signal<
    readonly Wire.HarvestHarvestRunPresetView[] | null
  >(null);
  readonly presets = computed(() => this._presets() ?? []);
  /** Whether every page was read, which a "Deleted preset" claim needs. */
  private readonly _presetsComplete = signal(false);

  /** The run to mark: the one a preset or the run form just started. */
  readonly highlighted = signal(
    inject(ActivatedRoute).snapshot.queryParamMap.get('run') ?? ''
  );

  /** The run somebody asked to stop, until the question is answered. */
  readonly stopping = signal<HarvestRun | null>(null);
  readonly aborting = signal(false);
  readonly abortFailure = signal<string | null>(null);

  /** Whether a file is being dragged over the drop zone. */
  readonly dragging = signal(false);

  readonly failed = computed(
    () => this.error() !== null && this.runs().length === 0
  );

  /**
   * Whether runs may start (admin plan 0044, target 5).
   *
   * Off as soon as either switch is known to be off. On once both are known
   * to be on. Otherwise not known: nothing has answered and nothing has been
   * tried, and saying "may start" then would be a guess.
   */
  readonly state = computed<RunsState>(() => {
    const switches = this.shell.switches();
    if (switches.some((item) => item.state === 'off')) {
      return 'off';
    }
    return switches.every((item) => item.state === 'on') ? 'on' : 'unknown';
  });

  /** The run in progress, which the dashboard read names. */
  readonly running = this.status.running;

  readonly progress = runProgress;
  readonly canAbort = canAbort;

  readonly rows = computed<readonly RunRow[]>(() =>
    this.runs().map((run) => ({
      id: run.id,
      mode: run.mode,
      status: run.status,
      requested: formatInstant(run.requestedAt),
      processed: run.processed,
      failed: run.failed,
      // Empty when the run still stands, which is what the row branches on.
      reverted: formatInstant(run.revertedAt),
      // On hover rather than in the row: the operator id is a uuid, and a row
      // that spelled one out would be mostly uuid.
      revertedBy: run.revertedByUserId ?? '',
      // A finished run that failed because of a switch says which one, on the
      // row, because that is where somebody is looking when they wonder.
      reasonKey: reasonKey(failureBlockReason(run)),
      chain:
        (run.supermarketId ?? '') === ''
          ? ''
          : this.names.nameOf(run.supermarketId ?? ''),
      // "Wrote" is what the run created plus what it updated (admin plan
      // 0044, section 2). The run view has no count of what it queued, so no
      // such column is drawn.
      wrote: run.created + run.updated,
    }))
  );

  constructor() {
    void this.load();
    void this._readPresets();

    // The run that was in progress ended: the earlier runs are one more than
    // the list on screen holds, so read them again. A run that begins adds
    // nothing to that list, and the first read of the status is no change.
    let inProgress = this.running()?.id ?? null;
    effect(() => {
      const now = this.running()?.id ?? null;
      untracked(() => {
        if (now === inProgress) {
          return;
        }
        const ended = inProgress !== null;
        inProgress = now;
        if (ended) {
          void this.load();
        }
      });
    });

    // The chain of the run in progress, for the panel's title.
    effect(() => {
      const chain = this.running()?.supermarketId ?? '';
      if (chain !== '') {
        untracked(() => void this.names.resolve([chain]));
      }
    });
  }

  /** The chain, where the run has one, for the title of "Running now". */
  whatOf(run: HarvestRun): string {
    const chain = run.supermarketId ?? '';
    return chain === '' ? '' : this.names.nameOf(chain);
  }

  instant(value: string | null): string {
    return formatInstant(value);
  }

  runLink(runId: string): readonly string[] {
    return harvestRunPath(runId);
  }

  /** The filter decides what is asked for, so changing it asks again. */
  onRevertedChange(filter: RevertedFilter): void {
    this.reverted.set(filter);
    void this.load();
  }

  onPresetChange(presetId: string): void {
    this.presetFilter.set(presetId);
    void this.load();
  }

  onModeChange(mode: ModeFilter): void {
    this.modeFilter.set(mode);
    void this.load();
  }

  /**
   * What a run row says about its preset, or null when it has none to say.
   *
   * A run whose preset is not among the ones read is called deleted only when
   * every page was read. A failed or truncated read says nothing, because a
   * wrong "deleted" is worse than a missing name.
   */
  presetOf(runId: string): RunPreset {
    const run = this.runs().find((entry) => entry.id === runId);
    const presetId = run?.presetId ?? null;
    const presets = this._presets();
    if (presetId === null || presets === null) {
      return null;
    }
    const preset = presets.find((entry) => entry.id === presetId);
    if (preset !== undefined) {
      return { kind: 'named', name: preset.name };
    }
    return this._presetsComplete() ? { kind: 'deleted' } : null;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const filter = this.reverted();
      const presetId = this.presetFilter();
      const mode = this.modeFilter();
      const page = await this._service.listRuns({
        limit: 20,
        ...(filter === 'any' ? {} : { reverted: filter === 'reverted' }),
        ...(presetId === '' ? {} : { presetId }),
        ...(mode === '' ? {} : { mode }),
      });
      this.runs.set(page.items);
      void this.names.resolve([
        ...new Set(
          page.items
            .map((run) => run.supermarketId ?? '')
            .filter((id) => id !== '')
        ),
      ]);
      this.shell.observeReachable();
      // The runs are where a storefront refusal is legible, so the state in
      // the header reads them rather than asking for them again.
      this.shell.observeRuns(page.items);
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * A preset was started: mark its run, and read the runs and the run in
   * progress again.
   */
  started(run: HarvestRun): void {
    this.highlighted.set(run.id);
    this.shell.observeSpawnRefusal(null);
    this.status.refresh();
    void this.load();
  }

  /**
   * Stop the run in progress, once the question has been answered.
   *
   * What it has already fetched is kept, and the run finishes as stopped. The
   * panel goes when the next read says nothing is running.
   */
  async stop(run: HarvestRun): Promise<void> {
    this.aborting.set(true);
    this.abortFailure.set(null);

    try {
      await this._service.abortRun(run.id);
      this.stopping.set(null);
      this.status.refresh();
      await this.load();
    } catch (error) {
      this.stopping.set(null);
      this.abortFailure.set(toGatewayError(error).detail);
    } finally {
      this.aborting.set(false);
    }
  }

  /** A file is over the zone. Without this the browser opens it instead. */
  dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  /** A file was dropped: hand it to the import page. */
  drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this._import(event.dataTransfer?.files?.[0] ?? null);
  }

  /** A file was chosen: hand it to the import page. */
  chosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    this._import(input.files?.[0] ?? null);
    // So that choosing the same file again is still a change.
    input.value = '';
  }

  /**
   * Open the import page with a file.
   *
   * That page reads the file, previews it and sends it, exactly as when the
   * file is chosen there. This tab only carries it across.
   */
  private _import(file: File | null): void {
    if (file === null) {
      return;
    }
    this._handoff.leave(file);
    void this._router.navigate([...this.importLink]);
  }

  /**
   * Every chain's presets, read once for the names and the filter.
   *
   * A failure costs the names and nothing else: the runs still list, each
   * without the preset it came from.
   */
  private async _readPresets(): Promise<void> {
    try {
      const held: Wire.HarvestHarvestRunPresetView[] = [];
      let cursor: string | undefined;
      let complete = false;
      for (let page = 0; page < MAX_PRESET_PAGES && !complete; page += 1) {
        const answer = await this._service.listPresets(undefined, cursor);
        held.push(...answer.items);
        complete = answer.nextCursor === null;
        cursor = answer.nextCursor ?? undefined;
      }
      this._presets.set(held);
      this._presetsComplete.set(complete);
      void this.names.resolve([
        ...new Set(held.map((preset) => preset.supermarketId)),
      ]);
    } catch {
      // The names are a courtesy. The list above them is the screen.
    }
  }
}

function reasonKey(reason: string | null): string | null {
  return reason === null ? null : `harvest.blocked.${reason}`;
}
