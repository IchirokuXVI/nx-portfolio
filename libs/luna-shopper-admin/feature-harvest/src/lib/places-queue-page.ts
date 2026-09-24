import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  HARVEST_SERVICE,
  QueueStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  CONTENT_LOCALES,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  QueueFrame,
  ReferencePicker,
  type QueueReport,
} from '@portfolio/luna-shopper-admin/ui';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';
import {
  fromOpenStreetMap,
  nearby,
  nearbyShops,
  placeCandidates,
  placeLines,
  placeRefusalKey,
  type NearbyShop,
  type PlaceCandidate,
} from './place-view';
import {
  runQueueBulk,
  type PendingBulk,
  type QueueBulkAct,
} from './queue-bulk';

type Place = Wire.HarvestDiscoveredPlaceView;

/** The languages a chain's name can be given in, which are the catalog's. */
type ChainLocale = Wire.NewChainDto['locale'];

/**
 * How many of a chain's shops the duplicates panel reads.
 *
 * One page. A chain with more shops than this in one city is not a case the
 * panel is for, and the import itself still asks the catalog about every one.
 */
const CATALOG_SHOPS_READ = 100;

/**
 * Discovered places, one decision at a time and as a list (plan 0006, section 5;
 * plan 0020; plan 0034).
 *
 * Locations found in OpenStreetMap are **offered rather than silently created**.
 * A place is offered when it matched neither the provider's own reference nor
 * the same brand within fifty metres, which is exactly the case a person has to
 * settle: the two shops fifty one metres apart are either one shop mapped twice
 * or two shops on the same street.
 *
 * So this screen shows why each one is being asked about, and it shows the near
 * duplicates **beside** the current place rather than behind a navigation: the
 * queued places of the same brand, and since plan 0034 the catalog's own shops
 * of the chain, which is where the duplicates backend plan 0150 found were.
 *
 * **An import can be answered with a question** (backend plan 0152). When the
 * catalog may already hold the shop, the import writes nothing and answers 409
 * `place_matches_location` with the candidates. The panel then lists them, each
 * with the rule that found it, and offers "Link to this shop" per candidate and
 * "Create a new shop anyway". Nothing is linked without that press.
 *
 * **The scope is the run's, or the one picked.** The run that found a place
 * declared which warehouse or offer region it belongs to, and the import joins
 * that scope when nothing else is named. The panel says which, and a scope of
 * the picked chain can be named instead.
 *
 * **An OpenStreetMap place can bring its chain with it** (backend plan 0153).
 * OpenStreetMap names things in no stated language, so the catalog cannot name a
 * chain from one by itself; the panel asks for a name and the language it is in.
 *
 * Importing takes a supermarket id, and the field is offered rather than
 * required: a place whose chain catalog already knows can be imported without
 * one. The picked chain applies to the single decision **and** to a bulk import;
 * see {@link askImport}. A bulk import never links: a place that answers
 * `place_matches_location` stays in the queue and is named in the report.
 */
@Component({
  selector: 'lib-places-queue-page',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    ConfirmDialog,
    QueueFrame,
    HarvestNotice,
    ReferencePicker,
  ],
  template: `
    <nav class="views-link">
      <a [routerLink]="groupsLink">{{
        'harvest.places.groups.open' | rokuT
      }}</a>
    </nav>

    <lib-queue-frame
      (clearSelection)="queue.clearSelection()"
      (confirm)="importPlace()"
      (loadMore)="queue.loadMore()"
      (openRow)="open($event)"
      (pickRow)="queue.toggle($event)"
      (reject)="reject()"
      (selectAll)="queue.selectLoaded()"
      (skip)="queue.skip()"
      (stop)="queue.stopBulk()"
      [busy]="queue.busy()"
      [canLoadMore]="queue.canLoadMore()"
      [decided]="queue.decided()"
      [empty]="queue.empty()"
      [errorKey]="errorKey()"
      [failed]="queue.failed()"
      [loading]="queue.loading()"
      [loadingMore]="queue.loadingMore()"
      [progress]="queue.bulk()"
      [progressKey]="progressKey()"
      [remaining]="queue.items().length"
      [report]="report()"
      [rows]="queue.items()"
      [selected]="queue.selected()"
      [selectedCount]="queue.selectedCount()"
      confirmKey="harvest.places.import"
      defaultView="review"
      emptyKey="harvest.places.empty"
      rejectKey="harvest.places.reject"
      titleKey="harvest.places.heading"
    >
      <lib-harvest-notice
        (retry)="queue.load()"
        [absent]="shell.absent()"
        queueFailure
      />

      @if (queue.current(); as place) {
        <h2>{{ place.name ?? place.externalRef }}</h2>
        <p class="why">{{ 'harvest.places.why' | rokuT }}</p>

        <dl>
          @for (line of lines(); track line.key) {
            @if (line.value !== '') {
              <div>
                <dt>{{ 'harvest.places.field.' + line.key | rokuT }}</dt>
                <dd>{{ line.value }}</dd>
              </div>
            }
          }
        </dl>

        <div class="assign">
          <span>{{ 'harvest.places.supermarketId' | rokuT }}</span>
          @if (creatingChain()) {
            <div class="new-chain">
              <label>
                <span>{{ 'harvest.places.newChain.name' | rokuT }}</span>
                <input
                  (input)="onChainName($event)"
                  [value]="newChainName()"
                  id="places-new-chain-name"
                  maxlength="200"
                  type="text"
                />
              </label>
              <label>
                <span>{{ 'harvest.places.newChain.locale' | rokuT }}</span>
                <select
                  (change)="onChainLocale($event)"
                  [value]="newChainLocale()"
                  id="places-new-chain-locale"
                >
                  @for (locale of chainLocales; track locale) {
                    <option [value]="locale">
                      {{ 'harvest.places.newChain.language.' + locale | rokuT }}
                    </option>
                  }
                </select>
              </label>
              <p class="hint">{{ 'harvest.places.newChain.hint' | rokuT }}</p>
              <button (click)="cancelNewChain()" class="quiet" type="button">
                {{ 'harvest.places.newChain.cancel' | rokuT }}
              </button>
            </div>
          } @else {
            <lib-reference-picker
              (valueChange)="chooseChain($event)"
              [controlId]="'places-chain'"
              [lookup]="references"
              [nullable]="true"
              [resource]="'supermarkets'"
              [value]="supermarketId()"
            />
            @if (offersNewChain()) {
              <button
                (click)="startNewChain(place)"
                class="quiet"
                type="button"
              >
                {{ 'harvest.places.newChain.start' | rokuT }}
              </button>
            }
          }
        </div>

        <div class="assign scope">
          <span>{{ 'harvest.places.scope.heading' | rokuT }}</span>
          <p class="declared">
            @if (place.scopeKey; as key) {
              {{ 'harvest.places.scope.declared' | rokuT: { key: key } }}
            } @else {
              {{ 'harvest.places.scope.none' | rokuT }}
            }
          </p>
          @if (supermarketId() !== '') {
            <lib-reference-picker
              (valueChange)="priceScopeId.set($event)"
              [controlId]="'places-scope'"
              [lookup]="references"
              [nullable]="true"
              [resource]="'price-scopes'"
              [scope]="scopeOfChain()"
              [value]="priceScopeId()"
            />
            <small>{{ 'harvest.places.scope.pick' | rokuT }}</small>
          } @else {
            <small>{{ 'harvest.places.scope.chainFirst' | rokuT }}</small>
          }
        </div>

        @if (candidates(); as found) {
          <section
            aria-labelledby="places-match-heading"
            class="matches"
            role="region"
          >
            <h3 id="places-match-heading">
              {{ 'harvest.places.match.heading' | rokuT }}
            </h3>
            <p class="lead">{{ 'harvest.places.match.lead' | rokuT }}</p>

            <ul>
              @for (candidate of found; track candidate.supermarketLocationId) {
                <li>
                  <div class="who">
                    <strong>{{ candidate.title }}</strong>
                    @if (candidate.address !== candidate.title) {
                      <span>{{ candidate.address }}</span>
                    }
                    <span class="muted">{{ candidate.postalCode }}</span>
                  </div>
                  <span class="rung">{{
                    'harvest.places.match.rung.' + candidate.rung | rokuT
                  }}</span>
                  <button
                    (click)="link(candidate)"
                    [disabled]="queue.busy()"
                    class="primary"
                    type="button"
                  >
                    {{ 'harvest.places.match.link' | rokuT }}
                  </button>
                </li>
              }
            </ul>

            <button
              (click)="forceImport()"
              [disabled]="queue.busy()"
              class="force"
              type="button"
            >
              {{ 'harvest.places.match.force' | rokuT }}
            </button>
          </section>
        }
      }

      <section class="near" queueContext>
        <h3>{{ 'harvest.places.near.heading' | rokuT }}</h3>

        @if (near().length === 0) {
          <p class="none">{{ 'harvest.places.near.none' | rokuT }}</p>
        } @else {
          <ul>
            @for (other of near(); track other.id) {
              <li>
                <strong>{{ other.name ?? other.externalRef }}</strong>
                <span>{{ other.street }}</span>
                <span>{{ other.city }}</span>
                <span class="ref">{{ other.externalRef }}</span>
              </li>
            }
          </ul>
        }

        <h3>{{ 'harvest.places.nearCatalog.heading' | rokuT }}</h3>
        @if (catalogNear().length === 0) {
          <p class="none">{{ 'harvest.places.nearCatalog.none' | rokuT }}</p>
        } @else {
          <ul class="catalog">
            @for (shop of catalogNear(); track shop.id) {
              <li>
                <strong>{{ shop.title }}</strong>
                @if (shop.address !== shop.title) {
                  <span>{{ shop.address }}</span>
                }
                <span>{{ shop.postalCode }}</span>
                <span class="ref">
                  @if (shop.metres === null) {
                    {{ 'harvest.places.nearCatalog.unplaced' | rokuT }}
                  } @else {
                    {{
                      'harvest.places.nearCatalog.metres'
                        | rokuT: { metres: shop.metres }
                    }}
                  }
                </span>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Section 2's columns for this screen: the name, the street, the city
           and the provider's own reference. The same facts the review view
           leads with, because a list whose columns are a different four is a
           second thing to learn. -->
      <ng-template #queueRow let-row>
        <strong>{{ row.name ?? row.externalRef }}</strong>
        <span>{{ row.street }}</span>
        <span>{{ row.city }}</span>
        <span class="ref">{{ row.externalRef }}</span>
      </ng-template>

      <div class="bulk" queueBulk>
        <button
          (click)="askImport()"
          [disabled]="nothingPicked()"
          type="button"
        >
          {{ 'harvest.places.bulk.import' | rokuT }}
        </button>
        <button
          (click)="askReject()"
          [disabled]="nothingPicked()"
          class="danger"
          type="button"
        >
          {{ 'harvest.places.bulk.reject' | rokuT }}
        </button>
      </div>
    </lib-queue-frame>

    @if (pending(); as bulk) {
      <lib-confirm-dialog
        (confirm)="go(bulk)"
        (dismiss)="pending.set(null)"
        [bodyArgs]="{ count: bulk.count, chain: bulk.chain }"
        [bodyKey]="bulk.bodyKey"
        [busy]="queue.busy()"
        [confirmKey]="bulk.confirmKey"
        [headingKey]="bulk.headingKey"
        [tone]="bulk.tone"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    .views-link {
      display: flex;
      justify-content: flex-end;
      margin-block-end: var(--admin-space-2);
    }

    .views-link a {
      color: var(--admin-accent);
    }

    h2 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .why {
      margin-block: var(--admin-space-2);
      color: var(--admin-ink-muted);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      margin-block-end: var(--admin-space-3);
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .assign {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      margin-block-end: var(--admin-space-3);
    }

    .assign > span,
    .new-chain label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .assign small,
    .hint,
    .declared {
      color: var(--admin-ink-muted);
    }

    .declared {
      margin: 0;
    }

    .new-chain {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: var(--admin-space-2) var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .new-chain label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .new-chain .hint,
    .new-chain button {
      grid-column: 1 / -1;
    }

    @media (max-width: 40rem) {
      .new-chain {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .quiet {
      align-self: flex-start;
      min-block-size: 2.75rem;
      border: 1px dashed var(--admin-border);
      background: transparent;
      color: var(--admin-accent);
      cursor: pointer;
    }

    /* The candidates. A shop the catalog already holds is the answer the
       operator is most likely to want, so each one carries its own button and
       the rule that found it, and the new shop is the quieter choice below. */
    .matches {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-block: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-status-attention);
      border-radius: var(--admin-radius);
      background: var(--admin-status-attention-wash);
    }

    .matches h3,
    .matches .lead {
      margin: 0;
      color: var(--admin-status-attention-on-wash);
    }

    .matches ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .matches li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    @media (max-width: 40rem) {
      .matches li {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .who {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .rung {
      padding: 0.125rem var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: 999px;
      font-size: 0.75rem;
      color: var(--admin-ink-muted);
      white-space: nowrap;
    }

    .matches .primary {
      min-block-size: 2.75rem;
      border-color: var(--admin-accent);
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
      cursor: pointer;
    }

    .matches .force {
      align-self: flex-start;
      min-block-size: 2.75rem;
      background: var(--admin-surface-raised);
      cursor: pointer;
    }

    .matches button:active:not(:disabled) {
      transform: translateY(1px);
    }

    .matches button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .matches button:focus-visible,
    .quiet:focus-visible,
    .views-link a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .near {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .near ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .near li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .near .catalog li {
      border-style: solid;
    }

    .none,
    .ref {
      color: var(--admin-ink-muted);
    }

    .bulk {
      display: flex;
      flex: 2;
      gap: var(--admin-space-3);
    }

    .bulk button {
      flex: 1;
      min-block-size: 3rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .bulk .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-on-wash);
    }

    .bulk button:disabled {
      opacity: 0.55;
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlacesQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _route = inject(ActivatedRoute);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _content = inject(ContentLocaleStore);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  readonly chainLocales = CONTENT_LOCALES as readonly ChainLocale[];
  readonly groupsLink = ['/', HARVEST_SEGMENT, 'places', 'groups'];

  /**
   * The chain the picker holds, or `''`.
   *
   * Reset after every decision that went through, single or bulk: a visible
   * leftover choice quietly filing the next place under the previous chain is
   * the mistake the reset prevents, and the picker makes re-choosing cheap. It
   * survives a refusal, so "Create a new shop anyway" sends what was asked.
   */
  readonly supermarketId = signal('');

  /**
   * A scope of the picked chain to import under instead of the declared one,
   * or `''` for the declared one (backend plan 0152, section 1).
   */
  readonly priceScopeId = signal('');

  /** Whether the chain is being named here rather than picked (plan 0153). */
  readonly creatingChain = signal(false);
  readonly newChainName = signal('');
  readonly newChainLocale = signal<ChainLocale>('es');

  /**
   * The postal code this queue was opened on, from the URL, or `''`.
   *
   * The postal code detail page links here filtered to one code (admin plan
   * 0021, section 5), which backend plan 0097 section 9 added the filter for.
   * Read once from the snapshot rather than watched: nothing on this screen
   * changes it, and arriving with a different one is a fresh navigation.
   */
  readonly postalCode =
    this._route.snapshot.queryParamMap.get('postalCode') ?? '';
  private readonly _country =
    this._route.snapshot.queryParamMap.get('country') ?? '';

  /** The bulk action waiting for an answer, or null when none is. */
  readonly pending = signal<PendingPlacesBulk | null>(null);
  /** What the last bulk run did, by name. Cleared when another one starts. */
  readonly report = signal<QueueReport | null>(null);
  readonly progressKey = signal('harvest.queue.bulk.progress');

  readonly queue = new QueueStore<Place>(
    async (cursor) => {
      try {
        // Only the undecided ones. An imported or rejected place is not a
        // question any more, and a queue that offered it again would be asking
        // an operator to answer their own earlier answer.
        const page = await this._service.listPlaces({
          status: 'NEW',
          cursor,
          country: this._country === '' ? undefined : this._country,
          postalCode: this.postalCode === '' ? undefined : this.postalCode,
        });
        this.shell.observeReachable();
        return page;
      } catch (error) {
        this.shell.observeFailure();
        throw error;
      }
    },
    (place) => place.id
  );

  /**
   * The candidates the last import of a place answered with, by place.
   *
   * Keyed on the place so a skip does not carry them onto the next one: they
   * are an answer about one place, and drawn under another they would offer to
   * link the wrong shop.
   */
  private readonly _matches = signal<{
    readonly placeId: string;
    readonly candidates: readonly PlaceCandidate[];
  } | null>(null);

  /** The candidates for the place in front, or null when none were offered. */
  readonly candidates = computed<readonly PlaceCandidate[] | null>(() => {
    const matches = this._matches();
    const place = this.queue.current();
    return matches !== null && place !== null && matches.placeId === place.id
      ? matches.candidates
      : null;
  });

  /**
   * The sentence above the queue.
   *
   * A `place_matches_location` refusal draws the candidates instead, so it
   * has no sentence of its own here: the panel is the answer. The places
   * queue's own refusals are named; anything else is the generic sentence.
   */
  readonly errorKey = computed(() => {
    const error = this.queue.error();
    if (error?.code === 'place_matches_location' && this.candidates()) {
      return null;
    }
    if (this._needsChain()) {
      return 'harvest.places.error.needsChain';
    }
    return placeRefusalKey(error) ?? gatewayErrorKey(error);
  });

  /** An import was refused because the place cannot name its own chain. */
  private readonly _needsChain = signal(false);

  readonly nothingPicked = computed(() => this.queue.selectedCount() === 0);

  readonly lines = computed(() => {
    const place = this.queue.current();
    return place === null ? [] : placeLines(place);
  });

  /**
   * The places this one might be a duplicate of.
   *
   * Same brand key and within a short distance, which is the rule that decided
   * to ask in the first place, applied to what is still in the queue. Grouping
   * is on `brand:wikidata` and never on the name, because `Dia` and `Maxi Dia`
   * share one QID while name matching would split exactly the pair somebody
   * needs to see together.
   */
  readonly near = computed(() => {
    const place = this.queue.current();
    return place === null ? [] : nearby(place, this.queue.upcoming());
  });

  /**
   * The catalog's own shops of the place's chain near it (admin plan 0034,
   * section 1).
   *
   * The chain is the picked one, or the one whose Wikidata key the place
   * carries. A place with neither has no chain to read shops of, and the panel
   * says there is nothing near rather than guessing.
   */
  readonly catalogNear = signal<readonly NearbyShop[]>([]);
  /** Which read is the latest, so a slow earlier answer cannot overwrite it. */
  private _nearRead = 0;
  /** Chains by Wikidata key, as far as this screen has asked. */
  private readonly _chainsByKey = new Map<string, string | null>();

  /** Offered for an OpenStreetMap place only, which is the one that needs it. */
  readonly offersNewChain = computed(() => {
    const place = this.queue.current();
    return place !== null && fromOpenStreetMap(place);
  });

  /** What the scope picker reads: the picked chain's scopes, and no other's. */
  readonly scopeOfChain = computed(() => ({
    supermarketId: this.supermarketId(),
  }));

  constructor() {
    void this.queue.load();

    effect(() => {
      const place = this.queue.current();
      const chain = this.supermarketId();
      void this._readCatalogNear(place, chain);
    });
  }

  /** A different chain means a different set of scopes to pick from. */
  chooseChain(supermarketId: string): void {
    this.supermarketId.set(supermarketId);
    this.priceScopeId.set('');
  }

  /**
   * Import the place in front.
   *
   * Refused with `place_matches_location`, the place stays in front and the
   * candidates come up under it. Refused because an OpenStreetMap place cannot
   * name its own chain, the chain form opens with the place's brand in it.
   */
  async importPlace(force = false): Promise<void> {
    const place = this.queue.current();
    if (place === null) {
      return;
    }

    const body = this._importBody(force);
    await this.queue.decide((row) => this._service.importPlace(row.id, body));
    this._settle(place, body);
  }

  /** "Create a new shop anyway", which is the same import with `force`. */
  forceImport(): Promise<void> {
    return this.importPlace(true);
  }

  /**
   * Bind the place to a shop the catalog already holds (backend plan 0152,
   * section 3). The one call that writes nothing new to the catalog.
   */
  async link(candidate: PlaceCandidate): Promise<void> {
    await this.queue.decide((place) =>
      this._service.linkPlace(place.id, {
        supermarketLocationId: candidate.supermarketLocationId,
      })
    );
    if (this.queue.error() === null) {
      this._reset();
    }
  }

  reject(): void {
    void this.queue.decide((place) => this._service.rejectPlace(place.id));
  }

  /** A row the operator wants to look at properly, rather than tick. */
  open(id: string): void {
    this.queue.focus(id);
  }

  /** Name the chain here, starting from the brand the place prints. */
  startNewChain(place: Place): void {
    this.creatingChain.set(true);
    this.supermarketId.set('');
    this.priceScopeId.set('');
    if (this.newChainName().trim() === '') {
      this.newChainName.set(place.brandName ?? place.name ?? '');
    }
  }

  cancelNewChain(): void {
    this.creatingChain.set(false);
    this._needsChain.set(false);
  }

  onChainName(event: Event): void {
    this.newChainName.set((event.target as HTMLInputElement).value);
  }

  onChainLocale(event: Event): void {
    this.newChainLocale.set(
      (event.target as HTMLSelectElement).value as ChainLocale
    );
  }

  /**
   * Import every selected place, under the picked chain when one is picked.
   *
   * The bulk path used to send an empty body always, because one operator's
   * typed answer applied to rows they did not look at. The owner weighed that
   * and the chain applies now (admin plan 0024, section 3.2); what makes it
   * acceptable is the control's nature. A typed uuid was opaque, where the
   * picker shows the chosen chain **by name**, and the confirm dialog seals it:
   * with a chain picked, the body names it beside the count, so the operator
   * confirms "import 12 places under Mercadona" and not just "import 12
   * places". With none picked the body and the behaviour are exactly the old
   * ones: catalog resolves each place from its brand, and a place whose brand
   * it cannot resolve is refused and named in the report.
   *
   * **It never links, and never forces** (admin plan 0034). A place the catalog
   * may already hold answers `place_matches_location`, stays in the queue and
   * is named in the report with that reason, for a person to settle one at a
   * time. A picked scope and a new chain are single decisions too: a scope is
   * one warehouse and a chain name is one place's brand.
   */
  async askImport(): Promise<void> {
    const supermarketId = this.supermarketId().trim();
    const body = supermarketId === '' ? {} : { supermarketId };
    // The name for the dialog's sentence. The id, when the lookup answered
    // nothing: a blank would ask the operator to confirm filing under nothing
    // in particular.
    const chain =
      supermarketId === ''
        ? ''
        : ((await this.references.resolve('supermarkets', supermarketId))
            ?.title ?? supermarketId);

    this.pending.set({
      headingKey: 'harvest.places.bulk.importConfirm.heading',
      bodyKey:
        supermarketId === ''
          ? 'harvest.places.bulk.importConfirm.body'
          : 'harvest.places.bulk.importConfirm.bodyChained',
      confirmKey: 'harvest.places.bulk.import',
      progressKey: 'harvest.places.bulk.importing',
      count: this.queue.selectedCount(),
      leftAlone: 0,
      tone: 'primary',
      chain,
      run: () =>
        this._run({
          act: async (place) => {
            await this._service.importPlace(place.id, body);
            return null;
          },
          nameOf: (place) => place.name ?? place.externalRef,
          reasonOf: placeRefusalKey,
          // The picker resets after a bulk run for the same reason it resets
          // after a single decision.
        }).then(() => this._reset()),
    });
  }

  askReject(): void {
    this.pending.set({
      chain: '',
      headingKey: 'harvest.places.bulk.rejectConfirm.heading',
      bodyKey: 'harvest.places.bulk.rejectConfirm.body',
      confirmKey: 'harvest.places.bulk.reject',
      progressKey: 'harvest.places.bulk.rejecting',
      count: this.queue.selectedCount(),
      leftAlone: 0,
      tone: 'danger',
      run: () =>
        this._run({
          act: async (place) => {
            await this._service.rejectPlace(place.id);
            return null;
          },
          nameOf: (place) => place.name ?? place.externalRef,
          reasonOf: placeRefusalKey,
        }),
    });
  }

  /** Go through with the confirmed bulk action. */
  go(bulk: PendingBulk): void {
    this.pending.set(null);
    this.progressKey.set(bulk.progressKey);
    void bulk.run();
  }

  /**
   * What an import of the place in front sends.
   *
   * A chain named here wins over a picked one, and the two are never both
   * sent: the harvester refuses that pair. Nothing is sent that was not
   * chosen, so an untouched panel still sends `{}` and the harvester resolves
   * the chain from the brand and the scope from the run.
   */
  private _importBody(force: boolean): Wire.ImportDiscoveredPlaceDto {
    const body: Wire.ImportDiscoveredPlaceDto = {};
    const name = this.newChainName().trim();
    const supermarketId = this.supermarketId().trim();

    if (this.creatingChain() && name !== '') {
      body.newChain = { name, locale: this.newChainLocale() };
    } else if (supermarketId !== '') {
      body.supermarketId = supermarketId;
      const priceScopeId = this.priceScopeId().trim();
      if (priceScopeId !== '') {
        body.priceScopeId = priceScopeId;
      }
    }
    if (force) {
      body.force = true;
    }
    return body;
  }

  /** Read what the import answered, and set the panel up for the next step. */
  private _settle(place: Place, body: Wire.ImportDiscoveredPlaceDto): void {
    const error = this.queue.error();
    if (error === null) {
      this._reset();
      return;
    }

    if (error.code === 'place_matches_location') {
      this._matches.set({
        placeId: place.id,
        candidates: placeCandidates(error.details, this._content.order()),
      });
      return;
    }

    // The plain conflict an OpenStreetMap place gets when nothing names its
    // chain (backend plan 0153). Opening the form is the answer to it.
    const unnamed =
      body.supermarketId === undefined && body.newChain === undefined;
    if (error.code === 'conflict' && unnamed && fromOpenStreetMap(place)) {
      this._needsChain.set(true);
      this.startNewChain(place);
    }
  }

  private _reset(): void {
    this.supermarketId.set('');
    this.priceScopeId.set('');
    this.creatingChain.set(false);
    this.newChainName.set('');
    this.newChainLocale.set('es');
    this._matches.set(null);
    this._needsChain.set(false);
  }

  /**
   * The catalog shops near the place in front, for the duplicates panel.
   *
   * A read that fails costs the panel its catalog half and nothing else: the
   * import still asks the catalog itself, so this is evidence for a person and
   * never the check.
   */
  private async _readCatalogNear(
    place: Place | null,
    picked: string
  ): Promise<void> {
    const read = ++this._nearRead;
    const done = (shops: readonly NearbyShop[]) => {
      if (read === this._nearRead) {
        this.catalogNear.set(shops);
      }
    };

    if (place === null) {
      done([]);
      return;
    }

    const chain = picked !== '' ? picked : await this._chainOf(place);
    const locations = this._registry.byName('locations');
    if (chain === null || locations === undefined) {
      done([]);
      return;
    }

    try {
      const page = await this._registry.gatewayFor(locations).list({
        filters: { supermarketId: chain },
        limit: CATALOG_SHOPS_READ,
      });
      done(nearbyShops(place, page.items, this._content.order()));
    } catch {
      done([]);
    }
  }

  /**
   * The chain whose Wikidata key the place carries, or null.
   *
   * Searched by the key, which the chains route matches, and then compared
   * exactly: a search is a substring match and `Q2` is inside `Q217599`.
   */
  private async _chainOf(place: Place): Promise<string | null> {
    const key = place.brandKey;
    if (key === null || key === '') {
      return null;
    }
    const known = this._chainsByKey.get(key);
    if (known !== undefined) {
      return known;
    }

    const supermarkets = this._registry.byName('supermarkets');
    if (supermarkets === undefined) {
      return null;
    }

    try {
      const page = await this._registry.gatewayFor(supermarkets).list({
        filters: { query: key },
        limit: 20,
      });
      const found = page.items.find((row) => row['externalBrandKey'] === key);
      const id = typeof found?.['id'] === 'string' ? found['id'] : null;
      this._chainsByKey.set(key, id);
      return id;
    } catch {
      return null;
    }
  }

  private async _run(bulk: QueueBulkAct<Place>): Promise<void> {
    this.report.set(null);
    this.report.set(await runQueueBulk(this.queue, bulk));
    this.progressKey.set('harvest.queue.bulk.progress');
  }
}

/**
 * This screen's pending bulk, which also carries the chain by name.
 *
 * `''` for the actions that file under none, so the dialog's arguments always
 * have the field and the chained body key is the only reader of it.
 */
interface PendingPlacesBulk extends PendingBulk {
  readonly chain: string;
}
