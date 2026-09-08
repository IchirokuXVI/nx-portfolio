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
import {
  ChainNames,
  formatInstant,
  formatSince,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  gatewayErrorKey,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { StatTile, Viewport } from '@portfolio/luna-shopper-admin/ui';
import {
  activityRows,
  loginFailureRows,
  postalCodeWaitingTile,
  waitingTiles,
} from './dashboard-view';

/**
 * The screen the app opens to (admin plan 0016, narrowed by admin plan 0022).
 *
 * `0004` refused a landing page because an operator opens this tool to change a
 * specific thing and a page in front of that is a click between them and it.
 * That is an argument against an empty landing page and it stands. This one
 * answers, on arrival, what the operator came to find out.
 *
 * **Three things, and each is a question about the whole tool rather than about
 * one part of it.** Work waiting is every queue in the app in one place, which
 * is the reason to open the app at all. Failed sign ins are a fact about the
 * tool itself. Recent activity crosses all three audit trails by definition. A
 * count of users is none of those: it is the first line of the shoppers
 * dashboard, and it was here only because there was nowhere else for it.
 *
 * **The sign ins stay here and do not move to the admins section.** They are two
 * numbers that are nearly always zero, and the value in them is that somebody
 * sees them without going to look. A screen an operator opens once a month is
 * not that place. This is the one asymmetry in the split and it is on purpose.
 *
 * **One read.** There is no per block request and no per chart request: the
 * store holds the whole document and a block that did not answer arrives as
 * `null` in it. The section dashboards read the same document, so opening one of
 * them costs no request at all.
 *
 * **`harvesterDeployed` is deliberately not consulted.** That helper says
 * production and staging do not run the harvester, and both do now, so the
 * document is the only thing that knows whether the block is missing.
 */
@Component({
  selector: 'lib-dashboard-page',
  imports: [RouterLink, RokuTranslatorPipe, StatTile],
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
             as "nothing is waiting". The retry beside it is on the section
             dashboard that block belongs to, once (section 5). -->
        @if (missing().length > 0) {
          <ul class="missing">
            @for (block of missing(); track block) {
              <li>{{ 'dashboard.down.' + block | rokuT }}</li>
            }
          </ul>
        }

        @if (waiting().length > 0) {
          <!-- The tile is the grid item, so the grid stretches every one to
               the row and equal boxes look like equal cards (admin plan 0024,
               section 2). The caption and the query parameters ride on the
               tile's own inputs, which is what let the wrappers go. -->
          <div class="tiles">
            @for (tile of waiting(); track tile.key) {
              <lib-stat-tile
                [caption]="tile.caption ?? undefined"
                [label]="tile.label"
                [link]="tile.link ?? undefined"
                [queryParams]="tile.query ?? undefined"
                [tone]="tile.tone"
                [value]="tile.value"
              />
            }
          </div>
        } @else if (missing().length === 0) {
          <p class="state">{{ 'dashboard.waiting.clear' | rokuT }}</p>
        }
      </section>

      <!-- Skipped entirely when auth did not answer, which the row above already
           says. -->
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

    .taken,
    .state {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .stale {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
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
      grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
      gap: var(--admin-space-3);
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
      color: var(--admin-danger-on-wash);
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
  private readonly _registry = inject(ResourceRegistry);
  private readonly _chains = inject(ChainNames);
  private readonly _viewport = inject(Viewport);
  private readonly _postalCodes = inject(PostalCodeSummaryStore);

  readonly store = inject(DashboardStore);
  readonly document = this.store.document;
  readonly compact = this._viewport.compact;

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

  // Drawn only inside `store.empty()`, which the store reaches by failing. The
  // fallback keeps the block from opening with a blank line if it ever does not.
  readonly errorKey = computed(
    () => gatewayErrorKey(this.store.failed()) ?? 'resource.error.unknown'
  );

  /** Which blocks did not answer, in the order the document names them. */
  readonly missing = computed(() => {
    const document = this.document();
    if (document === null) {
      return [];
    }

    return (['identity', 'core', 'catalog', 'harvest'] as const).filter(
      (block) => document[block] === null
    );
  });

  /**
   * Everything waiting for a person, from the document plus one call beside it.
   *
   * The postal code tile is not in the document (admin plan 0021, section 6) and
   * arrives on its own, so a dashboard whose harvest block is null still shows
   * it and a summary that did not answer costs one tile rather than the row.
   */
  readonly waiting = computed(() => {
    const document = this.document();
    const tiles =
      document === null
        ? []
        : waitingTiles(
            document,
            this._text,
            (id) => this.chainName(id),
            this._pathOf
          );

    const postalCodes = postalCodeWaitingTile(
      this._postalCodes.summary(),
      this._text,
      (value) => formatSince(value, Date.now(), this._translate.locale()),
      this._pathOf
    );

    return postalCodes === null ? tiles : [...tiles, postalCodes];
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
      (value) => formatInstant(value, locale),
      this._pathOf
    );
  });

  /** A key as a sentence, for a component input that takes words not keys. */
  text(key: string): string {
    return this._text(key);
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
