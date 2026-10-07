import { NgTemplateOutlet } from '@angular/common';
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
import {
  DashboardStore,
  PostalCodeSummaryStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  ChainNames,
  formatInstant,
  formatSince,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  ADMIN_FAILED_SIGN_INS_TAB,
  adminsPath,
} from '@portfolio/luna-shopper-admin/feature-people';
import {
  gatewayErrorKey,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  BarChart,
  LineChart,
  PageHeader,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import { catalogStats, pricesWrittenChart } from './catalog-view';
import {
  activityRows,
  postalCodeWaitingTile,
  waitingTiles,
  type StatView,
} from './dashboard-view';
import { harvestStats } from './harvest-view';
import { shopperStats, signUpsChart } from './shoppers-view';

/** How many rows of the feed a phone shows before "Show all". */
export const FEED_ROWS_ON_A_PHONE = 5;

/**
 * The screen the app opens to (admin plan 0016, in its final layout by admin
 * plan 0046).
 *
 * `0004` refused a landing page because an operator opens this tool to change a
 * specific thing and a page in front of that is a click between them and it.
 * That is an argument against an empty landing page and it stands. This one
 * answers, on arrival, what the operator came to find out.
 *
 * **Three parts, in the order they are asked about.** What waits for a person
 * is the row at the top: every queue in the app in one place, which is the
 * reason to open the app at all. Under it, the numbers of each area, one panel
 * each, where a number is a way into its list. Beside them, what changed: the
 * three audit trails as one feed.
 *
 * **The numbers are here because nowhere else holds them.** Each area had a
 * dashboard of its own, and each of those sections opens on its list now
 * (admin plans 0042 to 0045).
 *
 * **Failed sign ins are a tab of Admins.** The table was a block of this page.
 * The tile that counts the last 24 hours stays in the row at the top, because
 * the value in it is that somebody sees it without going to look, and it opens
 * that tab.
 *
 * **One read.** There is no request per panel and none per chart: the store
 * holds the whole document, and a block that did not answer arrives as `null`
 * in it. The panel of that block then says so and offers to ask again, and
 * the rest of the page is still true.
 *
 * **On a phone a numbers panel is a row that opens**, and the feed comes
 * before the numbers: what waits and what changed are read on a phone, and
 * the totals are looked up.
 */
@Component({
  selector: 'lib-dashboard-page',
  imports: [
    NgTemplateOutlet,
    PageHeader,
    RouterLink,
    RokuTranslatorPipe,
    BarChart,
    LineChart,
    ChevronLeftIcon,
  ],
  template: `
    <lib-page-header [heading]="'dashboard.heading' | rokuT">
      @if (measured(); as taken) {
        <p [title]="taken.exact" class="taken" pageChip>
          {{ 'dashboard.measuredAt' | rokuT: { when: taken.since } }}
        </p>
      }

      <button
        (click)="refresh()"
        [disabled]="store.loading()"
        class="button"
        pageAction
        type="button"
      >
        {{ 'dashboard.refresh' | rokuT }}
      </button>
    </lib-page-header>

    <!-- A refresh that failed is one line, not a page. The numbers below were
         true when the header says they were read. -->
    @if (staleKey(); as key) {
      <p class="stale" role="status">
        {{ 'dashboard.stale' | rokuT }} {{ key | rokuT }}
      </p>
    }

    @if (store.empty()) {
      <div class="failed" role="alert">
        <h2>{{ 'dashboard.error.heading' | rokuT }}</h2>
        <p>{{ errorKey() | rokuT }}</p>
        <button (click)="refresh()" class="button" type="button">
          {{ 'dashboard.error.retry' | rokuT }}
        </button>
      </div>
    } @else if (document(); as doc) {
      <section aria-labelledby="overview-waiting" class="waiting">
        <h2 id="overview-waiting">{{ 'dashboard.waiting.heading' | rokuT }}</h2>

        <!-- A list, so that a screen reader says how many tiles there are.
             Every tile is a link to where its work is done. -->
        <ul class="tiles">
          @for (tile of waiting(); track tile.key) {
            <li>
              @if (tile.link; as link) {
                <a
                  [attr.data-tile]="tile.key"
                  [class.wait]="tile.value > 0"
                  [queryParams]="tile.query"
                  [routerLink]="link"
                  class="tile"
                >
                  <ng-container
                    [ngTemplateOutlet]="tileBody"
                    [ngTemplateOutletContext]="{ $implicit: tile }"
                  />
                </a>
              } @else {
                <div
                  [attr.data-tile]="tile.key"
                  [class.wait]="tile.value > 0"
                  class="tile"
                >
                  <ng-container
                    [ngTemplateOutlet]="tileBody"
                    [ngTemplateOutletContext]="{ $implicit: tile }"
                  />
                </div>
              }
            </li>
          }
        </ul>
      </section>

      <div class="columns">
        @if (compact()) {
          <ng-container [ngTemplateOutlet]="feed" />
          <div class="numbers">
            <details class="panel" data-catalog-block>
              <summary>
                {{ 'dashboard.catalog.numbers' | rokuT }}
                <span aria-hidden="true" class="chevron">
                  <lib-chevron-left-icon />
                </span>
              </summary>
              <div class="panel-body">
                <ng-container [ngTemplateOutlet]="catalogBody" />
              </div>
            </details>
            <details class="panel" data-shoppers-block>
              <summary>
                {{ 'dashboard.shoppers.numbers' | rokuT }}
                <span aria-hidden="true" class="chevron">
                  <lib-chevron-left-icon />
                </span>
              </summary>
              <div class="panel-body">
                <ng-container [ngTemplateOutlet]="shoppersBody" />
              </div>
            </details>
            <details class="panel" data-harvest-block>
              <summary>
                {{ 'dashboard.harvest.numbers' | rokuT }}
                <span aria-hidden="true" class="chevron">
                  <lib-chevron-left-icon />
                </span>
              </summary>
              <div class="panel-body">
                <ng-container [ngTemplateOutlet]="harvestBody" />
              </div>
            </details>
          </div>
        } @else {
          <div class="numbers">
            <section
              aria-labelledby="overview-catalog"
              class="panel panel-body"
              data-catalog-block
            >
              <h2 id="overview-catalog">
                {{ 'dashboard.catalog.heading' | rokuT }}
              </h2>
              <ng-container [ngTemplateOutlet]="catalogBody" />
            </section>
            <section
              aria-labelledby="overview-shoppers"
              class="panel panel-body"
              data-shoppers-block
            >
              <h2 id="overview-shoppers">
                {{ 'dashboard.shoppers.heading' | rokuT }}
              </h2>
              <ng-container [ngTemplateOutlet]="shoppersBody" />
            </section>
            <section
              aria-labelledby="overview-harvest"
              class="panel panel-body"
              data-harvest-block
            >
              <h2 id="overview-harvest">
                {{ 'dashboard.harvest.heading' | rokuT }}
              </h2>
              <ng-container [ngTemplateOutlet]="harvestBody" />
            </section>
          </div>
          <ng-container [ngTemplateOutlet]="feed" />
        }
      </div>

      <ng-template #catalogBody>
        @if (doc.catalog === null) {
          <ng-container
            [ngTemplateOutlet]="down"
            [ngTemplateOutletContext]="{ $implicit: 'catalog' }"
          />
        } @else {
          <ng-container
            [ngTemplateOutlet]="stats"
            [ngTemplateOutletContext]="{ $implicit: catalog() }"
          />
          <lib-bar-chart
            [bars]="pricesWritten().bars"
            [height]="170"
            [series]="pricesWritten().series"
            [title]="text('dashboard.catalog.pricesWritten', { count: days() })"
          />
        }
      </ng-template>

      <ng-template #shoppersBody>
        <ng-container
          [ngTemplateOutlet]="stats"
          [ngTemplateOutletContext]="{ $implicit: shoppers() }"
        />
        @if (doc.identity === null) {
          <ng-container
            [ngTemplateOutlet]="down"
            [ngTemplateOutletContext]="{ $implicit: 'identity' }"
          />
        }
        @if (doc.core === null) {
          <ng-container
            [ngTemplateOutlet]="down"
            [ngTemplateOutletContext]="{ $implicit: 'core' }"
          />
        }
        @if (signUps(); as series) {
          <lib-line-chart
            [height]="150"
            [series]="series"
            [title]="text('dashboard.shoppers.signUpsTitle', { count: days() })"
          />
        }
      </ng-template>

      <ng-template #harvestBody>
        @if (doc.harvest === null) {
          <ng-container
            [ngTemplateOutlet]="down"
            [ngTemplateOutletContext]="{ $implicit: 'harvest' }"
          />
        } @else {
          <ng-container
            [ngTemplateOutlet]="stats"
            [ngTemplateOutletContext]="{ $implicit: harvest() }"
          />
        }
      </ng-template>

      <ng-template #feed>
        <section aria-labelledby="overview-feed" class="panel feed">
          <h2 id="overview-feed">{{ 'dashboard.activity.heading' | rokuT }}</h2>

          @if (activity().length === 0) {
            <p class="none">{{ 'dashboard.activity.none' | rokuT }}</p>
          } @else {
            <ul>
              @for (row of shownActivity(); track row.key) {
                <li>
                  @if (row.link; as link) {
                    <a [routerLink]="link" class="change" data-change>
                      <span [title]="row.at" class="when">{{ row.when }}</span>
                      <span class="line">{{ row.line }}</span>
                    </a>
                  } @else {
                    <p class="change" data-change>
                      <span [title]="row.at" class="when">{{ row.when }}</span>
                      <span class="line">{{ row.line }}</span>
                    </p>
                  }
                </li>
              }
            </ul>

            @if (compact() && activity().length > feedRows) {
              <button
                (click)="allChanges.set(!allChanges())"
                [attr.aria-expanded]="allChanges()"
                class="button all"
                type="button"
              >
                {{
                  (allChanges()
                    ? 'dashboard.activity.fewer'
                    : 'dashboard.activity.all'
                  ) | rokuT
                }}
              </button>
            }
          }
        </section>
      </ng-template>
    } @else {
      <p class="reading" role="status">{{ 'dashboard.loading' | rokuT }}</p>
    }

    <ng-template #tileBody let-tile>
      <span class="tile-value">{{ number(tile.value) }}</span>
      <span class="tile-label">{{ tile.label }}</span>
      @if (tile.caption; as caption) {
        <span class="tile-caption">{{ caption }}</span>
      }
    </ng-template>

    <!-- The numbers of one panel. A definition list: each number is the
         value of the term under it, and the link is on the number. -->
    <ng-template #stats let-list>
      @if (list.length > 0) {
        <dl class="stats">
          @for (stat of list; track stat.key) {
            <div [attr.data-stat]="stat.key" class="stat">
              <dt>{{ stat.label }}</dt>
              <dd [class.danger]="stat.danger">
                @if (stat.link; as link) {
                  <a [routerLink]="link">{{ statText(stat) }}</a>
                } @else {
                  {{ statText(stat) }}
                }
              </dd>
            </div>
          }
        </dl>
      }
    </ng-template>

    <!-- A service that did not answer: its panel says so, and offers to ask
         again. Everything else on the page is still true. -->
    <ng-template #down let-block>
      <p [attr.data-down]="block" class="down" role="status">
        <span>{{ 'dashboard.down.' + block | rokuT }}</span>
        <button (click)="refresh()" class="button" type="button">
          {{ 'dashboard.down.retry' | rokuT }}
        </button>
      </p>
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    h2 {
      font-size: 0.9375rem;
      font-weight: 600;
    }

    ul {
      list-style: none;
    }

    .taken,
    .reading {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .stale,
    .failed,
    .down {
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius-control);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .stale {
      padding: var(--admin-space-2) var(--admin-space-3);
    }

    .failed {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-6);
      border-radius: var(--admin-radius);
    }

    .down {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      padding: var(--admin-space-2) var(--admin-space-3);
    }

    .waiting {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    /* One row on a wide screen, however many tiles there are, and two columns
       on a phone. The tile is stretched by its cell, so the row is one height
       and equal boxes look like equal tiles. */
    .tiles {
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      gap: var(--admin-space-3);
    }

    .tiles > li {
      display: flex;
      min-inline-size: 0;
    }

    .tile {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
      padding: var(--admin-space-3) 0.875rem;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      text-decoration: none;
      color: var(--admin-ink);
    }

    /* Something waits here for a person. Amber on the page means this and
       only this, and the number says the same thing in a figure. */
    .tile.wait {
      border-color: var(--admin-waiting-on-wash);
      background: var(--admin-waiting-wash);
    }

    .tile.wait .tile-value {
      color: var(--admin-waiting-on-wash);
    }

    .tile-value {
      font-size: 1.625rem;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      line-height: 1.15;
    }

    .tile-caption {
      overflow-wrap: anywhere;
      font-size: 0.78125rem;
      color: var(--admin-ink-muted);
    }

    .tile.wait .tile-caption {
      color: var(--admin-waiting-on-wash);
    }

    a.tile:hover {
      border-color: var(--admin-ink-muted);
    }

    .columns {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    .numbers {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
    }

    .panel {
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .panel-body {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: 0.875rem;
    }

    /* The numbers of a panel in one row, which wraps where it has to. */
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3) 1.75rem;
    }

    /* The term comes first in the document, which is the order a definition
       list has, and is drawn under its number. */
    .stat {
      display: flex;
      flex-direction: column-reverse;
    }

    .stat dt {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .stat dd {
      font-size: 1.125rem;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .stat dd.danger,
    .stat dd.danger a {
      color: var(--admin-danger);
    }

    .stat a {
      text-decoration: none;
      color: var(--admin-ink);
    }

    .stat a:hover {
      text-decoration: underline;
    }

    .feed {
      overflow: hidden;
    }

    .feed h2 {
      padding: 0.625rem 0.875rem;
    }

    .none {
      padding: 0 0.875rem 0.875rem;
      color: var(--admin-ink-muted);
    }

    .change {
      display: flex;
      gap: 0.625rem;
      align-items: baseline;
      min-block-size: 2.75rem;
      padding: 0.625rem 0.875rem;
      border-block-start: 1px solid var(--admin-border);
      text-decoration: none;
      color: var(--admin-ink);
    }

    a.change:hover .line {
      text-decoration: underline;
    }

    .when {
      flex: none;
      inline-size: 6.5rem;
      font-size: 0.78125rem;
      color: var(--admin-ink-muted);
    }

    .line {
      flex: 1;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-weight: 500;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .button:disabled {
      color: var(--admin-ink-muted);
      cursor: default;
    }

    .all {
      inline-size: 100%;
      border-color: var(--admin-surface-raised);
      border-block-start-color: var(--admin-border);
      border-radius: 0;
    }

    a:focus-visible,
    button:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    /* A panel that opens, on a phone: the row is its name, and the numbers
       are under it once it is open. */
    summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-block-size: 3rem;
      padding-inline: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }

    /* The one chevron the icons hold points back. Turned, it points on while
       the row is closed and down while it is open. */
    .chevron {
      flex: none;
      inline-size: 1rem;
      block-size: 1rem;
      color: var(--admin-ink-muted);
      rotate: 180deg;
    }

    details[open] .chevron {
      rotate: 270deg;
    }

    details[open] > summary {
      border-block-end: 1px solid var(--admin-border);
    }

    /* The numbers and the feed side by side, once there is room for both. */
    @media (min-width: 72rem) {
      .columns {
        flex-direction: row;
        align-items: flex-start;
      }

      .feed {
        flex: none;
        inline-size: 27.5rem;
      }
    }

    @media (max-width: 47.99rem) {
      .tiles {
        grid-auto-flow: row;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.625rem;
      }

      .when {
        inline-size: 5.5rem;
      }
    }

    /* Between a phone and a wide screen seven tiles in one row are too narrow
       to read, so the row wraps to as many as fit. */
    @media (min-width: 48rem) and (max-width: 71.99rem) {
      .tiles {
        grid-auto-flow: row;
        grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _chains = inject(ChainNames);
  private readonly _viewport = inject(Viewport);
  private readonly _postalCodes = inject(PostalCodeSummaryStore);

  readonly store = inject(DashboardStore);
  readonly document = this.store.document;
  readonly compact = this._viewport.compact;

  /** How many rows of the feed a phone shows before it is asked for all. */
  readonly feedRows = FEED_ROWS_ON_A_PHONE;

  /** Whether a phone shows the whole feed. A wide screen always does. */
  readonly allChanges = signal(false);

  constructor() {
    this.store.watch();
    // The postal code queue's summary, which is not in the dashboard document
    // and is one call beside it (admin plan 0021, section 6). Read once on
    // arrival and again on a refresh; it changes when somebody adds a code or
    // the worker drains one, neither of which happens while nobody is looking.
    void this._postalCodes.load();
    // A component's teardown, which is the one that actually runs: a route's
    // providers injector is never destroyed, so a route scoped service's
    // `DestroyRef` would never fire and the poll would outlive this screen.
    inject(DestroyRef).onDestroy(() => this.store.stop());

    // The names are read once the ids are known, and again only when a poll
    // brings an id nothing has named yet. `untracked`, because the resolution
    // writes the signal this effect would otherwise depend on.
    effect(() => {
      const ids = this._chainIds();
      untracked(() => void this._chains.resolve(ids));
    });
  }

  /**
   * When the numbers were read, in both forms.
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
   * The failure to show under the header, when there is a document as well.
   *
   * A failure with nothing to keep is the page's error state instead, so the two
   * are never both drawn.
   */
  readonly staleKey = computed(() =>
    this.store.failed() !== null && !this.store.empty()
      ? gatewayErrorKey(this.store.failed())
      : null
  );

  // Drawn only inside `store.empty()`, which the store reaches by failing. The
  // fallback keeps the block from opening with a blank line if it ever does not.
  readonly errorKey = computed(
    () => gatewayErrorKey(this.store.failed()) ?? 'resource.error.unknown'
  );

  /**
   * How many days the gateway's window holds, both ends counted.
   *
   * The gateway chooses the window and this page has no control for it (admin
   * plan 0046, section 2). The length is written beside what it bounds: the
   * runs, and the two charts.
   */
  readonly days = computed(() => {
    const window = this.document()?.window;
    if (window === undefined) {
      return 0;
    }

    const from = Date.parse(`${window.from}T00:00:00Z`);
    const to = Date.parse(`${window.to}T00:00:00Z`);

    return Number.isNaN(from) || Number.isNaN(to)
      ? 0
      : Math.round((to - from) / 86_400_000) + 1;
  });

  /**
   * Everything waiting for a person, from the document plus one call beside it.
   *
   * The postal code tile is not in the document (admin plan 0021, section 6)
   * and arrives by itself, so a summary that did not answer costs one tile
   * rather than the row.
   */
  readonly waiting = computed(() => {
    const document = this.document();
    if (document === null) {
      return [];
    }

    return waitingTiles(
      document,
      postalCodeWaitingTile(
        this._postalCodes.summary(),
        this._text,
        (value) => formatSince(value, Date.now(), this._translate.locale()),
        this._pathOf
      ),
      this._text,
      (id) => this.chainName(id),
      this._pathOf,
      adminsPath(ADMIN_FAILED_SIGN_INS_TAB)
    );
  });

  /** The catalog's counts, each a way into the list it counts. */
  readonly catalog = computed(() => {
    const catalog = this.document()?.catalog ?? null;
    return catalog === null
      ? []
      : catalogStats(catalog, this._text, this._pathOf);
  });

  /** Prices written per day, one stacked series per kind of source. */
  readonly pricesWritten = computed(() => {
    const catalog = this.document()?.catalog ?? null;
    return catalog === null
      ? { bars: [], series: [] }
      : pricesWrittenChart(catalog, this._text, (day) => this._day(day));
  });

  /** Who is here and what they have made, each a way into its list. */
  readonly shoppers = computed(() => {
    const document = this.document();
    return document === null
      ? []
      : shopperStats(
          document.identity,
          document.core,
          this._text,
          this._pathOf
        );
  });

  /** Registered sign ups per day, or `null` when auth did not answer. */
  readonly signUps = computed(() => {
    const identity = this.document()?.identity ?? null;
    return identity === null ? null : signUpsChart(identity, this._text);
  });

  /** What the harvester did and what it may do. */
  readonly harvest = computed(() => {
    const harvest = this.document()?.harvest ?? null;
    return harvest === null
      ? []
      : harvestStats(harvest, this.days(), this._text);
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
      (value) => formatInstant(value, locale),
      this._pathOf
    );
  });

  /** The rows of the feed that are drawn: the first few on a phone, until asked. */
  readonly shownActivity = computed(() =>
    this.compact() && !this.allChanges()
      ? this.activity().slice(0, FEED_ROWS_ON_A_PHONE)
      : this.activity()
  );

  /** A key as a sentence, for a component input that takes words not keys. */
  text(key: string, values?: Record<string, unknown>): string {
    return this._text(key, values);
  }

  /** A count as the reader's locale writes it. */
  number(value: number): string {
    return new Intl.NumberFormat(this._translate.locale()).format(value);
  }

  /** A number of a panel as words: "48,210", or "0 of 4". */
  statText(stat: StatView): string {
    return stat.of === null
      ? this.number(stat.value)
      : this._text('dashboard.partOf', {
          part: this.number(stat.value),
          whole: this.number(stat.of),
        });
  }

  /** The chain's name, or its id where the reference could not name it. */
  chainName(supermarketId: string): string {
    return this._chains.nameOf(supermarketId);
  }

  refresh(): void {
    void this.store.load();
    // The tile beside the document's, re-read by the same button. Forced,
    // because the store answers a summary it already has and a refresh is the
    // one place an operator is asking for a newer one.
    void this._postalCodes.load(true);
  }

  /**
   * A day of the window as a short label, with `Intl` and never with
   * `DatePipe`. Parsed at noon UTC, so a viewer west of Greenwich is not shown
   * the day before.
   */
  private _day(day: string): string {
    return new Intl.DateTimeFormat(this._translate.locale(), {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00.000Z`));
  }

  /** Every chain the queues mention, in a stable order. */
  private readonly _chainIds = computed<readonly string[]>(() => {
    const harvest = this.document()?.harvest ?? null;
    if (harvest === null) {
      return [];
    }

    return [
      ...new Set([
        ...harvest.queues.entries.map((queue) => queue.supermarketId),
        ...harvest.queues.shops.map((queue) => queue.supermarketId),
      ]),
    ].sort();
  });

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
