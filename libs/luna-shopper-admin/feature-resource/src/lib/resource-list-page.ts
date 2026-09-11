import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  ResourceListStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  fieldOf,
  hasDetailScreen,
  toRowView,
  type ActionConfirmation,
  type FieldDescriptor,
  type FilterDescriptor,
  type NamedAction,
  type ReferenceField,
  type ResourceCell,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  ResourceList,
  Viewport,
  type RowAction,
} from '@portfolio/luna-shopper-admin/ui';
import { gatewayErrorKey } from './gateway-error-key';
import { ResourceReferences, ResourceRegistry } from './resource-registry';
import { RESOURCE_DESCRIPTOR } from './resource-route-data';

/** A named action waiting on an answer, and what it would be done to. */
interface PendingAction extends RowAction {
  readonly confirm: ActionConfirmation;
}

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
      [blockedBy]="blockedBy()"
      [busyRowId]="busyRowId()"
      [canCreate]="canCreate()"
      [canDelete]="canDelete()"
      [canOpen]="canOpen()"
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
      [lookup]="references"
      [moreFailed]="moreFailed()"
      [namedActions]="namedActions"
      [noMatch]="store.noMatch()"
      [noteKey]="descriptor.note ?? null"
      [noticeKeys]="notices()"
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

    @if (asking(); as pending) {
      <lib-confirm-dialog
        (confirm)="confirmAction()"
        (dismiss)="asking.set(null)"
        [bodyArgs]="{ name: pending.row.title }"
        [bodyKey]="pending.confirm.body"
        [busy]="busyRowId() !== null"
        [confirmKey]="pending.confirm.confirm"
        [headingKey]="pending.confirm.heading"
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
  private readonly _content = inject(ContentLocaleStore);

  /** How a reference filter finds the resource it points at. */
  readonly references = inject(ResourceReferences);

  /** Where a reference cell's target lives, for the link it draws. */
  private readonly _registry = inject(ResourceRegistry);

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

  /** The named action awaiting a yes, with the row it would act on. */
  readonly asking = signal<PendingAction | null>(null);

  /** The row something is happening to. */
  readonly busyRowId = signal<string | null>(null);

  readonly columns = computed(() => this._fields(this.descriptor.list.columns));

  readonly compactColumns = computed(() =>
    this._fields(this.descriptor.list.compact)
  );

  /**
   * The names the lookup has answered, by `resource:id` (admin plan 0023,
   * section 4.2).
   *
   * A resolve that answered `null` records the id itself, so a dangling
   * reference stays an id on screen and is never asked about twice. Until an
   * answer lands the cell shows the id, not a spinner: the id is true, arrives
   * with the row, and keeps the table from reflowing twice per page.
   */
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());

  /** Every key already sent to the lookup, answered or still in flight. */
  private readonly _asked = new Set<string>();

  /**
   * The language the rows on screen were read in.
   *
   * Seeded with the language the page opened in, so the effect watching the
   * setting does nothing on its first run and the constructor's own `load()`
   * stands. Without it every list would fetch its first page twice.
   */
  private _readIn = this._content.locale();

  readonly rows = computed(() => {
    const options = {
      locale: this._translator.locale(),
      contentLocales: this._content.order(),
    };
    const names = this._names();
    return this.store.rows().map((row) => {
      const view = toRowView(this.descriptor, row, options);
      return { ...view, cells: this._decorate(view.cells, names) };
    });
  });

  /** The whole screen failed, with nothing else to draw. */
  readonly failed = computed(() => this.store.status() === 'error');

  /** A failure with rows already on screen: a line under them, not a takeover. */
  readonly moreFailed = computed(
    () => this.store.error() !== null && !this.failed()
  );

  // The list draws this only behind `failed()` or `moreFailed()`, so there is
  // always an error by then. The fallback is for the type, not for a state.
  readonly errorKey = computed(
    () => gatewayErrorKey(this.store.error()) ?? 'resource.error.unknown'
  );

  /**
   * The filters this list is waiting for, named in words, or `null`.
   *
   * Translated here rather than in the template. The sentence is one key for
   * every resource, so the filters' own labels have to arrive as a string: a
   * pipe cannot resolve a key that is itself the argument of another key.
   */
  readonly blockedBy = computed(() => {
    const missing = this.store.missingFilters();
    if (missing.length === 0) {
      return null;
    }

    const filters: readonly FilterDescriptor[] = this.descriptor.filters ?? [];
    return missing
      .map((param) => {
        const filter = filters.find((entry) => entry.param === param);
        return this._translator.t(filter?.label ?? param);
      })
      .join(', ');
  });

  readonly canCreate = computed(() => this.descriptor.actions?.create === true);

  readonly canDelete = computed(() => this.descriptor.actions?.delete === true);

  /**
   * The resource's named actions, built once in this injection context.
   *
   * A field rather than a `computed`, because the factory calls `inject` and a
   * computed body runs whenever something it read has changed, long after the
   * constructor. The set of actions never changes anyway; only whether a given
   * row is allowed one does, and that is `available` on each of them.
   */
  readonly namedActions: readonly NamedAction<ResourceRow>[] =
    this.descriptor.actions?.named?.() ?? [];

  /**
   * What this resource has to say about itself right now.
   *
   * A field for the reason {@link namedActions} is one: the factory calls
   * `inject`, so it runs here and not inside a `computed` body. What it answers
   * is itself a signal, so the sentences still follow whatever the resource is
   * watching.
   */
  readonly notices: Signal<readonly string[]> =
    this.descriptor.notices?.() ?? signal([]);

  /** Whether a row leads to a detail screen. The route factory agrees, by construction. */
  readonly canOpen = computed(() => hasDetailScreen(this.descriptor));

  constructor() {
    void this.store.load();

    // The lookup names, filled as rows arrive (admin plan 0023, section 4.2).
    // Loading more rows resolves only the ids the set has not seen. `untracked`,
    // because the resolution writes the signal the rows computed reads.
    effect(() => {
      const rows = this.store.rows();
      untracked(() => void this._resolveNames(rows));
    });

    // A switch of the content language invalidates the page rather than only
    // its render (admin plan 0026, section 6). Once backend plan `0111` lands,
    // a listing is ordered and its cursor is cut in the caller's language, so
    // the rows on screen were chosen under the old one: redrawing them under
    // the new one reorders nothing and continues from a cursor cut elsewhere.
    // Reading the first page again is the only honest answer, and it is correct
    // today as well as necessary afterwards.
    effect(() => {
      const locale = this._content.locale();
      untracked(() => this._readAgainIn(locale));
    });
  }

  /**
   * Read the list again in a language it was not read in.
   *
   * The resolved reference names go with the rows, because they are titles this
   * page asked the lookup for in the old language and `_asked` would otherwise
   * stop it ever asking again. Everything the operator narrowed by stays: a
   * filter and an order are choices about which rows, and the language is a
   * choice about how to read them.
   */
  private _readAgainIn(locale: string): void {
    if (locale === this._readIn) {
      return;
    }

    this._readIn = locale;
    this._names.set(new Map());
    this._asked.clear();
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
    const confirm = event.action.confirm;
    if (confirm !== undefined) {
      this.asking.set({ ...event, confirm });
      return;
    }
    await this._run(event);
  }

  /** The operator said yes to a named action. */
  async confirmAction(): Promise<void> {
    const pending = this.asking();
    if (pending === null) {
      return;
    }

    await this._run(pending);
    this.asking.set(null);
  }

  private async _run(event: RowAction): Promise<void> {
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

  /**
   * A row's cells, with what only this page knows laid over them (admin plan
   * 0023, section 2).
   *
   * `toCell` is pure and synchronous, so the two things that are neither
   * happen here: the link, which needs the registry, and the looked up name,
   * which needs a request. Cells without a reference pass through untouched.
   */
  private _decorate(
    cells: Readonly<Record<string, ResourceCell>>,
    names: ReadonlyMap<string, string>
  ): Readonly<Record<string, ResourceCell>> {
    const next: Record<string, ResourceCell> = {};
    for (const [name, cell] of Object.entries(cells)) {
      next[name] = this._decorateCell(name, cell, names);
    }
    return next;
  }

  private _decorateCell(
    name: string,
    cell: ResourceCell,
    names: ReadonlyMap<string, string>
  ): ResourceCell {
    const reference = cell.reference;
    if (reference === undefined) {
      return cell;
    }

    let decorated = cell;

    const field = fieldOf(this.descriptor, name);
    if (field?.kind === 'reference' && field.nameLookup === true) {
      const known = names.get(`${reference.resource}:${reference.id}`);
      if (known !== undefined && known !== decorated.text) {
        decorated = { ...decorated, text: known };
      }
    }

    const link = this._linkTo(reference);
    if (link !== null) {
      decorated = { ...decorated, link };
    }

    return decorated;
  }

  /**
   * Where a reference leads, asked of the registry and never typed (admin plan
   * 0023, section 2.2): the target descriptor's registered location decides the
   * URL, so a section move carries every cell link with it.
   *
   * A target with no detail screen gets no link, by the same test the row's
   * own click uses: a name without a link is still an answer, and a link to a
   * 404 is not.
   */
  private _linkTo(reference: {
    readonly resource: string;
    readonly id: string;
  }): readonly string[] | null {
    const target = this._registry.byName(reference.resource);
    if (target === undefined || !hasDetailScreen(target)) {
      return null;
    }

    const path = this._registry.pathOf(reference.resource);
    return path === null ? null : [...path, reference.id];
  }

  /**
   * One resolve per distinct id the descriptor asked to look up (admin plan
   * 0023, section 4.2). The set is marked before the request goes out, so a
   * page loaded while one is in flight does not ask about the same id again.
   */
  private async _resolveNames(rows: readonly ResourceRow[]): Promise<void> {
    const fields = this.descriptor.fields.filter(
      (field: FieldDescriptor): field is ReferenceField<ResourceRow> =>
        field.kind === 'reference' && field.nameLookup === true
    );
    if (fields.length === 0) {
      return;
    }

    const wanted: { resource: string; id: string; key: string }[] = [];
    for (const field of fields) {
      for (const row of rows) {
        const id = row[field.name];
        if (typeof id !== 'string' || id === '') {
          continue;
        }
        const key = `${field.resource}:${id}`;
        if (!this._asked.has(key)) {
          this._asked.add(key);
          wanted.push({ resource: field.resource, id, key });
        }
      }
    }
    if (wanted.length === 0) {
      return;
    }

    const resolved = await Promise.all(
      wanted.map(async (entry) => {
        const option = await this.references.resolve(entry.resource, entry.id);
        // Null records the id itself as the name: a dangling reference stays
        // an id on screen and is never asked about twice.
        return [entry.key, option?.title ?? entry.id] as const;
      })
    );

    this._names.update((names) => {
      const next = new Map(names);
      for (const [key, title] of resolved) {
        next.set(key, title);
      }
      return next;
    });
  }
}
