import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { HarvestNotice } from '@portfolio/luna-shopper-admin/ui';
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';

type Source = Wire.HarvestSupermarketSourceView;

/** The adapters `UpsertSupermarketSourceDto` accepts. */
const ADAPTERS: readonly Wire.EnumsAdapterKey[] = [
  'mercadona-api',
  'osm-places',
  'manual',
];

/**
 * Per chain fetching configuration (plan 0006, sections 3 and 8).
 *
 * This is where the **one** switch of section 3 that the app is allowed to
 * change lives. `enabled` is per chain and is application state, unlike
 * `HARVEST_ENABLED` and `MERCADONA_ENABLED`, which are deployment configuration
 * and are shown on the runs screen without a control beside them.
 *
 * Putting it here rather than in the switch panel is the point. Three deployment
 * switches an operator cannot touch and one they can, all in a row, would read
 * as four of the same kind of thing, and the whole reason the panel exists is
 * that they are not.
 *
 * `enabled` gets its own route because describing a chain and starting to fetch
 * it are two decisions. The toggle calls that route directly, so turning a chain
 * on does not resend a configuration nobody was editing.
 */
@Component({
  selector: 'lib-sources-page',
  imports: [FormsModule, RokuTranslatorPipe, HarvestNotice],
  template: `
    <header>
      <h1>{{ 'harvest.sources.heading' | rokuT }}</h1>
      <p class="lead">{{ 'harvest.sources.lead' | rokuT }}</p>
    </header>

    @if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (sources().length === 0) {
      <p class="state">{{ 'harvest.sources.empty' | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      <ul class="sources">
        @for (source of sources(); track source.id) {
          <li>
            <div class="row">
              <span class="chain">{{ source.supermarketId }}</span>
              <span class="adapter">{{ source.adapterKey }}</span>

              <button
                (click)="toggle(source)"
                [attr.aria-pressed]="source.enabled"
                [class.on]="source.enabled"
                [disabled]="busyId() === source.supermarketId"
                class="toggle"
                type="button"
              >
                {{
                  (source.enabled
                    ? 'harvest.sources.enabled'
                    : 'harvest.sources.disabled'
                  ) | rokuT
                }}
              </button>
            </div>

            <dl>
              <div>
                <dt>{{ 'harvest.sources.field.workers' | rokuT }}</dt>
                <dd>{{ source.workers }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.sources.field.rate' | rokuT }}</dt>
                <dd>{{ source.maxRequestsPerSecond }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.sources.field.lastRunAt' | rokuT }}</dt>
                <dd>{{ instant(source.lastRunAt) }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.sources.field.lastSuccessAt' | rokuT }}</dt>
                <dd>{{ instant(source.lastSuccessAt) }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.sources.field.failures' | rokuT }}</dt>
                <dd>{{ source.consecutiveFailures }}</dd>
              </div>
            </dl>

            @if (editing() === source.supermarketId) {
              <div class="edit">
                <label>
                  <span>{{ 'harvest.sources.field.adapter' | rokuT }}</span>
                  <select [(ngModel)]="adapterKey" name="adapterKey">
                    @for (option of adapters; track option) {
                      <option [value]="option">{{ option }}</option>
                    }
                  </select>
                </label>
                <label>
                  <span>{{ 'harvest.sources.field.workers' | rokuT }}</span>
                  <input
                    [(ngModel)]="workers"
                    min="1"
                    name="workers"
                    type="number"
                  />
                </label>
                <label>
                  <span>{{ 'harvest.sources.field.rate' | rokuT }}</span>
                  <input [(ngModel)]="rate" min="1" name="rate" type="number" />
                </label>

                <div class="controls">
                  <button (click)="save(source)" class="primary" type="button">
                    {{ 'resource.action.save' | rokuT }}
                  </button>
                  <button (click)="editing.set(null)" type="button">
                    {{ 'resource.action.cancel' | rokuT }}
                  </button>
                </div>
              </div>
            } @else {
              <button (click)="edit(source)" type="button">
                {{ 'harvest.sources.edit' | rokuT }}
              </button>
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

    .lead,
    .state {
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .sources {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      list-style: none;
    }

    .sources li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      inline-size: 100%;
    }

    .chain {
      flex: 1;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .adapter {
      color: var(--admin-ink-muted);
    }

    .toggle {
      min-block-size: 2.75rem;
      min-inline-size: 7rem;
    }

    .toggle.on {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-ink);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .edit {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
      inline-size: 100%;
    }

    label {
      display: flex;
      flex: 1 1 8rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .controls {
      display: flex;
      gap: var(--admin-space-3);
    }

    .primary {
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcesPage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);

  readonly adapters = ADAPTERS;

  readonly sources = signal<readonly Source[]>([]);
  readonly loading = signal(true);
  readonly error = signal<GatewayError | null>(null);
  /** The chain a write is in flight for, so only its own control is disabled. */
  readonly busyId = signal<string | null>(null);
  readonly editing = signal<string | null>(null);

  readonly adapterKey = signal<Wire.EnumsAdapterKey>('manual');
  readonly workers = signal(1);
  readonly rate = signal(1);

  readonly failed = computed(
    () => this.error() !== null && this.sources().length === 0
  );

  readonly errorKey = computed(() =>
    this.failed() ? null : gatewayErrorKey(this.error())
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const page = await this._service.listSources({ limit: 50 });
      this.sources.set(page.items);
      this.shell.observeReachable();
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.loading.set(false);
    }
  }

  edit(source: Source): void {
    this.editing.set(source.supermarketId);
    this.adapterKey.set(source.adapterKey);
    this.workers.set(source.workers);
    this.rate.set(source.maxRequestsPerSecond);
  }

  /**
   * Turn one chain on or off.
   *
   * The reply replaces the row rather than the screen reading the list again, so
   * an operator working down a list of chains does not lose their place on every
   * toggle. A failure leaves the row as it was, because a control that flipped
   * and then silently flipped back would be worse than one that did not move.
   */
  async toggle(source: Source): Promise<void> {
    this.busyId.set(source.supermarketId);
    this.error.set(null);

    try {
      const updated = await this._service.setSourceEnabled(
        source.supermarketId,
        !source.enabled
      );
      this._replace(updated);
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  async save(source: Source): Promise<void> {
    this.busyId.set(source.supermarketId);
    this.error.set(null);

    try {
      const updated = await this._service.upsertSource(source.supermarketId, {
        adapterKey: this.adapterKey(),
        workers: this.workers(),
        maxRequestsPerSecond: this.rate(),
        // The chain's own configuration is sent back unchanged. This form does
        // not edit it: `config` is adapter shaped free form JSON, and a text box
        // that let somebody paste anything into a column the harvester reads at
        // fetch time is a bigger feature than this screen.
        config: source.config,
      });
      this._replace(updated);
      this.editing.set(null);
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  instant(value: string | null): string {
    return formatInstant(value);
  }

  private _replace(source: Source): void {
    this.sources.update((rows) =>
      rows.map((row) => (row.id === source.id ? source : row))
    );
  }
}
