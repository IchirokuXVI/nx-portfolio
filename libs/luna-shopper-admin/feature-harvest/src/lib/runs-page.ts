import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  priceScopeSource,
  type PriceScope,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  failureBlockReason,
  spawnBlockReason,
  type HarvestRun,
  type HarvestRunMode,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  ReferencePicker,
  SwitchPanel,
} from '@portfolio/luna-shopper-admin/ui';
import { formatInstant } from './format-instant';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';

/** What the reverted filter can be asked for. `any` sends no filter at all. */
const REVERTED_OPTIONS = ['any', 'reverted', 'standing'] as const;
type RevertedFilter = (typeof REVERTED_OPTIONS)[number];

/**
 * The three run modes, in the order the picker offers them.
 *
 * `REFRESH` is gone (backend plan 0086, section 9). It existed only because a
 * walk threw its prices away and something had to fetch them again; a walk
 * writes them now, so the mode had nothing left to do and the form cannot name
 * it. `LEAFLET_IMPORT` is `FILE_IMPORT`, which is the same run under a name that
 * does not claim a leaflet produced the file.
 *
 * `FILE_IMPORT` is the only one this form does not start (admin plan 0010,
 * section 2). An import needs a document, and a document is a file, a preview
 * and a validation failure that names the product it is about. None of that fits
 * three text inputs, so choosing it here sends the operator to the screen that
 * does rather than growing this one a mode's worth of fields.
 */
const MODES: readonly HarvestRunMode[] = [
  'STORE_DISCOVERY',
  'CATALOG_DISCOVERY',
  'FILE_IMPORT',
];

/** How far the scope read walks looking for the chain's `NATIONAL` one. */
const SCOPE_PAGE = 100;

/**
 * The adapter whose walk writes prices and therefore needs a scope to write
 * them to (backend plan 0086, section 9).
 *
 * DEZA's site prints no price anywhere, so its walk writes none and the spawn
 * accepts a scope for it and ignores it. A field that does nothing is a lie in a
 * form, so it is not offered.
 */
const SCOPED_ADAPTER = 'mercadona-api';

/**
 * The runs screen: what has run, what is running, and how to start one.
 *
 * A run is a process rather than a resource, so this is not `0004`'s list with a
 * create form behind it. Starting one is a small set of choices with a mode at
 * the top, and reading one is a screen of its own that polls, so the row here
 * links out to that rather than to an edit form there is no such thing as.
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
    ReferencePicker,
    SwitchPanel,
  ],
  template: `
    <header>
      <h1>{{ 'harvest.runs.heading' | rokuT }}</h1>
    </header>

    <lib-switch-panel [switches]="shell.switches()" />

    <section class="start">
      <h2>{{ 'harvest.runs.start.heading' | rokuT }}</h2>

      <div class="fields">
        <label>
          <span>{{ 'harvest.runs.start.mode' | rokuT }}</span>
          <select [(ngModel)]="mode" name="mode">
            @for (option of modes; track option) {
              <option [value]="option">
                {{ 'harvest.mode.' + option | rokuT }}
              </option>
            }
          </select>
        </label>

        <!-- An import states its chain on the upload screen, beside the
             document that says which chain printed it (admin plan 0010). -->
        @if (!uploading()) {
          <label>
            <span>{{ 'harvest.runs.start.supermarketId' | rokuT }}</span>
            <input
              (ngModelChange)="onChainChange()"
              [(ngModel)]="supermarketId"
              name="supermarketId"
              type="text"
            />
          </label>
        }

        <!-- A walk writes prices now, so a Mercadona walk needs to be told
             which scope to write them to and the spawn refuses one without it
             (backend plan 0086, section 9). Shown on the adapter rather than on
             the mode, because a DEZA walk is the same mode and writes none. -->
        @if (needsScope()) {
          <div class="field">
            <span>{{ 'harvest.runs.start.priceScope' | rokuT }}</span>
            <lib-reference-picker
              (valueChange)="priceScopeId.set($event)"
              [controlId]="'run-scope'"
              [lookup]="references"
              [resource]="'price-scopes'"
              [scope]="scopeFilter()"
              [value]="priceScopeId()"
            />
            <p class="attribution">
              {{ 'harvest.runs.start.priceScopeHelp' | rokuT }}
            </p>
          </div>
        }

        @if (mode() === 'STORE_DISCOVERY') {
          <label>
            <span>{{ 'harvest.runs.start.postalCode' | rokuT }}</span>
            <input [(ngModel)]="postalCode" name="postalCode" type="text" />
          </label>
          <label>
            <span>{{ 'harvest.runs.start.country' | rokuT }}</span>
            <input [(ngModel)]="country" name="country" type="text" />
          </label>
        }
      </div>

      <p class="attribution">{{ 'harvest.runs.start.attribution' | rokuT }}</p>

      @if (uploading()) {
        <p class="attribution">{{ 'harvest.runs.start.fileImport' | rokuT }}</p>
        <a [routerLink]="uploadLink()" class="primary">{{
          'harvest.runs.start.openUpload' | rokuT
        }}</a>
      } @else {
        <button
          (click)="start()"
          [disabled]="starting() || !ready()"
          class="primary"
          type="button"
        >
          {{
            (starting()
              ? 'harvest.runs.start.starting'
              : 'harvest.runs.start.submit'
            ) | rokuT
          }}
        </button>
      }

      @if (blockedKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }
    </section>

    <section class="filters">
      <label>
        <span>{{ 'harvest.runs.filter.reverted' | rokuT }}</span>
        <select
          (ngModelChange)="onRevertedChange()"
          [(ngModel)]="reverted"
          name="reverted"
        >
          @for (option of revertedOptions; track option) {
            <option [value]="option">
              {{ 'harvest.runs.filter.revertedOption.' + option | rokuT }}
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
          <li>
            <a [routerLink]="[row.id]">
              <span class="mode">{{ 'harvest.mode.' + row.mode | rokuT }}</span>
              <span [class]="row.status" class="status">
                {{ 'harvest.status.' + row.status | rokuT }}
              </span>
              <!-- A second chip rather than a replacement: the status says how
                   the run ended and a revert does not change that. -->
              @if (row.reverted !== '') {
                <span [title]="row.revertedBy" class="reverted">
                  {{
                    'harvest.runs.row.reverted' | rokuT: { when: row.reverted }
                  }}
                </span>
              }
              <span class="when">{{ row.requested }}</span>
              <span class="counts">
                {{
                  'harvest.runs.row.counts'
                    | rokuT: { processed: row.processed, failed: row.failed }
                }}
              </span>
              @if (row.reasonKey; as key) {
                <span class="reason">{{ key | rokuT }}</span>
              }
            </a>
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

    .fields {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      inline-size: 100%;
    }

    label,
    .field {
      display: flex;
      flex: 1 1 12rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span,
    .field > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .attribution {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .primary {
      min-block-size: 2.75rem;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    /* The way to the upload, which is a link and not a button because it goes
       to a screen rather than doing something. It still looks like the primary
       action, because on that mode it is the only one there is. */
    a.primary {
      display: inline-flex;
      align-items: center;
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius);
      font-weight: 600;
      text-decoration: none;
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      inline-size: 100%;
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

    .runs a {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      text-decoration: none;
      color: inherit;
    }

    .mode {
      font-weight: 700;
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
      color: var(--admin-accent-ink);
    }

    .status.FAILED,
    .status.STALE {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-ink);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    .reverted {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      font-size: 0.75rem;
      color: var(--admin-danger-ink);
    }

    .when,
    .counts,
    .reason {
      color: var(--admin-ink-muted);
    }

    .reason {
      flex-basis: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunsPage {
  private readonly _service = inject(HARVEST_SERVICE);
  /** The chosen chain's scopes, read for their `kind`, as the import reads them. */
  private readonly _scopes =
    inject(RESOURCE_GATEWAYS).for<PriceScope>(priceScopeSource());

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  readonly modes = MODES;

  readonly mode = signal<HarvestRunMode>('CATALOG_DISCOVERY');
  readonly supermarketId = signal('');
  readonly priceScopeId = signal('');
  readonly postalCode = signal('');
  readonly country = signal('');
  /** The chosen chain's adapter, once a source read has answered. `''` until. */
  readonly adapterKey = signal('');

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

  readonly starting = signal(false);
  readonly loading = signal(true);
  readonly runs = signal<readonly HarvestRun[]>([]);
  readonly error = signal<GatewayError | null>(null);
  private readonly _spawnError = signal<GatewayError | null>(null);

  readonly failed = computed(
    () => this.error() !== null && this.runs().length === 0
  );

  /**
   * Whether the chosen mode is the one this form cannot start.
   *
   * A leaflet import needs a document, so this form offers the way to the
   * screen that takes one rather than a start button that would be refused for
   * a body it has no field for (admin plan 0010, section 2).
   */
  readonly uploading = computed(() => this.mode() === 'FILE_IMPORT');

  /**
   * Whether this walk has to be told which scope to write its prices to.
   *
   * The adapter decides, not the mode: `CATALOG_DISCOVERY` runs against either
   * `mercadona-api` or `deza-web` since backend plan 0085, and only the first
   * writes a price. The spawn refuses a Mercadona walk without a scope and
   * accepts and ignores one for DEZA, so the field appears exactly where it is
   * required.
   */
  readonly needsScope = computed(
    () =>
      this.mode() === 'CATALOG_DISCOVERY' &&
      this.adapterKey() === SCOPED_ADAPTER
  );

  /** The chain the scope picker reads within, which it cannot read without. */
  readonly scopeFilter = computed(() => ({
    supermarketId: this.supermarketId().trim(),
  }));

  /**
   * Whether the form has everything the spawn will require.
   *
   * Only the scope is checked here, because it is the only field whose absence
   * is a refusal the operator can see coming: everything else the spawn wants is
   * either optional or is the mode itself. Asked so the button is disabled
   * rather than pressed and answered with a 400 about a field that was on
   * screen, empty, the whole time.
   */
  readonly ready = computed(
    () => !this.needsScope() || this.priceScopeId() !== ''
  );

  /**
   * Where a document is dropped.
   *
   * Absolute rather than relative, for the reason the queues give: `..` needs a
   * route above it to pop and throws outright when there is none, and this
   * component is rendered directly in its spec.
   */
  uploadLink(): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'imports', 'upload'];
  }

  /**
   * The chain changed, so what is known about its source did too.
   *
   * The adapter is read rather than guessed, because it is what decides whether
   * the scope picker is offered at all, and the scope is cleared with it: a
   * scope of the previous chain is not a scope of this one.
   */
  onChainChange(): void {
    this.priceScopeId.set('');
    this.adapterKey.set('');
    void this._readAdapter();
  }

  /**
   * Which adapter this chain is fetched with, from its source row.
   *
   * A failure leaves the adapter unknown, which hides the picker. That is the
   * safe way round: a chain with no source row cannot be walked at all, so the
   * spawn refuses it before the scope is ever looked at, and offering a field
   * for a run that cannot start would be noise.
   */
  private async _readAdapter(): Promise<void> {
    const supermarketId = this.supermarketId().trim();
    if (supermarketId === '') {
      return;
    }

    try {
      const source = await this._service.readSource(supermarketId);
      this.adapterKey.set(source.adapterKey);
      this.shell.observeReachable();
      if (source.adapterKey === SCOPED_ADAPTER) {
        await this._preselectNationalScope(supermarketId);
      }
    } catch {
      this.adapterKey.set('');
    }
  }

  /**
   * The chain's `NATIONAL` scope, preselected as the import screen preselects it.
   *
   * Most walks price nationally, and a chain with several warehouse scopes
   * should not present them as equally plausible. A chain with none leaves the
   * picker empty and the operator chooses.
   */
  private async _preselectNationalScope(supermarketId: string): Promise<void> {
    try {
      const page = await this._scopes.list({
        filters: { supermarketId },
        limit: SCOPE_PAGE,
      });
      const national = page.items.find((scope) => scope.kind === 'NATIONAL');
      if (national !== undefined && this.priceScopeId() === '') {
        this.priceScopeId.set(national.id);
      }
    } catch {
      // The picker can still be typed into, so a failed read costs a shortcut
      // rather than the field.
    }
  }

  readonly rows = computed(() =>
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
    return error.status === 409
      ? 'harvest.runs.start.alreadyRunning'
      : 'harvest.runs.start.failed';
  });

  constructor() {
    void this.load();
  }

  /** The filter is a server side one, so changing it is a fresh read. */
  onRevertedChange(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const filter = this.reverted();
      const page = await this._service.listRuns({
        limit: 20,
        ...(filter === 'any' ? {} : { reverted: filter === 'reverted' }),
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

  /**
   * Start it, unless the form already knows the spawn would refuse.
   *
   * The guard is here and not only on the disabled button, because the button is
   * a hint and this is the rule: a Mercadona walk with no scope is a 400 the
   * screen can see coming, and sending it anyway would put a validation failure
   * about a field that was on screen and empty in front of the operator.
   */
  async start(): Promise<void> {
    if (!this.ready()) {
      return;
    }

    this.starting.set(true);
    this._spawnError.set(null);

    try {
      await this._service.spawnRun(this._input());
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

  /**
   * The spawn body, with blank fields left out entirely.
   *
   * An empty string is not a postal code and not a uuid, and the harvester's
   * DTOs validate what they are given, so sending one turns "I left this blank"
   * into a validation failure about a field the operator never filled in.
   */
  private _input(): Wire.SpawnHarvestRunDto {
    const input: Wire.SpawnHarvestRunDto = { mode: this.mode() };
    const optional = {
      supermarketId: this.supermarketId().trim(),
      // Sent only where it means something. `deza-web` accepts one and ignores
      // it, so sending it there would be this screen asserting a fact about a
      // run that has none.
      priceScopeId: this.needsScope() ? this.priceScopeId() : '',
      postalCode: this.postalCode().trim(),
      country: this.country().trim(),
    };

    return Object.entries(optional).reduce<Wire.SpawnHarvestRunDto>(
      (body, [name, value]) =>
        value === '' ? body : { ...body, [name]: value },
      input
    );
  }
}

function reasonKey(reason: string | null): string | null {
  return reason === null ? null : `harvest.blocked.${reason}`;
}
