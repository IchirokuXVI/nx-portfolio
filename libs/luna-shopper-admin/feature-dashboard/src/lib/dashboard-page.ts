import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  formatInstant,
  formatSince,
  HARVEST_SEGMENT,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { runProgress } from '@portfolio/luna-shopper-admin/models';
import {
  BarChart,
  LineChart,
  RunProgressView,
  RunRowView,
  StatTile,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { BlockNotice } from './block-notice';
import {
  activityRows,
  catalogTiles,
  loginFailureRows,
  peopleTiles,
  pricesWrittenChart,
  recentRunRows,
  runsByStatusChart,
  signUpsChart,
  waitingTiles,
  zonesAndListsChart,
} from './dashboard-view';

/**
 * The screen the app opens to (admin plan 0016).
 *
 * `0004` refused a landing page because an operator opens this tool to change a
 * specific thing and a page in front of that is a click between them and it.
 * That is an argument against an empty landing page and it stands. This one
 * answers, on arrival and in one screen, the questions an operator otherwise
 * opens six screens to answer: is anything waiting for a decision, did last
 * night's run finish, how many people are here this week compared with last, did
 * somebody try to guess an admin password.
 *
 * The order of the sections is the order of what an operator does with it. What
 * needs a decision, then what is running, then how the product is doing, then
 * what changed.
 *
 * **One read.** There is no per block request and no per chart request: the
 * store holds the whole document and a block that did not answer arrives as
 * `null` in it. Each section draws its own notice in that case and the rest of
 * the page draws, because three blocks of true numbers are worth more than an
 * error page produced by the fourth.
 *
 * **`harvesterDeployed` is deliberately not consulted.** That helper says
 * production and staging do not run the harvester, and both do now, so the
 * document is the only thing that knows whether the block is missing.
 */
@Component({
  selector: 'lib-dashboard-page',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    BarChart,
    BlockNotice,
    LineChart,
    RunProgressView,
    RunRowView,
    StatTile,
  ],
  template: `
    <header class="head">
      <div class="titles">
        <h1>{{ 'dashboard.heading' | rokuT }}</h1>
        @if (measured(); as taken) {
          <p [title]="taken.exact" class="taken">
            {{ 'dashboard.measuredAt' | rokuT: { when: taken.since } }}
          </p>
        }
      </div>

      <button
        (click)="refresh()"
        [disabled]="store.loading()"
        class="refresh"
        type="button"
      >
        {{
          (store.loading() ? 'dashboard.refreshing' : 'dashboard.refresh')
            | rokuT
        }}
      </button>
    </header>

    <!-- A failed re-read is a line beside the timestamp, not a page. The
         numbers below were true when the timestamp says they were. -->
    @if (staleKey(); as key) {
      <p class="stale" role="status">
        {{ 'dashboard.stale' | rokuT }} {{ key | rokuT }}
      </p>
    }

    @if (store.empty()) {
      <div class="failed" role="alert">
        <h2>{{ 'dashboard.error.heading' | rokuT }}</h2>
        <p>{{ errorKey() | rokuT }}</p>
        <button (click)="refresh()" type="button">
          {{ 'dashboard.error.retry' | rokuT }}
        </button>
      </div>
    } @else if (document(); as doc) {
      <section class="block">
        <h2>{{ 'dashboard.waiting.heading' | rokuT }}</h2>

        <!-- Which services did not answer, so a short row of tiles is not read
             as "nothing is waiting". The notice itself, with its retry, is in
             the section the block belongs to, once (section 5). -->
        @if (missing().length > 0) {
          <ul class="missing">
            @for (block of missing(); track block) {
              <li>{{ 'dashboard.down.' + block | rokuT }}</li>
            }
          </ul>
        }

        @if (waiting().length > 0) {
          <div class="tiles">
            @for (tile of waiting(); track tile.key) {
              @if (tile.query; as query) {
                <!-- The one queue that reads a chain from the query string,
                     which a routerLink array cannot carry on its own. -->
                <a [queryParams]="query" [routerLink]="tile.link" class="wrap">
                  <lib-stat-tile
                    [label]="tile.label"
                    [tone]="tile.tone"
                    [value]="tile.value"
                  />
                </a>
              } @else {
                <lib-stat-tile
                  [label]="tile.label"
                  [link]="tile.link ?? undefined"
                  [tone]="tile.tone"
                  [value]="tile.value"
                />
              }
            }
          </div>
        } @else if (missing().length === 0) {
          <p class="state">{{ 'dashboard.waiting.clear' | rokuT }}</p>
        }
      </section>

      <section class="block">
        <h2>{{ 'dashboard.harvest.heading' | rokuT }}</h2>

        @if (doc.harvest; as harvest) {
          @if (running(); as run) {
            <div class="running">
              <h3>{{ 'dashboard.harvest.running' | rokuT }}</h3>
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

          <h3>{{ 'dashboard.harvest.recent' | rokuT }}</h3>
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
      </section>

      <section class="block">
        <h2>{{ 'dashboard.people.heading' | rokuT }}</h2>

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

        @if (people().length > 0) {
          <div class="tiles">
            @for (tile of people(); track tile.key) {
              <div class="captioned">
                <lib-stat-tile
                  [delta]="tile.delta ?? undefined"
                  [label]="tile.label"
                  [link]="tile.link ?? undefined"
                  [tone]="tile.tone"
                  [trend]="tile.trend ?? undefined"
                  [value]="tile.value"
                />
                @if (tile.caption; as caption) {
                  <p class="caption">{{ caption }}</p>
                }
              </div>
            }
          </div>
        }

        @if (signUps(); as series) {
          <lib-line-chart
            [series]="series"
            [title]="text('dashboard.people.signUpsTitle')"
          />
        }
        @if (zonesAndLists(); as series) {
          <lib-line-chart
            [series]="series"
            [title]="text('dashboard.people.zonesAndLists')"
          />
        }
      </section>

      <section class="block">
        <h2>{{ 'dashboard.catalog.heading' | rokuT }}</h2>

        @if (doc.catalog === null) {
          <lib-block-notice
            (retry)="refresh()"
            [heading]="'dashboard.down.catalog'"
          />
        } @else {
          <div class="tiles">
            @for (tile of catalog(); track tile.key) {
              <div class="captioned">
                <lib-stat-tile
                  [label]="tile.label"
                  [link]="tile.link ?? undefined"
                  [tone]="tile.tone"
                  [value]="tile.value"
                />
                @if (tile.caption; as caption) {
                  <p class="caption">{{ caption }}</p>
                }
              </div>
            }
          </div>

          <lib-bar-chart
            [bars]="pricesWritten().bars"
            [series]="pricesWritten().series"
            [title]="text('dashboard.catalog.pricesWritten')"
          />
        }
      </section>

      <!-- Skipped entirely when auth did not answer. The notice for that is in
           the people section above, once, rather than twice on one page. -->
      @if (doc.identity; as identity) {
        <section class="block">
          <h2>{{ 'dashboard.signIns.heading' | rokuT }}</h2>

          <div class="tiles">
            <lib-stat-tile
              [label]="text('dashboard.signIns.last24h')"
              [tone]="
                identity.loginFailures.last24h > 0 ? 'attention' : 'quiet'
              "
              [value]="identity.loginFailures.last24h"
            />
            <lib-stat-tile
              [label]="text('dashboard.signIns.last7d')"
              [value]="identity.loginFailures.last7d"
            />
          </div>

          @if (failures().length === 0) {
            <p class="state">{{ 'dashboard.signIns.none' | rokuT }}</p>
          } @else if (compact()) {
            <ul class="cards">
              @for (row of failures(); track row.key) {
                <li>
                  <p class="strong">{{ row.username }}</p>
                  <p>{{ row.when }}</p>
                  <p>{{ row.ip }}</p>
                </li>
              }
            </ul>
          } @else {
            <div class="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{{ 'dashboard.signIns.when' | rokuT }}</th>
                    <th scope="col">
                      {{ 'dashboard.signIns.username' | rokuT }}
                    </th>
                    <th scope="col">{{ 'dashboard.signIns.ip' | rokuT }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of failures(); track row.key) {
                    <tr>
                      <td>{{ row.when }}</td>
                      <td>{{ row.username }}</td>
                      <td>{{ row.ip }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }

      <section class="block">
        <h2>{{ 'dashboard.activity.heading' | rokuT }}</h2>

        @if (activity().length === 0) {
          <p class="state">{{ 'dashboard.activity.none' | rokuT }}</p>
        } @else if (compact()) {
          <ul class="cards">
            @for (row of activity(); track row.key) {
              <li>
                <p class="strong">
                  @if (row.link; as link) {
                    <a [routerLink]="link">{{ row.what }}</a>
                  } @else {
                    {{ row.what }}
                  }
                </p>
                <p>{{ row.who }}</p>
                <p [title]="row.at">{{ row.when }}</p>
              </li>
            }
          </ul>
        } @else {
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ 'dashboard.activity.when' | rokuT }}</th>
                  <th scope="col">{{ 'dashboard.activity.who' | rokuT }}</th>
                  <th scope="col">{{ 'dashboard.activity.what' | rokuT }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of activity(); track row.key) {
                  <tr>
                    <td [title]="row.at">{{ row.when }}</td>
                    <td>{{ row.who }}</td>
                    <td>
                      @if (row.link; as link) {
                        <a [routerLink]="link">{{ row.what }}</a>
                      } @else {
                        {{ row.what }}
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    } @else {
      <p class="state">{{ 'dashboard.loading' | rokuT }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-6);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-start;
      justify-content: space-between;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.9375rem;
      font-weight: 700;
    }

    .taken,
    .caption,
    .state,
    .chain {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .stale {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-ink);
    }

    .failed {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .block {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    /* Two columns on a phone, three when there is room, four on a wide screen.
       auto-fit rather than a breakpoint, because the tiles wrap on their own
       content and the page has nothing to say about where that happens. */
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--admin-space-3);
    }

    .captioned {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .wrap {
      display: block;
      color: inherit;
      text-decoration: none;
    }

    .state {
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .missing {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      list-style: none;
      font-size: 0.8125rem;
      color: var(--admin-danger-ink);
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

    /* A table wider than the page scrolls inside its own box, so the page never
       scrolls sideways. */
    .scroll {
      overflow-x: auto;
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
    }

    th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .cards li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .cards .strong {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--admin-ink);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    a:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _references = inject(ResourceReferences);
  private readonly _viewport = inject(Viewport);

  readonly store = inject(DashboardStore);
  readonly document = this.store.document;
  readonly compact = this._viewport.compact;

  /**
   * The chains the queues name, once the reference has answered.
   *
   * Resolved after the document arrives rather than joined into it: the gateway
   * sends ids because a queue is per chain and the chain's name belongs to
   * catalog, and this app already resolves supermarkets for the sources screen.
   * A chain the reference cannot name shows its id (plan 0007, section 4).
   */
  private readonly _chains = signal<ReadonlyMap<string, string>>(new Map());

  constructor() {
    this.store.watch();
    // A component's teardown, which is the one that actually runs: a route's
    // providers injector is never destroyed, so a route scoped service's
    // `DestroyRef` would never fire and the poll would outlive this screen.
    inject(DestroyRef).onDestroy(() => this.store.stop());

    // The names are read once the ids are known, and again only when a poll
    // brings an id nothing has named yet. `untracked`, because the resolution
    // writes the signal this effect would otherwise depend on.
    effect(() => {
      const ids = this._chainIds();
      untracked(() => void this._resolveChains(ids));
    });
  }

  /**
   * When the numbers were taken, in both forms.
   *
   * "Two minutes ago" is what an operator reads, and the clock time is on the
   * `title` for the one who wants to know exactly. `Date.now()` is read inside
   * the computed, which recomputes only when the timestamp changes, so it is
   * evaluated at the moment the answer arrived rather than continuously.
   */
  readonly measured = computed(() => {
    const at = this.store.measuredAt();
    if (at === null) {
      return null;
    }

    const locale = this._translate.locale();
    return {
      since: formatSince(at, Date.now(), locale),
      exact: formatInstant(at, locale),
    };
  });

  /**
   * The failure to show beside the timestamp, when there is a document as well.
   *
   * A failure with nothing to keep is the page's error state instead, so the two
   * are never both drawn.
   */
  readonly staleKey = computed(() =>
    this.store.failed() !== null && !this.store.empty()
      ? gatewayErrorKey(this.store.failed())
      : null
  );

  readonly errorKey = computed(() => gatewayErrorKey(this.store.failed()));

  /** Which blocks did not answer, in the order the sections draw them. */
  readonly missing = computed(() => {
    const document = this.document();
    if (document === null) {
      return [];
    }

    return (['identity', 'core', 'catalog', 'harvest'] as const).filter(
      (block) => document[block] === null
    );
  });

  readonly waiting = computed(() => {
    const document = this.document();
    return document === null
      ? []
      : waitingTiles(document, this._text, (id) => this.chainName(id));
  });

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

  readonly people = computed(() => {
    const document = this.document();
    return document === null
      ? []
      : peopleTiles(document.identity, document.core, this._text);
  });

  readonly signUps = computed(() => {
    const identity = this.document()?.identity ?? null;
    return identity === null ? null : signUpsChart(identity, this._text);
  });

  readonly zonesAndLists = computed(() => {
    const core = this.document()?.core ?? null;
    return core === null ? null : zonesAndListsChart(core, this._text);
  });

  readonly catalog = computed(() => {
    const catalog = this.document()?.catalog ?? null;
    return catalog === null ? [] : catalogTiles(catalog, this._text);
  });

  readonly pricesWritten = computed(() => {
    const catalog = this.document()?.catalog ?? null;
    return catalog === null
      ? { bars: [], series: [] }
      : pricesWrittenChart(catalog, this._text);
  });

  readonly failures = computed(() => {
    const identity = this.document()?.identity ?? null;
    return identity === null
      ? []
      : loginFailureRows(identity, this._text, (value) =>
          formatInstant(value, this._translate.locale())
        );
  });

  readonly activity = computed(() => {
    const document = this.document();
    if (document === null) {
      return [];
    }

    const locale = this._translate.locale();
    const now = Date.now();
    return activityRows(
      document.activity,
      this._text,
      (value) => formatSince(value, now, locale),
      (value) => formatInstant(value, locale)
    );
  });

  /** A key as a sentence, for a component input that takes words not keys. */
  text(key: string): string {
    return this._text(key);
  }

  /** How far a run has got, which is the run screen's own arithmetic. */
  readonly progress = runProgress;

  /** The chain's name, or its id where the reference could not name it. */
  chainName(supermarketId: string): string {
    return this._chains().get(supermarketId) ?? supermarketId;
  }

  runLink(id: string): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'runs', id];
  }

  sourcesLink(): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'sources'];
  }

  refresh(): void {
    void this.store.load();
  }

  /** Every chain the queues and the run in flight mention, in a stable order. */
  private readonly _chainIds = computed<readonly string[]>(() => {
    const harvest = this.document()?.harvest ?? null;
    if (harvest === null) {
      return [];
    }

    const running = harvest.running?.supermarketId ?? null;
    return [
      ...new Set([
        ...harvest.queues.entries.map((queue) => queue.supermarketId),
        ...harvest.queues.shops.map((queue) => queue.supermarketId),
        ...(running === null ? [] : [running]),
      ]),
    ].sort();
  });

  /**
   * Name the chains this screen has not named yet.
   *
   * One read per chain, of which there are a handful, and only for an id the map
   * does not hold: the document is re-read every minute and the chains do not
   * change between polls. A failure costs a name rather than the screen, because
   * `resolve` answers `null` for a reference that outlived what it points at and
   * the tile then shows the id (plan 0007, section 4).
   */
  private async _resolveChains(ids: readonly string[]): Promise<void> {
    const known = this._chains();
    const wanted = ids.filter((id) => !known.has(id));
    if (wanted.length === 0) {
      return;
    }

    const resolved = await Promise.all(
      wanted.map(
        async (id) =>
          [id, await this._references.resolve('supermarkets', id)] as const
      )
    );

    this._chains.update((names) => {
      const next = new Map(names);
      for (const [id, option] of resolved) {
        if (option !== null) {
          next.set(id, option.title);
        }
      }
      return next;
    });
  }

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
