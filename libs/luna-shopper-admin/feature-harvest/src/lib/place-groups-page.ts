import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import { HarvestNotice } from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';
import { placeGroupRows, type PlaceGroupRow } from './place-groups';

/** How many places each group shows by name. The count says the rest. */
const SAMPLE_SIZE = 3;

/**
 * The places queue, grouped by chain (admin plan 0034, section 4).
 *
 * The question it answers is "which chains did discovery find, and how many
 * shops of each", which the queue cannot: it shows one place at a time, or a
 * list of places, and a run that returns seventeen brands is read as seventeen
 * groups before it is read as a hundred rows. `places/groups` has answered it
 * since backend plan 0038 and nothing drew it.
 *
 * Read only. Deciding a place is the queue's work, and a second screen that
 * imported would be a second place for the matching rules of backend plan 0152
 * to be got wrong.
 */
@Component({
  selector: 'lib-place-groups-page',
  imports: [RouterLink, RokuTranslatorPipe, HarvestNotice],
  template: `
    <header>
      <h1>{{ 'harvest.places.groups.heading' | rokuT }}</h1>
      <p class="lead">{{ 'harvest.places.groups.lead' | rokuT }}</p>
      <a [routerLink]="queueLink">{{ 'harvest.places.groups.back' | rokuT }}</a>
    </header>

    @if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      @if (rows().length === 0) {
        <p class="state">{{ 'harvest.places.groups.empty' | rokuT }}</p>
      } @else {
        <ul class="groups">
          @for (group of rows(); track group.key) {
            <li>
              <div class="head">
                <strong>
                  @if (group.name === '') {
                    {{ 'harvest.places.groups.noBrand' | rokuT }}
                  } @else {
                    {{ group.name }}
                  }
                </strong>
                @if (group.brandKey !== '') {
                  <code>{{ group.brandKey }}</code>
                }
                <span class="count">{{
                  'harvest.places.groups.count' | rokuT: { count: group.count }
                }}</span>
              </div>

              <p class="chain">
                @if (group.supermarketId === '') {
                  {{ 'harvest.places.groups.unknownChain' | rokuT }}
                } @else {
                  {{
                    'harvest.places.groups.knownChain'
                      | rokuT: { chain: names.nameOf(group.supermarketId) }
                  }}
                }
              </p>

              @if (group.sample.length > 0) {
                <p class="sample">{{ group.sample.join(', ') }}</p>
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    header {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    header a {
      align-self: flex-start;
      color: var(--admin-accent);
    }

    header a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .lead,
    .state,
    .chain,
    .sample,
    .count {
      color: var(--admin-ink-muted);
    }

    .lead,
    .chain,
    .sample {
      margin: 0;
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .failure {
      color: var(--admin-danger);
    }

    .groups {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: var(--admin-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .groups li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-3) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: baseline;
    }

    code {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .count {
      margin-inline-start: auto;
      font-variant-numeric: tabular-nums;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceGroupsPage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);
  readonly names = inject(ChainNames);

  readonly queueLink = ['/', HARVEST_SEGMENT, 'places'];

  readonly rows = signal<readonly PlaceGroupRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<GatewayError | null>(null);

  readonly failed = computed(
    () => this.error() !== null && this.rows().length === 0
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
      const result = await this._service.placeGroups({
        sampleSize: SAMPLE_SIZE,
      });
      const rows = placeGroupRows(result);
      this.rows.set(rows);
      this.shell.observeReachable();
      void this.names.resolve(
        rows.map((row) => row.supermarketId).filter((id) => id !== '')
      );
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.loading.set(false);
    }
  }
}
