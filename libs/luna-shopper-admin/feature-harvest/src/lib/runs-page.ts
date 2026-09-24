import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  failureBlockReason,
  spawnBlockReason,
  type HarvestRun,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  RunRowView,
  SwitchPanel,
  type RunRow,
} from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { formatInstant } from './format-instant';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';
import { RunRequestForm } from './run-request-form';

/** What the reverted filter can be asked for. `any` sends no filter at all. */
const REVERTED_OPTIONS = ['any', 'reverted', 'standing'] as const;
type RevertedFilter = (typeof REVERTED_OPTIONS)[number];

/**
 * The run modes the list can be narrowed to (admin plan 0034, section 4).
 *
 * A record keyed on the wire union, as the sources page keeps its adapters, so
 * a mode the document adds is a compile error here rather than a filter that
 * silently cannot ask for it.
 */
const MODE_ORDER: Record<Wire.EnumsHarvestRunMode, number> = {
  STORE_DISCOVERY: 1,
  CATALOG_DISCOVERY: 2,
  FILE_IMPORT: 3,
};

const MODES: readonly Wire.EnumsHarvestRunMode[] = (
  Object.keys(MODE_ORDER) as Wire.EnumsHarvestRunMode[]
).sort((a, b) => MODE_ORDER[a] - MODE_ORDER[b]);

/** The mode filter. `''` sends none. */
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

/**
 * The runs screen: what has run, what is running, and how to start one.
 *
 * A run is a process rather than a resource, so this is not `0004`'s list with a
 * create form behind it. Starting one is a small set of choices with a mode at
 * the top, and reading one is a screen of its own that polls, so the row here
 * links out to that rather than to an edit form there is no such thing as.
 *
 * The choices are {@link RunRequestForm} since admin plan 0030, which the
 * presets screen edits a preset with. This page spawns what the form hands it,
 * draws the refusal, and saves the same request as a preset.
 *
 * The switches sit above the list rather than on a settings screen
 * somewhere, because the question they answer is "why did my run do nothing",
 * and that question is asked here, looking at a run that did nothing.
 *
 * **Starting a run is attributed to the harvester, not to the operator** (plan
 * 0006, section 6; backend plan 0075 section 3). Thousands of catalog writes
 * follow, and the audit trail credits the service for them. So the confirmation
 * says a run was started and never that the operator changed four thousand
 * prices, and `requestedByUserId` is not drawn as an author.
 */
@Component({
  selector: 'lib-runs-page',
  imports: [
    FormsModule,
    RouterLink,
    RokuTranslatorPipe,
    HarvestNotice,
    RunRequestForm,
    RunRowView,
    SwitchPanel,
  ],
  template: `
    <header>
      <h1>{{ 'harvest.runs.heading' | rokuT }}</h1>
    </header>

    <lib-switch-panel [switches]="shell.switches()" />

    <section class="start">
      <h2>{{ 'harvest.runs.start.heading' | rokuT }}</h2>

      <lib-run-request-form
        (changed)="draft.set($event)"
        (submitted)="start($event)"
        [busy]="starting()"
      >
        <button
          (click)="openSave()"
          [disabled]="!canSave()"
          class="secondary"
          type="button"
        >
          {{ 'harvest.presets.saveAs.action' | rokuT }}
        </button>
      </lib-run-request-form>

      @if (blockedKey(); as key) {
        <div class="failure" role="alert">
          <p>{{ key | rokuT }}</p>
          <!-- The server's own words, under the screen's. The refusals that
               reach here are written for whoever is operating the harvester,
               and they name the row or the switch that has to change. -->
          @if (blockedDetails().length > 0) {
            <ul>
              @for (line of blockedDetails(); track line) {
                <li>{{ line }}</li>
              }
            </ul>
          }
        </div>
      }

      @if (savedPreset(); as saved) {
        <p class="notice" role="status">
          {{ 'harvest.presets.saveAs.saved' | rokuT: { name: saved.name } }}
          <a [queryParams]="saved.query" [routerLink]="presetsLink">
            {{ 'harvest.presets.saveAs.open' | rokuT }}
          </a>
        </p>
      }
    </section>

    <!-- Save as preset (admin plan 0030, section 4). A small dialog, because
         the only new fact is the name: the request is the form as it is. -->
    @if (saveOpen()) {
      <div
        (keydown.escape)="closeSave()"
        aria-labelledby="save-preset-heading"
        aria-modal="true"
        class="dialog"
        role="dialog"
      >
        <div class="panel">
          <h2 id="save-preset-heading">
            {{ 'harvest.presets.saveAs.heading' | rokuT }}
          </h2>
          <label>
            <span>{{ 'harvest.presets.name' | rokuT }}</span>
            <input
              (ngModelChange)="onSaveNameChange($event)"
              [ngModel]="saveName()"
              maxlength="80"
              name="presetName"
              type="text"
            />
          </label>
          @if (saveNameTaken()) {
            <p class="field-error" role="alert">
              {{ 'harvest.presets.nameTaken' | rokuT }}
            </p>
          }
          @if (saveFailure() !== null) {
            <div class="failure" role="alert">
              <p>{{ 'harvest.presets.saveFailed' | rokuT }}</p>
              @if (saveFailure() !== '') {
                <p>{{ saveFailure() }}</p>
              }
            </div>
          }
          <div class="controls">
            <button
              (click)="saveAsPreset()"
              [disabled]="saving() || saveName().trim() === ''"
              class="primary"
              type="button"
            >
              {{
                (saving() ? 'harvest.presets.saving' : 'harvest.presets.save')
                  | rokuT
              }}
            </button>
            <button (click)="closeSave()" [disabled]="saving()" type="button">
              {{ 'resource.action.cancel' | rokuT }}
            </button>
          </div>
        </div>
      </div>
    }

    <section class="filters">
      <!-- By mode (admin plan 0034, section 4). One way, for the reason the
           reverted filter below gives. -->
      <label>
        <span>{{ 'harvest.runs.modeFilter.label' | rokuT }}</span>
        <select
          (ngModelChange)="onModeChange($event)"
          [ngModel]="modeFilter()"
          name="modeFilter"
        >
          <option value="">{{ 'harvest.runs.modeFilter.any' | rokuT }}</option>
          @for (mode of modes; track mode) {
            <option [value]="mode">{{ 'harvest.mode.' + mode | rokuT }}</option>
          }
        </select>
      </label>

      <label>
        <span>{{ 'harvest.runs.filter.reverted' | rokuT }}</span>
        <!-- One way, with the handler setting the signal itself. A banana box
             beside an explicit ngModelChange fires this handler first and
             writes the signal second, so the read below it would go out with
             the filter the operator just moved away from. -->
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

      <!-- By preset (admin plan 0030, section 5). Every chain's presets, each
           named with its chain, because the list above is every chain's runs. -->
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
    </section>

    @if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (rows().length === 0) {
      <p class="state">{{ 'harvest.runs.empty' | rokuT }}</p>
    } @else {
      <ul class="runs">
        @for (row of rows(); track row.id) {
          <li
            [attr.aria-current]="row.id === highlighted() ? 'true' : null"
            [class.highlighted]="row.id === highlighted()"
          >
            <!-- Relative, because the run screen is a child of this one. The
                 dashboard draws the same row with an absolute link, which is
                 why the link is the row component's input. -->
            <lib-run-row [link]="[row.id]" [row]="row" />
            @if (presetOf(row.id); as preset) {
              <p class="preset">
                @if (preset.kind === 'named') {
                  {{ 'harvest.runs.row.preset' | rokuT: { name: preset.name } }}
                } @else {
                  {{ 'harvest.runs.row.deletedPreset' | rokuT }}
                }
              </p>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .start {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    label {
      display: flex;
      flex: 1 1 12rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    button {
      cursor: pointer;
    }

    .primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      inline-size: 100%;
    }

    /* The server's own sentences, indented under the screen's own. Marked as a
       list because there can be several, which is what a refusal by field is. */
    .failure ul {
      margin-block-start: var(--admin-space-2);
      padding-inline-start: var(--admin-space-4);
      font-size: 0.8125rem;
    }

    .notice {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      font-size: 0.875rem;
    }

    .field-error {
      font-size: 0.8125rem;
      color: var(--admin-danger-on-wash);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
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

    /* The run a preset was just started as, on arriving from the presets
       screen. An outline rather than a fill, so the status chip keeps its
       colour. */
    .runs li.highlighted lib-run-row {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
      border-radius: var(--admin-radius);
    }

    .preset {
      padding-inline-start: var(--admin-space-3);
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    /* The save dialog, drawn as the confirm dialog is: an opaque cover and
       one raised panel. */
    .dialog {
      position: fixed;
      z-index: 90;
      display: flex;
      align-items: center;
      justify-content: center;
      inset: 0;
      padding: var(--admin-space-4);
      background: var(--admin-surface);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      inline-size: 100%;
      max-inline-size: 26rem;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunsPage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);
  readonly names = inject(ChainNames);

  readonly form = viewChild(RunRequestForm);

  /**
   * The reverted filter (backend plan 0082, section 6), as three choices rather
   * than a checkbox.
   *
   * A checkbox has two states and the filter has three: reverted only,
   * unreverted only, and both, which is what the screen opens on. A tri state
   * checkbox would encode the same thing less legibly.
   */
  readonly revertedOptions = REVERTED_OPTIONS;
  readonly reverted = signal<RevertedFilter>('any');
  /** The preset filter. `''` sends none. */
  readonly presetFilter = signal('');
  readonly modes = MODES;
  readonly modeFilter = signal<ModeFilter>('');

  readonly starting = signal(false);
  readonly loading = signal(true);
  readonly runs = signal<readonly HarvestRun[]>([]);
  readonly error = signal<GatewayError | null>(null);
  private readonly _spawnError = signal<GatewayError | null>(null);

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

  /** The run to highlight, as the presets screen names it after a start. */
  readonly highlighted = signal(
    inject(ActivatedRoute).snapshot.queryParamMap.get('run') ?? ''
  );

  /** The form's request as it stands, for "Save as preset". */
  readonly draft = signal<Wire.SpawnHarvestRunDto | null>(null);
  readonly saveOpen = signal(false);
  readonly saveName = signal('');
  readonly saving = signal(false);
  readonly saveNameTaken = signal(false);
  /** The server's sentence about a failed save, `''` when it sent none. */
  readonly saveFailure = signal<string | null>(null);
  readonly savedPreset = signal<{
    readonly name: string;
    readonly query: Readonly<Record<string, string>>;
  } | null>(null);

  readonly presetsLink = ['/', HARVEST_SEGMENT, 'presets'];

  readonly failed = computed(
    () => this.error() !== null && this.runs().length === 0
  );

  /**
   * Whether the form can be saved as a preset (admin plan 0030, section 4).
   *
   * Only when it could start, because the server validates a preset exactly as
   * a spawn, and only with a chain, because every preset belongs to one.
   */
  readonly canSave = computed(() => {
    const form = this.form();
    const draft = this.draft();
    return (
      form !== undefined &&
      form.ready() &&
      !form.uploading() &&
      draft !== null &&
      (draft.supermarketId ?? '') !== ''
    );
  });

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
    }))
  );

  /**
   * Why the last attempt to start would not start.
   *
   * The spawn refusal is the only direct evidence either switch offers, so it
   * is kept and shown rather than folded into a general failure message. A 409 is different again: something is already running, which is
   * not a switch and has an obvious remedy.
   */
  readonly blockedKey = computed(() => {
    const error = this._spawnError();
    if (error === null) {
      return null;
    }

    const reason = spawnBlockReason(error);
    if (reason !== null) {
      return reasonKey(reason);
    }
    if (error.status === 409) {
      return 'harvest.runs.start.alreadyRunning';
    }
    // Two sentences for the same status, and which one is true depends on
    // whether the server explained itself. Saying it did not while its own
    // words are drawn under the line is the failure this replaces.
    return this.blockedDetails().length > 0
      ? 'harvest.runs.start.refused'
      : 'harvest.runs.start.failed';
  });

  /**
   * What the server said about the refusal, in its own words.
   *
   * Empty when it sent none, which is the case the screen has its own sentence
   * for. Most spawn refusals are not that case: the harvester answers a chain
   * with no source row, a source switched off, a walk with no scope and a
   * document already imported with a `ValidationException` or a
   * `ConflictException`, and the fact that names the row to fix rides in
   * `detail` rather than in `message`, which is the same generic line for every
   * failure sharing a code.
   *
   * The per field messages come first where there are any, because a gateway
   * DTO refusal leaves `detail` as the status text rather than as a sentence.
   */
  readonly blockedDetails = computed<readonly string[]>(() => {
    const error = this._spawnError();
    if (error === null) {
      return [];
    }

    const fields = Object.values(error.fieldErrors).flat();
    if (fields.length > 0) {
      return fields;
    }
    return error.detail === '' ? [] : [error.detail];
  });

  constructor() {
    void this.load();
    void this._readPresets();
  }

  /**
   * The filter is a server side one, so changing it is a fresh read.
   *
   * The chosen value is the argument for the reason the template gives: read
   * off the signal instead, this would send the filter that was there before.
   */
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
   * The preset a run came from, as its row says it.
   *
   * Null for a run started by hand, and null too while the presets have not
   * been read: "Deleted preset" is a claim, and a list that failed to arrive
   * is not evidence for it.
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
      this.shell.observeReachable();
      // The runs are where a storefront refusal is legible, so the switch panel
      // reads them rather than asking for them again.
      this.shell.observeRuns(page.items);
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.loading.set(false);
    }
  }

  /** Spawn what the form handed up. The form has already checked it is ready. */
  async start(input: Wire.SpawnHarvestRunDto): Promise<void> {
    this.starting.set(true);
    this._spawnError.set(null);

    try {
      await this._service.spawnRun(input);
      this.shell.observeSpawnRefusal(null);
      await this.load();
    } catch (error) {
      const failure = toGatewayError(error);
      this._spawnError.set(failure);
      this.shell.observeSpawnRefusal(spawnBlockReason(failure));
    } finally {
      this.starting.set(false);
    }
  }

  openSave(): void {
    if (!this.canSave()) {
      return;
    }
    this.saveName.set('');
    this.saveNameTaken.set(false);
    this.saveFailure.set(null);
    this.savedPreset.set(null);
    this.saveOpen.set(true);
  }

  closeSave(): void {
    if (!this.saving()) {
      this.saveOpen.set(false);
    }
  }

  /** A new name is a new question, so the last answer about the old one goes. */
  onSaveNameChange(name: string): void {
    this.saveName.set(name);
    this.saveNameTaken.set(false);
  }

  /**
   * Save the form as it is under the typed name.
   *
   * The chain comes out of the request, because a preset holds it as a column
   * and its `input` has no field for it (backend plan 0120, section 3).
   */
  async saveAsPreset(): Promise<void> {
    const draft = this.form()?.request() ?? this.draft();
    const name = this.saveName().trim();
    if (draft === null || name === '' || !this.canSave()) {
      return;
    }
    const { supermarketId, ...input } = draft;

    this.saving.set(true);
    this.saveNameTaken.set(false);
    this.saveFailure.set(null);
    try {
      const preset = await this._service.createPreset(
        supermarketId ?? '',
        name,
        input
      );
      this._presets.update((held) => [...(held ?? []), preset]);
      this.savedPreset.set({
        name: preset.name,
        query: { chain: preset.supermarketId, preset: preset.id },
      });
      this.saveOpen.set(false);
    } catch (error) {
      const failure = toGatewayError(error);
      if (failure.status === 409) {
        this.saveNameTaken.set(true);
      } else {
        const fields = Object.values(failure.fieldErrors).flat();
        this.saveFailure.set(
          fields.length > 0 ? fields.join(' ') : failure.detail
        );
      }
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Every chain's presets, for the names on the rows and the filter.
   *
   * One read for the screen rather than one per chain, since the route answers
   * every chain's when asked for none, and cached: a preset's name does not
   * change between polls of the list.
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
      // The rows name no preset and the filter offers none, which is the
      // honest answer when the presets could not be read.
    }
  }
}

function reasonKey(reason: string | null): string | null {
  return reason === null ? null : `harvest.blocked.${reason}`;
}
