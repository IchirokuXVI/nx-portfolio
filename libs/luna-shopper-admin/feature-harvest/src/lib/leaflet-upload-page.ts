import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
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
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  leafletConflict,
  leafletFailures,
  parseLeaflet,
  sortOffersByPage,
  type Leaflet,
  type LeafletConflictNotice,
  type LeafletRejection,
} from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  ReferencePicker,
} from '@portfolio/luna-shopper-admin/ui';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';

/** How far the scope search walks looking for the chain's `NATIONAL` one. */
const SCOPE_PAGE = 100;

/**
 * A leaflet arrives as a file (admin plan 0010, section 2).
 *
 * Not a descriptor screen, and the plan opens by saying why: a file drop that
 * validates, previews a table of offers, asks for a chain, a scope and two
 * dates, and starts a run is not a form over a resource. There is no row here
 * to create and nothing to read back.
 *
 * Three properties are the design rather than details of it.
 *
 * **The document is read in the browser and never edited.** An edited document
 * has a different digest, and the digest is the backend's dedupe key, so a
 * screen that let an operator patch one field would produce a file that imports
 * a second time and reports itself as new. When the schema refuses the file, the
 * fix is in the extractor.
 *
 * **What was read is shown before anything is chosen.** The retailer's name, the
 * file, the digest, the page and offer counts. A wrong file is then obvious in
 * one glance, rather than after a chain, a scope and two dates have been picked.
 *
 * **`retailer.chain_id` is displayed and never used to pick anything** (backend
 * plan 0081, section 4). Two extractors spell one chain two ways, and a slug in
 * a file is not an identity. It sits beside the picker so the operator can
 * disagree with it.
 */
@Component({
  selector: 'lib-leaflet-upload-page',
  imports: [RouterLink, RokuTranslatorPipe, HarvestNotice, ReferencePicker],
  template: `
    <header>
      <h1>{{ 'harvest.leaflets.heading' | rokuT }}</h1>
      <p class="lead">{{ 'harvest.leaflets.lead' | rokuT }}</p>
    </header>

    <section class="drop">
      <label>
        <span>{{ 'harvest.leaflets.file' | rokuT }}</span>
        <input
          (change)="chooseFile($event)"
          accept="application/json,.json"
          name="document"
          type="file"
        />
      </label>

      @if (rejection(); as reason) {
        <p class="failure" role="alert">
          {{ 'harvest.leaflets.rejected.' + reason | rokuT }}
        </p>
      }
    </section>

    @if (leaflet(); as read) {
      <section class="summary">
        <h2>{{ 'harvest.leaflets.read.heading' | rokuT }}</h2>
        <dl>
          @for (fact of facts(); track fact.key) {
            <div>
              <dt>{{ 'harvest.leaflets.read.' + fact.key | rokuT }}</dt>
              <dd [class.digest]="fact.key === 'sha256'">{{ fact.value }}</dd>
            </div>
          }
        </dl>
        <p class="hint">{{ 'harvest.leaflets.read.chainIdHint' | rokuT }}</p>
      </section>

      <section class="choices">
        <div class="field">
          <span>{{ 'harvest.leaflets.chain' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="chooseChain($event)"
            [controlId]="'leaflet-chain'"
            [lookup]="references"
            [resource]="'supermarkets'"
            [value]="supermarketId()"
          />
        </div>

        <div class="field">
          <span>{{ 'harvest.leaflets.scope' | rokuT }}</span>
          @if (supermarketId() === '') {
            <p class="hint">{{ 'harvest.leaflets.scopeNeedsChain' | rokuT }}</p>
          } @else {
            <lib-reference-picker
              (valueChange)="priceScopeId.set($event)"
              [controlId]="'leaflet-scope'"
              [lookup]="references"
              [resource]="'price-scopes'"
              [scope]="scopeFilter()"
              [value]="priceScopeId()"
            />
            @if (noNationalScope()) {
              <p class="hint">
                {{ 'harvest.leaflets.noNational' | rokuT }}
                <a
                  [queryParams]="{ supermarketId: supermarketId() }"
                  [routerLink]="['/', 'price-scopes', 'new']"
                  target="_blank"
                  >{{ 'harvest.leaflets.createScope' | rokuT }}</a
                >
              </p>
              <button (click)="refreshScopes()" type="button">
                {{ 'harvest.leaflets.refreshScopes' | rokuT }}
              </button>
            }
          }
        </div>

        <label class="field">
          <span>{{ 'harvest.leaflets.validFrom' | rokuT }}</span>
          <input
            (input)="validFrom.set($any($event.target).value)"
            [value]="validFrom()"
            name="validFrom"
            required
            type="date"
          />
        </label>

        <label class="field">
          <span>{{ 'harvest.leaflets.validUntil' | rokuT }}</span>
          <input
            (input)="validUntil.set($any($event.target).value)"
            [value]="validUntil()"
            name="validUntil"
            required
            type="date"
          />
        </label>
      </section>

      @if (missingDates()) {
        <p class="hint">{{ 'harvest.leaflets.datesRequired' | rokuT }}</p>
      }

      <div class="submit">
        <button
          (click)="submit()"
          [disabled]="!ready() || importing()"
          class="primary"
          type="button"
        >
          {{
            (importing()
              ? 'harvest.leaflets.importing'
              : 'harvest.leaflets.import'
            ) | rokuT
          }}
        </button>
        <p class="attribution">
          {{ 'harvest.runs.start.attribution' | rokuT }}
        </p>
      </div>

      @if (conflict(); as clash) {
        <section class="failure" role="alert">
          <p>{{ 'harvest.leaflets.conflict.' + clash.kind | rokuT }}</p>
          @if (clash.runId !== '') {
            <a [routerLink]="runLink(clash.runId)">{{
              'harvest.leaflets.conflict.open' | rokuT
            }}</a>
          }
        </section>
      } @else if (failures().length > 0) {
        <section class="failures">
          <h2>{{ 'harvest.leaflets.failures.heading' | rokuT }}</h2>
          <p class="hint">{{ 'harvest.leaflets.failures.lead' | rokuT }}</p>
          <ul>
            @for (row of failures(); track row.offerId + row.section) {
              <li>
                <strong>{{
                  row.offerId === '' ? row.section : row.offerId
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

      <section class="preview">
        <h2>{{ 'harvest.leaflets.preview.heading' | rokuT }}</h2>
        <button (click)="togglePageOrder()" class="sort" type="button">
          {{
            (ascending()
              ? 'harvest.leaflets.preview.byPageDesc'
              : 'harvest.leaflets.preview.byPageAsc'
            ) | rokuT
          }}
        </button>

        <ul class="offers">
          @for (offer of offers(); track offer.id) {
            <li
              [class.blamed]="blamed().has(offer.id)"
              [class.muted]="offer.muted"
            >
              <div class="identity">
                <span class="page">{{ offer.page }}</span>
                <strong>{{ offer.name }}</strong>
                <span class="format">{{ offer.format }}</span>
                <span class="brand">{{ offer.brand }}</span>
              </div>
              <div class="numbers">
                <span class="price">{{ offer.price }}</span>
                <span class="basis">{{ offer.basis }}</span>
                @if (offer.promotionType !== '') {
                  <span class="promotion">{{ offer.promotionType }}</span>
                }
                @if (offer.loyalty) {
                  <span class="loyalty">{{
                    'harvest.leaflets.preview.loyalty' | rokuT
                  }}</span>
                }
              </div>
              @if (offer.noteKey; as key) {
                <p class="note">{{ key | rokuT }}</p>
              }
            </li>
          }
        </ul>
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
    .format,
    .brand,
    .basis {
      color: var(--admin-ink-muted);
    }

    .drop,
    .summary,
    .choices,
    .failures,
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

    .digest {
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
      color: var(--admin-danger-ink);
    }

    .submit {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .offers {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .offers li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-4);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .offers li.muted {
      opacity: 0.6;
      border-style: dashed;
    }

    .offers li.blamed {
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      opacity: 1;
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

    .page {
      min-inline-size: 2rem;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .price {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    .promotion,
    .loyalty {
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
    }

    .note {
      flex-basis: 100%;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    a {
      color: var(--admin-accent);
    }

    button,
    input {
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
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeafletUploadPage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _router = inject(Router);
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

  /** The document, held in memory and never stored. */
  readonly leaflet = signal<Leaflet | null>(null);
  /** Why the last dropped file could not be read. */
  readonly rejection = signal<LeafletRejection | null>(null);

  readonly supermarketId = signal('');
  readonly priceScopeId = signal('');
  readonly validFrom = signal('');
  readonly validUntil = signal('');

  readonly importing = signal(false);
  readonly error = signal<GatewayError | null>(null);
  readonly ascending = signal(true);
  /** Whether the chosen chain has a `NATIONAL` scope, once that is known. */
  readonly noNationalScope = signal(false);

  readonly offers = computed(() =>
    sortOffersByPage(
      this.leaflet()?.offers ?? [],
      this.ascending() ? 'asc' : 'desc'
    )
  );

  /** What the file says, in the order the plan lists it. */
  readonly facts = computed(() => {
    const summary = this.leaflet()?.summary;
    if (summary === undefined) {
      return [];
    }

    return [
      { key: 'retailer', value: summary.retailerName },
      { key: 'chainId', value: summary.chainId },
      { key: 'file', value: summary.file },
      { key: 'sha256', value: summary.sha256 },
      { key: 'pages', value: String(summary.pageCount) },
      { key: 'offers', value: String(summary.offerCount) },
      { key: 'warnings', value: String(summary.warningCount) },
    ];
  });

  /** The chain the scope picker reads within, which it cannot read without. */
  readonly scopeFilter = computed(() => ({
    supermarketId: this.supermarketId(),
  }));

  /**
   * A refusal the gateway explained by JSON path (section 2.1).
   *
   * The document's own offer ids are passed in so a path of `/offers/3/id` can
   * still name the tile, which is the one failure whose message cannot carry
   * the id it is about.
   */
  readonly failures = computed(() => {
    const error = this.error();
    if (error === null || error.status !== 400) {
      return [];
    }

    return leafletFailures(
      error.fieldErrors,
      (this.leaflet()?.offers ?? []).map((offer) => offer.id)
    );
  });

  /** The preview rows the gateway objected to, highlighted where they sit. */
  readonly blamed = computed(
    () => new Set(this.failures().map((row) => row.offerId))
  );

  readonly conflict = computed<LeafletConflictNotice | null>(() => {
    const error = this.error();
    return error === null ? null : leafletConflict(error);
  });

  /**
   * A failure this screen has no better sentence for.
   *
   * Not a 400, which is drawn as rows, and not a 409, which is drawn with a
   * link. Everything else falls through to the app's general vocabulary.
   */
  readonly errorKey = computed(() => {
    const error = this.error();
    if (error === null || error.status === 400 || error.status === 409) {
      return null;
    }
    return gatewayErrorKey(error);
  });

  /** A date the document did not state and the operator has not typed. */
  readonly missingDates = computed(
    () =>
      this.leaflet() !== null &&
      (this.validFrom() === '' || this.validUntil() === '')
  );

  readonly ready = computed(
    () =>
      this.leaflet() !== null &&
      this.supermarketId() !== '' &&
      this.priceScopeId() !== '' &&
      !this.missingDates()
  );

  /**
   * Read a dropped file, in the browser.
   *
   * A file that is not JSON is refused here rather than at the gateway, because
   * the operator can see that answer immediately and because sending a 300 KB
   * file to be told it is not JSON is a round trip for nothing.
   *
   * Everything a previous file left behind is cleared: a stale preview under a
   * new file's summary is the worst possible state for this screen to be in.
   */
  async chooseFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;

    this.leaflet.set(null);
    this.rejection.set(null);
    this.error.set(null);
    this.priceScopeId.set('');
    this.validFrom.set('');
    this.validUntil.set('');

    if (file === null) {
      return;
    }

    const parsed = parseLeaflet(await file.text());
    if (!parsed.ok) {
      this.rejection.set(parsed.reason);
      return;
    }

    this.leaflet.set(parsed.leaflet);
    // Prefilled from the document, and freely changed. A null in the file
    // leaves the input empty and required, which the backend enforces too: the
    // spawn refuses a run with a null bound.
    this.validFrom.set(parsed.leaflet.summary.startsOn);
    this.validUntil.set(parsed.leaflet.summary.endsOn);
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
   * Most leaflets are nationwide, and a scope that reaches every scope of the
   * chain is what a nationwide price belongs to. Preselecting it is the whole
   * of the shortcut: the operator confirms rather than searches, and a chain
   * with several warehouse scopes does not present them as equally plausible.
   *
   * A chain with none is offered the create form instead, in a new tab. This
   * screen holds the document in memory and nowhere else, so navigating away
   * and back would cost the operator the file they just dropped.
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
      if (national !== undefined) {
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

  togglePageOrder(): void {
    this.ascending.update((ascending) => !ascending);
  }

  /**
   * Send it, and leave for the run.
   *
   * On 201 the run screen takes over and watches it to completion, as it does
   * for every run. Both refusals keep the operator here with their document
   * intact, which is the point of not navigating optimistically: a 400 is fixed
   * in the extractor and re-dropped, and a 409 is a run to go and look at.
   */
  async submit(): Promise<void> {
    const leaflet = this.leaflet();
    if (leaflet === null || !this.ready() || this.importing()) {
      return;
    }

    this.importing.set(true);
    this.error.set(null);

    try {
      const run = await this._service.importLeaflet({
        supermarketId: this.supermarketId(),
        priceScopeId: this.priceScopeId(),
        validFrom: this.validFrom(),
        validUntil: this.validUntil(),
        // Byte for byte what was in the file. Nothing on this screen edits it.
        document: leaflet.document,
      });
      this.shell.observeReachable();
      await this._router.navigate(this.runLink(run.id));
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.importing.set(false);
    }
  }

  /**
   * Where a run is read.
   *
   * Absolute rather than relative, for the reason the shops queue gives: `..`
   * needs a route above it to pop and throws outright when there is none, and
   * this component is rendered directly in its spec.
   */
  runLink(runId: string): string[] {
    return ['/', HARVEST_SEGMENT, 'runs', runId];
  }
}
