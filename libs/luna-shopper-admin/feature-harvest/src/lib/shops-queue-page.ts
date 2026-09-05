import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  ReferencePicker,
} from '@portfolio/luna-shopper-admin/ui';
import { HARVEST_SEGMENT } from './harvest-paths';
import { HarvestShell } from './harvest-shell';
import { toShopRow, type Shop, type ShopRow } from './shop-view';

/**
 * The status a row can be filtered by, plus the "any" that is not one.
 *
 * `UNMAPPED` first because it is the default: the queue exists to be drained.
 * The other two are reachable so that a wrong mapping can be found and undone,
 * which is the only way back from a name match that bound the wrong shop.
 */
const STATUSES: readonly Wire.EnumsSourceLocationStatus[] = [
  'UNMAPPED',
  'ACTIVE',
  'IGNORED',
];

/** What a chosen filter sends. `''` means every status. */
type StatusFilter = Wire.EnumsSourceLocationStatus | '';

/**
 * The shops a source names, and the mappings that let a run write availability
 * for them (admin plan 0011; backend plan 0084, section 6).
 *
 * The fourth review queue, beside places, entries and item refs, and the
 * closest in shape to the third. It is a bespoke screen rather than a descriptor
 * for the reason `0011` section 1 gives: a row here is a decision with three
 * outcomes, one of which binds a foreign record, and none of which is "edit this
 * row's fields". A descriptor list with an edit form over `externalId` and
 * `printedName` would offer the operator the two columns nobody is allowed to
 * change, because they are the source's and not ours.
 *
 * **The chain is required and comes first.** `source_locations` is unique on
 * (`supermarketId`, `externalId`) and a mapping only means anything inside one
 * chain, so there is no route that answers "every source's shops". The table is
 * a prompt until a chain is chosen, the same way the entries queue opens on a
 * chooser.
 *
 * **`matchedBy` is a column and not a detail.** A row the automatic exact name
 * match bound and a row a person bound look identical otherwise, and they carry
 * different confidence. An operator reviewing a chain's mappings needs to see
 * which ones nobody checked.
 *
 * Nothing here creates a shop of ours. An unmapped row that is genuinely a new
 * store is created on the locations screen and then mapped here, because
 * creating a location sets a price scope and that is a decision rather than a
 * side effect of draining a queue.
 */
@Component({
  selector: 'lib-shops-queue-page',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    ConfirmDialog,
    HarvestNotice,
    ReferencePicker,
  ],
  template: `
    <header>
      <h1>{{ 'harvest.shops.heading' | rokuT }}</h1>
      <p class="lead">{{ 'harvest.shops.lead' | rokuT }}</p>
    </header>

    <div class="filters">
      <div class="field">
        <span>{{ 'harvest.shops.chain' | rokuT }}</span>
        <lib-reference-picker
          (valueChange)="chooseChain($event)"
          [controlId]="'shops-chain'"
          [lookup]="references"
          [resource]="'supermarkets'"
          [value]="supermarketId()"
        />
      </div>

      <label class="field">
        <span>{{ 'harvest.shops.filter.status' | rokuT }}</span>
        <select
          (change)="chooseStatus($event)"
          [value]="status()"
          name="status"
        >
          <option value="">{{ 'harvest.shops.filter.any' | rokuT }}</option>
          @for (option of statuses; track option) {
            <option [value]="option">
              {{ 'harvest.shops.status.' + option | rokuT }}
            </option>
          }
        </select>
      </label>
    </div>

    @if (supermarketId() === '') {
      <p class="state">{{ 'harvest.shops.chooseChain' | rokuT }}</p>
    } @else if (failed()) {
      <lib-harvest-notice (retry)="load()" [absent]="shell.absent()" />
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      @if (rows().length === 0) {
        <p class="state">{{ 'harvest.shops.empty' | rokuT }}</p>
      } @else {
        <ul class="shops">
          @for (row of rows(); track row.id) {
            <li>
              <div class="identity">
                <code class="code">{{ row.code }}</code>
                <strong class="printed">{{ row.printedName }}</strong>
                <span [class]="'badge ' + row.status" class="badge">
                  {{ 'harvest.shops.status.' + row.status | rokuT }}
                </span>
              </div>

              <dl>
                <div>
                  <dt>{{ 'harvest.shops.field.mappedTo' | rokuT }}</dt>
                  <dd>
                    @if (row.mappedTo === '') {
                      <span class="none">{{
                        'harvest.shops.field.unmapped' | rokuT
                      }}</span>
                    } @else {
                      {{ row.mappedTo }}
                    }
                  </dd>
                </div>
                <div>
                  <dt>{{ 'harvest.shops.field.matchedBy' | rokuT }}</dt>
                  <dd>{{ 'harvest.match.' + row.matchedBy | rokuT }}</dd>
                </div>
                <div>
                  <dt>{{ 'harvest.shops.field.lastSeen' | rokuT }}</dt>
                  <dd>
                    {{ row.lastSeen }}
                    @if (row.lastRunId; as runId) {
                      <a [routerLink]="runLink(runId)" class="run">{{
                        'harvest.shops.field.run' | rokuT
                      }}</a>
                    }
                  </dd>
                </div>
              </dl>

              <div class="controls">
                @if (row.canMap) {
                  <button
                    (click)="startMapping(row)"
                    [disabled]="busyId() === row.id"
                    class="primary"
                    type="button"
                  >
                    {{ 'harvest.shops.action.map' | rokuT }}
                  </button>
                }
                @if (row.canUnmap) {
                  <button
                    (click)="unmap(row)"
                    [disabled]="busyId() === row.id"
                    type="button"
                  >
                    {{ 'harvest.shops.action.unmap' | rokuT }}
                  </button>
                }
                @if (row.canIgnore) {
                  <button
                    (click)="ignore(row)"
                    [disabled]="busyId() === row.id"
                    type="button"
                  >
                    {{ 'harvest.shops.action.ignore' | rokuT }}
                  </button>
                }
                @if (row.canUnignore) {
                  <button
                    (click)="unignore(row)"
                    [disabled]="busyId() === row.id"
                    type="button"
                  >
                    {{ 'harvest.shops.action.unignore' | rokuT }}
                  </button>
                }
              </div>

              @if (mapping()?.id === row.id) {
                <div class="picking">
                  <span>{{ 'harvest.shops.map.pick' | rokuT }}</span>
                  <lib-reference-picker
                    (valueChange)="pickLocation($event)"
                    [controlId]="'shops-location-' + row.id"
                    [lookup]="references"
                    [resource]="'locations'"
                    [scope]="locationScope()"
                    [value]="''"
                  />
                  <button (click)="cancelMapping()" type="button">
                    {{ 'resource.action.cancel' | rokuT }}
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      }
    }

    @if (confirming(); as pending) {
      <lib-confirm-dialog
        (confirm)="confirmMapping()"
        (dismiss)="cancelMapping()"
        [bodyArgs]="{ shop: pending.printedName, location: pending.title }"
        [bodyKey]="'harvest.shops.map.notBackfilled'"
        [busy]="busyId() !== null"
        [confirmKey]="'harvest.shops.map.submit'"
        [headingKey]="'harvest.shops.map.heading'"
        [tone]="'primary'"
      >
        <a [routerLink]="runsLink()" class="run">{{
          'harvest.shops.map.startRun' | rokuT
        }}</a>
      </lib-confirm-dialog>
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

    .lead,
    .state,
    .none {
      color: var(--admin-ink-muted);
    }

    .failure {
      color: var(--admin-danger);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    .field {
      display: flex;
      flex: 1 1 14rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .field > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .shops {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      list-style: none;
    }

    .shops li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .identity {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    .code {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .printed {
      font-weight: 700;
    }

    .badge {
      padding: 0.125rem var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
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

    .run {
      margin-inline-start: var(--admin-space-2);
      color: var(--admin-accent);
    }

    .controls,
    .picking {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
    }

    .picking {
      padding-block-start: var(--admin-space-3);
      border-block-start: 1px dashed var(--admin-border);
    }

    .picking > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .picking lib-reference-picker {
      flex: 1 1 16rem;
    }

    button,
    select {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
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
    select:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopsQueuePage {
  private readonly _service = inject(HARVEST_SERVICE);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  readonly statuses = STATUSES;

  /** The chain the queue is for. Empty until one is chosen. */
  readonly supermarketId = signal('');
  /** Defaulted to the queue's own reason for existing. */
  readonly status = signal<StatusFilter>('UNMAPPED');

  readonly shops = signal<readonly Shop[]>([]);
  readonly loading = signal(false);
  readonly error = signal<GatewayError | null>(null);
  /** The row a write is in flight for, so only its own controls are disabled. */
  readonly busyId = signal<string | null>(null);

  /** The row whose mapping picker is open. */
  readonly mapping = signal<Shop | null>(null);
  /** The shop of ours the operator picked, waiting to be confirmed. */
  readonly confirming = signal<PendingMapping | null>(null);

  /**
   * The names of the shops of ours that rows already point at.
   *
   * Resolved after the page loads rather than joined by the gateway: the source
   * table lives in the harvester database and holds `supermarketLocationId` as
   * an opaque uuid, so the label comes from catalog or from nowhere.
   */
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());

  readonly rows = computed(() => {
    const names = this._names();
    return this.shops().map((shop) => toShopRow(shop, names));
  });

  /**
   * What the mapping picker is over: this chain's shops, and no other's.
   *
   * `LOCATIONS` is listed under its chain, so without this the picker has no
   * collection to read at all and answers an empty page. The typed term goes in
   * beside it, through the descriptor's own `search` filter.
   */
  readonly locationScope = computed(() => ({
    supermarketId: this.supermarketId(),
  }));

  /** A read that has never answered, which is the notice rather than a banner. */
  readonly failed = computed(
    () => this.error() !== null && this.shops().length === 0
  );

  readonly errorKey = computed(() =>
    this.failed() ? null : gatewayErrorKey(this.error())
  );

  chooseChain(supermarketId: string): void {
    this.supermarketId.set(supermarketId);
    this.cancelMapping();
    this.shops.set([]);
    void this.load();
  }

  chooseStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as StatusFilter);
    this.cancelMapping();
    void this.load();
  }

  async load(): Promise<void> {
    const supermarketId = this.supermarketId();
    if (supermarketId === '') {
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const status = this.status();
      const page = await this._service.listShops({
        supermarketId,
        // Left out rather than sent empty: the route validates what it is
        // given, and `status=` is not a status.
        ...(status === '' ? {} : { status }),
        limit: 100,
      });
      this.shops.set(page.items);
      this.shell.observeReachable();
      await this._resolveNames(page.items);
    } catch (error) {
      this.error.set(toGatewayError(error));
      this.shell.observeFailure();
    } finally {
      this.loading.set(false);
    }
  }

  startMapping(row: ShopRow): void {
    const shop = this.shops().find((candidate) => candidate.id === row.id);
    this.mapping.set(shop ?? null);
    this.confirming.set(null);
  }

  cancelMapping(): void {
    this.mapping.set(null);
    this.confirming.set(null);
  }

  /**
   * A shop of ours was picked. Ask before binding it.
   *
   * The question is not "are you sure": it is the sentence backend plan 0084
   * section 7 insists on. Mapping does **not** backfill the availability the
   * run skipped, and the next run writes it. Without that line the natural
   * reading of a green `ACTIVE` badge is "the data is here now".
   */
  async pickLocation(supermarketLocationId: string): Promise<void> {
    const shop = this.mapping();
    if (shop === null || supermarketLocationId === '') {
      return;
    }

    const option = await this.references.resolve(
      'locations',
      supermarketLocationId
    );

    this.confirming.set({
      shopId: shop.id,
      printedName: shop.printedName,
      supermarketLocationId,
      // The id, when the lookup answered nothing. A blank in the sentence would
      // ask the operator to confirm binding a shop to nothing in particular.
      title: option?.title ?? supermarketLocationId,
    });
  }

  async confirmMapping(): Promise<void> {
    const pending = this.confirming();
    if (pending === null) {
      return;
    }

    this._names.update((names) =>
      new Map(names).set(pending.supermarketLocationId, pending.title)
    );

    await this._decide(pending.shopId, () =>
      this._service.mapShop(pending.shopId, {
        supermarketLocationId: pending.supermarketLocationId,
      })
    );

    this.cancelMapping();
  }

  unmap(row: ShopRow): Promise<void> {
    return this._decide(row.id, () => this._service.unmapShop(row.id));
  }

  ignore(row: ShopRow): Promise<void> {
    return this._decide(row.id, () => this._service.ignoreShop(row.id));
  }

  unignore(row: ShopRow): Promise<void> {
    return this._decide(row.id, () => this._service.unignoreShop(row.id));
  }

  /**
   * Where a row's last run is read, and where a run is started.
   *
   * Absolute rather than relative to this screen. `..` reads better and is what
   * the run screen's own back link uses, but it needs a route above it to pop,
   * and it throws outright when there is none. This component is rendered
   * directly in its spec, where there is none.
   */
  runLink(runId: string): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'runs', runId];
  }

  runsLink(): readonly string[] {
    return ['/', HARVEST_SEGMENT, 'runs'];
  }

  /**
   * Run one decision and put the answer back in the list.
   *
   * A row the filter no longer matches **leaves**, which is what makes this a
   * queue rather than a table: ignoring a bakery on the default filter is the
   * last time anybody sees it. A row that still matches is replaced in place, so
   * an operator working down a chain does not lose their position on every
   * decision.
   *
   * A failure leaves the row exactly as it was. A control that flipped and then
   * silently flipped back would be worse than one that did not move.
   */
  private async _decide(
    id: string,
    decide: () => Promise<Shop>
  ): Promise<void> {
    this.busyId.set(id);
    this.error.set(null);

    try {
      const updated = await decide();
      const status = this.status();
      this.shops.update((rows) =>
        status !== '' && updated.status !== status
          ? rows.filter((row) => row.id !== id)
          : rows.map((row) => (row.id === id ? updated : row))
      );
    } catch (error) {
      this.error.set(toGatewayError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  /**
   * The labels of the shops of ours that these rows point at.
   *
   * One lookup per distinct id, and a lookup that answers nothing leaves the id
   * showing. `resolve` never throws: a reference can outlive what it points at,
   * and that is a state to draw rather than a failure to report.
   */
  private async _resolveNames(shops: readonly Shop[]): Promise<void> {
    const ids = [
      ...new Set(
        shops
          .map((shop) => shop.supermarketLocationId)
          .filter((id): id is string => id !== null)
      ),
    ];

    const found = await Promise.all(
      ids.map(
        async (id) =>
          [id, await this.references.resolve('locations', id)] as const
      )
    );

    const names = new Map<string, string>();
    for (const [id, option] of found) {
      if (option !== null) {
        names.set(id, option.title);
      }
    }
    this._names.set(names);
  }
}

/** A mapping the operator picked and has not yet gone through with. */
interface PendingMapping {
  readonly shopId: string;
  readonly printedName: string;
  readonly supermarketLocationId: string;
  /** The shop of ours, by name, for the sentence in the dialog. */
  readonly title: string;
}
