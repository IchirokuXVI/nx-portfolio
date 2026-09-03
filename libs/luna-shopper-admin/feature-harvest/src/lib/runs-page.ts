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
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  failureBlockReason,
  spawnBlockReason,
  type HarvestRun,
  type HarvestRunMode,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { HarvestNotice, SwitchPanel } from '@portfolio/luna-shopper-admin/ui';
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';

/** The three run modes, in the order the picker offers them. */
const MODES: readonly HarvestRunMode[] = [
  'STORE_DISCOVERY',
  'CATALOG_DISCOVERY',
  'REFRESH',
];

/**
 * The runs screen: what has run, what is running, and how to start one.
 *
 * A run is a process rather than a resource, so this is not `0004`'s list with a
 * create form behind it. Starting one is a small set of choices with a mode at
 * the top, and reading one is a screen of its own that polls, so the row here
 * links out to that rather than to an edit form there is no such thing as.
 *
 * The three switches sit above the list rather than on a settings screen
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

        <label>
          <span>{{ 'harvest.runs.start.supermarketId' | rokuT }}</span>
          <input [(ngModel)]="supermarketId" name="supermarketId" type="text" />
        </label>

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

      <button
        (click)="start()"
        [disabled]="starting()"
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

      @if (blockedKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }
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

    .attribution {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .primary {
      min-block-size: 2.75rem;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
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

  readonly shell = inject(HarvestShell);

  readonly modes = MODES;

  readonly mode = signal<HarvestRunMode>('CATALOG_DISCOVERY');
  readonly supermarketId = signal('');
  readonly postalCode = signal('');
  readonly country = signal('');

  readonly starting = signal(false);
  readonly loading = signal(true);
  readonly runs = signal<readonly HarvestRun[]>([]);
  readonly error = signal<GatewayError | null>(null);
  private readonly _spawnError = signal<GatewayError | null>(null);

  readonly failed = computed(
    () => this.error() !== null && this.runs().length === 0
  );

  readonly rows = computed(() =>
    this.runs().map((run) => ({
      id: run.id,
      mode: run.mode,
      status: run.status,
      requested: formatInstant(run.requestedAt),
      processed: run.processed,
      failed: run.failed,
      // A finished run that failed because of a switch says which one, on the
      // row, because that is where somebody is looking when they wonder.
      reasonKey: reasonKey(failureBlockReason(run)),
    }))
  );

  /**
   * Why the last attempt to start would not start.
   *
   * The spawn refusal is the only direct evidence any of the three switches
   * offers, so it is kept and shown rather than folded into a general failure
   * message. A 409 is different again: something is already running, which is
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

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const page = await this._service.listRuns({ limit: 20 });
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

  async start(): Promise<void> {
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
