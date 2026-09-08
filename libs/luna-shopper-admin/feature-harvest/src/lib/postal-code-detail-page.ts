import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  POSTAL_CODE_SERVICE,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { formatInstant, formatSince } from './format-instant';
import { HARVEST_SEGMENT } from './harvest-paths';
import { DEFAULT_POSTAL_CODE_COUNTRY } from './postal-code-queue-gateway';

/** A postal code the harvester worked out rather than read off the map. */
const DERIVED: Wire.EnumsPostalCodeSource = 'DERIVED';

/** How many places of one code the panel shows before sending you to the queue. */
const PLACE_LIMIT = 25;

/**
 * How much of the queue is read to find out which neighbours are in it.
 *
 * The listing is demand driven and short by design, which is the same reason
 * this screen's list offers no status filter. One page of a hundred is a bound
 * rather than a claim: a neighbour past it simply does not link, which is the
 * safe way to be wrong.
 */
const QUEUE_SCAN_LIMIT = 100;

/** One neighbouring code, with how far away it is and whether it is tracked. */
interface NearCode {
  readonly postalCode: string;
  readonly distanceMetres: number;
  readonly tracked: boolean;
}

/**
 * One postal code, and the three questions an operator asks about it (admin plan
 * 0021, section 5).
 *
 * A component rather than a generated read view, because the answer comes from
 * three services and there is nothing here to edit. Each panel loads on its own
 * and **fails on its own**: a core outage empties the waiting panel and leaves
 * the other three, because the page is four questions and three of them still
 * have answers.
 */
@Component({
  selector: 'lib-postal-code-detail-page',
  imports: [RokuTranslatorPipe, RouterLink],
  template: `
    <header>
      <button (click)="back()" class="back" type="button">
        {{ 'harvest.postalCodes.detail.back' | rokuT }}
      </button>
      <h1>{{ postalCode }}</h1>
      <p class="kind">{{ row()?.placeName ?? '' }}</p>
    </header>

    <!-- 1. The row itself. -->
    <section class="panel">
      <h2>{{ 'harvest.postalCodes.detail.queue' | rokuT }}</h2>

      @if (rowLoading()) {
        <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
      } @else if (rowErrorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (row(); as view) {
        <dl>
          <div>
            <dt>{{ 'harvest.postalCodes.field.status' | rokuT }}</dt>
            <dd>{{ 'harvest.postalCodes.status.' + view.status | rokuT }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.field.requestedAt' | rokuT }}</dt>
            <dd>{{ instant(view.requestedAt) }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.field.discoveredAt' | rokuT }}</dt>
            <dd>{{ instant(view.discoveredAt) }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.field.lastAttemptedAt' | rokuT }}</dt>
            <dd>{{ instant(view.lastAttemptedAt) }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.field.attempts' | rokuT }}</dt>
            <dd>{{ view.attempts }}</dd>
          </div>
        </dl>

        @if (view.error; as message) {
          <p class="failure" role="alert">{{ message }}</p>
        }

        @if (view.runId; as runId) {
          <a [routerLink]="['/', segment, 'runs', runId]" class="run">
            {{ 'harvest.postalCodes.detail.lastRun' | rokuT }}
          </a>
        }

        <!-- The two count pairs, side by side, each saying which it is. A table
             column cannot explain itself and this panel can. -->
        <div class="counts">
          <div class="pair">
            <h3>{{ 'harvest.postalCodes.detail.locatedInIt' | rokuT }}</h3>
            <p class="explains">
              {{ 'harvest.postalCodes.detail.locatedInItSays' | rokuT }}
            </p>
            <dl>
              <div>
                <dt>{{ 'harvest.postalCodes.count.total' | rokuT }}</dt>
                <dd>{{ view.locatedInIt.total }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.postalCodes.count.imported' | rokuT }}</dt>
                <dd>{{ view.locatedInIt.imported }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.postalCodes.count.rejected' | rokuT }}</dt>
                <dd>{{ view.locatedInIt.rejected }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.postalCodes.count.undecided' | rokuT }}</dt>
                <dd>{{ view.locatedInIt.undecided }}</dd>
              </div>
            </dl>
          </div>

          <div class="pair">
            <h3>{{ 'harvest.postalCodes.detail.foundByItsRuns' | rokuT }}</h3>
            <p class="explains">
              {{ 'harvest.postalCodes.detail.foundByItsRunsSays' | rokuT }}
            </p>
            <dl>
              <div>
                <dt>{{ 'harvest.postalCodes.count.total' | rokuT }}</dt>
                <dd>{{ view.foundByItsRuns.total }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.postalCodes.count.imported' | rokuT }}</dt>
                <dd>{{ view.foundByItsRuns.imported }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.postalCodes.count.rejected' | rokuT }}</dt>
                <dd>{{ view.foundByItsRuns.rejected }}</dd>
              </div>
              <div>
                <dt>{{ 'harvest.postalCodes.count.undecided' | rokuT }}</dt>
                <dd>{{ view.foundByItsRuns.undecided }}</dd>
              </div>
            </dl>
          </div>
        </div>
      }
    </section>

    <!-- 2. Near codes. -->
    <section class="panel">
      <h2>{{ 'harvest.postalCodes.detail.near' | rokuT }}</h2>
      <p class="explains">
        {{ 'harvest.postalCodes.detail.nearSays' | rokuT }}
      </p>

      @if (nearLoading()) {
        <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
      } @else if (nearErrorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (!known()) {
        <p class="state">
          {{ 'harvest.postalCodes.detail.notShipped' | rokuT }}
        </p>
      } @else if (near().length === 0) {
        <p class="state">{{ 'harvest.postalCodes.detail.noNear' | rokuT }}</p>
      } @else {
        <ul class="near">
          @for (code of near(); track code.postalCode) {
            <li>
              @if (code.tracked) {
                <a [routerLink]="['..', code.postalCode]" class="code">
                  {{ code.postalCode }}
                </a>
              } @else {
                <span class="code">{{ code.postalCode }}</span>
              }
              <span class="distance">{{
                kilometres(code.distanceMetres)
              }}</span>
            </li>
          }
        </ul>
      }
    </section>

    <!-- 3. Places in this code. -->
    <section class="panel">
      <h2>{{ 'harvest.postalCodes.detail.places' | rokuT }}</h2>

      @if (placesLoading()) {
        <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
      } @else if (placesErrorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else {
        <p class="shops">
          {{
            'harvest.postalCodes.detail.shops'
              | rokuT: { count: shopCount() ?? 0 }
          }}
        </p>

        @if (places().length === 0) {
          <p class="state">
            {{ 'harvest.postalCodes.detail.noPlaces' | rokuT }}
          </p>
        } @else {
          <ul class="places">
            @for (place of places(); track place.id) {
              <li>
                <span class="name">{{ place.name ?? place.externalRef }}</span>
                <span class="status">
                  {{
                    'harvest.postalCodes.placeStatus.' + place.status | rokuT
                  }}
                </span>
                <span class="source">{{ sourceKey(place) | rokuT }}</span>
              </li>
            }
          </ul>
        }

        <div class="links">
          <a
            [queryParams]="{ country: country, postalCode: postalCode }"
            [routerLink]="['/', segment, 'places']"
          >
            {{ 'harvest.postalCodes.detail.openPlaces' | rokuT }}
          </a>
          <!-- The shops list, wherever the catalog section mounted it. Its
               segment says what the resource calls itself and nothing about
               which section holds it (admin plan 0022, section 3). -->
          @if (locationsLink(); as link) {
            <a [routerLink]="link">
              {{ 'harvest.postalCodes.detail.openLocations' | rokuT }}
            </a>
          }
        </div>
      }
    </section>

    <!-- 4. Who is waiting. -->
    <section class="panel">
      <h2>{{ 'harvest.postalCodes.detail.waiting' | rokuT }}</h2>

      @if (usageLoading()) {
        <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
      } @else if (usageErrorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (usage(); as counts) {
        <dl>
          <div>
            <dt>{{ 'harvest.postalCodes.waiting.mainProfiles' | rokuT }}</dt>
            <dd>{{ counts.mainProfiles }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.waiting.mainUsers' | rokuT }}</dt>
            <dd>{{ counts.mainUsers }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.waiting.nearbyProfiles' | rokuT }}</dt>
            <dd>{{ counts.nearbyProfiles }}</dd>
          </div>
          <div>
            <dt>{{ 'harvest.postalCodes.waiting.nearbyUsers' | rokuT }}</dt>
            <dd>{{ counts.nearbyUsers }}</dd>
          </div>
        </dl>

        <p class="explains">
          {{
            'harvest.postalCodes.waiting.suppressed'
              | rokuT: { count: counts.suppressedProfiles }
          }}
        </p>
      }
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    h1 {
      font-family: monospace;
      font-size: 1.5rem;
      font-weight: 700;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.875rem;
      font-weight: 700;
    }

    .kind {
      color: var(--admin-ink-muted);
    }

    .back {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .explains,
    .state,
    .distance,
    .source {
      color: var(--admin-ink-muted);
    }

    .failure {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
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

    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      inline-size: 100%;
    }

    .pair {
      display: flex;
      flex: 1 1 16rem;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-3);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      inline-size: 100%;
    }

    li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .code {
      font-family: monospace;
      font-weight: 700;
    }

    .name {
      flex: 1;
      overflow-wrap: anywhere;
    }

    .links {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PostalCodeDetailPage {
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _postalCodes = inject(POSTAL_CODE_SERVICE);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);

  /** Where the shops list lives, or nothing where this app did not mount it. */
  locationsLink(): readonly string[] | null {
    return this._registry.pathOf('locations');
  }

  readonly segment = HARVEST_SEGMENT;

  /** The code, from the URL. It is the row's address (see the descriptor). */
  readonly postalCode = this._route.snapshot.paramMap.get('id') ?? '';

  /**
   * The country, from the query string, defaulted.
   *
   * On the query string rather than in the path because the address of a row is
   * its code: one deployment serves one country, and a segment nobody ever
   * varies is a segment that makes every link longer to no purpose.
   */
  readonly country =
    this._route.snapshot.queryParamMap.get('country') ??
    DEFAULT_POSTAL_CODE_COUNTRY;

  readonly row = signal<Wire.HarvestPostalCodeDiscoveryRequestView | null>(
    null
  );
  readonly rowLoading = signal(true);
  readonly rowError = signal<GatewayError | null>(null);

  readonly near = signal<readonly NearCode[]>([]);
  readonly known = signal(true);
  readonly nearLoading = signal(true);
  readonly nearError = signal<GatewayError | null>(null);

  readonly places = signal<readonly Wire.HarvestDiscoveredPlaceView[]>([]);
  /** Shops catalog already holds here, or null when the code is not shipped. */
  readonly shopCount = signal<number | null>(null);
  readonly placesLoading = signal(true);
  readonly placesError = signal<GatewayError | null>(null);

  readonly usage = signal<Wire.AdminCorePostalCodeUsageView | null>(null);
  readonly usageLoading = signal(true);
  readonly usageError = signal<GatewayError | null>(null);

  readonly rowErrorKey = computed(() => gatewayErrorKey(this.rowError()));
  readonly nearErrorKey = computed(() => gatewayErrorKey(this.nearError()));
  readonly placesErrorKey = computed(() => gatewayErrorKey(this.placesError()));
  readonly usageErrorKey = computed(() => gatewayErrorKey(this.usageError()));

  constructor() {
    // Four reads, started together and settled apart. Nothing here waits on
    // anything else, which is what makes one service being down cost one panel.
    void this._loadRow();
    void this._loadNear();
    void this._loadPlaces();
    void this._loadUsage();
  }

  back(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }

  instant(value: string | null): string {
    return formatInstant(value);
  }

  /**
   * Whether a place's postal code was read off the map or worked out.
   *
   * A method rather than a ternary in the template, because the catalogue spec
   * reads every string literal a template pipes and a comparison written inline
   * is reported as a key nobody wrote a sentence for.
   *
   * A worked out code says so wherever it is shown. The nearest centre is a good
   * rule and it is still a guess, and the counts on this page are built on it.
   */
  sourceKey(place: Wire.HarvestDiscoveredPlaceView): string {
    return place.postalCodeSource === DERIVED
      ? 'harvest.postalCodes.detail.derived'
      : 'harvest.postalCodes.detail.tagged';
  }

  /** A distance in whole kilometres, or in metres below one. */
  kilometres(metres: number): string {
    return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
  }

  /** How long ago the code was last looked at, for the heading area. */
  since(value: string | null): string {
    return formatSince(value, Date.now());
  }

  private async _loadRow(): Promise<void> {
    try {
      const page = await this._harvest.listPostalCodes({
        country: this.country,
        postalCode: this.postalCode,
      });
      // The filter is a prefix, so the exact code is found rather than taken.
      this.row.set(
        page.items.find((row) => row.postalCode === this.postalCode) ?? null
      );
    } catch (error) {
      this.rowError.set(error as GatewayError);
    } finally {
      this.rowLoading.set(false);
    }
  }

  /**
   * The neighbours, and which of them this back office can open.
   *
   * Two reads rather than one per neighbour: catalog answers the codes and one
   * page of the queue says which of them are tracked. A neighbour past that page
   * draws as text, which is the safe way to be wrong: a link that leads to a
   * "no such code" page is worse than a code with no link.
   */
  private async _loadNear(): Promise<void> {
    try {
      const answer = await this._postalCodes.nearby(
        this.country,
        this.postalCode
      );
      this.known.set(answer.known);

      const tracked = new Set<string>();
      try {
        const page = await this._harvest.listPostalCodes({
          country: this.country,
          limit: QUEUE_SCAN_LIMIT,
        });
        for (const row of page.items) {
          tracked.add(row.postalCode);
        }
      } catch {
        // Which neighbours are tracked is a decoration on a decoration. Losing
        // it costs the links and nothing else.
      }

      this.near.set(
        answer.postalCodes.map((code) => ({
          postalCode: code.postalCode,
          distanceMetres: code.distanceMetres,
          tracked: tracked.has(code.postalCode),
        }))
      );
    } catch (error) {
      this.nearError.set(error as GatewayError);
    } finally {
      this.nearLoading.set(false);
    }
  }

  private async _loadPlaces(): Promise<void> {
    try {
      const page = await this._harvest.listPlaces({
        country: this.country,
        postalCode: this.postalCode,
        limit: PLACE_LIMIT,
      });
      this.places.set(page.items);

      // The number that decides whether velista shows a shopper anything at
      // all. A code catalog does not ship answers null, and the panel says nought
      // rather than pretending it counted.
      const shipped = await this._postalCodes.shipped(
        this.country,
        this.postalCode
      );
      this.shopCount.set(shipped?.locationCount ?? null);
    } catch (error) {
      this.placesError.set(error as GatewayError);
    } finally {
      this.placesLoading.set(false);
    }
  }

  private async _loadUsage(): Promise<void> {
    try {
      const answer = await this._postalCodes.usage(this.country, [
        this.postalCode,
      ]);
      this.usage.set(
        answer.usage.find((row) => row.postalCode === this.postalCode) ?? null
      );
    } catch (error) {
      this.usageError.set(error as GatewayError);
    } finally {
      this.usageLoading.set(false);
    }
  }
}
