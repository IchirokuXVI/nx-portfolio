import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
  type HarvestRunPresetInput,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  ReferencePicker,
} from '@portfolio/luna-shopper-admin/ui';
import { formatInstant } from './format-instant';
import { HARVEST_SEGMENT } from './harvest-paths';
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

/**
 * The presets screen (admin plan 0030, section 3): a chain's saved runs, and
 * the way to start, edit and delete one.
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
  selector: 'lib-presets-page',
  imports: [
    FormsModule,
    RouterLink,
    RokuTranslatorPipe,
    ConfirmDialog,
    HarvestNotice,
    ReferencePicker,
    RunRequestForm,
  ],
  template: `
    <header>
      <h1>{{ 'harvest.presets.heading' | rokuT }}</h1>
    </header>

    <section class="toolbar">
      <div class="field">
        <span>{{ 'harvest.presets.chain' | rokuT }}</span>
        <lib-reference-picker
          (valueChange)="chooseChain($event)"
          [controlId]="'presets-chain'"
          [lookup]="references"
          [resource]="'supermarkets'"
          [value]="supermarketId()"
        />
      </div>
      <button
        (click)="openNew()"
        [disabled]="supermarketId() === '' || editing() !== null"
        class="primary"
        type="button"
      >
        {{ 'harvest.presets.new' | rokuT }}
      </button>
    </section>

    @if (editing(); as open) {
      <section class="editor">
        <h2>
          {{
            (open.preset === null
              ? 'harvest.presets.newHeading'
              : 'harvest.presets.editHeading'
            ) | rokuT
          }}
        </h2>
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
            <div class="head">
              <span class="preset-name">{{ preset.name }}</span>
              <span class="mode">
                {{ 'harvest.mode.' + preset.input.mode | rokuT }}
              </span>
            </div>
            <p class="summary">
              @for (part of summaryOf(preset); track part.key) {
                <span>{{ part.key | rokuT: part.args ?? {} }}</span>
              }
            </p>
            <p class="last">
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
            </p>
            <div class="actions">
              <button
                (click)="start(preset)"
                [disabled]="busyId() !== null"
                class="primary"
                type="button"
              >
                {{
                  (startingId() === preset.id
                    ? 'harvest.presets.starting'
                    : 'harvest.presets.start'
                  ) | rokuT
                }}
              </button>
              <button
                (click)="openEdit(preset)"
                [disabled]="busyId() !== null || editing() !== null"
                type="button"
              >
                {{ 'harvest.presets.edit' | rokuT }}
              </button>
              <button
                (click)="pendingDelete.set(preset)"
                [disabled]="busyId() !== null"
                class="danger"
                type="button"
              >
                {{ 'harvest.presets.delete.action' | rokuT }}
              </button>
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

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
    }

    .field,
    label {
      display: flex;
      flex: 1 1 16rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .field > span,
    label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .editor {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .editor .name {
      flex: 0 0 auto;
      inline-size: 100%;
      max-inline-size: 26rem;
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
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      inline-size: 100%;
      font-size: 0.875rem;
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .presets {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .presets li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--admin-space-2) var(--admin-space-4);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    /* The preset a notice on the runs page linked to. */
    .presets li.highlighted {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    .preset-name {
      font-weight: 700;
    }

    .mode,
    .summary,
    .last {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .summary {
      grid-column: 1;
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--admin-space-3);
    }

    .last {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
    }

    .last-run {
      display: inline-flex;
      gap: var(--admin-space-2);
      align-items: center;
      color: inherit;
    }

    .status {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      text-transform: uppercase;
    }

    .status.RUNNING,
    .status.PENDING {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .status.FAILED,
    .status.STALE {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .actions {
      grid-column: 2;
      grid-row: 2;
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      justify-content: flex-end;
    }

    .presets li .failure {
      grid-column: 1 / -1;
    }

    /* One column on a phone: the actions go under the summary. */
    @media (max-width: 40rem) {
      .presets li {
        grid-template-columns: minmax(0, 1fr);
      }

      .last,
      .actions {
        grid-column: 1;
        grid-row: auto;
        justify-self: start;
        justify-content: flex-start;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetsPage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _router = inject(Router);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

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
    const chain = query.get('chain') ?? '';
    if (chain !== '') {
      this.chooseChain(chain);
    }
  }

  chooseChain(supermarketId: string): void {
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
    return ['/', HARVEST_SEGMENT, 'runs', runId];
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
      await this._router.navigate(['/', HARVEST_SEGMENT, 'runs'], {
        queryParams: { run: run.id },
      });
    } catch (error) {
      const failure = toGatewayError(error);
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
