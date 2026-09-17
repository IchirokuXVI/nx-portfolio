import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  type OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  ChainNames,
  formatInstant,
  formatSince,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ReferencePicker, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { brandKey } from '@portfolio/luna-shopper/contracts/brand-key';
import { capitalizeBrand } from './brand-capitalization';
import { BrandsGateway, type BrandSuggestion } from './brands-gateway';

/**
 * The `details` key a `brand_key_taken` names the holding brand under.
 *
 * Repeated here rather than imported from `@portfolio/luna-shopper/platform`,
 * for the reason `ADMIN_APP_VERSION` is: that library's barrel exports the Nest
 * bootstrap and the platform module, so reaching into it for one string would
 * pull a backend framework into a browser bundle. The backend's own constant is
 * `BRAND_KEY_HOLDER_DETAIL` in `domain-exception.ts`, and the two have to agree.
 */
const BRAND_KEY_HOLDER_DETAIL = 'brandId';

/** How long typing settles before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * The brands the queue is asking for (admin plan 0027, section 3).
 *
 * **Hand written rather than a descriptor**, and the row is why: a
 * `ResourceCell` holds one text, and this row holds a spelling over its key, a
 * date over its age, and one chip per chain that carries it. A suggestion is
 * also not a resource. It has no id and nothing holds it: it is a key some
 * queued products carry that no registered brand claims, so there is no row to
 * open, edit or delete and the only act on it is to register one.
 *
 * **Everything the operator decides on is in the row.** There is no detail
 * screen, and every chain is shown rather than the first two and a "+2": a chain
 * hidden behind a count is a fact moved out of the row somebody is deciding on.
 *
 * **Registering is an inline panel, not a screen.** The decision is which
 * spelling becomes the label, and that decision is made while looking at the
 * spellings the chains used, which are on the row above it. There is no bulk
 * register for the same reason: every label is a decision, and the panel is what
 * a decision looks like.
 */
@Component({
  selector: 'lib-brand-suggestions-page',
  imports: [NgTemplateOutlet, RokuTranslatorPipe, ReferencePicker, RouterLink],
  template: `
    <header>
      <h1>{{ 'brands.suggested.heading' | rokuT }}</h1>
      <p class="lead">{{ 'brands.suggested.lead' | rokuT }}</p>
    </header>

    <label class="search">
      <span>{{ 'brands.suggested.search' | rokuT }}</span>
      <input
        (input)="onSearch($event)"
        [value]="query()"
        autocapitalize="none"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        type="search"
        data-search
      />
    </label>

    @if (done(); as said) {
      <p class="done" role="status">
        {{
          (said.linked === 0
            ? 'brands.suggested.register.doneNone'
            : 'brands.suggested.register.done'
          ) | rokuT: { label: said.label, count: said.linked }
        }}
      </p>
    }

    @if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (failed()) {
      <p class="state error" role="alert">
        {{ errorKey() | rokuT }}
        <button (click)="reload()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </p>
    } @else if (rows().length === 0) {
      <p class="state">
        {{
          (query() === '' ? 'brands.suggested.empty' : 'resource.list.noMatch')
            | rokuT
        }}
      </p>
    } @else if (compact()) {
      <!-- On a phone the row is a card: the brand, then the figures, then the
           chips, then the action. A four column table at that width is
           unreadable however it scrolls. -->
      <ul class="cards">
        @for (row of rows(); track row.key) {
          <li>
            <article>
              <h2>
                <span class="spelling">{{ row.spelling }}</span>
                <span class="key">{{ row.key }}</span>
              </h2>

              <dl>
                <div>
                  <dt>{{ 'brands.suggested.products' | rokuT }}</dt>
                  <dd class="figure">{{ count(row.productCount) }}</dd>
                </div>
                <div>
                  <dt>{{ 'brands.suggested.firstSeen' | rokuT }}</dt>
                  <dd>
                    {{ instant(row.firstSeenAt) }}
                    <span class="muted">{{ since(row.firstSeenAt) }}</span>
                  </dd>
                </div>
              </dl>

              <ul class="chips">
                @for (chain of row.chains; track chain.supermarketId) {
                  <li class="chip">
                    <span aria-hidden="true">
                      {{
                        'brands.suggested.chain'
                          | rokuT
                            : {
                                name: names.nameOf(chain.supermarketId),
                                count: count(chain.productCount),
                              }
                      }}
                    </span>
                    <span class="sr-only">
                      {{
                        'brands.suggested.chainAria'
                          | rokuT
                            : {
                                name: names.nameOf(chain.supermarketId),
                                count: count(chain.productCount),
                              }
                      }}
                    </span>
                  </li>
                }
              </ul>

              <button
                (click)="startRegister(row)"
                [attr.aria-expanded]="openKey() === row.key"
                [attr.data-register]="row.key"
                class="primary"
                type="button"
              >
                {{ 'brands.suggested.register.action' | rokuT }}
              </button>

              @if (openKey() === row.key) {
                <ng-container [ngTemplateOutlet]="panel" />
              }
            </article>
          </li>
        }
      </ul>
    } @else {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{{ 'brands.suggested.brand' | rokuT }}</th>
              <th class="figure" scope="col">
                {{ 'brands.suggested.products' | rokuT }}
              </th>
              <th scope="col">{{ 'brands.suggested.firstSeen' | rokuT }}</th>
              <th scope="col">{{ 'brands.suggested.chains' | rokuT }}</th>
              <th scope="col">
                <span class="sr-only">{{
                  'resource.list.actions' | rokuT
                }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr>
                <th scope="row">
                  <span class="stack">
                    <span class="spelling">{{ row.spelling }}</span>
                    <span class="key">{{ row.key }}</span>
                  </span>
                </th>
                <td class="figure">{{ count(row.productCount) }}</td>
                <td>
                  <!-- The date over its age, as the brand sits over its key.
                       Two bare spans side by side touched, because Angular
                       drops the whitespace between two elements. -->
                  <span class="stack">
                    <span>{{ instant(row.firstSeenAt) }}</span>
                    <span class="muted">{{ since(row.firstSeenAt) }}</span>
                  </span>
                </td>
                <td>
                  <ul class="chips">
                    @for (chain of row.chains; track chain.supermarketId) {
                      <li class="chip">
                        <span aria-hidden="true">
                          {{
                            'brands.suggested.chain'
                              | rokuT
                                : {
                                    name: names.nameOf(chain.supermarketId),
                                    count: count(chain.productCount),
                                  }
                          }}
                        </span>
                        <span class="sr-only">
                          {{
                            'brands.suggested.chainAria'
                              | rokuT
                                : {
                                    name: names.nameOf(chain.supermarketId),
                                    count: count(chain.productCount),
                                  }
                          }}
                        </span>
                      </li>
                    }
                  </ul>
                </td>
                <td>
                  <button
                    (click)="startRegister(row)"
                    [attr.aria-expanded]="openKey() === row.key"
                    [attr.data-register]="row.key"
                    type="button"
                  >
                    {{ 'brands.suggested.register.action' | rokuT }}
                  </button>
                </td>
              </tr>

              @if (openKey() === row.key) {
                <tr class="panel-row">
                  <td colspan="5">
                    <ng-container [ngTemplateOutlet]="panel" />
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }

    @if (hasMore()) {
      <button
        (click)="loadMore()"
        [disabled]="loadingMore()"
        class="more"
        type="button"
      >
        {{
          (loadingMore() ? 'resource.list.loadingMore' : 'resource.action.more')
            | rokuT
        }}
      </button>
    }

    <!-- One panel, drawn under whichever row is open. Written once rather than
         twice, because a table row and a card are two places the same decision
         is made and a second copy is a second thing to get wrong. -->
    <ng-template #panel>
      <!-- The panel carries the Escape handler, so it has to be focusable: a
           handler on an element nothing can focus is a control only a mouse can
           reach. That is also what makes the panel reachable to be announced. -->
      <section
        (keydown.escape)="cancel()"
        [attr.aria-label]="'brands.suggested.register.panel' | rokuT"
        class="panel"
        role="group"
        tabindex="-1"
      >
        <label>
          <span>{{ 'brands.suggested.register.label' | rokuT }}</span>
          <input
            (input)="onLabel($event)"
            [value]="label()"
            type="text"
            data-label
          />
        </label>

        <!-- The name starts capitalized, so the chain's own spelling is the one
             a press brings back, and each button is disabled while the name
             already is what it would write. -->
        <div class="controls">
          <button
            (click)="capitalize()"
            [disabled]="saving() || label() === capitalized()"
            type="button"
            data-capitalize
          >
            {{ 'brands.suggested.register.capitalize' | rokuT }}
          </button>
          <button
            (click)="revert()"
            [disabled]="saving() || label() === original()"
            type="button"
            data-revert
          >
            {{ 'brands.suggested.register.revert' | rokuT }}
          </button>
        </div>

        <p aria-live="polite" class="live-key">
          @if (liveKey() === '') {
            {{ 'brands.suggested.register.noKey' | rokuT }}
          } @else {
            {{
              'brands.suggested.register.makesKey' | rokuT: { key: liveKey() }
            }}
          }
          @if (keyDiffers()) {
            <span class="warn">{{
              'brands.suggested.register.keyDiffers' | rokuT
            }}</span>
          }
        </p>

        <div class="field">
          <span>{{ 'brands.suggested.register.privateLabel' | rokuT }}</span>
          <lib-reference-picker
            (valueChange)="chainId.set($event)"
            [controlId]="'suggestion-chain'"
            [lookup]="references"
            [nullable]="true"
            [resource]="'supermarkets'"
            [value]="chainId()"
          />
        </div>

        @if (panelErrorKey(); as key) {
          <p class="failure" role="alert">
            {{ key | rokuT }}
            @if (holderLink(); as link) {
              <a [routerLink]="link">{{
                'brands.suggested.register.openHolder' | rokuT
              }}</a>
            }
          </p>
        }

        <div class="controls">
          <button
            (click)="register()"
            [disabled]="saving() || liveKey() === ''"
            class="primary"
            type="button"
            data-confirm
          >
            {{
              (saving()
                ? 'resource.action.working'
                : 'brands.suggested.register.confirm'
              ) | rokuT
            }}
          </button>
          <button
            (click)="cancel()"
            [disabled]="saving()"
            type="button"
            data-cancel
          >
            {{ 'resource.action.cancel' | rokuT }}
          </button>
        </div>
      </section>
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: flex-start;
    }

    header {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    h2 {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      font-size: 1rem;
    }

    .lead,
    .state,
    .muted {
      color: var(--admin-ink-muted);
    }

    .state {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .done {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .failure {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .search,
    .field,
    .panel label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      max-inline-size: 24rem;
    }

    .search > span,
    .field > span,
    .panel label span,
    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .table-wrap {
      overflow-x: auto;
      inline-size: 100%;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    thead th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody th {
      font-weight: 400;
    }

    /* A wrapper rather than a flex table cell: display flex on a th takes it
       out of the table layout, and the column stops lining up with its
       header. */
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .panel-row td {
      background: var(--admin-surface);
    }

    .spelling {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    /* The key, in the muted monospace a key wears everywhere in this app. */
    .key,
    .live-key {
      font-family: monospace;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .figure {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      inline-size: 100%;
      list-style: none;
    }

    .cards article {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    /* Every chain, wrapping onto a second line rather than truncating: a chain
       hidden behind a count is a fact moved out of the row. */
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .chip {
      padding: var(--admin-space-1) var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      font-size: 0.8125rem;
      white-space: nowrap;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      inline-size: 100%;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .warn {
      display: block;
      font-family: inherit;
      color: var(--admin-ink);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
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

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    input {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .sr-only {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandSuggestionsPage implements OnDestroy {
  private readonly _brands = inject(BrandsGateway);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _viewport = inject(Viewport);

  /** What a chain is called, resolved once per id. */
  readonly names = inject(ChainNames);

  /** How the private label picker finds a chain by name. */
  readonly references = inject(ResourceReferences);

  readonly compact = this._viewport.compact;

  readonly rows = signal<readonly BrandSuggestion[]>([]);
  readonly query = signal('');
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly failed = signal(false);
  private readonly _cursor = signal<string | null>(null);
  private readonly _error = signal<GatewayError | null>(null);

  readonly errorKey = computed(
    () => gatewayErrorKey(this._error()) ?? 'resource.error.unknown'
  );
  readonly hasMore = computed(() => this._cursor() !== null);

  /** Which row's panel is open, by key. `null` when none is. */
  readonly openKey = signal<string | null>(null);
  readonly label = signal('');
  /** The open row's spelling as the chain printed it, which revert restores. */
  readonly original = signal('');
  readonly capitalized = computed(() => capitalizeBrand(this.label()));
  readonly chainId = signal('');
  readonly saving = signal(false);
  private readonly _panelError = signal<GatewayError | null>(null);

  /**
   * What the last register linked, until the next one starts.
   *
   * The label and the count rather than a finished sentence, because this
   * screen draws its own notice and can interpolate them where they are read.
   */
  readonly done = signal<{
    readonly label: string;
    readonly linked: number;
  } | null>(null);

  /**
   * The key this label would make, live.
   *
   * The same `brandKey` catalog, the harvester and the gateway use, so what the
   * panel shows is what the server will store rather than an approximation of
   * it. Empty means the label makes no key at all, which is what `-` and `---`
   * do, and the register button is disabled rather than sending a request whose
   * only possible answer is `brand_label_empty`.
   */
  readonly liveKey = computed(() => brandKey(this.label()) ?? '');

  /**
   * Whether the label being typed would leave this row's products behind.
   *
   * The whole reason the panel prefills the spelling and lets it be edited is
   * that `MAHOU` should become `Mahou`. Both make `mahou`, so both link the
   * products. `Mahou 5 Estrellas` does not, and the operator has to be told
   * before they save rather than after, when the row is gone and nothing moved.
   */
  readonly keyDiffers = computed(() => {
    const open = this.openKey();
    return open !== null && this.liveKey() !== '' && this.liveKey() !== open;
  });

  readonly panelErrorKey = computed(() => gatewayErrorKey(this._panelError()));

  /**
   * Where the brand already holding this key lives, or nothing.
   *
   * Built from `ResourceRegistry.pathOf`, never from the segment: where a
   * resource is mounted is its section's business, and a link written by hand
   * here would break the day the section moves.
   */
  readonly holderLink = computed<readonly string[] | null>(() => {
    const error = this._panelError();
    if (error === null || error.code !== 'brand_key_taken') {
      return null;
    }

    const brandId = error.detailString(BRAND_KEY_HOLDER_DETAIL);
    const path = this._registry.pathOf('brands');

    return brandId === null || path === null ? null : [...path, brandId];
  });

  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this._load();
  }

  ngOnDestroy(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
  }

  /** A count, through `Intl`, like every other figure in this app. */
  count(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  instant(value: string): string {
    return formatInstant(value);
  }

  since(value: string): string {
    return formatSince(value, Date.now());
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);

    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._load();
    }, SEARCH_DELAY_MS);
  }

  onLabel(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
  }

  /** Write the name with only the first letter of each word in capitals. */
  capitalize(): void {
    this.label.set(this.capitalized());
  }

  /** Put back the spelling the chain printed. */
  revert(): void {
    this.label.set(this.original());
  }

  reload(): void {
    void this._load();
  }

  loadMore(): void {
    void this._loadMore();
  }

  /**
   * Open the panel under one row, with its spelling already capitalized in the
   * label. Chains mostly print brands in capitals, so the capitalized name is
   * the one a person keeps far more often than the printed one.
   */
  startRegister(row: BrandSuggestion): void {
    this.openKey.set(row.key);
    this.original.set(row.spelling);
    this.label.set(capitalizeBrand(row.spelling));
    this.chainId.set('');
    this._panelError.set(null);
    this.done.set(null);
    this._focusLater('[data-label]');
  }

  /** Close the panel, and put focus back on the button that opened it. */
  cancel(): void {
    const open = this.openKey();
    this.openKey.set(null);
    this._panelError.set(null);
    if (open !== null) {
      this._focusLater(`[data-register="${cssValue(open)}"]`);
    }
  }

  /**
   * Register the open row, as a brand.
   *
   * On success the row leaves the list, because it is no longer a suggestion:
   * the key is registered, so the read it came from would not answer it again.
   * Focus moves to the next row's button, or to the search box when there is no
   * next row, so working through the queue never needs the mouse.
   */
  async register(): Promise<void> {
    const open = this.openKey();
    if (open === null || this.saving()) {
      return;
    }

    this.saving.set(true);
    this._panelError.set(null);

    try {
      const chainId = this.chainId();
      const created = await this._brands.register(
        this.label(),
        chainId === '' ? null : chainId
      );

      const remaining = this.rows().filter((row) => row.key !== open);
      const next = this._keyAfter(open);

      this.rows.set(remaining);
      this.openKey.set(null);
      this.done.set({
        label: created.label,
        linked: created.linkedItems ?? 0,
      });

      this._focusLater(
        next === null ? '[data-search]' : `[data-register="${cssValue(next)}"]`
      );
    } catch (error) {
      // The panel stays open, holding everything typed. A refused register is a
      // decision to make again, not one to make from scratch.
      this._panelError.set(error as GatewayError);
    } finally {
      this.saving.set(false);
    }
  }

  /** The key of the row after this one, or `null` when it is the last. */
  private _keyAfter(key: string): string | null {
    const rows = this.rows();
    const at = rows.findIndex((row) => row.key === key);
    return at === -1 ? null : (rows[at + 1]?.key ?? null);
  }

  private async _load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    this.openKey.set(null);

    try {
      const page = await this._brands.suggestions(this.query());
      this.rows.set(page.items);
      this._cursor.set(page.nextCursor);
      void this.names.resolve(chainIdsOf(page.items));
    } catch (error) {
      this._error.set(error as GatewayError);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The next page, appended and deduped by key.
   *
   * The cursor is a keyset over `(productCount, key)` and the counts move as the
   * queue is worked, so a row really can arrive on two pages (backend plan 0115,
   * section 7.2). Dropping the repeat is the reader's job.
   */
  private async _loadMore(): Promise<void> {
    const cursor = this._cursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const page = await this._brands.suggestions(this.query(), cursor);
      const seen = new Set(this.rows().map((row) => row.key));

      this.rows.set([
        ...this.rows(),
        ...page.items.filter((row) => !seen.has(row.key)),
      ]);
      this._cursor.set(page.nextCursor);
      void this.names.resolve(chainIdsOf(page.items));
    } catch (error) {
      this._error.set(error as GatewayError);
      this.failed.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /**
   * Move focus to an element this render has not drawn yet.
   *
   * `afterNextRender` rather than a timer or a microtask, and the difference is
   * the whole of it: the panel opening and the row leaving are signal writes, so
   * the element being focused does not exist until the view is redrawn. A
   * microtask queued beside the write can run first and find the old DOM, and a
   * timer is the same race with a longer fuse.
   */
  private _focusLater(selector: string): void {
    afterNextRender(
      () => {
        this._host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this._injector }
    );
  }
}

/** Every chain named on a page of suggestions, without repeats. */
function chainIdsOf(rows: readonly BrandSuggestion[]): readonly string[] {
  return [
    ...new Set(
      rows.flatMap((row) => row.chains.map((chain) => chain.supermarketId))
    ),
  ];
}

/**
 * A key, safe inside an attribute selector.
 *
 * `brandKey` leaves only letters and digits, so nothing here needs escaping
 * today. It is quoted anyway, because a selector built from a value is exactly
 * where an assumption about that value stops being true quietly.
 */
function cssValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
