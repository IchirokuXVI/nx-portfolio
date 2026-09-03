import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { ResourceListStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  fieldOf,
  toRowView,
  type FieldDescriptor,
  type NamedAction,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  ResourceList,
  Viewport,
  type RowAction,
} from '@portfolio/luna-shopper-admin/ui';
import { gatewayErrorKey } from './gateway-error-key';
import { RESOURCE_DESCRIPTOR } from './resource-route-data';

/**
 * The list screen, for every resource (plan 0004, section 3).
 *
 * One component and one route factory, so the second entity costs a descriptor
 * and no code at all. What lives here rather than in `ResourceList` is
 * everything that is not drawing: reading the descriptor off the route,
 * building its gateway, holding the store, turning rows into formatted cells,
 * and navigating.
 *
 * The formatting is done here, in a `computed`, for the reason velista formats
 * dates in its selectors: the template gets strings, and the function that made
 * them has a spec of its own.
 */
@Component({
  selector: 'lib-resource-list-page',
  imports: [ResourceList, ConfirmDialog],
  template: `
    <lib-resource-list
      (act)="run($event)"
      (clear)="store.clear()"
      (create)="create()"
      (filterChange)="store.setFilter($event.param, $event.value)"
      (more)="store.loadMore()"
      (open)="open($event)"
      (orderChange)="store.setOrder($event)"
      (remove)="askToDelete($event)"
      (retry)="store.load()"
      [busyRowId]="busyRowId()"
      [canCreate]="canCreate()"
      [canDelete]="canDelete()"
      [columns]="columns()"
      [compact]="compact()"
      [compactColumns]="compactColumns()"
      [empty]="store.empty()"
      [errorKey]="errorKey()"
      [failed]="failed()"
      [filters]="descriptor.filters ?? []"
      [filterValues]="store.filters()"
      [hasMore]="store.hasMore()"
      [loading]="store.status() === 'loading'"
      [loadingMore]="store.loadingMore()"
      [moreFailed]="moreFailed()"
      [namedActions]="namedActions()"
      [noMatch]="store.noMatch()"
      [order]="store.order()"
      [rows]="rows()"
      [sorts]="descriptor.sorts ?? []"
      [titleKey]="descriptor.labels.many"
    />

    @if (deleting(); as row) {
      <lib-confirm-dialog
        (confirm)="confirmDelete()"
        (dismiss)="deleting.set(null)"
        [bodyArgs]="{ name: row.title }"
        [busy]="busyRowId() !== null"
        bodyKey="resource.confirm.delete.body"
        confirmKey="resource.confirm.delete.confirm"
        headingKey="resource.confirm.delete.heading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceListPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _viewport = inject(Viewport);
  private readonly _translator = inject(RokuTranslatorService);

  /**
   * The resource this screen is for, from route `data`.
   *
   * Stated on the route rather than resolved from a token, because a route's
   * own `providers` injector is not reliably the one a component resolves
   * against, and because a descriptor on the route is a fact a spec can supply
   * with `provideRouter` and nothing else.
   */
  readonly descriptor = this._route.snapshot.data[RESOURCE_DESCRIPTOR];

  /**
   * The gateway, built here because this is an injection context.
   *
   * A field initializer runs during construction, which is where `inject` works.
   * It has to come after `descriptor`, and does.
   */
  readonly store = new ResourceListStore<ResourceRow>(
    this.descriptor,
    this.descriptor.gateway()
  );

  readonly compact = this._viewport.compact;

  /** The row awaiting a yes, or `null`. */
  readonly deleting = signal<ReturnType<typeof this.rows>[number] | null>(null);

  /** The row something is happening to. */
  readonly busyRowId = signal<string | null>(null);

  readonly columns = computed(() => this._fields(this.descriptor.list.columns));

  readonly compactColumns = computed(() =>
    this._fields(this.descriptor.list.compact)
  );

  readonly rows = computed(() => {
    const options = {
      locale: this._translator.locale(),
      contentLocales: CONTENT_LOCALES,
    };
    return this.store
      .rows()
      .map((row) => toRowView(this.descriptor, row, options));
  });

  /** The whole screen failed, with nothing else to draw. */
  readonly failed = computed(() => this.store.status() === 'error');

  /** A failure with rows already on screen: a line under them, not a takeover. */
  readonly moreFailed = computed(
    () => this.store.error() !== null && !this.failed()
  );

  readonly errorKey = computed(() => gatewayErrorKey(this.store.error()));

  readonly canCreate = computed(() => this.descriptor.actions?.create === true);

  readonly canDelete = computed(() => this.descriptor.actions?.delete === true);

  readonly namedActions = computed<readonly NamedAction<ResourceRow>[]>(
    () => this.descriptor.actions?.named ?? []
  );

  constructor() {
    void this.store.load();
  }

  open(id: string): void {
    void this._router.navigate([id], { relativeTo: this._route });
  }

  create(): void {
    void this._router.navigate(['new'], { relativeTo: this._route });
  }

  askToDelete(id: string): void {
    this.deleting.set(this.rows().find((row) => row.id === id) ?? null);
  }

  async confirmDelete(): Promise<void> {
    const row = this.deleting();
    if (row === null) {
      return;
    }

    this.busyRowId.set(row.id);
    await this.store.remove(row.id);
    this.busyRowId.set(null);
    this.deleting.set(null);
  }

  /**
   * A named action, run and then followed by a fresh read.
   *
   * Reading the list again rather than guessing what the action did. An action
   * this component knows nothing about can change any column of any row, and a
   * screen that assumed otherwise would be showing something that is not there.
   */
  async run(event: RowAction): Promise<void> {
    this.busyRowId.set(event.row.id);
    try {
      await event.action.run(event.row.row);
    } finally {
      this.busyRowId.set(null);
    }
    await this.store.load();
  }

  private _fields(names: readonly string[]): readonly FieldDescriptor[] {
    return names
      .map((name) => fieldOf(this.descriptor, name))
      .filter((field): field is FieldDescriptor => field !== undefined);
  }
}
