import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  DashboardStore,
  PostalCodeSummaryStore,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import { runProgress } from '@portfolio/luna-shopper-admin/models';
import {
  BarChart,
  BlockNotice,
  RunProgressView,
  RunRowView,
  StatTile,
} from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { formatInstant, formatSince } from './format-instant';
import {
  postalCodeCaption,
  recentRunRows,
  runsByStatusChart,
} from './harvest-dashboard-view';
import { HARVEST_SEGMENT } from './harvest-paths';

/**
 * The harvester section's own dashboard (admin plan 0022, sections 5, 7 and 9).
 *
 * What is running, what ran, and what is waiting on a code nobody has looked at.
 * It was the harvest block of one long overview, and it is a screen now for the
 * same reason the other two are: the overview keeps what is true of the whole
 * system, and a run that finished last night is true of one part of it.
 *
 * **This is the screen that keeps the fast poll.** `0016` sped the store up
 * whenever a run was in flight, wherever the operator happened to be, so a run
 * that started at midnight made a catalog screen re-read four times a minute to
 * follow something it does not draw. The rule is on this screen instead: the
 * store is told to follow runs while this is open and told to stop on its
 * teardown.
 *
 * **The postal codes card is here and its count is also on the overview, and
 * that is not a duplicate.** The queued count stands for people opening velista
 * and being told we have nothing for them, which is why `0021` put it on the
 * work waiting row; the failures and the age of the oldest queued row belong
 * beside the runs that produced them, which is here. Both read the one summary
 * call either way.
 */
@Component({
  selector: 'lib-harvest-dashboard',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    BarChart,
    BlockNotice,
    RunProgressView,
    RunRowView,
    StatTile,
  ],
  template: `
    <h1>{{ 'shell.sections.harvest' | rokuT }}</h1>

    @if (document(); as doc) {
      @if (doc.harvest; as harvest) {
        @if (running(); as run) {
          <div class="running">
            <h2>{{ 'dashboard.harvest.running' | rokuT }}</h2>
            <p class="what">
              {{ 'harvest.mode.' + run.mode | rokuT }}
              @if (run.supermarketId; as chain) {
                <span class="chain">{{ chainName(chain) }}</span>
              }
            </p>
            <lib-run-progress [progress]="progress(run)" [run]="run" />
            <a [routerLink]="runLink(run.id)">{{
              'dashboard.harvest.openRun' | rokuT
            }}</a>
          </div>
        } @else {
          <p class="state">{{ 'dashboard.harvest.noRun' | rokuT }}</p>
        }

        <h2>{{ 'dashboard.harvest.recent' | rokuT }}</h2>
        @if (recentRuns().length === 0) {
          <p class="state">{{ 'dashboard.harvest.noRuns' | rokuT }}</p>
        } @else {
          <ul class="runs">
            @for (row of recentRuns(); track row.id) {
              <li><lib-run-row [link]="runLink(row.id)" [row]="row" /></li>
            }
          </ul>
        }

        <lib-bar-chart
          [bars]="runsByStatus().bars"
          [series]="runsByStatus().series"
          [title]="text('dashboard.harvest.byStatusTitle')"
        />

        <a [routerLink]="sourcesLink()" class="sources">
          {{
            'dashboard.harvest.sources'
              | rokuT
                : {
                    enabled: harvest.sources.enabled,
                    total: harvest.sources.total,
                  }
          }}
        </a>
      } @else {
        <lib-block-notice
          (retry)="refresh()"
          [heading]="'dashboard.down.harvest'"
        />
      }
    } @else {
      <p class="state">{{ 'dashboard.loading' | rokuT }}</p>
    }

    <!-- Outside the harvest block on purpose: the summary is a call of its own,
         so a harvester that did not answer the dashboard still shows what is
         queued (admin plan 0021, section 6). -->
    @if (postalCodes(); as codes) {
      <section class="codes">
        <h2>{{ 'harvest.postalCodes.many' | rokuT }}</h2>
        <lib-stat-tile
          [caption]="codes.caption ?? undefined"
          [label]="text('dashboard.waiting.postalCodes')"
          [link]="postalCodesLink() ?? undefined"
          [tone]="codes.tone"
          [value]="codes.queued"
        />
      </section>
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
      font-size: 1.125rem;
      font-weight: 700;
    }

    .state,
    .chain {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .running {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .what {
      font-weight: 700;
    }

    .chain {
      margin-inline-start: var(--admin-space-2);
      font-weight: 400;
    }

    .runs {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .codes {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
    }

    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HarvestDashboard {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _chains = inject(ChainNames);
  private readonly _postalCodes = inject(PostalCodeSummaryStore);

  readonly store = inject(DashboardStore);
  readonly document = this.store.document;

  constructor() {
    this.store.watch();
    // The one screen that draws the run in flight, so the one screen the fast
    // poll belongs to.
    this.store.followRuns(true);
    // The postal code queue's summary, which is not in the dashboard document
    // and is one call beside it. Read once on arrival and again on a refresh.
    void this._postalCodes.load();
    // A component's teardown, which is the one that actually runs: a route's
    // providers injector is never destroyed.
    inject(DestroyRef).onDestroy(() => this.store.stop());

    // The names are read once the ids are known, and again only when a poll
    // brings an id nothing has named yet. `untracked`, because the resolution
    // writes the signal this effect would otherwise depend on.
    effect(() => {
      const ids = this._chainIds();
      untracked(() => void this._chains.resolve(ids));
    });
  }

  readonly running = computed(() => this.document()?.harvest?.running ?? null);

  readonly recentRuns = computed(() => {
    const harvest = this.document()?.harvest ?? null;
    return harvest === null
      ? []
      : recentRunRows(harvest.recent, (value) =>
          formatInstant(value, this._translate.locale())
        );
  });

  readonly runsByStatus = computed(() => {
    const harvest = this.document()?.harvest ?? null;
    return harvest === null
      ? { bars: [], series: [] }
      : runsByStatusChart(harvest, this._text);
  });

  /** The queue's three numbers, or `null` where the summary did not answer. */
  readonly postalCodes = computed(() => {
    const summary = this._postalCodes.summary();
    if (summary === null) {
      return null;
    }

    return {
      queued: summary.queued,
      caption: postalCodeCaption(summary, this._text, (value) =>
        formatSince(value, Date.now(), this._translate.locale())
      ),
      tone: summary.queued > 0 ? ('attention' as const) : ('quiet' as const),
    };
  });

  /** How far a run has got, which is the run screen's own arithmetic. */
  readonly progress = runProgress;

  /** A key as a sentence, for a component input that takes words not keys. */
  text(key: string): string {
    return this._text(key);
  }

  /** The chain's name, or its id where the reference could not name it. */
  chainName(supermarketId: string): string {
    return this._chains.nameOf(supermarketId);
  }

  runLink(id: string): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'runs', id];
  }

  sourcesLink(): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'sources'];
  }

  postalCodesLink(): readonly string[] | null {
    return this._registry.pathOf('postal-codes');
  }

  refresh(): void {
    void this.store.load();
    // Forced, because the store answers a summary it already has and a refresh
    // is the one place an operator is asking for a newer one.
    void this._postalCodes.load(true);
  }

  /** Every chain the run in flight mentions, which is at most one. */
  private readonly _chainIds = computed<readonly string[]>(() => {
    const running = this.document()?.harvest?.running?.supermarketId ?? null;
    return running === null ? [] : [running];
  });

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
