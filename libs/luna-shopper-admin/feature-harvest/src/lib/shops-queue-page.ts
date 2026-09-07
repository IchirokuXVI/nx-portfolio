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
  QueueStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
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
  runQueueBulk,
  type PendingBulk,
  type QueueBulkAct,
} from './queue-bulk';
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
 * for them (admin plan 0011; plan 0020; backend plan 0084, section 6).
 *
 * The fourth review queue, beside places and entries. It is a bespoke screen
 * rather than a descriptor for the reason `0011` section 1 gives: a row here is
 * a decision with three outcomes, one of which binds a foreign record, and none
 * of which is "edit this row's fields". A descriptor list with an edit form over
 * `externalId` and `printedName` would offer the operator the two columns nobody
 * is allowed to change, because they are the source's and not ours.
 *
 * **The chain is required and comes first.** `source_locations` is unique on
 * (`supermarketId`, `externalId`) and a mapping only means anything inside one
 * chain, so there is no route that answers "every source's shops". The screen is
 * a prompt until a chain is chosen, the same way the entries queue opens on a
 * chooser.
 *
 * **`matchedBy` is a column and not a detail.** A row the automatic exact name
 * match bound and a row a person bound look identical otherwise, and they carry
 * different confidence. An operator reviewing a chain's mappings needs to see
 * which ones nobody checked.
 *
 * **It reads through `QueueStore`, and that is what fixes the paging** (plan
 * 0020, section 1.1). This screen used to hold its own rows and read one page of
 * a hundred, never looking at `nextCursor`, so a chain with more than a hundred
 * source locations showed a hundred of them with nothing on the screen saying
 * so. Moving onto the store fixes that as a side effect of getting the selection
 * and the bulk runner. It opens in the list view, which is the view it has
 * always had, and the review view is the new one.
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
    QueueFrame,
    ReferencePicker,
  ],
  template: `
    <p class="lead">{{ 'harvest.shops.lead' | rokuT }}</p>

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

    @if (queue === null) {
      <p class="state">{{ 'harvest.shops.chooseChain' | rokuT }}</p>
    } @else {
      <lib-queue-frame
        (clearSelection)="queue.clearSelection()"
        (confirm)="primary()"
        (loadMore)="queue.loadMore()"
        (openRow)="queue.focus($event)"
        (pickRow)="queue.toggle($event)"
        (reject)="rejectCurrent()"
        (selectAll)="queue.selectLoaded()"
        (skip)="queue.skip()"
        (stop)="queue.stopBulk()"
        [busy]="queue.busy()"
        [canLoadMore]="queue.canLoadMore()"
        [confirmKey]="confirmKey()"
        [decided]="queue.decided()"
        [empty]="queue.empty()"
        [errorKey]="errorKey()"
        [failed]="failed()"
        [loading]="loading()"
        [loadingMore]="queue.loadingMore()"
        [progress]="queue.bulk()"
        [progressKey]="progressKey()"
        [rejectKey]="rejectKey()"
        [remaining]="rows().length"
        [report]="report()"
        [rows]="rows()"
        [selected]="queue.selected()"
        [selectedCount]="queue.selectedCount()"
        defaultView="list"
        emptyKey="harvest.shops.empty"
        titleKey="harvest.shops.heading"
      >
        <lib-harvest-notice
          (retry)="load()"
          [absent]="shell.absent()"
          queueFailure
        />

        @if (current(); as row) {
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

          @if (row.canUnmap) {
            <button
              (click)="ignore(row)"
              [disabled]="queue.busy()"
              class="secondary"
              type="button"
            >
              {{ 'harvest.shops.action.ignore' | rokuT }}
            </button>
          }

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
        }

        <!-- Section 2 keeps the columns this screen already had, the match
             rule among them, because a row the automatic match bound and a row
             a person bound differ in nothing else. -->
        <ng-template #queueRow let-row>
          <code class="code">{{ row.code }}</code>
          <strong class="printed">{{ row.printedName }}</strong>
          <span [class]="'badge ' + row.status" class="badge">
            {{ 'harvest.shops.status.' + row.status | rokuT }}
          </span>
          @if (row.mappedTo === '') {
            <span class="none">{{
              'harvest.shops.field.unmapped' | rokuT
            }}</span>
          } @else {
            <span>{{ row.mappedTo }}</span>
          }
          <span class="none">{{
            'harvest.match.' + row.matchedBy | rokuT
          }}</span>
          <span class="none">{{ row.lastSeen }}</span>
        </ng-template>

        <div class="bulk" queueBulk>
          <button
            (click)="askIgnore()"
            [disabled]="ignorable().length === 0"
            type="button"
          >
            {{ 'harvest.shops.action.ignore' | rokuT }}
          </button>
          <button
            (click)="askUnignore()"
            [disabled]="unignorable().length === 0"
            type="button"
          >
            {{ 'harvest.shops.action.unignore' | rokuT }}
          </button>
          <button
            (click)="askUnmap()"
            [disabled]="unmappable().length === 0"
            type="button"
          >
            {{ 'harvest.shops.action.unmap' | rokuT }}
          </button>
        </div>
      </lib-queue-frame>
    }

    @if (confirming(); as pending) {
      <lib-confirm-dialog
        (confirm)="confirmMapping()"
        (dismiss)="cancelMapping()"
        [bodyArgs]="{ shop: pending.printedName, location: pending.title }"
        [bodyKey]="'harvest.shops.map.notBackfilled'"
        [busy]="queue !== null && queue.busy()"
        [confirmKey]="'harvest.shops.map.submit'"
        [headingKey]="'harvest.shops.map.heading'"
        [tone]="'primary'"
      >
        <a [routerLink]="runsLink()" class="run">{{
          'harvest.shops.map.startRun' | rokuT
        }}</a>
      </lib-confirm-dialog>
    }

    @if (pending(); as bulk) {
      <lib-confirm-dialog
        (confirm)="go(bulk)"
        (dismiss)="pending.set(null)"
        [bodyArgs]="{ count: bulk.count, leftAlone: bulk.leftAlone }"
        [bodyKey]="bulk.bodyKey"
        [busy]="queue !== null && queue.busy()"
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
      gap: var(--admin-space-4);
    }

    .lead,
    .state,
    .none {
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
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

    .identity {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
      margin-block-end: var(--admin-space-3);
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
      margin-block-end: var(--admin-space-3);
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

    .picking {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: flex-end;
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

    .bulk {
      display: flex;
      flex: 3;
      gap: var(--admin-space-3);
    }

    .bulk button {
      flex: 1;
      min-block-size: 3rem;
      font-size: 1rem;
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

  private readonly _queue = signal<QueueStore<Shop> | null>(null);

  /**
   * Built when a chain is chosen, because the read needs one to exist.
   *
   * Behind a signal, and read through a getter so callers write `queue`. A
   * change of filter builds a **new** store, and a computed that had read the
   * old one's signals would never hear about it: it would be frozen on the rows
   * of the chain the operator has just navigated away from.
   */
  get queue(): QueueStore<Shop> | null {
    return this._queue();
  }

  /** The row whose mapping picker is open. */
  readonly mapping = signal<Shop | null>(null);
  /** The shop of ours the operator picked, waiting to be confirmed. */
  readonly confirming = signal<PendingMapping | null>(null);

  /** The bulk action waiting for an answer, or null when none is. */
  readonly pending = signal<PendingBulk | null>(null);
  /** What the last bulk run did, by name. Cleared when another one starts. */
  readonly report = signal<QueueReport | null>(null);
  readonly progressKey = signal('harvest.queue.bulk.progress');

  /**
   * The names of the shops of ours that rows already point at.
   *
   * Resolved as each page arrives rather than joined by the gateway: the source
   * table lives in the harvester database and holds `supermarketLocationId` as
   * an opaque uuid, so the label comes from catalog or from nowhere. Merged
   * rather than replaced, because the store keeps every page it has read and a
   * later page must not blank the names of the earlier ones.
   */
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());

  readonly rows = computed<readonly ShopRow[]>(() => {
    const names = this._names();
    return (this.queue?.items() ?? []).map((shop) => toShopRow(shop, names));
  });

  /** The row the review view is about, which is the head of the queue. */
  readonly current = computed<ShopRow | null>(() => this.rows()[0] ?? null);

  readonly loading = computed(() => this.queue?.loading() ?? false);
  readonly failed = computed(() => this.queue?.failed() ?? false);

  readonly errorKey = computed(() =>
    this.failed() ? null : gatewayErrorKey(this.queue?.error() ?? null)
  );

  /**
   * What the review view's primary button says, which is what it does.
   *
   * One row, one primary decision. An `UNMAPPED` row is mapped, an `ACTIVE` row
   * is unmapped, an `IGNORED` row is put back. Ignoring is the "no" beside it,
   * on the rows that have one.
   */
  readonly confirmKey = computed(() => {
    const row = this.current();
    if (row === null || row.canMap) {
      return 'harvest.shops.action.map';
    }
    return row.canUnmap
      ? 'harvest.shops.action.unmap'
      : 'harvest.shops.action.unignore';
  });

  readonly rejectKey = computed(() =>
    this.current()?.canIgnore === true ? 'harvest.shops.action.ignore' : null
  );

  /** The selected rows each bulk action can actually be applied to. */
  readonly ignorable = computed(() => this._selected(canIgnore));
  readonly unignorable = computed(() => this._selected(canUnignore));
  readonly unmappable = computed(() => this._selected(canUnmap));

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

  chooseChain(supermarketId: string): void {
    this.supermarketId.set(supermarketId);
    this.cancelMapping();
    void this.load();
  }

  chooseStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as StatusFilter);
    this.cancelMapping();
    void this.load();
  }

  /**
   * Read the chosen chain again, from the top.
   *
   * The status is the server's filter, so changing it is a fresh read rather
   * than a filter applied to what is in hand: the queue holds the pages it has
   * fetched, and filtering those would answer from a fraction of the rows.
   */
  async load(): Promise<void> {
    const supermarketId = this.supermarketId();
    if (supermarketId === '') {
      return;
    }

    this.report.set(null);
    const queue = new QueueStore<Shop>(
      async (cursor) => {
        try {
          const status = this.status();
          const page = await this._service.listShops({
            supermarketId,
            // Left out rather than sent empty: the route validates what it is
            // given, and `status=` is not a status.
            ...(status === '' ? {} : { status }),
            cursor,
          });
          this.shell.observeReachable();
          // Named here rather than after the first read, so a page the store
          // fetched by itself is labelled too.
          await this._resolveNames(page.items);
          return page;
        } catch (error) {
          this.shell.observeFailure();
          throw error;
        }
      },
      (shop) => shop.id
    );

    this._queue.set(queue);
    await queue.load();
  }

  /** The review view's primary act, which is whatever this row's is. */
  primary(): void {
    const row = this.current();
    if (row === null) {
      return;
    }

    if (row.canMap) {
      this.startMapping(row);
      return;
    }
    void (row.canUnmap ? this.unmap(row) : this.unignore(row));
  }

  /** The review view's "no", which exists only on a row that has one. */
  rejectCurrent(): void {
    const row = this.current();
    if (row !== null && row.canIgnore) {
      void this.ignore(row);
    }
  }

  startMapping(row: ShopRow): void {
    const shop = (this.queue?.items() ?? []).find(
      (candidate) => candidate.id === row.id
    );
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

  askIgnore(): void {
    this._ask({
      headingKey: 'harvest.shops.bulk.ignoreConfirm.heading',
      bodyKey: 'harvest.shops.bulk.ignoreConfirm.body',
      confirmKey: 'harvest.shops.action.ignore',
      progressKey: 'harvest.shops.bulk.ignoring',
      count: this.ignorable().length,
      tone: 'danger',
      act: (shop) => this._service.ignoreShop(shop.id),
      applies: canIgnore,
    });
  }

  askUnignore(): void {
    this._ask({
      headingKey: 'harvest.shops.bulk.unignoreConfirm.heading',
      bodyKey: 'harvest.shops.bulk.unignoreConfirm.body',
      confirmKey: 'harvest.shops.action.unignore',
      progressKey: 'harvest.shops.bulk.unignoring',
      count: this.unignorable().length,
      tone: 'primary',
      act: (shop) => this._service.unignoreShop(shop.id),
      applies: canUnignore,
    });
  }

  askUnmap(): void {
    this._ask({
      headingKey: 'harvest.shops.bulk.unmapConfirm.heading',
      bodyKey: 'harvest.shops.bulk.unmapConfirm.body',
      confirmKey: 'harvest.shops.action.unmap',
      progressKey: 'harvest.shops.bulk.unmapping',
      count: this.unmappable().length,
      tone: 'danger',
      act: (shop) => this._service.unmapShop(shop.id),
      applies: canUnmap,
    });
  }

  /** Go through with the confirmed bulk action. */
  go(bulk: PendingBulk): void {
    this.pending.set(null);
    this.progressKey.set(bulk.progressKey);
    void bulk.run();
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

  private _ask(asked: {
    headingKey: string;
    bodyKey: string;
    confirmKey: string;
    progressKey: string;
    count: number;
    tone: 'danger' | 'primary';
    act: (shop: Shop) => Promise<Shop>;
    applies: (shop: Shop) => boolean;
  }): void {
    const selected = this.queue?.selectedCount() ?? 0;
    this.pending.set({
      headingKey: asked.headingKey,
      bodyKey: asked.bodyKey,
      confirmKey: asked.confirmKey,
      progressKey: asked.progressKey,
      count: asked.count,
      leftAlone: selected - asked.count,
      tone: asked.tone,
      run: () =>
        this._run({
          act: async (shop) => this._settled(await asked.act(shop)),
          applies: asked.applies,
          nameOf: (shop) => shop.printedName,
        }),
    });
  }

  private async _run(bulk: QueueBulkAct<Shop>): Promise<void> {
    const queue = this.queue;
    if (queue === null) {
      return;
    }

    this.report.set(null);
    this.report.set(await runQueueBulk(queue, bulk));
    this.progressKey.set('harvest.queue.bulk.progress');
  }

  /**
   * Run one decision and put the answer back in the queue.
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
    await this.queue?.decideAt(id, async () => this._settled(await decide()));
  }

  /** The decided row, or null when the filter no longer describes it. */
  private _settled(shop: Shop): Shop | null {
    const status = this.status();
    return status === '' || shop.status === status ? shop : null;
  }

  private _selected(applies: (shop: Shop) => boolean): readonly Shop[] {
    const selected = this.queue?.selected() ?? new Set<string>();
    return (this.queue?.items() ?? []).filter(
      (shop) => selected.has(shop.id) && applies(shop)
    );
  }

  /**
   * The labels of the shops of ours that these rows point at.
   *
   * One lookup per distinct id this page has not already named, and a lookup
   * that answers nothing leaves the id showing. `resolve` never throws: a
   * reference can outlive what it points at, and that is a state to draw rather
   * than a failure to report.
   */
  private async _resolveNames(shops: readonly Shop[]): Promise<void> {
    const known = this._names();
    const ids = [
      ...new Set(
        shops
          .map((shop) => shop.supermarketLocationId)
          .filter((id): id is string => id !== null && !known.has(id))
      ),
    ];

    if (ids.length === 0) {
      return;
    }

    const found = await Promise.all(
      ids.map(
        async (id) =>
          [id, await this.references.resolve('locations', id)] as const
      )
    );

    this._names.update((names) => {
      const next = new Map(names);
      for (const [id, option] of found) {
        if (option !== null) {
          next.set(id, option.title);
        }
      }
      return next;
    });
  }
}

/** A row that is not already ignored, which is what ignoring one needs. */
function canIgnore(shop: Shop): boolean {
  return shop.status !== 'IGNORED';
}

function canUnignore(shop: Shop): boolean {
  return shop.status === 'IGNORED';
}

/** Only an `ACTIVE` row points at anything, so only one can be unmapped. */
function canUnmap(shop: Shop): boolean {
  return shop.status === 'ACTIVE';
}

/** A mapping the operator picked and has not yet gone through with. */
interface PendingMapping {
  readonly shopId: string;
  readonly printedName: string;
  readonly supermarketLocationId: string;
  /** The shop of ours, by name, for the sentence in the dialog. */
  readonly title: string;
}
