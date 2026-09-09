import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  QueueStore,
  RESOURCE_GATEWAYS,
  type CreateItemFromSourceEntryInput,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  PRICE_SCOPES,
  priceScopeSource,
  type PriceScope,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  OFFICIAL_SOURCE_KINDS,
  SOURCE_ENTRY_STATUSES,
  type OfficialSourceKind,
  type SourceEntryStatus,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  QueueFrame,
  ReferencePicker,
  type QueueReport,
} from '@portfolio/luna-shopper-admin/ui';
import {
  proposalOf,
  toSourceEntryRow,
  type SourceEntryPriceLine,
  type SourceEntryRow,
} from './entry-view';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';
import {
  runQueueBulk,
  type PendingBulk,
  type QueueBulkAct,
} from './queue-bulk';

/** One entry off the wire, which is what the queue holds. */
type Entry = Wire.HarvestSourceCatalogEntryView;

/** The categories a created item may be given. */
const CATEGORIES: readonly Wire.EnumsItemCategory[] = [
  'PRODUCE',
  'DAIRY',
  'BAKERY',
  'MEAT',
  'SEAFOOD',
  'FROZEN',
  'BEVERAGES',
  'SNACKS',
  'PANTRY',
  'HOUSEHOLD',
  'PERSONAL_CARE',
  'OTHER',
];

/** The units it may be sold by. */
const UNITS: readonly Wire.EnumsUnitOfMeasure[] = [
  'UNIT',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
  'PACK',
];

/** How far the scope read walks, to give a price line a name rather than a uuid. */
const SCOPE_PAGE = 100;

/**
 * Everything a source named and nobody has decided (admin plan 0014, section 1).
 *
 * **One queue where there were three.** `harvest/entries` listed what a walk
 * found and nothing matched, `harvest/item-refs` the fuzzy matches a walk
 * proposed, and `harvest/leaflets/queue` the printed names a leaflet queued.
 * Backend plan `0086` folded the three tables into `source_catalog_entries` with
 * one status column, so they are one screen: the row shapes were never really
 * three, only the tables were.
 *
 * Four things on it are the design rather than details of it.
 *
 * **The chain is a filter, beside the other two.** It used to be a gate: the
 * screen opened on a chooser, and once a chain was chosen there was no way back
 * to another one short of reloading the page. The key of a row is
 * (`supermarketId`, `externalId`), so a row's key means nothing outside its
 * chain, but the row names its chain and the queue is one queue. Nothing is
 * chosen by default, and then the read is every chain's rows, newest first,
 * which is the order the queue reads in anyway. A row draws its chain's name
 * while no chain is chosen, because that is when the badge says something the
 * filters do not.
 *
 * **The source kind is a badge and a filter**, because it is the one thing that
 * tells a Mercadona product from a Mercadona leaflet tile of the same product,
 * and the two are two rows on purpose. Without the filter an operator working
 * through a leaflet's two hundred rows is interleaved with a walk's four
 * thousand.
 *
 * **A price line per scope, and none is a statement.** Two regional leaflets
 * print one product and each price belongs to its own scope, which is why the
 * prices left the row. A row with none says so in words: for a DEZA row that is
 * the truth, and an operator who accepts one and sees nothing written must not
 * read that as a failure.
 *
 * **A proposal is either a product or a sibling row**, and the primary action
 * differs. A sibling is the row of this chain that carries the EAN, so it is the
 * one to create the item from, and the button opens it rather than accepting
 * here.
 */
@Component({
  selector: 'lib-entries-queue-page',
  imports: [
    FormsModule,
    RouterLink,
    RokuTranslatorPipe,
    QueueFrame,
    HarvestNotice,
    ReferencePicker,
    ConfirmDialog,
  ],
  template: `
    <section class="filters">
      <div class="field">
        <label for="entries-chain">{{
          'harvest.entries.filter.chain' | rokuT
        }}</label>
        <lib-reference-picker
          (valueChange)="open($event)"
          [controlId]="'entries-chain'"
          [lookup]="references"
          [nullable]="true"
          [resource]="'supermarkets'"
          [value]="chosen()"
        />
        @if (chosen() === '') {
          <p class="hint">{{ 'harvest.entries.filter.anyChain' | rokuT }}</p>
        }
      </div>

      <label>
        <span>{{ 'harvest.entries.filter.status' | rokuT }}</span>
        <select
          (ngModelChange)="chooseStatus($event)"
          [ngModel]="status()"
          name="status"
        >
          <option value="">
            {{ 'harvest.entries.filter.queued' | rokuT }}
          </option>
          @for (option of statuses; track option) {
            <option [value]="option">
              {{ 'harvest.entryStatus.' + option | rokuT }}
            </option>
          }
        </select>
      </label>

      <label>
        <span>{{ 'harvest.entries.filter.sourceKind' | rokuT }}</span>
        <select
          (ngModelChange)="chooseKind($event)"
          [ngModel]="sourceKind()"
          name="sourceKind"
        >
          <option value="">
            {{ 'harvest.entries.filter.anyKind' | rokuT }}
          </option>
          @for (option of kinds; track option) {
            <option [value]="option">
              {{ 'harvest.sourceKind.' + option | rokuT }}
            </option>
          }
        </select>
      </label>
    </section>

    @if (queue !== null) {
      <lib-queue-frame
        (clearSelection)="queue!.clearSelection()"
        (confirm)="primary()"
        (loadMore)="queue!.loadMore()"
        (openRow)="openRow($event)"
        (pickRow)="queue!.toggle($event)"
        (reject)="rejecting.set(true)"
        (selectAll)="queue!.selectLoaded()"
        (skip)="skip()"
        (stop)="queue!.stopBulk()"
        [busy]="queue!.busy()"
        [canLoadMore]="queue!.canLoadMore()"
        [confirmKey]="confirmKey()"
        [decided]="queue!.decided()"
        [empty]="queue!.empty()"
        [errorKey]="errorKey()"
        [failed]="queue!.failed()"
        [loading]="queue!.loading()"
        [loadingMore]="queue!.loadingMore()"
        [progress]="queue!.bulk()"
        [progressKey]="progressKey()"
        [remaining]="queue!.items().length"
        [report]="report()"
        [rows]="listRows()"
        [selected]="queue!.selected()"
        [selectedCount]="queue!.selectedCount()"
        defaultView="review"
        emptyKey="harvest.entries.empty"
        rejectKey="harvest.entries.reject"
        titleKey="harvest.entries.heading"
      >
        <lib-harvest-notice
          (retry)="queue!.load()"
          [absent]="shell.absent()"
          queueFailure
        />

        @if (row(); as entry) {
          <h2>{{ entry.name }}</h2>
          <p class="identity">
            <!-- The chain, while none is chosen, because that is when it says
                 something the filters do not. -->
            @if (chosen() === '' && chainName(entry.supermarketId); as chain) {
              <span class="chain">{{ chain }}</span>
            }
            @if (entry.sourceKind; as kind) {
              <span [class]="kind" class="kind">{{
                'harvest.sourceKind.' + kind | rokuT
              }}</span>
            }
            <span class="brand">{{ entry.brand }}</span>
            <span class="size">{{ entry.sizeFormat }}</span>
            @if (entry.ean !== '') {
              <span class="ean">{{ entry.ean }}</span>
            }
            <span class="seen">{{
              'harvest.entries.timesSeen' | rokuT: { count: entry.timesSeen }
            }}</span>
          </p>

          <section class="prices">
            <h3>{{ 'harvest.entries.prices.heading' | rokuT }}</h3>
            @if (entry.prices.length === 0) {
              <p class="hint">{{ 'harvest.entries.prices.none' | rokuT }}</p>
            } @else {
              <ul>
                @for (line of priceLines(); track line.scopeId) {
                  <li>
                    <span class="scope">{{ line.scope }}</span>
                    <span class="amount">{{ line.price }}</span>
                    <span class="unit">{{ line.unitPrice }}</span>
                    <span class="window">{{ line.window }}</span>
                  </li>
                }
              </ul>
            }
          </section>

          <dl>
            @for (line of lines(); track line.key) {
              @if (line.value !== '') {
                <div>
                  <dt>{{ 'harvest.entries.field.' + line.key | rokuT }}</dt>
                  <dd>{{ line.value }}</dd>
                </div>
              }
            }
          </dl>

          <section class="proposal">
            <h3>{{ 'harvest.entries.proposal.heading' | rokuT }}</h3>
            @switch (proposal()) {
              @case ('item') {
                <p class="hint">
                  {{
                    'harvest.entries.proposal.item'
                      | rokuT: { confidence: entry.confidence }
                  }}
                </p>
              }
              @case ('sibling') {
                <p class="hint">
                  {{
                    'harvest.entries.proposal.sibling'
                      | rokuT: { name: siblingName() }
                  }}
                </p>
                @if (siblingName() === '') {
                  <p class="hint">
                    {{
                      'harvest.entries.proposal.siblingElsewhere'
                        | rokuT: { id: entry.candidateEntryId }
                    }}
                  </p>
                }
              }
              @default {
                <p class="hint">
                  {{ 'harvest.entries.proposal.none' | rokuT }}
                </p>
              }
            }
            @if (entry.matchedBy; as matchedBy) {
              <p class="hint">
                {{ 'harvest.match.' + matchedBy | rokuT }}
              </p>
            }
          </section>

          @if (entry.extra.length > 0) {
            <details class="extra">
              <summary>{{ 'harvest.entries.extra' | rokuT }}</summary>
              <dl>
                @for (line of entry.extra; track line.key) {
                  <div>
                    <dt>{{ line.key }}</dt>
                    <dd>
                      <pre>{{ line.value }}</pre>
                    </dd>
                  </div>
                }
              </dl>
            </details>
          }

          @if (entry.lastRunId !== '') {
            <p class="run">
              <a [routerLink]="runLink(entry.lastRunId)">{{
                'harvest.entries.lastRun' | rokuT
              }}</a>
            </p>
          }

          @if (written(); as result) {
            <p class="written" role="status">
              {{ writtenKey() | rokuT: result }}
            </p>
          }
        }

        <section class="decide" queueContext>
          <h3>{{ 'harvest.entries.bind.heading' | rokuT }}</h3>
          <lib-reference-picker
            (valueChange)="itemId.set($event)"
            [controlId]="'entries-item'"
            [disabled]="queue!.busy()"
            [lookup]="references"
            [resource]="'items'"
            [value]="itemId()"
          />

          <h3>{{ 'harvest.entries.create.heading' | rokuT }}</h3>
          <p class="hint">{{ 'harvest.entries.create.help' | rokuT }}</p>

          <div class="row">
            <label>
              <span>{{ 'harvest.entries.create.nameEs' | rokuT }}</span>
              <input [(ngModel)]="nameEs" name="nameEs" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.entries.create.nameEn' | rokuT }}</span>
              <input [(ngModel)]="nameEn" name="nameEn" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.entries.create.brand' | rokuT }}</span>
              <input [(ngModel)]="brand" name="brand" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.entries.create.ean' | rokuT }}</span>
              <input [(ngModel)]="ean" name="ean" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.entries.create.unitSize' | rokuT }}</span>
              <input [(ngModel)]="unitSize" name="unitSize" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.entries.create.category' | rokuT }}</span>
              <select [(ngModel)]="category" name="category">
                <option value="">
                  {{ 'harvest.entries.create.fromRow' | rokuT }}
                </option>
                @for (option of categories; track option) {
                  <option [value]="option">
                    {{ 'harvest.category.' + option | rokuT }}
                  </option>
                }
              </select>
            </label>
            <label>
              <span>{{ 'harvest.entries.create.defaultUnit' | rokuT }}</span>
              <select [(ngModel)]="defaultUnit" name="defaultUnit">
                <option value="">
                  {{ 'harvest.entries.create.fromRow' | rokuT }}
                </option>
                @for (option of units; track option) {
                  <option [value]="option">
                    {{ 'harvest.unit.' + option | rokuT }}
                  </option>
                }
              </select>
            </label>
          </div>

          <button
            (click)="createItem()"
            [disabled]="queue!.busy() || nameEs().trim() === ''"
            type="button"
          >
            {{ 'harvest.entries.create.submit' | rokuT }}
          </button>
        </section>

        <!-- Section 2's columns for this screen: whatever the review view leads
             with. The chain where the queue holds several, the kind badge, the
             name, the brand and size, the barcode, the proposal and how many
             runs have seen it. -->
        <ng-template #queueRow let-row>
          @if (chosen() === '' && chainName(row.supermarketId); as chain) {
            <span class="chain">{{ chain }}</span>
          }
          @if (row.sourceKind; as kind) {
            <span [class]="kind" class="kind">{{
              'harvest.sourceKind.' + kind | rokuT
            }}</span>
          }
          <strong>{{ row.name }}</strong>
          <span class="brand">{{ row.brand }}</span>
          <span class="size">{{ row.sizeFormat }}</span>
          @if (row.ean !== '') {
            <span class="ean">{{ row.ean }}</span>
          }
          <span class="hint">{{
            'harvest.entries.proposalBadge.' + proposalKind(row) | rokuT
          }}</span>
          <span class="seen">{{
            'harvest.entries.timesSeen' | rokuT: { count: row.timesSeen }
          }}</span>
        </ng-template>

        <div class="bulk" queueBulk>
          <!-- The count the accept will act on, and the count it will leave
               alone, before it runs. A count that appears only in the report
               afterwards arrives too late to change the decision. -->
          <p class="counts">
            {{
              'harvest.entries.bulk.counts'
                | rokuT
                  : {
                      count: acceptable().length,
                      selected: queue!.selectedCount(),
                      unproposed: unproposed(),
                    }
            }}
          </p>
          <button
            (click)="askAccept()"
            [disabled]="acceptable().length === 0"
            type="button"
          >
            {{ 'harvest.entries.bulk.accept' | rokuT }}
          </button>
          <button
            (click)="askReject()"
            [disabled]="queue!.selectedCount() === 0"
            class="danger"
            type="button"
          >
            {{ 'harvest.entries.bulk.reject' | rokuT }}
          </button>
        </div>
      </lib-queue-frame>

      @if (pending(); as bulk) {
        <lib-confirm-dialog
          (confirm)="go(bulk)"
          (dismiss)="pending.set(null)"
          [bodyArgs]="{ count: bulk.count, unproposed: bulk.leftAlone }"
          [bodyKey]="bulk.bodyKey"
          [busy]="queue!.busy()"
          [confirmKey]="bulk.confirmKey"
          [headingKey]="bulk.headingKey"
          [tone]="bulk.tone"
        />
      }

      @if (rejecting()) {
        <lib-confirm-dialog
          (confirm)="reject()"
          (dismiss)="rejecting.set(false)"
          [bodyKey]="'harvest.entries.rejectConfirm.body'"
          [busy]="queue!.busy()"
          [confirmKey]="'harvest.entries.reject'"
          [headingKey]="'harvest.entries.rejectConfirm.heading'"
        />
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      /* The picker is a search box until a chain is chosen, and a name with two
         buttons afterwards. Both are wider than a select, and neither may push
         the two selects off the row. */
      min-inline-size: 16rem;
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .hint,
    .brand,
    .size,
    .ean,
    .seen,
    .scope,
    .unit,
    .window {
      color: var(--admin-ink-muted);
    }

    .filters,
    .identity,
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    .filters {
      align-items: flex-start;
    }

    .identity {
      align-items: baseline;
      margin-block-end: var(--admin-space-3);
    }

    .kind,
    .chain {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .chain {
      /* A chain is a proper name, so it keeps its own capitals. */
      text-transform: none;
      font-weight: 600;
    }

    .kind.OFFICIAL_LEAFLET {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .ean {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.8125rem;
    }

    .prices,
    .proposal,
    .decide {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      margin-block-end: var(--admin-space-3);
    }

    .prices ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      list-style: none;
    }

    .prices li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    .amount {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    .written {
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
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

    dd {
      overflow-wrap: anywhere;
    }

    .extra {
      margin-block-start: var(--admin-space-3);
    }

    .extra pre {
      margin: 0;
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.8125rem;
      white-space: pre-wrap;
    }

    .run a {
      color: var(--admin-accent);
    }

    .bulk {
      display: flex;
      flex: 3;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .counts {
      flex: 1 1 12rem;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .bulk button {
      flex: 1 1 8rem;
      align-self: stretch;
      min-block-size: 3rem;
    }

    .bulk .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-on-wash);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: 100%;
      max-inline-size: 24rem;
    }

    .field > span,
    label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    label {
      display: flex;
      flex: 1 1 12rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    button {
      align-self: flex-start;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible,
    input:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntriesQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _route = inject(ActivatedRoute);
  /**
   * The chosen chain's scopes, read for their names.
   *
   * Through the resource gateway rather than through the reference lookup,
   * because the lookup answers one picker page and a chain can have more scopes
   * than that: Mercadona has one per warehouse. The upload screen reads them the
   * same way and for the same reason.
   */
  private readonly _scopes =
    inject(RESOURCE_GATEWAYS).for<PriceScope>(priceScopeSource());

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  readonly categories = CATEGORIES;
  readonly units = UNITS;
  readonly statuses = SOURCE_ENTRY_STATUSES;
  readonly kinds = OFFICIAL_SOURCE_KINDS;

  /** The chain the queue is for. Empty until one is chosen. */
  readonly chosen = signal('');

  /**
   * The two filters, both empty by default.
   *
   * An empty status is not "any": it is the queue, which is `CANDIDATE` and
   * `UNRESOLVED` together, and the route answers that when no status is sent. So
   * the control offers the queue as its first choice and the four statuses
   * beside it, and asking for `ACTIVE` by name is how a decision is looked up.
   */
  readonly status = signal<SourceEntryStatus | ''>('');
  readonly sourceKind = signal<OfficialSourceKind | ''>('');

  /** The product to bind to. Preselected from the proposal where there is one. */
  readonly itemId = signal('');

  readonly nameEs = signal('');
  /** Left empty, and legal (backend plan 0079). */
  readonly nameEn = signal('');
  readonly brand = signal('');
  readonly ean = signal('');
  readonly unitSize = signal('');
  /**
   * Empty means "whatever the row says".
   *
   * The backend derives a category from `categoryPath` and a unit from
   * `sizeFormat`, and the plan asks for a create that sends only the fields the
   * operator changed. An empty first option is how a select says "unchanged":
   * preselecting a real value would send that value on every create, and the
   * operator would be overriding a derivation they never looked at.
   */
  readonly category = signal<Wire.EnumsItemCategory | ''>('');
  readonly defaultUnit = signal<Wire.EnumsUnitOfMeasure | ''>('');

  /** Whether the rejection confirmation is up. Nothing is decided until it is. */
  readonly rejecting = signal(false);

  /** The bulk action waiting for an answer, or null when none is. */
  readonly pending = signal<PendingBulk | null>(null);
  /** What the last bulk run did, by name. Cleared when another one starts. */
  readonly report = signal<QueueReport | null>(null);
  readonly progressKey = signal('harvest.queue.bulk.progress');

  /**
   * What the last acceptance wrote, for the sentence that says so.
   *
   * Captured **before** the decision, since by the time the sentence is drawn
   * the queue has moved on and the numbers on screen belong to another row.
   *
   * Asserted on as a component input rather than as rendered text, because the
   * sentence interpolates and the testing translator does not interpolate.
   */
  readonly written = signal<AcceptedPrices | null>(null);

  private readonly _queue = signal<QueueStore<Entry> | null>(null);

  /**
   * Built when a chain is chosen, because the read needs one to exist.
   *
   * Behind a signal, and read through a getter so callers write `queue`. Either
   * filter builds a **new** store, and a computed that had read the old one's
   * signals would never hear about it: it would be frozen on the rows of the
   * status the operator has just navigated away from.
   */
  get queue(): QueueStore<Entry> | null {
    return this._queue();
  }

  /**
   * Scopes by id, so a price line reads as a name and not a uuid.
   *
   * Across every chain whose rows this page has drawn, not one chain's, because
   * a queue with no chain filter holds rows of several.
   */
  private readonly _scopeNames = signal<ReadonlyMap<string, string>>(new Map());
  /** The chains already read, so neither name is asked for twice. */
  private readonly _scopesAsked = new Set<string>();
  /** Chains by id, for the badge a row wears while no chain is chosen. */
  private readonly _chainNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _chainsAsked = new Set<string>();

  /**
   * What the size input held before the operator touched it.
   *
   * Kept rather than read back off the row, because by the time the create is
   * built the row is still in the queue but the comparison wants the string the
   * input started with, and `460` and `460.0` are the same size and two
   * different strings.
   */
  private readonly _sizeAsRead = signal('');

  readonly errorKey = computed(() =>
    gatewayErrorKey(this.queue?.error() ?? null)
  );

  constructor() {
    // The chain a run's own link named, so an operator arriving from the run
    // that queued these rows reads that chain and not every chain. Absent
    // everywhere else, and then the queue opens on all of them.
    this.chosen.set(
      this._route.snapshot.queryParamMap.get('supermarketId') ?? ''
    );
    this.reload();

    // The chain behind each row's id, for the badge. Read off the rows rather
    // than at the moment a chain is chosen, because with no chain chosen the
    // rows in front of the operator belong to several chains and which chains
    // those are changes with every page.
    effect(() => void this._readChains(this.queue?.items() ?? []));

    // The scopes of the chain whose row is in front, for the price lines. One
    // read per chain, kept, so walking a mixed queue does not re-read a chain
    // the operator has already passed through.
    effect(() => {
      const chain = this.row()?.supermarketId ?? '';
      if (chain !== '') {
        void this._ensureScopes(chain);
      }
    });
  }

  readonly row = computed<SourceEntryRow | null>(() => {
    const entry = this.queue?.current() ?? null;
    return entry === null ? null : toSourceEntryRow(entry);
  });

  /**
   * Every loaded row, mapped once, for the list view.
   *
   * The same mapper the review view uses, so the two views cannot disagree about
   * what a row says. A row the mapper refuses is dropped rather than drawn as a
   * gap: `toSourceEntryRow` answers null for something that is not a row at all,
   * and the queue is better nine rows long than a failure.
   */
  readonly listRows = computed<readonly SourceEntryRow[]>(() =>
    (this.queue?.items() ?? [])
      .map((entry) => toSourceEntryRow(entry))
      .filter((row): row is SourceEntryRow => row !== null)
  );

  /**
   * The selected rows the ladder already proposed a product for.
   *
   * The only ones "accept as proposed" can act on, because it sends the row's
   * own `itemId` and a row with none has nothing to send. The bar names both
   * counts before the action runs.
   */
  readonly acceptable = computed<readonly Entry[]>(() => {
    const selected = this.queue?.selected() ?? new Set<string>();
    return (this.queue?.items() ?? []).filter(
      (entry) => selected.has(entry.id) && proposed(entry)
    );
  });

  readonly unproposed = computed(
    () => (this.queue?.selectedCount() ?? 0) - this.acceptable().length
  );

  readonly proposal = computed(() => {
    const row = this.row();
    return row === null ? 'none' : proposalOf(row);
  });

  /**
   * The sibling row the ladder proposed, when the queue is holding it.
   *
   * Resolved out of the rows already loaded rather than read by id, because
   * there is no route that reads one row: `sourceEntry.list` filters on the
   * chain, the status, the kind and a search term, and none of those addresses
   * an id. A sibling that is not in the queue is usually one that has been
   * decided, so the screen names its id and leaves the ordinary actions
   * standing rather than offering a button that would go nowhere.
   */
  readonly sibling = computed<SourceEntryRow | null>(() => {
    const row = this.row();
    if (row === null || row.candidateEntryId === '') {
      return null;
    }

    const found = (this.queue?.items() ?? []).find(
      (entry) => entry.id === row.candidateEntryId
    );
    return found === undefined ? null : toSourceEntryRow(found);
  });

  readonly siblingName = computed(() => this.sibling()?.name ?? '');

  /**
   * What the primary button says, which is what it does.
   *
   * A sibling proposal is the one case where the primary action is not a
   * decision at all: the sibling carries the EAN, so it is the row to create the
   * item from, and confirming here would bind the product to the wrong one of
   * the two rows.
   */
  readonly confirmKey = computed(() =>
    this.proposal() === 'sibling' && this.sibling() !== null
      ? 'harvest.entries.openSibling'
      : 'harvest.entries.accept'
  );

  /** The price lines with their scopes named. */
  readonly priceLines = computed(() => {
    const names = this._scopeNames();
    return (this.row()?.prices ?? []).map((line) => ({
      ...line,
      scope: names.get(line.scopeId) ?? line.scopeId,
    }));
  });

  readonly lines = computed(() => {
    const row = this.row();
    if (row === null) {
      return [];
    }

    return [
      { key: 'externalId', value: row.externalId },
      { key: 'categoryPath', value: row.categoryPath },
      { key: 'url', value: row.url },
      { key: 'status', value: row.status },
      { key: 'lastSeen', value: row.lastSeen },
    ];
  });

  /**
   * Which sentence the confirmation uses.
   *
   * Three, because none of them is the other with a different number in it. Zero
   * has to say **why** nothing was written, or an operator who accepts a DEZA
   * row reads a working accept as a failure; one and many differ only because
   * English does.
   */
  readonly writtenKey = computed(() => {
    const count = this.written()?.count ?? 0;
    if (count === 0) {
      return 'harvest.entries.written.none';
    }
    return count === 1
      ? 'harvest.entries.written.one'
      : 'harvest.entries.written.many';
  });

  /**
   * Narrow the queue to one chain, or widen it back to every chain.
   *
   * An empty id is the second of those and not a no-op, which is what the
   * picker's own clear sends. The scope names are read off the row in front
   * rather than here, because a queue over every chain draws rows of several.
   */
  open(supermarketId: string): void {
    this.chosen.set(supermarketId);
    this.reload();
  }

  /**
   * The other two filters, each taking what the control emitted.
   *
   * **The value is the argument and never the bound signal.** An explicit
   * `(ngModelChange)` beside a two way binding is a second listener on the same
   * output, and prettier's attribute order puts it first, so a handler that read
   * `status()` would read the choice the operator has just moved away from and
   * the screen would be one read behind with nothing failing anywhere.
   */
  chooseStatus(status: SourceEntryStatus | ''): void {
    this.status.set(status);
    this.reload();
  }

  chooseKind(sourceKind: OfficialSourceKind | ''): void {
    this.sourceKind.set(sourceKind);
    this.reload();
  }

  /** The chain's name for the badge, or `''` while nothing has named it. */
  chainName(supermarketId: string): string {
    return this._chainNames().get(supermarketId) ?? '';
  }

  /**
   * Read the queue again, from the top.
   *
   * All three filters are the server's, so changing any of them is a fresh read
   * rather than a filter applied to what is in hand: the queue holds one page,
   * and filtering that page would answer from a twentieth of the rows.
   */
  reload(): void {
    const supermarketId = this.chosen();

    this.written.set(null);
    this.report.set(null);
    const queue = new QueueStore<Entry>(
      async (cursor) => {
        try {
          const status = this.status();
          const sourceKind = this.sourceKind();
          const page = await this._service.listEntries({
            // Absent asks for every chain's rows, which is what an empty
            // filter means.
            ...(supermarketId === '' ? {} : { supermarketId }),
            // No status asked for is the queue itself: `CANDIDATE` and
            // `UNRESOLVED` together, which is what is waiting for a person.
            ...(status === '' ? {} : { status }),
            ...(sourceKind === '' ? {} : { sourceKind }),
            cursor,
          });
          this.shell.observeReachable();
          return page;
        } catch (error) {
          this.shell.observeFailure();
          throw error;
        }
      },
      (entry) => entry.id
    );

    this._queue.set(queue);
    void queue.load().then(() => this._syncSubject());
  }

  /**
   * The primary action, which is one of two acts.
   *
   * Accepting binds this row. Opening a sibling decides nothing: it moves the
   * queue to the row that carries the EAN, which is the row the item should be
   * created from.
   */
  primary(): void {
    if (this.proposal() === 'sibling' && this.sibling() !== null) {
      this.openSibling();
      return;
    }
    this.accept();
  }

  /**
   * Bind the current row to a product the catalog already holds.
   *
   * The proposal is preselected, so agreeing with one is a single press. A row
   * with none needs a product picked first, and the button does nothing until
   * one is: sending an empty id would be a 400 about a field the operator never
   * filled in.
   */
  accept(): void {
    const queue = this.queue;
    const itemId = this.itemId();
    if (queue === null || itemId === '') {
      return;
    }

    const decided = this.row();
    void queue
      .decide(async (entry) => {
        const result = await this._service.acceptEntry(entry.id, { itemId });
        this.written.set(accepted(decided, result.pricesWritten));
        return result;
      })
      .then(() => this._syncSubject());
  }

  /**
   * Create the product this row is for, and bind it, in one call.
   *
   * **Only what the operator changed is sent.** The backend fills every other
   * field from the row, so a create that echoed the row back would be this
   * screen asserting values it merely displayed, and a field it read slightly
   * differently would overwrite the row's own. `name.en` is sent only when one
   * was typed: an empty string is not a name, and storing one would hide the
   * `missing en` tag that asks for a translation.
   */
  createItem(): void {
    const queue = this.queue;
    const decided = this.row();
    const es = this.nameEs().trim();
    if (queue === null || decided === null || es === '') {
      return;
    }

    const input = this._changes(decided, es);

    void queue
      .decide(async (entry) => {
        const result = await this._service.createItemFromEntry(entry.id, input);
        this.written.set(accepted(decided, result.pricesWritten));
        return result;
      })
      .then(() => this._syncSubject());
  }

  /**
   * Not a product he tracks, once the confirmation has been answered.
   *
   * A rejection is asked about first, unlike the other two: accepting the wrong
   * product is corrected by accepting the right one, and rejecting takes a row
   * out of every future run's questions.
   */
  reject(): void {
    const queue = this.queue;
    if (queue === null) {
      return;
    }

    void queue
      .decide((entry) => this._service.rejectEntry(entry.id))
      .then(() => {
        this.written.set(null);
        this.rejecting.set(false);
        this._syncSubject();
      });
  }

  /**
   * Put this row at the back without deciding it, and re-point the controls.
   *
   * The queue's own `skip` moves the row and knows nothing about the form in
   * front of it, so calling it directly would leave the picker holding the
   * skipped row's product. That is exactly how a name gets bound to the wrong
   * product, which is this queue's whole hazard.
   */
  skip(): void {
    this.queue?.skip();
    this._syncSubject();
  }

  /** Move the queue to the row the ladder proposed, without deciding this one. */
  openSibling(): void {
    const sibling = this.sibling();
    if (sibling !== null) {
      this.openRow(sibling.id);
    }
  }

  /**
   * Put one row in front and point the controls at it.
   *
   * What clicking a row in the list view does, and what opening a sibling does.
   * A row that is no longer in the queue leaves the order alone, so a sibling
   * somebody decided between the read and the press cannot move anything.
   */
  openRow(id: string): void {
    this.queue?.focus(id);
    this._syncSubject();
  }

  /**
   * Accept every selected row that already carries a proposal.
   *
   * The row's own `itemId`, which the ladder wrote when it proposed a match, so
   * nothing here is one operator's choice applied to rows they did not look at.
   * A selected row with no proposal is left alone rather than refused, and the
   * bar says how many of those there are before this runs.
   */
  askAccept(): void {
    const count = this.acceptable().length;
    this.pending.set({
      headingKey: 'harvest.entries.bulk.acceptConfirm.heading',
      bodyKey: 'harvest.entries.bulk.acceptConfirm.body',
      confirmKey: 'harvest.entries.bulk.accept',
      progressKey: 'harvest.entries.bulk.accepting',
      count,
      leftAlone: this.unproposed(),
      tone: 'primary',
      run: () =>
        this._run({
          act: async (entry) => {
            await this._service.acceptEntry(entry.id, {
              itemId: entry.itemId ?? '',
            });
            return null;
          },
          applies: proposed,
          nameOf: (entry) => entry.name,
        }),
    });
  }

  askReject(): void {
    this.pending.set({
      headingKey: 'harvest.entries.bulk.rejectConfirm.heading',
      bodyKey: 'harvest.entries.bulk.rejectConfirm.body',
      confirmKey: 'harvest.entries.bulk.reject',
      progressKey: 'harvest.entries.bulk.rejecting',
      count: this.queue?.selectedCount() ?? 0,
      leftAlone: 0,
      tone: 'danger',
      run: () =>
        this._run({
          act: async (entry) => {
            await this._service.rejectEntry(entry.id);
            return null;
          },
          nameOf: (entry) => entry.name,
        }),
    });
  }

  /** Go through with the confirmed bulk action. */
  go(bulk: PendingBulk): void {
    this.pending.set(null);
    this.progressKey.set(bulk.progressKey);
    void bulk.run();
  }

  /** What the list view says about a row's proposal, in one word. */
  proposalKind(row: SourceEntryRow): string {
    return proposalOf(row);
  }

  /** Where a run is read. Absolute, because this screen has no route to pop. */
  runLink(runId: string): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'runs', runId];
  }

  /**
   * What the operator changed about the row, and nothing else.
   *
   * A value equal to the row's is left out, which is what makes the create send
   * only changes. The two selects say "from the row" with an empty value, so a
   * category the backend derives is never overridden by a default this screen
   * chose.
   */
  /**
   * Run a bulk action and put the report up, then point the controls again.
   *
   * The re-point matters as much here as it does after a single decision: a run
   * that emptied the head of the queue leaves the picker holding a product that
   * belongs to a row nobody is looking at any more, and binding a name to the
   * wrong product is this queue's whole hazard.
   */
  private async _run(bulk: QueueBulkAct<Entry>): Promise<void> {
    const queue = this.queue;
    if (queue === null) {
      return;
    }

    this.report.set(null);
    this.report.set(await runQueueBulk(queue, bulk));
    this.progressKey.set('harvest.queue.bulk.progress');
    this._syncSubject();
  }

  private _changes(
    row: SourceEntryRow,
    es: string
  ): CreateItemFromSourceEntryInput {
    const en = this.nameEn().trim();
    const brand = this.brand().trim();
    const ean = this.ean().trim();
    const unitSize = this.unitSize().trim();
    const category = this.category();
    const defaultUnit = this.defaultUnit();
    const size = Number(unitSize);

    return {
      ...(es === row.name && en === ''
        ? {}
        : { name: en === '' ? { es } : { es, en } }),
      ...(brand === row.brand ? {} : { brand: brand === '' ? null : brand }),
      ...(ean === row.ean ? {} : { ean: ean === '' ? null : ean }),
      ...(unitSize === this._sizeAsRead() || Number.isNaN(size)
        ? {}
        : { unitSize: unitSize === '' ? null : size }),
      ...(category === '' ? {} : { category }),
      ...(defaultUnit === '' ? {} : { defaultUnit }),
    };
  }

  /**
   * Point the controls at whatever row is now in front of the operator.
   *
   * The proposal goes into the picker and the chain's own name into the Spanish
   * name, so both paths start from what the source said. Carrying the previous
   * row's answers forward would be worse than useless: the queue's whole hazard
   * is binding a name to the wrong product, and a picker still holding the last
   * row's item is exactly how that happens.
   */
  private _syncSubject(): void {
    const row = this.row();
    const raw = this.queue?.current() ?? null;

    this.itemId.set(row?.itemId ?? '');
    this.nameEs.set(row?.name ?? '');
    this.nameEn.set('');
    this.brand.set(row?.brand ?? '');
    this.ean.set(row?.ean ?? '');
    const size =
      raw === null || raw.unitSize === null ? '' : String(raw.unitSize);
    this.unitSize.set(size);
    this._sizeAsRead.set(size);
    this.category.set('');
    this.defaultUnit.set('');
  }

  /**
   * Read one chain's scopes, once, and keep them.
   *
   * A price line names its scope and the row carries only its id, so the names
   * have to come from somewhere; this is one read per chain rather than one per
   * line. The map is merged rather than replaced, because a queue over every
   * chain walks through rows of several and replacing it would blank the names
   * of the chain the operator just came from.
   */
  private async _ensureScopes(supermarketId: string): Promise<void> {
    if (this._scopesAsked.has(supermarketId)) {
      return;
    }
    this._scopesAsked.add(supermarketId);

    try {
      const page = await this._scopes.list({
        filters: { supermarketId },
        limit: SCOPE_PAGE,
      });
      this._scopeNames.update(
        (names) =>
          new Map([
            ...names,
            ...page.items.map(
              (scope) =>
                [scope.id, PRICE_SCOPES.title(scope)] as [string, string]
            ),
          ])
      );
    } catch {
      // A price line falls back to its scope id, which is worse to read and is
      // still the truth. A failed scope read is not a reason to refuse a queue,
      // and the chain is asked again the next time one of its rows comes up.
      this._scopesAsked.delete(supermarketId);
    }
  }

  /**
   * Name the chains the loaded rows came from, once each.
   *
   * Resolved one id at a time through the directory rather than listed, because
   * what has to be named is the handful of chains this page happens to hold and
   * not every chain in the catalog. A chain that does not answer draws no badge
   * rather than a uuid.
   */
  private async _readChains(entries: readonly Entry[]): Promise<void> {
    const missing = [
      ...new Set(entries.map((entry) => entry.supermarketId)),
    ].filter((id) => id !== '' && !this._chainsAsked.has(id));
    if (missing.length === 0) {
      return;
    }

    for (const id of missing) {
      this._chainsAsked.add(id);
    }

    const found = await Promise.all(
      missing.map(async (id) => {
        const option = await this.references.resolve('supermarkets', id);
        return [id, option?.title ?? ''] as [string, string];
      })
    );

    this._chainNames.update(
      (names) => new Map([...names, ...found.filter(([, name]) => name !== '')])
    );
  }
}

/**
 * Whether the ladder proposed a product for this row.
 *
 * The one thing "accept as proposed" needs, so it is the predicate the bulk
 * runner is given as well as the one the bar counts with. A row without one is
 * never passed to the act, because there is nothing to send.
 */
function proposed(entry: Entry): boolean {
  return (entry.itemId ?? '') !== '';
}

/**
 * What an acceptance wrote, in the words the confirmation uses.
 *
 * A type alias rather than an interface, deliberately: the translator pipe takes
 * `Record<string, unknown>` for its interpolation values, and TypeScript gives
 * an implicit index signature to a type alias and not to an interface. An
 * interface here compiles everywhere except the one template that uses it.
 */
export type AcceptedPrices = {
  /** How many `item_prices` rows the accept wrote. */
  readonly count: number;
  /** The chain's own name for the product the prices were written for. */
  readonly name: string;
  /** The prices themselves, so the sentence names what it wrote. */
  readonly prices: string;
};

function accepted(
  decided: SourceEntryRow | null,
  count: number
): AcceptedPrices {
  return {
    count,
    name: decided?.name ?? '',
    prices: (decided?.prices ?? []).map(priceSentence).join(', '),
  };
}

/** One price, as the confirmation reads it out. */
function priceSentence(line: SourceEntryPriceLine): string {
  return line.window === '' ? line.price : `${line.price} (${line.window})`;
}
