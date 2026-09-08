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
  BarChart,
  BlockNotice,
  StatTile,
} from '@portfolio/luna-shopper-admin/ui';
import { catalogTiles, pricesWrittenChart } from './catalog-dashboard-view';

/**
 * The catalog section's own dashboard (admin plan 0022, sections 5 and 7).
 *
 * How much catalog there is and how much of it is being priced. It was the
 * catalog block of one long overview, and it is a screen now because the
 * overview keeps only what is true of the whole system: every queue in one
 * place, a fact about the tool itself, and the feed that crosses all three audit
 * trails. A count of products is none of those. It was on the overview because
 * there was nowhere else for it, and this is the somewhere else.
 *
 * **It issues no request.** `DashboardStore` is `providedIn: 'root'` and already
 * re-reads once a minute while the tab is visible, so this reads a document that
 * is being kept fresh by the screen the operator came from.
 *
 * `catalog: null` draws `0016` section 5's notice in place of the whole page
 * body rather than in place of a section, because on this screen the block is
 * the page. The operator opened a section and is told which service did not
 * answer, which is the same copy one screen further in.
 */
@Component({
  selector: 'lib-catalog-dashboard',
  imports: [RokuTranslatorPipe, BarChart, BlockNotice, StatTile],
  template: `
    <h1>{{ 'shell.sections.catalog' | rokuT }}</h1>

    @if (document(); as doc) {
      @if (doc.catalog === null) {
        <lib-block-notice
          (retry)="refresh()"
          [heading]="'dashboard.down.catalog'"
        />
      } @else {
        <!-- The tile is the grid item, so every tile in a row shares the
             row's height (admin plan 0024, section 2). -->
        <div class="tiles">
          @for (tile of tiles(); track tile.key) {
            <lib-stat-tile
              [caption]="tile.caption ?? undefined"
              [label]="tile.label"
              [link]="tile.link ?? undefined"
              [tone]="tile.tone"
              [value]="tile.value"
            />
          }
        </div>

        <lib-bar-chart
          [bars]="pricesWritten().bars"
          [series]="pricesWritten().series"
          [title]="text('dashboard.catalog.pricesWritten')"
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
export class CatalogDashboard {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _registry = inject(ResourceRegistry);

  readonly store = inject(DashboardStore);
  readonly document = this.store.document;

  constructor() {
    this.store.watch();
    // A component's teardown, which is the one that actually runs: a route's
    // providers injector is never destroyed, so a route scoped service's
    // `DestroyRef` would never fire and the poll would outlive this screen.
    inject(DestroyRef).onDestroy(() => this.store.stop());
  }

  readonly tiles = computed(() => {
    const catalog = this.document()?.catalog ?? null;
    return catalog === null
      ? []
      : catalogTiles(catalog, this._text, this._pathOf);
  });

  readonly pricesWritten = computed(() => {
    const catalog = this.document()?.catalog ?? null;
    return catalog === null
      ? { bars: [], series: [] }
      : pricesWrittenChart(catalog, this._text, (day) => this._day(day));
  });

  /** A key as a sentence, for a component input that takes words not keys. */
  text(key: string): string {
    return this._text(key);
  }

  refresh(): void {
    void this.store.load();
  }

  /**
   * A day of the window as a short label, with `Intl` and never with `DatePipe`.
   *
   * The wire carries `YYYY-MM-DD` and thirty of those along an axis are
   * unreadable. Parsed at noon UTC rather than at midnight, so a viewer west of
   * Greenwich is not shown the day before.
   */
  private _day(day: string): string {
    return new Intl.DateTimeFormat(this._translate.locale(), {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00.000Z`));
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
