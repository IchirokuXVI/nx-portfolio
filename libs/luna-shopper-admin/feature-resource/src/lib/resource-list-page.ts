import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
} from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  ResourceListStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  fieldOf,
  hasDetailScreen,
  toCell,
  toRowView,
  type ActionConfirmation,
  type BriefPresentation,
  type BulkAction,
  type BulkPanelInputs,
  type ErrorLinkTarget,
  type FieldDescriptor,
  type FilterDescriptor,
  type NamedAction,
  type ReferenceField,
  type ReferencesField,
  type ResourceCell,
  type ResourceRow,
  type RowBrief,
  type RowState,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  ResourceList,
  Viewport,
  type ReferenceLookup,
  type RowAction,
} from '@portfolio/luna-shopper-admin/ui';
import { gatewayErrorKey } from './gateway-error-key';
import { ResourceChanges } from './resource-changes';
import {
  parentsFromRoute,
  ResourceReferences,
  ResourceRegistry,
} from './resource-registry';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_LIST_EMBED,
  SPLIT_UNDER_HEADER,
  type ResourceListEmbed,
} from './resource-route-data';

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
  imports: [
    ResourceList,
    ConfirmDialog,
    NgComponentOutlet,
    RokuTranslatorPipe,
    RouterLink,
  ],
  template: `
    <lib-resource-list
      (act)="run($event)"
      (clear)="store.clear()"
      (create)="create()"
      (filterChange)="store.setFilter($event.param, $event.value)"
      (more)="store.loadMore()"
      (open)="open($event)"
      (orderChange)="store.setOrder($event)"
      (pick)="pick($event)"
      (remove)="askToDelete($event)"
      (retry)="store.load()"
      [busyRowId]="busyRowId()"
      [canCreate]="canCreate()"
      [canDelete]="canDelete()"
      [canOpen]="canOpen()"
      [columns]="columns()"
      [compact]="compact()"
      [compactColumns]="compactColumns()"
      [createKey]="descriptor.labels.create ?? 'resource.action.create'"
      [currentId]="openId()"
      [empty]="store.empty()"
      [errorKey]="errorKey()"
      [failed]="failed()"
      [filters]="filters"
      [filterScope]="embed === null ? '' : descriptor.name"
      [filterValues]="store.filters()"
      [hasMore]="store.hasMore()"
      [heading]="heading()"
      [headingLevel]="openId() === null ? 1 : 2"
      [info]="descriptor.info ?? null"
      [layout]="embed === 'column' ? 'rows' : 'auto'"
      [loading]="store.status() === 'loading'"
      [loadingMore]="store.loadingMore()"
      [lookup]="lookup"
      [moreFailed]="moreFailed()"
      [namedActions]="namedActions"
      [noMatch]="store.noMatch()"
      [noticeKeys]="notices()"
      [order]="store.order()"
      [rows]="rows()"
      [selectable]="bulkActions.length > 0"
      [selected]="selected()"
      [selectionLocked]="activeBulk() !== null"
      [sorts]="descriptor.sorts ?? []"
      [titleKey]="descriptor.labels.many"
    >
      @if (refusal(); as refused) {
        <p class="refusal" listRefusal role="alert" data-refusal>
          {{ refused.key | rokuT: { name: refused.name } }}
          @if (refused.link; as link) {
            <a
              [queryParams]="link.queryParams ?? null"
              [routerLink]="link.commands"
              >{{ link.labelKey | rokuT }}</a
            >
          }
          <button (click)="refusal.set(null)" type="button">
            {{ 'resource.action.dismiss' | rokuT }}
          </button>
        </p>
      }
      @if (bulkActions.length > 0) {
        <div class="bulk" listBulk>
          @if (activeBulk(); as action) {
            <ng-container
              *ngComponentOutlet="action.panel; inputs: bulkInputs()"
            />
          } @else {
            <p aria-live="polite" class="bulk-count">
              {{
                'resource.bulk.selected'
                  | rokuT: { count: selectedRows().length }
              }}
            </p>
            @for (action of bulkActions; track action.name) {
              <button
                (click)="openBulk(action)"
                [attr.data-bulk]="action.name"
                [disabled]="selectedRows().length === 0"
                type="button"
              >
                {{ action.label | rokuT }}
              </button>
            }
            @if (selectedRows().length > 0) {
              <button (click)="clearSelection()" type="button" data-bulk-clear>
                {{ 'resource.bulk.clear' | rokuT }}
              </button>
            }
          }
        </div>
      }
    </lib-resource-list>

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

    .refusal {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .refusal > button {
      margin-inline-start: auto;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .refusal > button:focus-visible,
    .refusal > a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .bulk {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .bulk-count {
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .bulk > button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .bulk > button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .bulk > button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
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

  private readonly _changes = inject(ResourceChanges);

  /** The last write to this resource that the rows on screen already show. */
  private _seenVersion = this._changes.version(
    this._route.snapshot.data[RESOURCE_DESCRIPTOR].name
  );

  /**
   * Say that this list wrote to its resource, for whatever else shows it: the
   * count on a tab, the page of the row's parent. The rows here already show
   * the write, so this list does not read again for it.
   */
  private _wrote(): void {
    this._changes.wrote(this.descriptor.name);
    this._seenVersion = this._changes.version(this.descriptor.name);
  }

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
   * Whether the list is part of a larger page, and which part (admin plan
   * 0042). `null` when it is the whole page.
   */
  readonly embed: ResourceListEmbed | null =
    this._route.snapshot.data[RESOURCE_LIST_EMBED] ?? null;

  /**
   * The rows above this resource that the address names, by filter.
   *
   * A chain's shops sit at `/chains/{chainId}/shops`, so the chain is read
   * from the route and is not a control on the list. Read once: the page that
   * holds this list draws it again when the parent changes.
   */
  private readonly _parents = parentsFromRoute(
    this._registry,
    this.descriptor,
    this._route.snapshot
  );

  /**
   * The filters the list offers: the descriptor's, less the one the address
   * already answered.
   */
  readonly filters: readonly FilterDescriptor[] = (
    (this.descriptor.filters ?? []) as readonly FilterDescriptor[]
  ).filter((filter) => filter.param !== this.descriptor.parent?.filter);

  /**
   * How a reference filter finds its rows, kept under the same parent.
   *
   * The shops of a chain can be narrowed to a price scope, and the scopes to
   * pick from are that chain's. A target that lives under a parent this list
   * is also under is searched under it. Any other target is searched as it
   * always was, because a parameter its route does not declare is refused.
   */
  readonly lookup: ReferenceLookup = {
    search: (resource, term, scope) => {
      const filter = this._registry.byName(resource)?.parent?.filter;
      const parent = filter === undefined ? undefined : this._parents[filter];

      return this.references.search(
        resource,
        term,
        filter === undefined || parent === undefined
          ? scope
          : { [filter]: parent, ...scope }
      );
    },
    resolve: (resource, id) => this.references.resolve(resource, id),
  };

  /**
   * The gateway, built here because this is an injection context.
   *
   * A field initializer runs during construction, which is where `inject` works.
   * It has to come after `descriptor`, and does.
   */
  readonly store = new ResourceListStore<ResourceRow>(
    this.descriptor,
    this.descriptor.gateway(),
    this.initialFilters(),
    this._fixedFilters()
  );

  /**
   * The row open beside the list, when the list is a column, or `null`.
   *
   * It is the first segment under the list's own route, which is the id the
   * list navigated to when the row was pressed. Written by hand from the
   * router's events, for the reason `AdminShellPage` gives.
   */
  readonly openId = signal<string | null>(this._childId());

  /** What the list draws above itself. */
  readonly heading = computed<'page' | 'pane' | 'none'>(() => {
    if (this.embed === 'tab') {
      return 'none';
    }
    if (this.embed === 'column') {
      // Under a page's header and its tab the column needs no title: the tab
      // says what is listed.
      if (this._route.snapshot.data[SPLIT_UNDER_HEADER] === true) {
        return 'none';
      }
      return this._viewport.split() ? 'pane' : 'page';
    }
    return 'page';
  });

  /** The states of one row, built once in this injection context. */
  private readonly _statesOf: (row: ResourceRow) => readonly RowState[] =
    this.descriptor.rowStates?.() ?? (() => []);

  /**
   * The delete the server refused, said once above the list, or `null`.
   *
   * A delete that failed used to leave the row where it was and say nothing,
   * so the operator could not tell a refusal from a click that missed. A
   * category that still holds products is the refusal this was written for
   * (admin plan 0036), and its link opens those products.
   */
  readonly refusal = signal<{
    readonly key: string;
    readonly name: string;
    readonly link: ErrorLinkTarget | null;
  } | null>(null);

  readonly compact = this._viewport.compact;

  /** The row awaiting a yes, or `null`. */
  readonly deleting = signal<ReturnType<typeof this.rows>[number] | null>(null);

  /** The named action awaiting a yes, with the row it would act on. */
  readonly asking = signal<PendingAction | null>(null);

  /** The row something is happening to. */
  readonly busyRowId = signal<string | null>(null);

  /** What can be done to several ticked rows (admin plan 0035, section 2). */
  readonly bulkActions: readonly BulkAction[] =
    this.descriptor.actions?.bulk ?? [];

  /** The ticked rows, by id. */
  readonly selected = signal<ReadonlySet<string>>(new Set());

  /** The bulk action whose panel is open, or `null`. */
  readonly activeBulk = signal<BulkAction | null>(null);

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
      const cells = this._decorate(view.cells, names, row);
      const states = this._statesOf(row);
      return {
        ...view,
        cells,
        ...(states.length > 0 ? { states } : {}),
        ...(this.embed === 'column'
          ? { brief: this._brief(row, view.title, options) }
          : {}),
      };
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

  /**
   * The ticked rows that are on screen.
   *
   * A tick on a row a filter has since hidden is not counted or handed to a
   * panel, because a review has to name every row it will write to.
   */
  readonly selectedRows = computed(() =>
    this.rows().filter((row) => this.selected().has(row.id))
  );

  /** What the open panel is given. */
  readonly bulkInputs = computed<Record<string, unknown>>(() => {
    const inputs: BulkPanelInputs = {
      rows: this.selectedRows(),
      finish: (changed: boolean) => this.finishBulk(changed),
    };
    return { ...inputs };
  });

  /** Tick or untick one row. Nothing is sent. */
  pick(id: string): void {
    if (this.activeBulk() !== null) {
      return;
    }
    const next = new Set(this.selected());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selected.set(next);
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  /** Open one bulk action's panel with the ticked rows. */
  openBulk(action: BulkAction): void {
    if (this.selectedRows().length === 0) {
      return;
    }
    this.activeBulk.set(action);
  }

  /** The panel is done. A write clears the ticks and reads the page again. */
  finishBulk(changed: boolean): void {
    this.activeBulk.set(null);
    if (changed) {
      this.selected.set(new Set());
      void this.store.load();
    }
  }

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

    // A list that is still drawn while one of its rows is written reads again
    // (admin plan 0042). A list that is the whole page is never on screen
    // during a write, and the constructor's own read is all it needs.
    if (this.embed !== null) {
      effect(() => {
        const version = this._changes.version(this.descriptor.name);
        untracked(() => {
          if (version !== this._seenVersion) {
            this._seenVersion = version;
            // Every page that was loaded, so the row that is open beside
            // the list stays in the column when it was on a later page.
            void this.store.refresh();
          }
        });
      });
    }

    // A column follows the address, so that the open row stays marked through
    // the browser's back button as well as through a press on a row.
    if (this.embed === 'column') {
      const events = this._router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) {
          this.openId.set(this._childId());
        }
      });
      inject(DestroyRef).onDestroy(() => events.unsubscribe());
    }
  }

  /** The first segment under this list's route, or `null` on the list itself. */
  private _childId(): string | null {
    return this._route.snapshot.firstChild?.url[0]?.path ?? null;
  }

  /** What the address already decided, for every read. */
  private _fixedFilters(): Record<string, string> {
    const parent = this.descriptor.parent;
    const value =
      parent === undefined ? undefined : this._parents[parent.filter];

    return parent === undefined || value === undefined
      ? {}
      : { [parent.filter]: value };
  }

  /**
   * One row as a column draws it: a heading, one line, and a number.
   *
   * The line is the text of each named field, in order, with nothing between
   * them but a space: "Sevilla 41004". A field whose value is a word and not
   * data (none, yes, no) is left out, since a line of a column has no label to
   * say what is none. So is a field whose text is the heading itself.
   */
  private _brief(
    row: ResourceRow,
    title: string,
    options: Parameters<typeof toCell>[2]
  ): RowBrief {
    const brief: BriefPresentation | undefined = this.descriptor.list.brief;
    const textOf = (name: string): string => {
      const field = fieldOf(this.descriptor, name);
      const cell =
        field === undefined ? undefined : toCell(field, row, options);
      return cell === undefined || cell.key !== undefined ? '' : cell.text;
    };

    const trailing =
      brief?.trailing === undefined ? '' : textOf(brief.trailing);

    // One sentence where the descriptor wrote one (admin plan 0045), and the
    // named fields side by side otherwise.
    const sentence = brief?.sentence?.(row);
    const heading = brief?.heading?.(row, this._content.order()) || title;

    return {
      heading,
      line:
        sentence !== undefined
          ? sentence.kind === 'text'
            ? sentence.text
            : this._translator.t(
                sentence.key,
                undefined,
                undefined,
                sentence.args
              )
          : (brief?.line ?? [])
              .map(textOf)
              // A field the heading already says is not said a second time
              // under it. A shop with no address is headed by its postal
              // code, and the line was that same code again (admin plan
              // 0049).
              .filter((text) => text !== '' && text !== heading)
              .join(' '),
      trailing: trailing === '' ? null : trailing,
    };
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
    this.refusal.set(null);
    const error = await this.store.remove(row.id);
    this.busyRowId.set(null);
    this.deleting.set(null);

    if (error === null) {
      this._wrote();
    }

    if (error !== null) {
      const declared = this.descriptor.errorLinks?.[error.code];
      // A link that names no detail is about the row the delete was for.
      const id =
        declared === undefined
          ? null
          : declared.detail === undefined
            ? row.id
            : error.detailString(declared.detail);
      this.refusal.set({
        key: gatewayErrorKey(error) ?? 'resource.error.unknown',
        name: row.title,
        link:
          declared === undefined || id === null
            ? null
            : this._registry.linkFor(declared, id, {
                ...row.row,
                ...this._parents,
              }),
      });
    }
  }

  /**
   * The filters the link that opened this list asked for.
   *
   * Only parameters the descriptor declares as a filter are read, so a query
   * string cannot send the gateway something the list would never send
   * itself. A refusal's link uses this to open a list already narrowed: the
   * products of a category that could not be deleted.
   *
   * A list that opens narrowed by something else as well overrides this
   * (admin plan 0043): the products open at the price scope the operator
   * chose last. It runs while the page is being built, so an override may
   * call `inject` and may not read a field of its own class.
   */
  protected initialFilters(): Record<string, string> {
    const params = this._route.snapshot.queryParamMap;
    const filters: Record<string, string> = {};
    for (const filter of this.filters) {
      const value = params.get(filter.param);
      if (value !== null && value !== '') {
        filters[filter.param] = value;
      }
    }
    return filters;
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
    this._wrote();
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
    names: ReadonlyMap<string, string>,
    row: ResourceRow
  ): Readonly<Record<string, ResourceCell>> {
    const next: Record<string, ResourceCell> = {};
    for (const [name, cell] of Object.entries(cells)) {
      next[name] = this._decorateCell(name, cell, names, row);
    }
    return next;
  }

  private _decorateCell(
    name: string,
    cell: ResourceCell,
    names: ReadonlyMap<string, string>,
    row: ResourceRow
  ): ResourceCell {
    const several = cell.references;
    if (several !== undefined) {
      // Several names, each overlaid as it lands, in the order the row holds
      // them (admin plan 0028, section 3). No link: a list of names is not one
      // place to go.
      const field = fieldOf(this.descriptor, name);
      if (field?.kind !== 'references' || field.nameLookup !== true) {
        return cell;
      }
      const text = several.ids
        .map((id) => names.get(`${several.resource}:${id}`) ?? id)
        .join(', ');
      return text === cell.text ? cell : { ...cell, text };
    }

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

    const link = this._linkTo(reference, row);
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
   *
   * A target that lives under a parent has an address only when that parent is
   * known (admin plan 0042). The row usually says it: a price names its scope
   * and its chain. What the row does not say, the address this list sits at
   * may. Neither means no link.
   */
  private _linkTo(
    reference: { readonly resource: string; readonly id: string },
    row: ResourceRow
  ): readonly string[] | null {
    const target = this._registry.byName(reference.resource);
    if (target === undefined || !hasDetailScreen(target)) {
      return null;
    }

    return this._registry.rowPath(reference.resource, reference.id, {
      ...row,
      ...this._parents,
    });
  }

  /**
   * One resolve per distinct id the descriptor asked to look up (admin plan
   * 0023, section 4.2). The set is marked before the request goes out, so a
   * page loaded while one is in flight does not ask about the same id again.
   */
  private async _resolveNames(rows: readonly ResourceRow[]): Promise<void> {
    const fields = this.descriptor.fields.filter(
      (
        field: FieldDescriptor
      ): field is ReferenceField<ResourceRow> | ReferencesField<ResourceRow> =>
        (field.kind === 'reference' || field.kind === 'references') &&
        field.nameLookup === true
    );
    if (fields.length === 0) {
      return;
    }

    const wanted: { resource: string; id: string; key: string }[] = [];
    for (const field of fields) {
      for (const row of rows) {
        const value = row[field.name];
        const ids = Array.isArray(value) ? value : [value];
        for (const id of ids) {
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
