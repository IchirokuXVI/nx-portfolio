import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
  type OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  priceScopeSource,
  type PriceScope,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  harvestFailures,
  hintNotice,
  importConflict,
  OFFICIAL_SOURCE_KINDS,
  parseHarvestDocument,
  PREVIEW_PAGE,
  previewMatches,
  previewWindow,
  spawnBlockReason,
  type HarvestDocumentRead,
  type HarvestDocumentRejection,
  type HintResult,
  type ImportConflictNotice,
  type OfficialSourceKind,
} from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  ReferencePicker,
} from '@portfolio/luna-shopper-admin/ui';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';

/** How many scopes the preview names before it counts the rest. */
const SCOPES_NAMED = 4;

/** How far the scope search walks looking for the chain's `NATIONAL` one. */
const SCOPE_PAGE = 100;

/**
 * How long typing settles before the document is scanned.
 *
 * The same 250 ms the reference picker waits, and for the same reason: a word is
 * typed in bursts, and the work belongs to the word rather than to the letter.
 */
const SEARCH_DELAY_MS = 250;

/**
 * Which sentence the tally says (plan 0019, section 3).
 *
 * Ten rather than four, because the four in the plan multiply out: the refusal
 * filter and the cap are each on or off, and a sentence that says "showing 14 of
 * 14" or leaves out that rows are hidden is the kind of half truth this line
 * exists to prevent. A term matching nothing collapses both caps, which is why
 * there are ten and not twelve.
 */
export type PreviewTallyKind =
  | 'all'
  | 'capped'
  | 'matching'
  | 'matchingCapped'
  | 'none'
  | 'refused'
  | 'refusedCapped'
  | 'refusedMatching'
  | 'refusedMatchingCapped'
  | 'refusedNone';

/**
 * The tally, as its sentence and the words that go in it.
 *
 * The counts are already grouped, because they are read rather than computed
 * with, and `4,232` beside the chain and `4232` beside the list would be two
 * numbers an operator has to check are the same one.
 */
export interface PreviewTally {
  /**
   * Everything here is a word the sentence interpolates, so the whole object is
   * what the pipe is handed. The index signature is what lets it be, and it is
   * why every count below is already a string.
   */
  readonly [word: string]: string;
  readonly kind: PreviewTallyKind;
  /** How many rows are drawn. */
  readonly drawn: string;
  /** How many products the term and the refusal filter left. */
  readonly matched: string;
  /** How many the document has, whatever is drawn. */
  readonly total: string;
  /** How many matched products are not drawn, for the "show more" control. */
  readonly remaining: string;
  readonly term: string;
}

/**
 * A harvest run that happened somewhere else, arriving as a file (admin plan
 * 0014, section 2).
 *
 * It was the leaflet upload. The rename is the point of backend plan `0086`
 * section 6: **the upload is not a leaflet tool.** It is how the result of a
 * harvester run that happened elsewhere gets in, whether an extractor read a
 * leaflet, a person typed a chain's prices, or a walk ran on a machine that is
 * allowed to crawl. One schema, `HarvestDocument`, so the page has one shape
 * whatever produced the file.
 *
 * Three properties are the design rather than details of it.
 *
 * **The document is read in the browser and never edited.** An edited document
 * has a different digest, and the digest is the backend's dedupe key, so a
 * screen that let an operator patch one field would produce a file that imports
 * a second time and reports itself as new. When the schema refuses the file, the
 * fix is in the producer.
 *
 * **Three inputs, all required, and the source kind is one of them.** It is what
 * the rows and the prices are stamped with and what `0080`'s policies rank, so
 * the operator picks it consciously: a Mercadona export imported here is an API
 * price, not a leaflet price, because the upload is not what observed it.
 *
 * **A hint fills an input only if that input is still empty**, and a notice says
 * every time what happened. Ids do not survive an environment change, so a hint
 * is checked against this deployment's directory before it is used, and a
 * disagreement between the file and the operator is visible before the run
 * starts rather than in the queue afterwards.
 */
@Component({
  selector: 'lib-import-upload-page',
  imports: [RouterLink, RokuTranslatorPipe, HarvestNotice, ReferencePicker],
  template: `
    <header>
      <h1>{{ 'harvest.imports.heading' | rokuT }}</h1>
      <p class="lead">{{ 'harvest.imports.lead' | rokuT }}</p>
    </header>

    <section class="drop">
      <label>
        <span>{{ 'harvest.imports.file' | rokuT }}</span>
        <input
          (change)="chooseFile($event)"
          accept="application/json,.json"
          name="document"
          type="file"
        />
      </label>

      @if (rejection(); as reason) {
        <p class="failure" role="alert">
          {{ 'harvest.imports.rejected.' + reason | rokuT }}
        </p>
      }
    </section>

    @if (read(); as document) {
      <section class="summary">
        <h2>{{ 'harvest.imports.read.heading' | rokuT }}</h2>
        <dl>
          @for (fact of facts(); track fact.key) {
            @if (fact.value !== '') {
              <div>
                <dt>{{ 'harvest.imports.read.' + fact.key | rokuT }}</dt>
                <dd [class.digest]="fact.key === 'sha256'">{{ fact.value }}</dd>
              </div>
            }
          }
        </dl>
      </section>

      @if (notice(); as hints) {
        @if (hints.shown) {
          <section class="hints" role="status">
            @if (hints.kind !== 'none') {
              <p>{{ 'harvest.imports.hints.' + hints.kind | rokuT }}</p>
            }
            <ul>
              @for (line of hints.set; track line.field) {
                <li>
                  {{
                    'harvest.imports.hints.setLine'
                      | rokuT
                        : {
                            field: line.field,
                            value: line.fileValue,
                          }
                  }}
                </li>
              }
              @for (line of hints.kept; track line.field) {
                <li>
                  {{
                    'harvest.imports.hints.keptLine'
                      | rokuT
                        : {
                            field: line.field,
                            kept: line.keptValue,
                            value: line.fileValue,
                          }
                  }}
                </li>
              }
              @for (line of hints.unknown; track line.field) {
                <li>
                  {{
                    'harvest.imports.hints.unknownLine'
                      | rokuT: { field: line.field, id: line.fileValue }
                  }}
                </li>
              }
            </ul>
          </section>
        }
      }

      <section class="choices">
        <div class="field">
          <span>{{ 'harvest.imports.chain' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="chooseChain($event)"
            [controlId]="'import-chain'"
            [lookup]="references"
            [resource]="'supermarkets'"
            [value]="supermarketId()"
          />
        </div>

        <!-- Asked for only by a file that carries a price naming no group of
             shops, which is every leaflet and every version 1 document (admin
             plan 0025, section 3). A file that scopes every price of its own
             needs no default, and one that states no price at all needs no
             scope to write it to. -->
        @if (needsScope()) {
          <div class="field">
            <span>{{ 'harvest.imports.scope' | rokuT }}</span>
            @if (supermarketId() === '') {
              <p class="hint">
                {{ 'harvest.imports.scopeNeedsChain' | rokuT }}
              </p>
            } @else {
              <lib-reference-picker
                (valueChange)="priceScopeId.set($event)"
                [controlId]="'import-scope'"
                [lookup]="references"
                [resource]="'price-scopes'"
                [scope]="scopeFilter()"
                [value]="priceScopeId()"
              />
              @if (noNationalScope()) {
                <p class="hint">
                  {{ 'harvest.imports.noNational' | rokuT }}
                  <!-- Where the price scopes screen is, asked of the registry
                     rather than written out: the resource moved into the catalog
                     section and its segment never said which section held it
                     (admin plan 0022, section 3). An app that did not mount it
                     gets the sentence without the link. -->
                  @if (newScopeLink(); as link) {
                    <a
                      [queryParams]="{ supermarketId: supermarketId() }"
                      [routerLink]="link"
                      target="_blank"
                      >{{ 'harvest.imports.createScope' | rokuT }}</a
                    >
                  }
                </p>
                <button (click)="refreshScopes()" type="button">
                  {{ 'harvest.imports.refreshScopes' | rokuT }}
                </button>
              }
            }
          </div>
        }

        <!-- What the file prices for, when it says so itself. A LIDL export
             names 59 regions, and an operator about to import one should see
             that before they press the button (admin plan 0025, section 4). -->
        @if (scopeSummary(); as summary) {
          <section class="scopes" role="status">
            <p>
              {{
                'harvest.imports.scopes.count'
                  | rokuT: { count: summary.count, names: summary.names }
              }}
            </p>
            <p class="hint">
              {{
                'harvest.imports.scopes.perProduct'
                  | rokuT: { most: summary.mostPerProduct }
              }}
            </p>
          </section>
        }

        <label class="field">
          <span>{{ 'harvest.imports.sourceKind' | rokuT }}</span>
          <select
            (change)="sourceKind.set($any($event.target).value)"
            [value]="sourceKind()"
            name="sourceKind"
          >
            <option value="">
              {{ 'harvest.imports.sourceKindChoose' | rokuT }}
            </option>
            @for (option of kinds; track option) {
              <option [value]="option">
                {{ 'harvest.sourceKind.' + option | rokuT }}
              </option>
            }
          </select>
          <p class="hint">{{ 'harvest.imports.sourceKindHelp' | rokuT }}</p>
        </label>

        <!-- Only for a document that carries a window. A storefront export has
             none, and asking for one would be asking for a fact the file never
             had (backend plan 0086, section 6.1). -->
        @if (document.validity !== null) {
          <label class="field">
            <span>{{ 'harvest.imports.validFrom' | rokuT }}</span>
            <input
              (input)="validFrom.set($any($event.target).value)"
              [value]="validFrom()"
              name="validFrom"
              required
              type="date"
            />
          </label>

          <label class="field">
            <span>{{ 'harvest.imports.validUntil' | rokuT }}</span>
            <input
              (input)="validUntil.set($any($event.target).value)"
              [value]="validUntil()"
              name="validUntil"
              required
              type="date"
            />
          </label>
        }
      </section>

      @if (missingDates()) {
        <p class="hint">{{ 'harvest.imports.datesRequired' | rokuT }}</p>
      }

      @if (started(); as run) {
        <section class="done" role="status">
          <p>{{ 'harvest.imports.started' | rokuT }}</p>
          <a [queryParams]="queueParams()" [routerLink]="queueLink()">{{
            'harvest.imports.openQueue' | rokuT
          }}</a>
          <a [routerLink]="runLink(run)">{{
            'harvest.imports.openRun' | rokuT
          }}</a>
        </section>
      } @else {
        <div class="submit">
          <button
            (click)="submit()"
            [disabled]="!ready() || importing()"
            class="primary"
            type="button"
          >
            {{
              (importing()
                ? 'harvest.imports.importing'
                : 'harvest.imports.import'
              ) | rokuT
            }}
          </button>
          <p class="attribution">
            {{ 'harvest.runs.start.attribution' | rokuT }}
          </p>
        </div>
      }

      @if (conflict(); as clash) {
        <section class="failure" role="alert">
          <p>{{ 'harvest.imports.conflict.' + clash.kind | rokuT }}</p>
          @if (clash.runId !== '') {
            <a [routerLink]="runLink(clash.runId)">{{
              'harvest.imports.conflict.open' | rokuT
            }}</a>
          }
        </section>
      } @else if (failures().length > 0) {
        <section class="failures">
          <h2>{{ 'harvest.imports.failures.heading' | rokuT }}</h2>
          <p class="hint">{{ 'harvest.imports.failures.lead' | rokuT }}</p>
          <ul>
            @for (row of failures(); track row.productId + row.section) {
              <li>
                <strong>{{
                  row.productId === '' ? row.section : row.productId
                }}</strong>
                <ul class="messages">
                  @for (message of row.messages; track message) {
                    <li>{{ message }}</li>
                  }
                </ul>
              </li>
            }
          </ul>
        </section>
      } @else if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (shell.absent()) {
        <lib-harvest-notice [absent]="true" />
      }

      <!-- The document is whole and the DOM is not (plan 0019). What the cap
           governs is this @for and nothing else: the read document still holds
           every product, and submit still sends the original bytes. -->
      <section class="preview">
        <h2>{{ 'harvest.imports.preview.heading' | rokuT }}</h2>

        <div class="controls">
          <label class="search">
            <span>{{ 'harvest.imports.preview.search' | rokuT }}</span>
            <input
              (input)="onSearch($event)"
              #search
              name="previewSearch"
              type="search"
            />
          </label>

          @if (refusedOnly()) {
            <button (click)="showWholeFile()" type="button">
              {{ 'harvest.imports.preview.wholeFile' | rokuT }}
            </button>
          }
        </div>

        <p class="tally" role="status">
          {{ 'harvest.imports.preview.tally.' + tally().kind | rokuT: tally() }}
        </p>

        <ul class="products">
          @for (product of window().rows; track product.id) {
            <li [class.blamed]="blamed().has(product.id)">
              <div class="identity">
                <strong>{{ product.name }}</strong>
                <span class="brand">{{ product.brand }}</span>
                <span class="size">{{ product.size }}</span>
                @if (product.ean !== '') {
                  <span class="ean">{{ product.ean }}</span>
                }
              </div>
              <div class="numbers">
                <span class="price">{{ product.price }}</span>
                <span class="unit">{{ product.unitPrice }}</span>
                @if (product.validUntil !== '') {
                  <span class="window">{{ product.validUntil }}</span>
                }
              </div>
            </li>
          }
        </ul>

        <!-- No "show all". A control whose purpose is to undo the cap is the cap
             not existing, and an operator looking for one row has the search
             box instead. -->
        @if (window().hasMore) {
          <button (click)="showMore()" class="more" type="button">
            {{
              'harvest.imports.preview.more'
                | rokuT: { more: tally().remaining }
            }}
          </button>
        }
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
      font-size: 1rem;
      font-weight: 700;
    }

    .lead,
    .hint,
    .attribution,
    .brand,
    .size,
    .unit,
    .window {
      color: var(--admin-ink-muted);
    }

    .drop,
    .summary,
    .choices,
    .hints,
    .failures,
    .done,
    .preview {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .choices {
      flex-direction: row;
      flex-wrap: wrap;
    }

    .hints {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .hints ul {
      padding-inline-start: var(--admin-space-4);
    }

    .done {
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      align-items: baseline;
    }

    .field,
    .drop label {
      display: flex;
      flex: 1 1 14rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .field > span,
    .drop label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
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

    .digest,
    .ean {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.75rem;
      overflow-wrap: anywhere;
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .failures ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .messages {
      color: var(--admin-danger-on-wash);
    }

    .submit {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
    }

    .search {
      display: flex;
      flex: 1 1 18rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .search > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .tally {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .more {
      align-self: flex-start;
    }

    .products {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .products li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-4);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .products li.blamed {
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
    }

    .identity,
    .numbers {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    .identity {
      flex: 1 1 20rem;
    }

    .price {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    a {
      color: var(--admin-accent);
    }

    button {
      cursor: pointer;
    }

    .primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
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
export class ImportUploadPage implements OnDestroy {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _translate = inject(RokuTranslatorService);
  /**
   * The scopes of one chain, read for their `kind`.
   *
   * Through the resource gateway rather than through the picker's own lookup,
   * because the picker answers with a title and an id and the question here is
   * which scope is `NATIONAL`. A scope's title is its label, and a harvested
   * scope has none.
   */
  private readonly _scopes =
    inject(RESOURCE_GATEWAYS).for<PriceScope>(priceScopeSource());

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);
  private readonly _registry = inject(ResourceRegistry);

  readonly kinds = OFFICIAL_SOURCE_KINDS;

  /** The create form for a price scope, wherever the catalog section mounted it. */
  newScopeLink(): readonly string[] | null {
    const path = this._registry.pathOf('price-scopes');

    return path === null ? null : [...path, 'new'];
  }

  /** The document, held in memory and never stored. */
  readonly read = signal<HarvestDocumentRead | null>(null);
  /** Why the last dropped file could not be read. */
  readonly rejection = signal<HarvestDocumentRejection | null>(null);

  readonly supermarketId = signal('');
  readonly priceScopeId = signal('');
  readonly sourceKind = signal<OfficialSourceKind | ''>('');
  readonly validFrom = signal('');
  readonly validUntil = signal('');

  readonly importing = signal(false);
  readonly error = signal<GatewayError | null>(null);
  /** Whether the chosen chain has a `NATIONAL` scope, once that is known. */
  readonly noNationalScope = signal(false);
  /** The run the last import started, which is what the success state is. */
  readonly started = signal('');

  /** What each of the three hints did, for the notice and for the specs. */
  readonly hints = signal<readonly HintResult[]>([]);

  /**
   * The three the preview holds, and nothing else on this screen moves (plan
   * 0019, section 5).
   *
   * `term` is the settled term rather than what is in the box: it is written
   * 250 ms after the last keystroke, so a four thousand row scan happens once
   * per word rather than once per keystroke.
   */
  readonly term = signal('');
  readonly shown = signal(PREVIEW_PAGE);
  /** Whether the preview is narrowed to the rows the gateway objected to. */
  readonly refusedOnly = signal(false);

  /** The box itself, which is emptied when a new file is chosen. */
  private readonly _search = viewChild<ElementRef<HTMLInputElement>>('search');

  private _timer: ReturnType<typeof setTimeout> | null = null;

  readonly notice = computed(() => hintNotice(this.hints()));

  /** What the file says, in the order the plan lists it. */
  readonly facts = computed(() => {
    const summary = this.read()?.summary;
    if (summary === undefined) {
      return [];
    }

    return [
      { key: 'producer', value: summary.producerName },
      { key: 'producerVersion', value: summary.producerVersion },
      { key: 'producedAt', value: summary.producedAt },
      { key: 'schemaVersion', value: summary.schemaVersion },
      { key: 'sha256', value: summary.sha256 },
      { key: 'products', value: String(summary.productCount) },
      { key: 'warnings', value: String(summary.warningCount) },
    ];
  });

  /** The chain the scope picker reads within, which it cannot read without. */
  readonly scopeFilter = computed(() => ({
    supermarketId: this.supermarketId(),
  }));

  /**
   * A refusal the gateway explained by JSON path.
   *
   * The document's own product ids are passed in so a path of `/products/3/id`
   * can still name the product, which is the one failure whose message cannot
   * carry the id it is about.
   */
  readonly failures = computed(() => {
    const error = this.error();
    if (error === null || error.status !== 400) {
      return [];
    }

    return harvestFailures(
      error.fieldErrors,
      (this.read()?.products ?? []).map((product) => product.id)
    );
  });

  /** The preview rows the gateway objected to, highlighted where they sit. */
  readonly blamed = computed(
    () => new Set(this.failures().map((row) => row.productId))
  );

  /**
   * The whole document, filtered, before the window is applied.
   *
   * In that order and not the other one: a term that matches row 3,000 has to
   * return row 3,000 with the window still at its default, or the search is
   * useless on the files that made it necessary.
   */
  readonly matches = computed(() =>
    previewMatches(
      this.read()?.products ?? [],
      this.term(),
      this.refusedOnly() ? this.blamed() : null
    )
  );

  /** What is drawn, which is the first `shown` of what matched. */
  readonly window = computed(() => previewWindow(this.matches(), this.shown()));

  /**
   * The one line above the list, and it is not decoration.
   *
   * A cap that does not say it is a cap is a file that looks shorter than it is,
   * on the screen whose job is to show the operator what they are about to
   * import. The counts are the document's rather than the window's, so the
   * number beside the chain and the number here agree.
   */
  readonly tally = computed<PreviewTally>(() => {
    const view = this.window();
    const total = this.read()?.products.length ?? 0;
    const term = this.term().trim();
    const refused = this.refusedOnly();

    const number = new Intl.NumberFormat(this._translate.locale());
    const counts = {
      drawn: number.format(view.rows.length),
      matched: number.format(view.matched),
      total: number.format(total),
      remaining: number.format(view.remaining),
      term,
    };

    if (view.matched === 0 && term !== '') {
      return { kind: refused ? 'refusedNone' : 'none', ...counts };
    }

    const whole: PreviewTallyKind = refused ? 'refused' : 'all';
    const searched: PreviewTallyKind = refused ? 'refusedMatching' : 'matching';
    const capped: PreviewTallyKind = refused ? 'refusedCapped' : 'capped';
    const searchedCapped: PreviewTallyKind = refused
      ? 'refusedMatchingCapped'
      : 'matchingCapped';

    const kind = view.hasMore
      ? term === ''
        ? capped
        : searchedCapped
      : term === ''
        ? whole
        : searched;

    return { kind, ...counts };
  });

  readonly conflict = computed<ImportConflictNotice | null>(() => {
    const error = this.error();
    return error === null ? null : importConflict(error);
  });

  /**
   * A failure this screen has no better sentence for.
   *
   * Not a 400, which is drawn as rows, and not a 409, which is drawn with a
   * link. A refusal that names a switch is drawn as that switch's own
   * explanation, which the runs screen already does and this one has to: the
   * arrangement backend plan 0086 exists for is a cluster with `HARVEST_ENABLED`
   * false, where an import is the one thing an operator will try and where
   * `not_configured` is the ordinary answer. Everything else falls through to
   * the app's general vocabulary, which for a 501 would say only that something
   * went wrong.
   */
  readonly errorKey = computed(() => {
    const error = this.error();
    if (error === null || error.status === 400 || error.status === 409) {
      return null;
    }

    const reason = spawnBlockReason(error);
    return reason === null
      ? gatewayErrorKey(error)
      : `harvest.blocked.${reason}`;
  });

  /**
   * A window the document carries and the operator has emptied.
   *
   * Only ever asked about for a document that states one: a storefront export
   * has no window and no inputs, so there is nothing to be missing.
   */
  readonly missingDates = computed(() => {
    const read = this.read();
    return (
      read !== null &&
      read.validity !== null &&
      (this.validFrom() === '' || this.validUntil() === '')
    );
  });

  /**
   * Whether this file needs to be told which group of shops its prices are for
   * (admin plan 0025, section 3).
   *
   * Three cases, and only the first asks:
   *
   * 1. A price names no scope. Every leaflet, and every version 1 document.
   * 2. Every price names one. A LIDL export, which prices 59 regions itself.
   * 3. There is no price at all. A DEZA export, which states none.
   *
   * **Read from the products and never from `hints.adapter_key`.** The hint is
   * what a producer claims and the products are what the file holds, so a file
   * labelled `lidl-api` that carries an unscoped price is asked for a default
   * rather than left with a price that has nowhere to go.
   */
  readonly needsScope = computed(() => this.read()?.pricing.unscoped !== false);

  /**
   * What the file declares, for the operator to read before importing.
   *
   * Absent for a document that declares no scopes, so nothing changes for a
   * leaflet upload.
   */
  readonly scopeSummary = computed(() => {
    const read = this.read();
    if (read === undefined || read === null || read.scopes.length === 0) {
      return null;
    }
    const shown = read.scopes.slice(0, SCOPES_NAMED);
    const rest = read.scopes.length - shown.length;
    const names = shown.map((scope) => scope.name).join(', ');

    return {
      count: read.scopes.length,
      // The first few by name and the rest as a number: 59 region names is a
      // paragraph, and what an operator checks is that the list looks right.
      names: rest > 0 ? `${names} (+${rest})` : names,
      mostPerProduct: read.pricing.mostPerProduct,
    };
  });

  readonly ready = computed(
    () =>
      this.read() !== null &&
      this.supermarketId() !== '' &&
      (!this.needsScope() || this.priceScopeId() !== '') &&
      this.sourceKind() !== '' &&
      !this.missingDates()
  );

  /**
   * Read a dropped file, in the browser.
   *
   * A file that is not JSON is refused here rather than at the gateway, because
   * the operator can see that answer immediately and because sending a 300 KB
   * file to be told it is not JSON is a round trip for nothing.
   *
   * Everything a previous file left behind is cleared **except the three
   * inputs**, and that exception is the whole of the hint rule: an operator who
   * chose a chain and then dropped a file keeps their chain, and the notice says
   * what the file wanted instead.
   */
  async chooseFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;

    this.read.set(null);
    this.rejection.set(null);
    this.error.set(null);
    this.hints.set([]);
    this.started.set('');
    this.validFrom.set('');
    this.validUntil.set('');
    // The window, the term and the refusal filter all belong to the file that
    // is going away: a position, a search and a complaint about a different
    // document (plan 0019, section 4).
    this.resetPreview();

    if (file === null) {
      return;
    }

    const parsed = parseHarvestDocument(await file.text());
    if (!parsed.ok) {
      this.rejection.set(parsed.reason);
      return;
    }

    this.read.set(parsed.read);
    // Prefilled from the document and freely changed. A document with no window
    // shows no inputs at all rather than two empty required ones.
    this.validFrom.set(parsed.read.validity?.from ?? '');
    this.validUntil.set(parsed.read.validity?.until ?? '');

    await this.applyHints(parsed.read);
  }

  /**
   * Fill the empty inputs from the file, and say what happened.
   *
   * Three independent decisions, one per input, and each has three outcomes:
   * the file set it, the operator's choice was kept, or the file named an id
   * this deployment does not have. An input the operator already set is **never**
   * overwritten, whatever the file says, which is what makes a disagreement
   * visible rather than silently obeyed.
   */
  async applyHints(read: HarvestDocumentRead): Promise<void> {
    const results: HintResult[] = [];

    if (read.hints.chainId !== '') {
      results.push(
        await this._applyReference(
          'chain',
          'supermarkets',
          read.hints.chainId,
          this.supermarketId
        )
      );
    }

    if (read.hints.priceScopeId !== '') {
      results.push(
        await this._applyReference(
          'scope',
          'price-scopes',
          read.hints.priceScopeId,
          this.priceScopeId
        )
      );
    }

    if (read.hints.sourceKind !== null) {
      const stated = read.hints.sourceKind;
      const kept = this.sourceKind();
      if (kept === '') {
        this.sourceKind.set(stated);
        results.push({
          field: 'sourceKind',
          outcome: 'set',
          fileValue: stated,
          keptValue: '',
        });
      } else {
        results.push({
          field: 'sourceKind',
          outcome: 'kept',
          fileValue: stated,
          keptValue: kept,
        });
      }
    }

    this.hints.set(results);

    // A chain the file set still needs its scopes read, so the national one is
    // preselected exactly as it is when the operator picks the chain by hand.
    if (this.supermarketId() !== '' && this.priceScopeId() === '') {
      await this.refreshScopes();
    }
  }

  ngOnDestroy(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
  }

  /**
   * A word typed in the search box, once it has settled.
   *
   * The window goes back to its first page on every change, because the page it
   * was on was a position in a different list: an operator who pressed "show
   * more" twice and then typed a word is not asking for the first 750 of what
   * matched.
   */
  onSearch(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;

    if (this._timer !== null) {
      clearTimeout(this._timer);
    }

    this._timer = setTimeout(() => {
      this.term.set(typed);
      this.shown.set(PREVIEW_PAGE);
    }, SEARCH_DELAY_MS);
  }

  /** Another page of rows. Pressing it repeatedly does reach the end of a file. */
  showMore(): void {
    this.shown.update((shown) => shown + PREVIEW_PAGE);
  }

  /** Back out of a refusal, to the whole document again. */
  showWholeFile(): void {
    this.refusedOnly.set(false);
    this.shown.set(PREVIEW_PAGE);
  }

  /** The preview as a freshly opened file leaves it. */
  resetPreview(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    this.term.set('');
    this.shown.set(PREVIEW_PAGE);
    this.refusedOnly.set(false);

    const box = this._search()?.nativeElement;
    if (box !== undefined) {
      box.value = '';
    }
  }

  async chooseChain(supermarketId: string): Promise<void> {
    this.supermarketId.set(supermarketId);
    this.priceScopeId.set('');
    this.error.set(null);
    await this.refreshScopes();
  }

  /**
   * Find the chain's `NATIONAL` scope and preselect it.
   *
   * Most uploads are nationwide, and a scope that reaches every shop of the
   * chain is what a nationwide price belongs to. Preselecting it is the whole of
   * the shortcut: the operator confirms rather than searches, and a chain with
   * several warehouse scopes does not present them as equally plausible.
   *
   * A chain with none is offered the create form instead, in a new tab. This
   * screen holds the document in memory and nowhere else, so navigating away and
   * back would cost the operator the file they just dropped.
   */
  async refreshScopes(): Promise<void> {
    const supermarketId = this.supermarketId();
    if (supermarketId === '') {
      return;
    }

    try {
      const page = await this._scopes.list({
        filters: { supermarketId },
        limit: SCOPE_PAGE,
      });
      const national = page.items.find((scope) => scope.kind === 'NATIONAL');

      this.noNationalScope.set(national === undefined);
      if (national !== undefined && this.priceScopeId() === '') {
        this.priceScopeId.set(national.id);
      }
      this.shell.observeReachable();
    } catch (error) {
      // A scope read that failed is not a reason to stop: the picker can still
      // be typed into, and the operator can still choose one by hand.
      this.noNationalScope.set(false);
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    }
  }

  /**
   * Send it, and stay here.
   *
   * The old leaflet screen navigated to the run on 201. This one shows a success
   * state with two ways on, because the interesting place after an import is the
   * queue rather than the run: an import fetches nothing, so its run is over in
   * seconds and the rows it queued are the work. Both refusals keep the operator
   * here with their document intact, which is the point of not navigating
   * optimistically: a 400 is fixed in the producer and re-dropped, and a 409 is a
   * run to go and look at.
   */
  async submit(): Promise<void> {
    const read = this.read();
    const sourceKind = this.sourceKind();
    if (
      read === null ||
      sourceKind === '' ||
      !this.ready() ||
      this.importing()
    ) {
      return;
    }

    this.importing.set(true);
    this.error.set(null);

    try {
      const run = await this._service.importDocument({
        supermarketId: this.supermarketId(),
        // Sent only where it means something. A file that scopes every price of
        // its own has nothing to fall back to, so a scope here would be this
        // screen asserting a fact about an import that has none.
        ...(this.needsScope() ? { priceScopeId: this.priceScopeId() } : {}),
        sourceKind,
        ...(this.validFrom() === '' ? {} : { validFrom: this.validFrom() }),
        ...(this.validUntil() === '' ? {} : { validUntil: this.validUntil() }),
        // Byte for byte what was in the file. Nothing on this screen edits it.
        document: read.document,
      });
      this.shell.observeReachable();
      this.started.set(run.id);
    } catch (error) {
      const failure = toGatewayError(error);
      this.error.set(failure);
      // A refusal is the one moment the operator is not browsing the document
      // but reading a complaint about specific rows, so the preview follows them
      // there (plan 0019, section 4). Under a cap the alternative is a promise
      // the marking cannot keep: the row a message names is row 3,000 and the
      // operator is looking at rows 1 to 250, all of them unmarked.
      //
      // Only for a refusal that names a product. A complaint about the producer
      // block narrows the preview to nothing, which hides the document to say
      // something that is not about it.
      this.refusedOnly.set(this.failures().some((row) => row.productId !== ''));
      this.shown.set(PREVIEW_PAGE);
      // The switch panel on the runs screen reads this, so a refusal seen here
      // explains the empty runs list over there rather than being learned twice.
      this.shell.observeSpawnRefusal(spawnBlockReason(failure));
      this.shell.observeFailure();
    } finally {
      this.importing.set(false);
    }
  }

  /**
   * Where a run is read.
   *
   * Absolute rather than relative, for the reason the queues give: `..` needs a
   * route above it to pop and throws outright when there is none, and this
   * component is rendered directly in its spec.
   */
  runLink(runId: string): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'runs', runId];
  }

  /** Where the rows now are, with the chain already chosen. */
  queueLink(): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'entries'];
  }

  queueParams(): Record<string, string> {
    return { supermarketId: this.supermarketId() };
  }

  /**
   * One hint that names a row of the directory.
   *
   * Resolved before it is used, because an id does not survive an environment
   * change: a file carried from the machine that walked to the cluster that
   * imports names a chain by an id that cluster has never seen. The name comes
   * back with it, so the notice can say `Deza` rather than a uuid, and the uuid
   * is what it says when nothing answered.
   */
  private async _applyReference(
    field: HintResult['field'],
    resource: string,
    id: string,
    input: { (): string; set(value: string): void }
  ): Promise<HintResult> {
    const kept = input();
    const option = await this.references.resolve(resource, id);
    const fileValue = option?.title ?? id;

    if (option === null) {
      return { field, outcome: 'unknown', fileValue: id, keptValue: kept };
    }
    if (kept !== '') {
      const keptOption = await this.references.resolve(resource, kept);
      return {
        field,
        outcome: 'kept',
        fileValue,
        keptValue: keptOption?.title ?? kept,
      };
    }

    input.set(id);
    return { field, outcome: 'set', fileValue, keptValue: '' };
  }
}
