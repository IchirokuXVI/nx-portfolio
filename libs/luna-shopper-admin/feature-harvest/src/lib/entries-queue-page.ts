import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
} from '@portfolio/luna-shopper-admin/ui';
import {
  proposalOf,
  toSourceEntryRow,
  type SourceEntryPriceLine,
  type SourceEntryRow,
} from './entry-view';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';

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
 * **The chain comes first**, as every one of the three did, because a row is
 * keyed on (`supermarketId`, `externalId`) and a chain's own name for a product
 * means nothing outside that chain. There is no route that answers "every
 * chain's queued rows" and no screen that could use one.
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
    @if (chosen() === '') {
      <section class="choose">
        <h1>{{ 'harvest.entries.heading' | rokuT }}</h1>
        <p class="lead">{{ 'harvest.entries.choose.body' | rokuT }}</p>

        <div class="field">
          <span>{{ 'harvest.entries.choose.chain' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="open($event)"
            [controlId]="'entries-chain'"
            [lookup]="references"
            [resource]="'supermarkets'"
            [value]="chosen()"
          />
        </div>
      </section>
    } @else {
      <section class="filters">
        <label>
          <span>{{ 'harvest.entries.filter.status' | rokuT }}</span>
          <select
            (ngModelChange)="reload()"
            [(ngModel)]="status"
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
            (ngModelChange)="reload()"
            [(ngModel)]="sourceKind"
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

      <lib-queue-frame
        (confirm)="primary()"
        (reject)="rejecting.set(true)"
        (skip)="queue!.skip()"
        [busy]="queue!.busy()"
        [confirmKey]="confirmKey()"
        [decided]="queue!.decided()"
        [empty]="queue!.empty()"
        [errorKey]="errorKey()"
        [failed]="queue!.failed()"
        [loading]="queue!.loading()"
        [remaining]="queue!.items().length"
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
                <p class="hint">{{ 'harvest.entries.proposal.none' | rokuT }}</p>
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
      </lib-queue-frame>

      @if (rejecting()) {
        <lib-confirm-dialog
          (confirm)="reject()"
          (dismiss)="rejecting.set(false)"
          [busy]="queue!.busy()"
          [bodyKey]="'harvest.entries.rejectConfirm.body'"
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

    .choose {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
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
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .lead,
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

    .identity {
      align-items: baseline;
      margin-block-end: var(--admin-space-3);
    }

    .kind {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .kind.OFFICIAL_LEAFLET {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-ink);
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
      color: var(--admin-accent-ink);
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

    button,
    input,
    select {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
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

  /** Built when a chain is chosen, because the read needs one to exist. */
  queue: QueueStore<Wire.HarvestSourceCatalogEntryView> | null = null;

  /** The chain's scopes by id, so a price line reads as a name and not a uuid. */
  private readonly _scopeNames = signal<ReadonlyMap<string, string>>(new Map());

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
    // that queued these rows is not asked to pick it again. Absent everywhere
    // else, and then the chooser is the first thing this screen draws.
    const named = this._route.snapshot.queryParamMap.get('supermarketId') ?? '';
    if (named !== '') {
      this.open(named);
    }
  }

  readonly row = computed<SourceEntryRow | null>(() => {
    const entry = this.queue?.current() ?? null;
    return entry === null ? null : toSourceEntryRow(entry);
  });

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
   * Open the queue for one chain.
   *
   * The scopes are read once beside it, because a price line names its scope and
   * the row carries only its id. One read per chain rather than one per line,
   * and a scope the read did not reach falls back to the id rather than to
   * nothing.
   */
  open(supermarketId: string): void {
    if (supermarketId === '') {
      return;
    }

    this.chosen.set(supermarketId);
    void this._readScopes(supermarketId);
    this.reload();
  }

  /**
   * Read the queue again, from the top.
   *
   * Both filters are the server's, so changing either is a fresh read rather
   * than a filter applied to what is in hand: the queue holds one page, and
   * filtering that page would answer from a twentieth of the rows.
   */
  reload(): void {
    const supermarketId = this.chosen();
    if (supermarketId === '') {
      return;
    }

    this.written.set(null);
    this.queue = new QueueStore<Wire.HarvestSourceCatalogEntryView>(
      async (cursor) => {
        try {
          const status = this.status();
          const sourceKind = this.sourceKind();
          const page = await this._service.listEntries({
            supermarketId,
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

    void this.queue.load().then(() => this._syncSubject());
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

  /** Move the queue to the row the ladder proposed, without deciding this one. */
  openSibling(): void {
    const queue = this.queue;
    const sibling = this.sibling();
    if (queue === null || sibling === null) {
      return;
    }

    // Skipping until the sibling is in front, which is what the queue's own
    // rotation offers. Bounded by the queue's length, so a sibling that left the
    // queue between the read and the press cannot spin here.
    for (let step = 0; step < queue.items().length; step++) {
      if (queue.current()?.id === sibling.id) {
        break;
      }
      queue.skip();
    }

    this._syncSubject();
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
    const size = raw === null || raw.unitSize === null ? '' : String(raw.unitSize);
    this.unitSize.set(size);
    this._sizeAsRead.set(size);
    this.category.set('');
    this.defaultUnit.set('');
  }

  private async _readScopes(supermarketId: string): Promise<void> {
    try {
      const page = await this._scopes.list({
        filters: { supermarketId },
        limit: SCOPE_PAGE,
      });
      this._scopeNames.set(
        new Map(page.items.map((scope) => [scope.id, PRICE_SCOPES.title(scope)]))
      );
    } catch {
      // A price line falls back to its scope id, which is worse to read and is
      // still the truth. A failed scope read is not a reason to refuse a queue.
      this._scopeNames.set(new Map());
    }
  }
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
