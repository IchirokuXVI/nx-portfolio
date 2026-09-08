import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  BlockNotice,
  LineChart,
  StatTile,
} from '@portfolio/luna-shopper-admin/ui';
import {
  peopleTiles,
  signUpsChart,
  zonesAndListsChart,
} from './people-dashboard-view';

/**
 * The shoppers section's own dashboard (admin plan 0022, sections 5 and 7).
 *
 * Who is using velista and what they have made together. It was the people
 * block of one long overview, and the overview keeps only what is true of the
 * whole system, so a count of users is the first line of this screen rather than
 * the fourth line of that one.
 *
 * **Two blocks, two notices.** Users come from auth and zones, lists and baskets
 * come from core, and either can be missing on its own. A screen that drew one
 * notice for both would say the wrong thing half the time.
 *
 * **It issues no request.** `DashboardStore` is `providedIn: 'root'` and already
 * re-reads once a minute while the tab is visible.
 */
@Component({
  selector: 'lib-people-dashboard',
  imports: [RokuTranslatorPipe, BlockNotice, LineChart, StatTile],
  template: `
    <h1>{{ 'shell.sections.shoppers' | rokuT }}</h1>

    @if (document(); as doc) {
      @if (doc.identity === null) {
        <lib-block-notice
          (retry)="refresh()"
          [heading]="'dashboard.down.identity'"
        />
      }
      @if (doc.core === null) {
        <lib-block-notice
          (retry)="refresh()"
          [heading]="'dashboard.down.core'"
        />
      }

      @if (tiles().length > 0) {
        <!-- The tile is the grid item, so a plain tile beside the sparkline
             tile shares its row's height, with quiet space under its number
             (admin plan 0024, section 2). -->
        <div class="tiles">
          @for (tile of tiles(); track tile.key) {
            <lib-stat-tile
              [caption]="tile.caption ?? undefined"
              [delta]="tile.delta ?? undefined"
              [label]="tile.label"
              [link]="tile.link ?? undefined"
              [tone]="tile.tone"
              [trend]="tile.trend ?? undefined"
              [value]="tile.value"
            />
          }
        </div>
      }

      @if (signUps(); as series) {
        <lib-line-chart
          [series]="series"
          [title]="text('dashboard.shoppers.signUpsTitle')"
        />
      }
      @if (zonesAndLists(); as series) {
        <lib-line-chart
          [series]="series"
          [title]="text('dashboard.shoppers.zonesAndLists')"
        />
      }
    } @else {
      <p class="state">{{ 'dashboard.loading' | rokuT }}</p>
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

    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
      gap: var(--admin-space-3);
    }

    .state {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeopleDashboard {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _registry = inject(ResourceRegistry);

  readonly store = inject(DashboardStore);
  readonly document = this.store.document;

  constructor() {
    this.store.watch();
    // A component's teardown, which is the one that actually runs: a route's
    // providers injector is never destroyed.
    inject(DestroyRef).onDestroy(() => this.store.stop());
  }

  readonly tiles = computed(() => {
    const document = this.document();
    return document === null
      ? []
      : peopleTiles(document.identity, document.core, this._text, this._pathOf);
  });

  readonly signUps = computed(() => {
    const identity = this.document()?.identity ?? null;
    return identity === null ? null : signUpsChart(identity, this._text);
  });

  readonly zonesAndLists = computed(() => {
    const core = this.document()?.core ?? null;
    return core === null ? null : zonesAndListsChart(core, this._text);
  });

  /** A key as a sentence, for a component input that takes words not keys. */
  text(key: string): string {
    return this._text(key);
  }

  refresh(): void {
    void this.store.load();
  }

  /** Where a resource is mounted, which is the section's business and not this screen's. */
  private readonly _pathOf = (name: string): readonly string[] | null =>
    this._registry.pathOf(name);

  /**
   * The translator, as the plain function the selectors take.
   *
   * A bound arrow rather than a method reference, because the selectors call it
   * without a receiver and `t` reads instance state.
   */
  private readonly _text = (
    key: string,
    values?: Record<string, unknown>
  ): string => this._translate.t(key, undefined, undefined, values);
}
