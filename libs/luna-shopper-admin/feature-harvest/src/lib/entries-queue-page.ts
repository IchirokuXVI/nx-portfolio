import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  HARVEST_SERVICE,
  QueueStore,
  RESOURCE_GATEWAYS,
  type CreateItemFromSourceEntryInput,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  formatSize,
  PRICE_SCOPES,
  priceScopeMark,
  priceScopeSource,
  type PriceScope,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  harvestRunPath,
  OFFICIAL_SOURCE_KINDS,
  SOURCE_ENTRY_STATUSES,
  type OfficialSourceKind,
  type ScopeMarkView,
  type SourceEntryStatus,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  QueueFrame,
  ReferencePicker,
  ReferencesControl,
  ScopeMark,
} from '@portfolio/luna-shopper-admin/ui';
import { brandKey } from '@portfolio/luna-shopper/contracts/brand-key';
import { DecisionsFilePanel } from './decisions-file-panel';
import {
  proposalOf,
  toSourceEntryRow,
  type SourceEntryPriceLine,
  type SourceEntryRow,
} from './entry-view';
import { HarvestShell } from './harvest-shell';
import { HarvestStatus } from './harvest-status';
import { ReviewChain } from './review-chain';

/** One entry off the wire, which is what the queue holds. */
type Entry = Wire.HarvestSourceCatalogEntryView;

/** One line of a panel of the card: a label, a value, and how it is set. */
interface CardLine {
  readonly key: string;
  readonly value: string;
  /** A barcode or an id, which this app sets in the mono face. */
  readonly mono?: boolean;
}

/** The product a row was matched to, as the panel beside the row draws it. */
interface ProposedProduct {
  readonly lines: readonly CardLine[];
  /** Where the product is, or `null` when the app did not mount products. */
  readonly link: readonly string[] | null;
}

/** A price scope, as a price line names it. */
interface ScopeName {
  readonly name: string;
  /** How far the scope reaches, as the four bar mark. */
  readonly mark: ScopeMarkView | null;
}

/**
 * What the category picker offers: only categories inside another, because a
 * product never goes on a root (backend plan 0166).
 */
const LEAVES = { kind: 'leaf' } as const;

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

/** How long typing in the brand filter settles before a read goes out. */
const BRAND_SEARCH_DELAY_MS = 250;

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
    ReferencesControl,
    ConfirmDialog,
    DecisionsFilePanel,
    ScopeMark,
  ],
  template: `
    <!-- A curation run's decisions file, applied from here (admin plan 0035,
         section 3). The panel reads and reviews it; only its own button sends. -->
    @if (decisionsOpen()) {
      <lib-decisions-file-panel
        (applied)="applied()"
        (closed)="decisionsOpen.set(false)"
      />
    }

    <section class="filters">
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

      <!-- Any spelling, and the key it makes shown under it, because the filter
           is on the key and not on the text: ELPOZO and El Pozo find the same
           rows (backend plan 0124, section 7). -->
      <div class="field">
        <label for="entries-brand">{{
          'harvest.entries.filter.brand' | rokuT
        }}</label>
        <input
          (input)="typeBrand($event)"
          [value]="brandText()"
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          id="entries-brand"
          spellcheck="false"
          type="search"
          data-brand
        />
        @if (brandText().trim() !== '') {
          <p aria-live="polite" class="hint live-key">
            @if (brandFilterKey(); as key) {
              {{ 'harvest.entries.filter.brandKey' | rokuT: { key } }}
            } @else {
              {{ 'harvest.entries.filter.brandNoKey' | rokuT }}
            }
          </p>
        }
      </div>

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
        (confirm)="primary()"
        (loadMore)="queue!.loadMore()"
        (openRow)="openRow($event)"
        (reject)="rejecting.set(true)"
        (skip)="skip()"
        [busy]="queue!.busy()"
        [canLoadMore]="queue!.canLoadMore()"
        [confirmKey]="confirmKey()"
        [currentId]="row()?.id ?? null"
        [empty]="queue!.empty()"
        [errorKey]="errorKey()"
        [failed]="queue!.failed()"
        [loading]="queue!.loading()"
        [loadingMore]="queue!.loadingMore()"
        [rows]="listRows()"
        emptyKey="harvest.entries.empty"
        rejectKey="harvest.entries.reject"
        rejectShortKey="harvest.entries.rejectShort"
        titleKey="harvest.entries.heading"
      >
        <!-- A button of this queue alone (admin plan 0044, target 4). -->
        @if (!decisionsOpen()) {
          <button
            (click)="decisionsOpen.set(true)"
            class="tool"
            queueTool
            type="button"
            data-open-decisions
          >
            {{ 'harvest.entries.decisionsFile.open' | rokuT }}
          </button>
        }

        <lib-harvest-notice
          (retry)="queue!.load()"
          [absent]="shell.absent()"
          queueFailure
        />

        @if (row(); as entry) {
          <div class="head">
            <h2>{{ entry.name }}</h2>
            <p class="identity">
              @if (chainName(entry.supermarketId); as chain) {
                <span class="chip chain">{{ chain }}</span>
              }
              @if (entry.sourceKind; as kind) {
                <span [class]="kind" class="chip kind">{{
                  'harvest.sourceKind.' + kind | rokuT
                }}</span>
              }
              <span class="chip seen">{{
                'harvest.entries.timesSeen' | rokuT: { count: entry.timesSeen }
              }}</span>
              @if (entry.lastRunId !== '') {
                <a [routerLink]="runLink(entry.lastRunId)" class="run">{{
                  'harvest.entries.lastRun' | rokuT
                }}</a>
              }
            </p>
          </div>

          <!-- What the source said and what it was matched to, side by side
               on a wide screen and one above the other on a phone. -->
          <div class="pair">
            <section class="says">
              <h3>{{ 'harvest.entries.says.heading' | rokuT }}</h3>
              <dl>
                @for (line of lines(); track line.key) {
                  @if (line.value !== '') {
                    <div>
                      <dt>{{ 'harvest.entries.field.' + line.key | rokuT }}</dt>
                      <dd [class.mono]="line.mono">{{ line.value }}</dd>
                    </div>
                  }
                }
              </dl>
              @if (entry.url !== '') {
                <a
                  [href]="entry.url"
                  class="out"
                  rel="noopener noreferrer"
                  target="_blank"
                  >{{ 'harvest.entries.says.openAtChain' | rokuT }}</a
                >
              }
            </section>

            <section [class.has]="proposal() !== 'none'" class="proposed">
              <div class="proposed-head">
                <h3>{{ 'harvest.entries.proposal.heading' | rokuT }}</h3>
                <!-- Why this product was proposed, as a state. -->
                @if (proposal() === 'none') {
                  <span class="chip">{{
                    'harvest.entries.proposalBadge.none' | rokuT
                  }}</span>
                } @else if (entry.matchedBy; as matchedBy) {
                  <span class="chip good" data-reason>{{
                    'harvest.entries.reason.' + matchedBy | rokuT
                  }}</span>
                }
              </div>
              @switch (proposal()) {
                @case ('item') {
                  @if (proposed(); as product) {
                    <dl>
                      @for (line of product.lines; track line.key) {
                        @if (line.value !== '') {
                          <div>
                            <dt>
                              {{
                                'harvest.entries.proposed.' + line.key | rokuT
                              }}
                            </dt>
                            <dd [class.mono]="line.mono">{{ line.value }}</dd>
                          </div>
                        }
                      }
                    </dl>
                    @if (product.link; as link) {
                      <a [routerLink]="link" class="out">{{
                        'harvest.entries.proposed.open' | rokuT
                      }}</a>
                    }
                  }
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
            </section>
          </div>

          <section class="prices">
            <div class="prices-head">
              <h3>{{ 'harvest.entries.prices.heading' | rokuT }}</h3>
              @if (entry.prices.length > 0) {
                <span class="hint">{{
                  'harvest.entries.prices.writes' | rokuT
                }}</span>
              }
            </div>
            @if (entry.prices.length === 0) {
              <p class="hint">{{ 'harvest.entries.prices.none' | rokuT }}</p>
            } @else {
              <ul>
                @for (line of priceLines(); track line.scopeId) {
                  <li>
                    @if (line.mark; as mark) {
                      <lib-scope-mark
                        [label]="mark.label | rokuT"
                        [level]="mark.level"
                      />
                    }
                    <span class="scope">{{ line.scope }}</span>
                    <span class="window">{{ line.window }}</span>
                    <span class="unit">{{ line.unitPrice }}</span>
                    <span class="amount">{{ line.price }}</span>
                  </li>
                }
              </ul>
            }
          </section>

          <!-- On a phone the bar holds reject, skip and accept. These two are
               links in the card (admin plan 0044, target 4). -->
          <p class="links">
            <button
              (click)="openPanel('pick')"
              [attr.aria-expanded]="panel() === 'pick'"
              class="link"
              type="button"
              data-panel="pick"
            >
              {{ 'harvest.entries.pick' | rokuT }}
            </button>
            <button
              (click)="openPanel('create')"
              [attr.aria-expanded]="panel() === 'create'"
              class="link"
              type="button"
              data-panel="create"
            >
              {{ 'harvest.entries.create.open' | rokuT }}
            </button>
          </p>

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

          @if (written(); as result) {
            <p class="written" role="status">
              {{ writtenKey() | rokuT: result }}
            </p>
          }
        }

        <!-- The two other things that can be done with the row, in the bar on
             a wide screen. -->
        <button
          (click)="openPanel('pick')"
          [attr.aria-expanded]="panel() === 'pick'"
          [disabled]="queue!.busy()"
          queueAction
          type="button"
        >
          {{ 'harvest.entries.pick' | rokuT }}
        </button>
        <button
          (click)="openPanel('create')"
          [attr.aria-expanded]="panel() === 'create'"
          [disabled]="queue!.busy()"
          queueAction
          type="button"
        >
          {{ 'harvest.entries.create.open' | rokuT }}
        </button>

        <section [hidden]="panel() === null" class="decide" queueContext>
          @if (panel() === 'pick') {
            <h3>{{ 'harvest.entries.bind.heading' | rokuT }}</h3>
            <lib-reference-picker
              (valueChange)="itemId.set($event)"
              [controlId]="'entries-item'"
              [disabled]="queue!.busy()"
              [label]="'harvest.entries.bind.heading' | rokuT"
              [lookup]="references"
              [resource]="'items'"
              [value]="itemId()"
            />
            <p class="hint">{{ 'harvest.entries.bind.help' | rokuT }}</p>
          }

          @if (panel() === 'create') {
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
              <div class="field categories">
                <label for="entries-categories">{{
                  'harvest.entries.create.categories' | rokuT
                }}</label>
                <lib-references-control
                  (valueChange)="categoryIds.set($event)"
                  [controlId]="'entries-categories'"
                  [disabled]="queue!.busy()"
                  [lookup]="references"
                  [resource]="'categories'"
                  [scope]="leaves"
                  [value]="categoryIds()"
                />
                <p class="hint">
                  {{ 'harvest.entries.create.categoriesHelp' | rokuT }}
                </p>
              </div>
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
              class="primary"
              type="button"
              data-create
            >
              {{ 'harvest.entries.create.submit' | rokuT }}
            </button>
          }
        </section>

        <!-- One line of the column beside the open row: the name, then the
             chain and whether a product was proposed. -->
        <ng-template #queueLine let-row>
          <span class="line-name">{{ row.name }}</span>
          @if (chainName(row.supermarketId); as chain) {
            <span class="line-chain">{{ chain }}</span>
          }
          <span [class.good]="proposalKind(row) !== 'none'" class="chip">{{
            'harvest.entries.proposalBadge.' + proposalKind(row) | rokuT
          }}</span>
        </ng-template>
      </lib-queue-frame>

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
      min-inline-size: 0;
    }

    /* A list of chips and a search box, so it takes the row's whole width
       rather than squeezing the selects beside it. */
    .categories {
      flex-basis: 100%;
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    h3 {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .hint,
    .brand,
    .size,
    .ean,
    .seen,
    .unit,
    .window {
      color: var(--admin-ink-muted);
    }

    /* The key the typed brand makes, in the muted monospace a key wears
       everywhere in this app. */
    .live-key {
      font-family: var(--admin-font-mono, monospace);
      font-size: 0.8125rem;
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

    .head {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      margin-block-end: var(--admin-space-3);
    }

    .identity {
      gap: var(--admin-space-2);
      align-items: center;
    }

    .chip {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .chip.good,
    .chip.OFFICIAL_LEAFLET {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .kind,
    .chain {
      font-size: 0.75rem;
    }

    .chain {
      font-weight: 600;
    }

    .ean,
    .mono {
      font-family: var(--admin-font-mono, monospace);
      font-size: 0.8125rem;
    }

    .run,
    .out {
      font-size: 0.8125rem;
      color: var(--admin-accent);
    }

    /* The source at the left and the proposal at the right. */
    .pair {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--admin-space-3);
      margin-block-end: var(--admin-space-3);
    }

    .says,
    .proposed {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
    }

    .proposed.has {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
    }

    .proposed.has h3,
    .proposed.has .hint,
    .proposed.has dt {
      color: var(--admin-accent-on-wash);
    }

    .proposed-head,
    .prices-head {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .proposed-head h3,
    .prices-head h3 {
      flex: 1;
    }

    .proposed.has .chip.good {
      background: var(--admin-surface-raised);
    }

    dl {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    dl > div {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      gap: var(--admin-space-2);
    }

    dt {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    dd {
      overflow-wrap: anywhere;
    }

    .prices,
    .decide {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      margin-block-end: var(--admin-space-3);
    }

    .decide {
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .decide[hidden] {
      display: none;
    }

    .prices ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .prices li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
    }

    .scope {
      flex: 1;
      min-inline-size: 8rem;
    }

    .amount,
    .unit {
      font-variant-numeric: tabular-nums;
    }

    .amount {
      font-weight: 600;
    }

    /* The two other actions are in the bar on a wide screen, so the links in
       the card are for a phone alone. */
    .links {
      display: none;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    .link {
      min-block-size: 2.75rem;
      padding: 0;
      border: none;
      background: none;
      font-weight: 500;
      text-decoration: underline;
      color: var(--admin-accent);
    }

    .written {
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .extra {
      margin-block-start: var(--admin-space-3);
    }

    .extra pre {
      margin: 0;
      font-family: var(--admin-font-mono, monospace);
      font-size: 0.8125rem;
      white-space: pre-wrap;
    }

    .line-name {
      flex-basis: 100%;
      overflow-wrap: anywhere;
    }

    .line-chain {
      font-size: 0.8125rem;
      font-weight: 400;
      color: var(--admin-ink-muted);
    }

    .primary {
      border-color: var(--admin-accent);
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: 100%;
      max-inline-size: 24rem;
    }

    .field > span,
    label > span,
    .field > label {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    /* A label that only names the control under it takes its own height.
       The rule below is for a label that wraps its control. */
    .field > label {
      flex: none;
    }

    .filters > label,
    .filters > .field {
      flex: 0 1 14rem;
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
    select:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    @media (max-width: 47.99rem) {
      /* One above the other on a phone. */
      .pair {
        grid-template-columns: minmax(0, 1fr);
      }

      .links {
        display: flex;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntriesQueuePage implements OnDestroy {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _content = inject(ContentLocaleStore);
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

  private readonly _registry = inject(ResourceRegistry);
  private readonly _status = inject(HarvestStatus);
  private readonly _review = inject(ReviewChain);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  readonly leaves = LEAVES;
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

  /** The brand, as it was typed. The key it makes is what goes out. */
  readonly brandText = signal('');

  /**
   * The key that text makes, or `null` when it makes none.
   *
   * The same `brandKey` catalog, the harvester and the gateway use, so what the
   * line under the input shows is what the rows are filed under rather than an
   * approximation of it.
   */
  readonly brandFilterKey = computed(() => brandKey(this.brandText()));

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
   * The backend derives the categories from `categoryPath` and a unit from
   * `sizeFormat`, and the plan asks for a create that sends only the fields the
   * operator changed. An empty pick and an empty first option are how these
   * controls say "unchanged": preselecting a real value would send it on every
   * create, and the operator would be overriding a derivation they never
   * looked at.
   *
   * The categories are held as ids, which is what the picker holds, and sent as
   * slugs, which is what the harvest route takes (backend plan 0166, section 3).
   */
  readonly categoryIds = signal<readonly string[]>([]);
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
  private readonly _scopeNames = signal<ReadonlyMap<string, ScopeName>>(
    new Map()
  );
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

  /** The brand filter's settle, so a screen left mid typing reloads nothing. */
  private _brandTimer: ReturnType<typeof setTimeout> | null = null;

  readonly errorKey = computed(() =>
    gatewayErrorKey(this.queue?.error() ?? null)
  );

  /** Whether the decisions file panel is open (admin plan 0035, section 3). */
  readonly decisionsOpen = signal(false);

  /**
   * Which of the two other ways to decide the row is open: pointing it at
   * another product, or creating the product. Neither is open when a row comes
   * up, so the card shows the row and its proposal and nothing to fill in.
   */
  readonly panel = signal<'pick' | 'create' | null>(null);

  /** The products a proposal named, read once each, for the panel beside the row. */
  private readonly _products = signal<
    ReadonlyMap<string, ProposedProduct | null>
  >(new Map());
  private readonly _productsAsked = new Set<string>();

  constructor() {
    // The brand a suggested brands chip named, beside the chain it named. Read
    // as text and shown as text, because the input holds a spelling and the key
    // is what it makes: a key is a legal spelling of itself.
    this.brandText.set(
      this._route.snapshot.queryParamMap.get('brandKey') ?? ''
    );

    // The chain the four queues share (admin plan 0044). A run's own link
    // names it, and so does the filter above the queue. Each change builds
    // the queue again, and the first read is this effect's first run.
    effect(() => {
      const chain = this._review.chain();
      untracked(() => this.open(chain));
    });

    // The product a proposal names, for the panel beside the row.
    effect(() => {
      const itemId = this.row()?.itemId ?? '';
      if (itemId !== '') {
        untracked(() => void this._readProduct(itemId));
      }
    });

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

  ngOnDestroy(): void {
    if (this._brandTimer !== null) {
      clearTimeout(this._brandTimer);
    }
  }

  readonly row = computed<SourceEntryRow | null>(() => {
    const entry = this.queue?.current() ?? null;
    return entry === null ? null : toSourceEntryRow(entry);
  });

  /**
   * Every loaded row, mapped once, for the column beside the open row.
   *
   * The same mapper the open row uses, so the two cannot disagree about what a
   * row says. A row the mapper refuses is dropped rather than drawn as a gap:
   * `toSourceEntryRow` answers null for something that is not a row at all,
   * and the queue is better nine rows long than a failure.
   */
  readonly listRows = computed<readonly SourceEntryRow[]>(() =>
    (this.queue?.items() ?? [])
      .map((entry) => toSourceEntryRow(entry))
      .filter((row): row is SourceEntryRow => row !== null)
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

  /** The price lines with their scopes named, and how far each one reaches. */
  readonly priceLines = computed(() => {
    const scopes = this._scopeNames();
    return (this.row()?.prices ?? []).map((line) => {
      const scope = scopes.get(line.scopeId);
      return {
        ...line,
        scope: scope?.name ?? line.scopeId,
        mark: scope?.mark ?? null,
      };
    });
  });

  /**
   * What the source says about the row, under that heading.
   *
   * The page at the chain is a link under these and not a line among them.
   */
  readonly lines = computed<readonly CardLine[]>(() => {
    const row = this.row();
    if (row === null) {
      return [];
    }

    return [
      { key: 'name', value: row.name },
      { key: 'brand', value: row.brand },
      { key: 'size', value: row.sizeFormat },
      { key: 'ean', value: row.ean, mono: true },
      { key: 'categoryPath', value: row.categoryPath },
      { key: 'externalId', value: row.externalId, mono: true },
      { key: 'lastSeen', value: row.lastSeen },
    ];
  });

  /**
   * The product the row was matched to, for the panel beside it. `null` while
   * it is being read, and when the catalog no longer has it.
   */
  readonly proposed = computed<ProposedProduct | null>(() => {
    const itemId = this.row()?.itemId ?? '';
    return itemId === '' ? null : (this._products().get(itemId) ?? null);
  });

  /** Open one of the two other ways to decide, or close it when it is open. */
  openPanel(panel: 'pick' | 'create'): void {
    this.panel.update((open) => (open === panel ? null : panel));
  }

  /** A decisions file was applied: the queue and its counts are read again. */
  applied(): void {
    this.reload();
    this._status.refresh();
  }

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

  /**
   * The brand filter, after the typing settles.
   *
   * The same 250 ms the suggestions search uses, because this is the same act:
   * a text input whose every keystroke would otherwise be a read of the queue.
   */
  typeBrand(event: Event): void {
    this.brandText.set((event.target as HTMLInputElement).value);

    if (this._brandTimer !== null) {
      clearTimeout(this._brandTimer);
    }
    this._brandTimer = setTimeout(() => {
      this._brandTimer = null;
      this.reload();
    }, BRAND_SEARCH_DELAY_MS);
  }

  /**
   * What the brand filter sends, or `null` for no filter at all.
   *
   * Three answers from two. A text that makes a key sends the key, which is
   * what the rows are filed under. A text that makes none is still sent, as
   * itself: the route matches nothing against it, so the operator sees an empty
   * list, which is the truth about a brand spelled out of punctuation. Only an
   * empty box is no filter.
   */
  private _brandFilterValue(): string | null {
    const typed = this.brandText().trim();
    if (typed === '') {
      return null;
    }
    return this.brandFilterKey() ?? typed;
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
    const brandKeyFilter = this._brandFilterValue();

    this.written.set(null);
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
            ...(brandKeyFilter === null ? {} : { brandKey: brandKeyFilter }),
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
    if (queue === null) {
      return;
    }
    if (itemId === '') {
      // Nothing to agree with yet, so the press opens the picker and decides
      // nothing. The second press, with a product picked, is the accept.
      this.panel.set('pick');
      return;
    }

    const decided = this.row();
    void queue
      .decide(async (entry) => {
        const result = await this._service.acceptEntry(entry.id, { itemId });
        this.written.set(accepted(decided, result.pricesWritten));
        return result;
      })
      .then(() => this._decided());
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

    const changes = this._changes(decided, es);
    const categoryIds = this.categoryIds();

    void queue
      .decide(async (entry) => {
        const categorySlugs = await this._slugsOf(categoryIds);
        const input =
          categorySlugs.length === 0 ? changes : { ...changes, categorySlugs };
        const result = await this._service.createItemFromEntry(entry.id, input);
        this.written.set(accepted(decided, result.pricesWritten));
        return result;
      })
      .then(() => this._decided());
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
        this._decided();
      });
  }

  /**
   * Go to the next row without deciding this one, and re-point the controls.
   *
   * The queue's own `skip` moves on and knows nothing about the form in
   * front of it, so calling it directly would leave the picker holding the
   * skipped row's product. That is exactly how a name gets bound to the wrong
   * product, which is this queue's whole hazard.
   *
   * On the last row that is loaded the queue first reads the next page, so
   * the row changes a moment later. The controls are pointed again then.
   */
  skip(): void {
    const queue = this.queue;
    if (queue === null) {
      return;
    }

    const moved = queue.skip();
    this._syncSubject();
    const front = this.row()?.id ?? null;
    void moved.then(() => {
      if (this.queue === queue && (this.row()?.id ?? null) !== front) {
        this._syncSubject();
      }
    });
  }

  /** Move the queue to the row the ladder proposed, without deciding this one. */
  openSibling(): void {
    const sibling = this.sibling();
    if (sibling !== null) {
      this.openRow(sibling.id);
    }
  }

  /**
   * Make one row the open one and point the controls at it.
   *
   * What pressing a line of the column does, and what opening a sibling does.
   * No row changes its place (admin plan 0049, target 5). A row that is no
   * longer in the queue is ignored, so a sibling somebody decided between the
   * read and the press changes nothing.
   */
  openRow(id: string): void {
    this.queue?.focus(id);
    this._syncSubject();
  }

  /** What a line of the column says about a row's proposal, in one word. */
  proposalKind(row: SourceEntryRow): string {
    return proposalOf(row);
  }

  /** Where a run is read. Absolute, because this screen has no route to pop. */
  runLink(runId: string): readonly string[] {
    return harvestRunPath(runId);
  }

  /**
   * What the operator changed about the row, and nothing else.
   *
   * A value equal to the row's is left out, which is what makes the create send
   * only changes. The unit select and the category picker say "from the row"
   * when empty, so what the backend derives is never overridden by a default
   * this screen chose.
   */
  /**
   * A decision went through: point the controls at the row
   * that is in front now, and read the counts again, so that the rail and the
   * switch above say what the queue holds (admin plan 0044, target 2).
   */
  private _decided(): void {
    this._syncSubject();
    this._status.refresh();
  }

  /** Read the product a proposal names, once, for the panel beside the row. */
  private async _readProduct(itemId: string): Promise<void> {
    if (this._productsAsked.has(itemId)) {
      return;
    }
    this._productsAsked.add(itemId);

    const option = await this.references.resolve('items', itemId);
    const row = option?.row ?? null;
    const text = (value: unknown): string =>
      typeof value === 'string' ? value : '';

    const product: ProposedProduct | null =
      option === null
        ? null
        : {
            lines: [
              { key: 'name', value: option.title },
              { key: 'brand', value: text(row?.['brand']) },
              {
                key: 'size',
                value:
                  row === null
                    ? ''
                    : formatSize(
                        row as Parameters<typeof formatSize>[0],
                        this._content.locale()
                      ),
              },
              { key: 'ean', value: text(row?.['ean']), mono: true },
            ],
            link: this._registry.rowPath('items', itemId),
          };

    this._products.update((held) => new Map([...held, [itemId, product]]));
  }

  private _changes(
    row: SourceEntryRow,
    es: string
  ): CreateItemFromSourceEntryInput {
    const en = this.nameEn().trim();
    const brand = this.brand().trim();
    const ean = this.ean().trim();
    const unitSize = this.unitSize().trim();
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
      ...(defaultUnit === '' ? {} : { defaultUnit }),
    };
  }

  /**
   * The slugs of the picked categories, in the order picked.
   *
   * Read through the same lookup the picker names them with. One that no
   * longer resolves is left out rather than sent as an id the route would
   * refuse as a slug.
   */
  private async _slugsOf(ids: readonly string[]): Promise<string[]> {
    const options = await Promise.all(
      ids.map((id) => this.references.resolve('categories', id))
    );
    return options.flatMap((option) => {
      const slug = option?.row?.['slug'];
      return typeof slug === 'string' && slug !== '' ? [slug] : [];
    });
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
    this.categoryIds.set([]);
    this.defaultUnit.set('');
    // A new row opens with neither panel, so a product picked for the last
    // row is never one press away from the next.
    this.panel.set(null);
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
                [
                  scope.id,
                  {
                    name: PRICE_SCOPES.title(scope, this._content.order()),
                    mark: priceScopeMark(scope.kind) ?? null,
                  },
                ] as [string, ScopeName]
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
