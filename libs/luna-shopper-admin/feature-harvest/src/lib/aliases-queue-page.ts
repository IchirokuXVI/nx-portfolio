import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  QueueStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  QueueFrame,
  ReferencePicker,
} from '@portfolio/luna-shopper-admin/ui';
import {
  toSourceAliasRow,
  type SourceAlias,
  type SourceAliasRow,
} from './alias-view';
import { HarvestShell } from './harvest-shell';
import { observeQueuedAliases } from './queued-aliases';

/** The categories `CreateItemFromAliasDto` accepts. */
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

/** The units it accepts. */
const UNITS: readonly Wire.EnumsUnitOfMeasure[] = [
  'UNIT',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
  'PACK',
];

/**
 * The printed names a leaflet import could not resolve (admin plan 0010,
 * section 3).
 *
 * **Its own page, sharing the primitives and not the page** (section 4). The
 * item refs queue is the closest in shape, and it is still a different row: a
 * ref is a mapping from one of our items to a chain's product id, drawn around
 * `refProblem` and a product that stopped appearing, and its correction is "no,
 * it is that other product id". A row here is a printed string with a price and
 * a page, and its correction is "it is that item" or "it is a new item called
 * this". One page over both would be a page with two row shapes, two APIs and
 * two vocabularies.
 *
 * What is shared is the chrome: `QueueFrame` owns the confirm, reject and skip
 * trio, the tally, and the empty and error states, so a decision here behaves
 * exactly as a decision on the other three does.
 *
 * **The chain comes first**, as it does on the entries queue and for the same
 * reason: an alias is keyed on (`supermarketId`, `aliasKey`) and there is no
 * route that answers "every chain's queued names".
 *
 * **Accepting writes the price the row was queued for** (backend plan 0081,
 * section 3). The run is over by then and the offer sits in its stored
 * document, so the confirmation says how many price rows the acceptance
 * produced. Without that write an operator who works the queue would have to
 * upload the document a second time to get the prices he just resolved.
 */
@Component({
  selector: 'lib-aliases-queue-page',
  imports: [
    FormsModule,
    RokuTranslatorPipe,
    QueueFrame,
    HarvestNotice,
    ReferencePicker,
  ],
  template: `
    @if (chosen() === '') {
      <section class="choose">
        <h1>{{ 'harvest.aliases.heading' | rokuT }}</h1>
        <p class="lead">{{ 'harvest.aliases.choose.body' | rokuT }}</p>

        <div class="field">
          <span>{{ 'harvest.aliases.choose.chain' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="open($event)"
            [controlId]="'aliases-chain'"
            [lookup]="references"
            [resource]="'supermarkets'"
            [value]="chosen()"
          />
        </div>
      </section>
    } @else {
      <lib-queue-frame
        (confirm)="accept()"
        (reject)="reject()"
        (skip)="queue!.skip()"
        [busy]="queue!.busy()"
        [decided]="queue!.decided()"
        [empty]="queue!.empty()"
        [errorKey]="errorKey()"
        [failed]="queue!.failed()"
        [loading]="queue!.loading()"
        [remaining]="queue!.items().length"
        confirmKey="harvest.aliases.accept"
        emptyKey="harvest.aliases.empty"
        rejectKey="harvest.aliases.reject"
        titleKey="harvest.aliases.heading"
      >
        <lib-harvest-notice
          (retry)="queue!.load()"
          [absent]="shell.absent()"
          queueFailure
        />

        @if (row(); as alias) {
          <h2>{{ alias.printedName }}</h2>
          <p class="printed">
            <span class="format">{{ alias.printedFormat }}</span>
            <span class="brand">{{ alias.printedBrand }}</span>
            <span class="seen">{{
              'harvest.aliases.timesSeen' | rokuT: { count: alias.timesSeen }
            }}</span>
          </p>

          <dl>
            @for (line of lines(); track line.key) {
              @if (line.value !== '') {
                <div>
                  <dt>{{ 'harvest.aliases.field.' + line.key | rokuT }}</dt>
                  <dd>{{ line.value }}</dd>
                </div>
              }
            }
          </dl>

          @if (alias.rawText.length > 0) {
            <details class="raw">
              <summary>{{ 'harvest.aliases.rawText' | rokuT }}</summary>
              <ul>
                @for (fragment of alias.rawText; track fragment) {
                  <li>{{ fragment }}</li>
                }
              </ul>
            </details>
          }

          @if (written(); as result) {
            <p class="written" role="status">
              {{ 'harvest.aliases.written' | rokuT: result }}
            </p>
          }
        }

        <section class="decide" queueContext>
          <h3>{{ 'harvest.aliases.bind.heading' | rokuT }}</h3>
          @if (candidate()) {
            <p class="hint">{{ 'harvest.aliases.bind.candidate' | rokuT }}</p>
          }
          <lib-reference-picker
            (valueChange)="itemId.set($event)"
            [controlId]="'aliases-item'"
            [disabled]="queue!.busy()"
            [lookup]="references"
            [resource]="'items'"
            [value]="itemId()"
          />

          <h3>{{ 'harvest.aliases.create.heading' | rokuT }}</h3>
          <p class="hint">{{ 'harvest.aliases.create.help' | rokuT }}</p>

          <div class="row">
            <label>
              <span>{{ 'harvest.aliases.create.nameEs' | rokuT }}</span>
              <input [(ngModel)]="nameEs" name="nameEs" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.aliases.create.nameEn' | rokuT }}</span>
              <input [(ngModel)]="nameEn" name="nameEn" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.aliases.create.brand' | rokuT }}</span>
              <input [(ngModel)]="brand" name="brand" type="text" />
            </label>
            <label>
              <span>{{ 'harvest.aliases.create.category' | rokuT }}</span>
              <select [(ngModel)]="category" name="category">
                @for (option of categories; track option) {
                  <option [value]="option">
                    {{ 'harvest.category.' + option | rokuT }}
                  </option>
                }
              </select>
            </label>
            <label>
              <span>{{ 'harvest.aliases.create.defaultUnit' | rokuT }}</span>
              <select [(ngModel)]="defaultUnit" name="defaultUnit">
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
            {{ 'harvest.aliases.create.submit' | rokuT }}
          </button>
        </section>
      </lib-queue-frame>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
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
    .format,
    .brand,
    .seen {
      color: var(--admin-ink-muted);
    }

    .printed {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      margin-block-end: var(--admin-space-3);
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

    .raw {
      margin-block-start: var(--admin-space-3);
      color: var(--admin-ink-muted);
    }

    .raw ul {
      padding-inline-start: var(--admin-space-4);
    }

    .decide {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
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

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
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
export class AliasesQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _route = inject(ActivatedRoute);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  readonly categories = CATEGORIES;
  readonly units = UNITS;

  /** The chain the queue is for. Empty until one is chosen. */
  readonly chosen = signal('');

  /** The product to bind to. Preselected from the candidate where there is one. */
  readonly itemId = signal('');

  readonly nameEs = signal('');
  /** Left empty, and legal (backend plan 0079). */
  readonly nameEn = signal('');
  readonly brand = signal('');
  readonly category = signal<Wire.EnumsItemCategory>('OTHER');
  readonly defaultUnit = signal<Wire.EnumsUnitOfMeasure>('UNIT');

  /**
   * What the last acceptance wrote, for the sentence that says so.
   *
   * The price and the printed name are captured **before** the decision, since
   * by the time the sentence is drawn the queue has moved on to the next row
   * and the numbers on screen belong to a different offer.
   *
   * Asserted on as a component input rather than as rendered text, because the
   * sentence interpolates and the testing translator does not interpolate.
   */
  readonly written = signal<AcceptedPrice | null>(null);

  /** Built when a chain is chosen, because the route needs one to exist. */
  queue: QueueStore<SourceAlias> | null = null;

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

  readonly row = computed<SourceAliasRow | null>(() => {
    const alias = this.queue?.current() ?? null;
    return alias === null ? null : toSourceAliasRow(alias);
  });

  /** Whether the fuzzy rung proposed a product for this row. */
  readonly candidate = computed(() => this.row()?.candidateItemId !== '');

  readonly lines = computed(() => {
    const row = this.row();
    if (row === null) {
      return [];
    }

    return [
      { key: 'price', value: row.price },
      { key: 'unitPrice', value: row.unitPrice },
      { key: 'page', value: row.page },
      {
        key: 'confidence',
        value: row.offerConfidence === null ? '' : `${row.offerConfidence}%`,
      },
      { key: 'lastSeen', value: row.lastSeen },
    ];
  });

  /**
   * Open the queue for one chain.
   *
   * The first read is what fills the navigation badge, and every decision
   * refreshes it, so the badge and this page can never disagree about how much
   * is left.
   */
  open(supermarketId: string): void {
    if (supermarketId === '') {
      return;
    }

    this.chosen.set(supermarketId);
    this.queue = new QueueStore<SourceAlias>(
      async (cursor) => {
        try {
          const page = await this._service.listAliases({
            supermarketId,
            // No status asked for, which is the queue: `CANDIDATE` and
            // `UNRESOLVED` together, the rows waiting for a person.
            cursor,
          });
          this.shell.observeReachable();
          return page;
        } catch (error) {
          this.shell.observeFailure();
          throw error;
        }
      },
      (alias) => alias.id
    );

    void this.queue.load().then(() => this._syncSubject());
  }

  /**
   * Bind the current row to a product the catalog already holds.
   *
   * The candidate is preselected, so confirming a proposal is one press. A row
   * with none needs a product picked first, and the button does nothing until
   * one is: sending an empty id would be a 400 about a field the operator
   * never filled in.
   */
  accept(): void {
    const queue = this.queue;
    const itemId = this.itemId();
    if (queue === null || itemId === '') {
      return;
    }

    const queued = this.row();
    void queue
      .decide(async (alias) => {
        const result = await this._service.acceptAlias(alias.id, { itemId });
        this.written.set(accepted(queued, result.pricesWritten));
        return result;
      })
      .then(() => this._syncSubject());
  }

  /**
   * Create the product this row is for, and bind it, in one call.
   *
   * `name.en` is sent only when the operator typed one. An empty string is not
   * a name: it would be stored as a blank English name rather than as none, and
   * the `missing en` tag that tells the catalog screens to ask for a
   * translation would never appear.
   */
  createItem(): void {
    const queue = this.queue;
    const es = this.nameEs().trim();
    if (queue === null || es === '') {
      return;
    }

    const en = this.nameEn().trim();
    const brand = this.brand().trim();
    const queued = this.row();

    void queue
      .decide(async (alias) => {
        const result = await this._service.createItemFromAlias(alias.id, {
          name: en === '' ? { es } : { es, en },
          ...(brand === '' ? {} : { brand }),
          category: this.category(),
          defaultUnit: this.defaultUnit(),
        });
        this.written.set(accepted(queued, result.pricesWritten));
        return result;
      })
      .then(() => this._syncSubject());
  }

  /**
   * Not a product he tracks.
   *
   * The row leaves the queue and the alias stays as `REJECTED`, so the next
   * leaflet that prints that string skips it with a warning and does not ask
   * again. That is the rule `DiscoveredPlaceStatus` already keeps for places:
   * the status is the owner's, and a run does not get to overwrite a decision.
   */
  reject(): void {
    const queue = this.queue;
    if (queue === null) {
      return;
    }

    void queue
      .decide((alias) => this._service.rejectAlias(alias.id))
      .then(() => {
        this.written.set(null);
        this._syncSubject();
      });
  }

  /**
   * Point the controls at whatever row is now in front of the operator.
   *
   * The candidate goes into the picker and the printed name into the Spanish
   * name, so both paths start from what the leaflet said. Carrying the previous
   * row's answers forward would be worse than useless here: the queue's whole
   * hazard is binding a printed name to the wrong product, and a picker still
   * holding the last row's item is exactly how that happens.
   */
  private _syncSubject(): void {
    const row = this.row();

    this.itemId.set(row?.candidateItemId ?? '');
    this.nameEs.set(row?.printedName ?? '');
    this.nameEn.set('');
    this.brand.set(row?.printedBrand ?? '');
    this.category.set('OTHER');
    this.defaultUnit.set('UNIT');

    observeQueuedAliases(this.queue?.items().length ?? null);
  }
}

/**
 * What an acceptance wrote, in the words the confirmation uses.
 *
 * A type alias rather than an interface, deliberately: the translator pipe
 * takes `Record<string, unknown>` for its interpolation values, and TypeScript
 * gives an implicit index signature to a type alias and not to an interface. An
 * interface here compiles everywhere except the one template that uses it.
 */
export type AcceptedPrice = {
  /** How many `item_prices` rows the harvester wrote. */
  readonly count: number;
  /** The printed name the price was written for. */
  readonly name: string;
  /** The leaflet's own price, already formatted. `''` when the row had none. */
  readonly price: string;
};

function accepted(queued: SourceAliasRow | null, count: number): AcceptedPrice {
  return {
    count,
    name: queued?.printedName ?? '',
    price: queued?.price ?? '',
  };
}
