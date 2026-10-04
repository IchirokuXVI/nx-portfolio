import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
  type HarvestRunPresetInput,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  harvestRunPath,
  spawnBlockReason,
  type HarvestRun,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, HarvestNotice } from '@portfolio/luna-shopper-admin/ui';
import { ChainSelect } from './chain-select';
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';
import { RunRequestForm } from './run-request-form';

type Preset = Wire.HarvestHarvestRunPresetView;

/** One sentence of a preset's summary, as a key and its arguments. */
export interface SummaryPart {
  readonly key: string;
  readonly args?: Readonly<Record<string, number>>;
}

/** What the editor is open on: a new preset of a chain, or a saved one. */
interface Editing {
  readonly preset: Preset | null;
  readonly supermarketId: string;
}

/** A refusal drawn on one row, in the screen's words and the server's. */
interface RowRefusal {
  readonly key: string;
  readonly detail: string;
}

/** Where the chain the panel was last on is kept, in this browser. */
export const PRESETS_CHAIN_KEY = 'luna-shopper-admin.harvest.presets-chain';

/** The chain the panel was last on, or `''`. Storage that refuses is no chain. */
function rememberedChain(): string {
  try {
    return globalThis.localStorage?.getItem(PRESETS_CHAIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberChain(supermarketId: string): void {
  try {
    if (supermarketId === '') {
      globalThis.localStorage?.removeItem(PRESETS_CHAIN_KEY);
    } else {
      globalThis.localStorage?.setItem(PRESETS_CHAIN_KEY, supermarketId);
    }
  } catch {
    // A browser that refuses storage starts on no chain next time, and that
    // is the whole cost.
  }
}

/**
 * The presets of a chain (admin plan 0030, section 3): its saved runs, and
 * the way to start, edit and delete one.
 *
 * **A panel of the Runs tab, and not a page** (admin plan 0044, target 5). It
 * was a screen of its own at `/harvest/presets`. Starting a run and following
 * it are one piece of work, so the presets sit beside the run in progress and
 * the earlier runs. A start is told to the page through {@link started}, and
 * the page reads its runs again.
 *
 * **The chain is remembered.** A person starts the same chain's presets day
 * after day, so the panel opens on the chain it was last on, kept in this
 * browser. A link that names a chain wins over the remembered one.
 *
 * Edit and delete show only while "Edit presets" is on: a row is a name, a
 * line that says what it does, how its last run ended, and "Start".
 *
 * A preset is edited with {@link RunRequestForm}, the form a run is started
 * with, so a preset cannot hold a request the runs page could not have sent.
 * The chain is fixed on it, because a preset's chain never changes (backend
 * plan 0120, section 5), and a file import is not offered, because a preset
 * cannot hold one.
 *
 * A preset's `input` has no `supermarketId`: the chain is a column. The page
 * adds it when it hands `input` to the form, and strips it again when it saves.
 */
@Component({
  selector: 'lib-presets-panel',
  imports: [
    FormsModule,
    RouterLink,
    RokuTranslatorPipe,
    ConfirmDialog,
    HarvestNotice,
    ChainSelect,
    RunRequestForm,
  ],
  template: `
    <div class="named">
      <h2>{{ 'harvest.presets.title' | rokuT }}</h2>
      <div class="chain">
        <lib-chain-select
          (valueChange)="chooseChain($event)"
          [value]="supermarketId()"
          controlId="presets-chain"
          label="harvest.presets.chain"
          noneKey="harvest.presets.noChain"
        />
      </div>
    </div>

    @if (editing(); as open) {
      <section class="editor">
        <h3>
          {{
            (open.preset === null
              ? 'harvest.presets.newHeading'
              : 'harvest.presets.editHeading'
            ) | rokuT
          }}
        </h3>
        <label class="name">
          <span>{{ 'harvest.presets.name' | rokuT }}</span>
          <input
            (ngModelChange)="onNameChange($event)"
            [ngModel]="name()"
            maxlength="80"
            name="presetName"
            type="text"
          />
          @if (nameTaken()) {
            <span class="field-error" role="alert">
              {{ 'harvest.presets.nameTaken' | rokuT }}
            </span>
          }
        </label>

        <lib-run-request-form
          (submitted)="save($event)"
          [busy]="saving() || name().trim() === ''"
          [busyLabel]="
            saving() ? 'harvest.presets.saving' : 'harvest.presets.save'
          "
          [chainLocked]="true"
          [offersImport]="false"
          [submitLabel]="'harvest.presets.save'"
          [value]="editorValue()"
        >
          <button (click)="closeEditor()" [disabled]="saving()" type="button">
            {{ 'resource.action.cancel' | rokuT }}
          </button>
        </lib-run-request-form>

        @if (saveFailure(); as failure) {
          <div class="failure" role="alert">
            <p>{{ 'harvest.presets.saveFailed' | rokuT }}</p>
            @if (failure.detail !== '') {
              <p>{{ failure.detail }}</p>
            }
          </div>
        }
      </section>
    }

    @if (supermarketId() === '') {
      <p class="state">{{ 'harvest.presets.chooseChain' | rokuT }}</p>
    } @else if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading() && presets().length === 0) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (presets().length === 0) {
      <p class="state">{{ 'harvest.presets.empty' | rokuT }}</p>
    } @else {
      <ul class="presets">
        @for (preset of presets(); track preset.id) {
          <li [class.highlighted]="preset.id === highlighted()">
            <div class="what">
              <span class="preset-name">{{ preset.name }}</span>
              <!-- One line: the kind of run, then what it is set to do. -->
              <span class="summary">
                <span class="mode">{{
                  'harvest.mode.' + preset.input.mode | rokuT
                }}</span>
                @for (part of summaryOf(preset); track part.key) {
                  <span>{{ part.key | rokuT: part.args ?? {} }}</span>
                }
              </span>
            </div>
            <span class="last">
              @if (preset.lastRun; as last) {
                <a [routerLink]="runLink(last.id)" class="last-run">
                  <span [class]="last.status" class="status">
                    {{ 'harvest.status.' + last.status | rokuT }}
                  </span>
                  <span>{{ instant(last.requestedAt) }}</span>
                </a>
              } @else {
                {{ 'harvest.presets.neverRun' | rokuT }}
              }
            </span>
            <div class="actions">
              <button
                (click)="start(preset)"
                [disabled]="busyId() !== null"
                class="start"
                type="button"
                data-start
              >
                {{
                  (startingId() === preset.id
                    ? 'harvest.presets.starting'
                    : 'harvest.presets.start'
                  ) | rokuT
                }}
              </button>
              <!-- Edit and delete are for the day the presets are put in
                   order, so they show only while "Edit presets" is on. -->
              @if (editMode()) {
                <button
                  (click)="openEdit(preset)"
                  [disabled]="busyId() !== null || editing() !== null"
                  type="button"
                  data-edit
                >
                  {{ 'harvest.presets.edit' | rokuT }}
                </button>
                <button
                  (click)="pendingDelete.set(preset)"
                  [disabled]="busyId() !== null"
                  class="danger"
                  type="button"
                  data-delete
                >
                  {{ 'harvest.presets.delete.action' | rokuT }}
                </button>
              }
            </div>
            @if (refusalOf(preset.id); as refusal) {
              <div class="failure" role="alert">
                <p>{{ refusal.key | rokuT }}</p>
                @if (refusal.detail !== '') {
                  <p>{{ refusal.detail }}</p>
                }
              </div>
            }
          </li>
        }
      </ul>

      @if (nextCursor() !== null) {
        <button (click)="loadMore()" [disabled]="loading()" type="button">
          {{ 'harvest.presets.more' | rokuT }}
        </button>
      }
    }

    <div class="foot">
      <button
        (click)="openNew()"
        [disabled]="supermarketId() === '' || editing() !== null"
        class="link"
        type="button"
        data-new-preset
      >
        {{ 'harvest.presets.new' | rokuT }}
      </button>
      <button
        (click)="editMode.set(!editMode())"
        [attr.aria-pressed]="editMode()"
        [disabled]="presets().length === 0"
        class="link"
        type="button"
        data-edit-presets
      >
        {{
          (editMode() ? 'harvest.presets.editDone' : 'harvest.presets.editAll')
            | rokuT
        }}
      </button>
    </div>

    @if (pendingDelete(); as target) {
      <lib-confirm-dialog
        (confirm)="confirmDelete(target)"
        (dismiss)="pendingDelete.set(null)"
        [bodyArgs]="{ name: target.name }"
        [busy]="busyId() === target.id"
        bodyKey="harvest.presets.delete.body"
        confirmKey="harvest.presets.delete.confirm"
        headingKey="harvest.presets.delete.heading"
      >
        @if (deleteFailure(); as failure) {
          <p class="field-error" role="alert">
            {{ 'harvest.presets.delete.failed' | rokuT }}
            {{ failure }}
          </p>
        }
      </lib-confirm-dialog>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      flex: none;
      font-size: 0.9375rem;
      font-weight: 600;
    }

    h3 {
      font-size: 0.875rem;
      font-weight: 600;
    }

    .named {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .chain {
      flex: 1;
      min-inline-size: 12rem;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .editor {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface);
    }

    .editor .name {
      inline-size: 100%;
      max-inline-size: 26rem;
    }

    button {
      cursor: pointer;
    }

    .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-on-wash);
    }

    .field-error {
      font-size: 0.8125rem;
      color: var(--admin-danger-on-wash);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius-control);
      background: var(--admin-danger-wash);
      inline-size: 100%;
      font-size: 0.875rem;
    }

    .state {
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius-control);
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .presets {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .presets li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      padding-block: var(--admin-space-2);
      border-block-start: 1px solid var(--admin-border);
    }

    /* The preset a notice on this page named. */
    .presets li.highlighted {
      background: var(--admin-accent-wash);
    }

    .what {
      display: flex;
      flex: 1 1 12rem;
      flex-direction: column;
      min-inline-size: 0;
    }

    .preset-name {
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .summary,
    .last {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    /* One line of words, each part closed by a comma but the last. */
    .summary > span:not(:last-child)::after {
      content: ', ';
    }

    .last-run {
      display: inline-flex;
      gap: var(--admin-space-2);
      align-items: center;
      color: inherit;
    }

    .status {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-neutral-on-wash);
    }

    .status.RUNNING,
    .status.PENDING,
    .status.COMPLETED {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .status.FAILED,
    .status.STALE {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }

    .presets li .failure {
      flex-basis: 100%;
    }

    .foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    .link {
      padding: 0;
      border: none;
      background: none;
      font-size: 0.875rem;
      color: var(--admin-accent);
    }

    .link:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    @media (max-width: 47.99rem) {
      .link {
        min-block-size: 2.75rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetsPanel {
  private readonly _service = inject(HARVEST_SERVICE);

  /** A preset was started, and this is the run. */
  readonly started = output<HarvestRun>();

  /** Whether each row shows its edit and delete actions. */
  readonly editMode = signal(false);

  readonly shell = inject(HarvestShell);

  readonly supermarketId = signal('');
  readonly presets = signal<readonly Preset[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<GatewayError | null>(null);
  readonly failed = computed(
    () => this.error() !== null && this.presets().length === 0
  );

  /** The preset the runs page's notice linked to, outlined on arrival. */
  readonly highlighted = signal('');

  readonly startingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly busyId = computed(() => this.startingId() ?? this.deletingId());
  private readonly _refusals = signal<ReadonlyMap<string, RowRefusal>>(
    new Map()
  );

  readonly editing = signal<Editing | null>(null);
  readonly name = signal('');
  readonly saving = signal(false);
  readonly nameTaken = signal(false);
  readonly saveFailure = signal<{ readonly detail: string } | null>(null);

  readonly pendingDelete = signal<Preset | null>(null);
  /** The server's sentence about a failed delete. */
  readonly deleteFailure = signal<string | null>(null);

  /**
   * What the form starts from: the preset's input with its chain added, or an
   * empty walk of the chosen chain.
   */
  readonly editorValue = computed<Wire.SpawnHarvestRunDto | null>(() => {
    const open = this.editing();
    if (open === null) {
      return null;
    }
    if (open.preset === null) {
      return { mode: 'CATALOG_DISCOVERY', supermarketId: open.supermarketId };
    }
    return {
      ...(open.preset.input as Wire.SpawnHarvestRunDto),
      supermarketId: open.supermarketId,
    };
  });

  /** Kept per chain choice, so an answer for the previous chain is dropped. */
  private _generation = 0;

  constructor() {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    this.highlighted.set(query.get('preset') ?? '');
    // The chain a link named, else the one this browser was last on.
    const chain = query.get('chain') ?? rememberedChain();
    if (chain !== '') {
      this.chooseChain(chain);
    }
  }

  chooseChain(supermarketId: string): void {
    rememberChain(supermarketId);
    this.supermarketId.set(supermarketId);
    this.editing.set(null);
    this._refusals.set(new Map());
    void this.load();
  }

  /** The chain's first page, ordered by name as the route orders it. */
  async load(): Promise<void> {
    const chain = this.supermarketId();
    const generation = ++this._generation;
    this.presets.set([]);
    this.nextCursor.set(null);
    if (chain === '') {
      return;
    }
    await this._read(chain, undefined, generation);
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null) {
      return;
    }
    await this._read(this.supermarketId(), cursor, this._generation);
  }

  /**
   * A preset in words: how many scopes it walks and copies, and what it
   * fetches (admin plan 0030, section 3). Parts rather than one sentence, so
   * each is a key and a missing fact is a missing part rather than a zero.
   */
  summaryOf(preset: Preset): readonly SummaryPart[] {
    const input = preset.input;
    const parts: SummaryPart[] = [];
    const copies = (input.scopeCopies ?? []).reduce(
      (sum, copy) => sum + copy.to.length,
      0
    );

    if (input.detailBackfill === true) {
      parts.push({ key: 'harvest.presets.summary.backfill' });
    }
    if ((input.priceScopeIds ?? []).length > 0) {
      parts.push({
        key: 'harvest.presets.summary.warehouses',
        args: { count: input.priceScopeIds?.length ?? 0 },
      });
    } else if (input.priceScopeId !== undefined) {
      parts.push({ key: 'harvest.presets.summary.oneScope' });
    }
    if (copies > 0) {
      parts.push({
        key: 'harvest.presets.summary.copies',
        args: { count: copies },
      });
    }
    if (input.writes !== undefined) {
      parts.push({ key: `harvest.runs.start.writes.${input.writes}` });
    }
    if (input.details !== undefined) {
      parts.push({ key: `harvest.presets.summary.details.${input.details}` });
    }
    if (input.mode === 'STORE_DISCOVERY') {
      const codes = (input.postalCodes ?? []).length;
      parts.push(
        codes > 0
          ? {
              key: 'harvest.presets.summary.postalCodes',
              args: { count: codes },
            }
          : input.postalCode !== undefined
            ? { key: 'harvest.presets.summary.aroundPostalCode' }
            : { key: 'harvest.presets.summary.everyShop' }
      );
    }
    return parts;
  }

  refusalOf(id: string): RowRefusal | null {
    return this._refusals().get(id) ?? null;
  }

  runLink(runId: string): readonly string[] {
    return harvestRunPath(runId);
  }

  instant(value: string): string {
    return formatInstant(value);
  }

  /**
   * One click, and the run it started (admin plan 0030, section 3).
   *
   * The refusals stay on the row with the server's own words: a run already
   * active, and a scope the preset names that was deleted since it was saved.
   */
  async start(preset: Preset): Promise<void> {
    this.startingId.set(preset.id);
    this._setRefusal(preset.id, null);
    try {
      const run = await this._service.startPreset(preset.id);
      this.started.emit(run);
      // The row says how its last run ended, and that is this run now.
      void this.load();
    } catch (error) {
      const failure = toGatewayError(error);
      // A refusal that names a switch is what the state in the header of the
      // Runs tab is read from, so it is told as a refused run form is.
      this.shell.observeSpawnRefusal(spawnBlockReason(failure));
      const fields = Object.values(failure.fieldErrors).flat();
      const detail = fields.length > 0 ? fields.join(' ') : failure.detail;
      this._setRefusal(preset.id, {
        key:
          failure.status === 409
            ? 'harvest.presets.alreadyRunning'
            : detail === ''
              ? 'harvest.presets.startFailed'
              : 'harvest.presets.refused',
        detail,
      });
    } finally {
      this.startingId.set(null);
    }
  }

  openNew(): void {
    const chain = this.supermarketId();
    if (chain === '') {
      return;
    }
    this._openEditor({ preset: null, supermarketId: chain }, '');
  }

  openEdit(preset: Preset): void {
    this._openEditor(
      { preset, supermarketId: preset.supermarketId },
      preset.name
    );
  }

  closeEditor(): void {
    if (!this.saving()) {
      this.editing.set(null);
    }
  }

  onNameChange(name: string): void {
    this.name.set(name);
    this.nameTaken.set(false);
  }

  /**
   * Save the form under the name. The chain comes out of the request, because
   * a preset holds it as a column and its input has no field for it.
   */
  async save(request: Wire.SpawnHarvestRunDto): Promise<void> {
    const open = this.editing();
    const name = this.name().trim();
    if (open === null || name === '') {
      return;
    }
    const input: HarvestRunPresetInput & { supermarketId?: string } = {
      ...request,
    };
    delete input.supermarketId;

    this.saving.set(true);
    this.nameTaken.set(false);
    this.saveFailure.set(null);
    try {
      if (open.preset === null) {
        await this._service.createPreset(open.supermarketId, name, input);
      } else {
        await this._service.updatePreset(open.preset.id, { name, input });
      }
      this.editing.set(null);
      await this.load();
    } catch (error) {
      const failure = toGatewayError(error);
      if (failure.status === 409) {
        this.nameTaken.set(true);
      } else {
        const fields = Object.values(failure.fieldErrors).flat();
        this.saveFailure.set({
          detail: fields.length > 0 ? fields.join(' ') : failure.detail,
        });
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Runs started from it keep their record, which the dialog says. */
  async confirmDelete(preset: Preset): Promise<void> {
    this.deletingId.set(preset.id);
    this.deleteFailure.set(null);
    try {
      await this._service.deletePreset(preset.id);
      this.presets.update((rows) => rows.filter((row) => row.id !== preset.id));
      if (this.editing()?.preset?.id === preset.id) {
        this.editing.set(null);
      }
      this.pendingDelete.set(null);
    } catch (error) {
      // The dialog stays open with the failure in it, because a dialog that
      // closes on a refusal reads as a delete that worked.
      this.deleteFailure.set(toGatewayError(error).detail);
    } finally {
      this.deletingId.set(null);
    }
  }

  private _openEditor(editing: Editing, name: string): void {
    this.name.set(name);
    this.nameTaken.set(false);
    this.saveFailure.set(null);
    this.editing.set(editing);
  }

  private async _read(
    chain: string,
    cursor: string | undefined,
    generation: number
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this._service.listPresets(chain, cursor);
      if (generation !== this._generation) {
        return;
      }
      this.presets.update((held) => [...held, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.shell.observeReachable();
    } catch (error) {
      if (generation === this._generation) {
        this.error.set(toGatewayError(error));
        this.shell.observeFailure();
      }
    } finally {
      if (generation === this._generation) {
        this.loading.set(false);
      }
    }
  }

  private _setRefusal(id: string, refusal: RowRefusal | null): void {
    this._refusals.update((held) => {
      const next = new Map(held);
      if (refusal === null) {
        next.delete(id);
      } else {
        next.set(id, refusal);
      }
      return next;
    });
  }
}
