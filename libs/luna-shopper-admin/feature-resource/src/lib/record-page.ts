import { Location } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  RecordStore,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  hasDetailScreen,
  idOf,
  isEditable,
  nounKeyOf,
  type AnyResourceDescriptor,
  type FieldDescriptor,
  type NamedAction,
  type ResourceDraft,
  type ResourceRow,
  type RowState,
} from '@portfolio/luna-shopper-admin/models';
import {
  CautionLine,
  ConfirmDialog,
  PageHeader,
} from '@portfolio/luna-shopper-admin/ui';
import { TrashIcon } from '@portfolio/shared/ui';
import { gatewayErrorKey } from './gateway-error-key';
import type { LeaveAware } from './record-leave-guard';
import { RecordView, sentenceStart, type RecordRefusal } from './record-view';
import { ResourceChanges } from './resource-changes';
import { parentsFromRoute, ResourceRegistry } from './resource-registry';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  RESOURCE_ID_PARAM,
  routeParam,
} from './resource-route-data';

/**
 * The field kinds a query parameter can fill in on a new record.
 *
 * Every one of them holds a plain string in the draft. A yes or no, a text in
 * several languages and a json field each hold a shape that a query parameter
 * cannot spell.
 */
const STRING_FIELD_KINDS: readonly string[] = [
  'text',
  'number',
  'money',
  'enum',
  'reference',
  'date',
];

/** The query parameter that opens a record as a form: `?edit=1`. */
export const RECORD_EDIT_PARAM = 'edit';

/** The navigation state that says the record was just added. */
const ADDED_STATE = 'added';

/**
 * One page reads a record, changes it and adds one (admin plan 0053, section
 * 2.3).
 *
 * The route component: the header, the More menu, the questions and where the
 * app goes. `RecordView` draws everything under the header, and `RecordStore`
 * holds the record and the draft.
 *
 * **A record opens to be read.** "Edit" turns the same page into a form, and
 * the mode is a state of the page and not of the address: a reload of a form
 * comes back reading. `?edit=1` exists so that another screen can link
 * straight to the form, and the page takes it out of the address at once.
 *
 * **Leaving with changes asks first**, through `recordLeaveGuard`, which every
 * route that mounts this page carries. The browser asks for a reload and for
 * a closed tab.
 *
 * It reads its route as `ResourceFormPage` does, and it follows the route: one
 * component serves every ID of a route, because the router keeps the
 * component when only the ID changes.
 */
@Component({
  selector: 'lib-record-page',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    CautionLine,
    ConfirmDialog,
    PageHeader,
    RecordView,
    TrashIcon,
  ],
  template: `
    @let record = store();
    @let status = record.status();

    <!-- At the top of the page and in every state, so that the title and the
         way back do not arrive a moment after the page. Each thing put in the
         header is the one element of its own block, which is what lets it
         reach its slot. -->
    <lib-page-header
      [backLabel]="descriptor.labels.many | rokuT"
      [backLink]="listUrl"
      [heading]="heading()"
      [info]="descriptor.info ?? null"
      [loading]="status === 'loading'"
      [moreLabel]="moreLabel()"
      overflow="menu"
    >
      @for (chip of chips(); track chip.label) {
        <span
          [class.good]="chip.tone === 'good'"
          [class.waiting]="chip.tone === 'waiting'"
          class="chip"
          pageChip
          >{{ chip.label | rokuT: chip.args ?? {} }}</span
        >
      }

      @if (canEdit()) {
        <button (click)="edit()" pageAction type="button" data-edit>
          {{ 'resource.action.edit' | rokuT }}
        </button>
      }

      @for (action of plainActions(); track action.name) {
        <button
          (click)="run(action)"
          [attr.data-action]="action.name"
          [disabled]="working()"
          pageMoreAction
          type="button"
        >
          {{ action.label | rokuT }}
        </button>
      }

      @for (action of dangerActions(); track action.name) {
        <button
          (click)="run(action)"
          [attr.data-action]="action.name"
          [disabled]="working()"
          pageMoreDanger
          type="button"
        >
          {{ action.label | rokuT }}
        </button>
      }

      @if (canDelete()) {
        <button
          (click)="deleting.set(true)"
          [disabled]="working()"
          pageMoreDanger
          type="button"
          data-delete
        >
          <span class="mark"><lib-trash-icon /></span>
          {{ 'record.delete.action' | rokuT: { name: noun() } }}
        </button>
      }
    </lib-page-header>

    @if (status === 'missing') {
      <section class="state" data-missing>
        <p>{{ 'record.state.missing.body' | rokuT: { name: noun() } }}</p>
        <a [routerLink]="listUrl" class="button">{{
          'record.state.missing.list'
            | rokuT: { list: (descriptor.labels.many | rokuT) }
        }}</a>
      </section>
    } @else if (status === 'error') {
      <!-- No section is drawn, so nothing here can be taken for the record. -->
      <lib-caution-line [text]="errorText()" tone="refused" data-no-answer>
        <button (click)="retry()" class="retry" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </lib-caution-line>
    } @else {
      @if (status === 'loading') {
        <p class="sr-only" role="status">{{ heading() }}</p>
      }
      <lib-record-view
        (addAnother)="addAnother()"
        (cancel)="cancel()"
        (saved)="saved($event)"
        [added]="added()"
        [descriptor]="descriptor"
        [parents]="parents()"
        [refusal]="refusal()"
        [store]="record"
      />
    }

    @if (leaving()) {
      <lib-confirm-dialog
        (confirm)="answerLeave(true)"
        (dismiss)="answerLeave(false)"
        [bodyArgs]="leaveArgs()"
        [bodyKey]="
          record.mode() === 'create'
            ? 'record.leave.bodyNew'
            : 'record.leave.body'
        "
        confirmKey="resource.confirm.discard.confirm"
        dismissKey="record.leave.stay"
        headingKey="resource.confirm.discard.heading"
        prefer="dismiss"
        data-leave
      />
    }

    @if (deleting()) {
      <lib-confirm-dialog
        (confirm)="confirmDelete()"
        (dismiss)="deleting.set(false)"
        [busy]="working()"
        [confirmArgs]="{ name: title() }"
        [headingArgs]="{ thing: noun(), name: title() }"
        bodyKey="record.delete.body"
        confirmKey="record.delete.confirm"
        dismissKey="record.delete.keep"
        headingKey="record.delete.heading"
        order="dismiss-first"
        data-delete-question
      />
    }

    @if (refusedDelete(); as refused) {
      <lib-confirm-dialog
        (confirm)="refusedDelete.set(null)"
        (dismiss)="refusedDelete.set(null)"
        [bodyKey]="refused.key"
        [dismissKey]="null"
        [headingArgs]="{ name: title() }"
        confirmKey="record.delete.close"
        headingKey="record.delete.refused"
        tone="primary"
        data-delete-refused
      >
        @if (refused.link; as link) {
          <a
            [queryParams]="link.queryParams ?? null"
            [routerLink]="link.commands"
            >{{ link.labelKey | rokuT }}</a
          >
        }
      </lib-confirm-dialog>
    }

    @if (asking(); as action) {
      @if (action.confirm; as question) {
        <lib-confirm-dialog
          (confirm)="confirmAction()"
          (dismiss)="asking.set(null)"
          [bodyArgs]="{ name: title() }"
          [bodyKey]="question.body"
          [busy]="working()"
          [confirmKey]="question.confirm"
          [headingKey]="question.heading"
          data-action-question
        />
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
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

    .chip.good {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .chip.waiting {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    button {
      font-weight: 500;
      cursor: pointer;
    }

    button:focus-visible,
    .button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .mark {
      flex: none;
      inline-size: 1rem;
      block-size: 1rem;
    }

    .state {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 47.5rem;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .button {
      display: inline-flex;
      align-items: center;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border-radius: var(--admin-radius-control);
      background: var(--admin-accent);
      font-weight: 500;
      text-decoration: none;
      color: var(--admin-accent-ink);
    }

    lib-caution-line {
      align-items: center;
      max-inline-size: 47.5rem;
    }

    .retry {
      margin-inline-start: var(--admin-space-2);
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPage implements LeaveAware {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _location = inject(Location);
  private readonly _injector = inject(Injector);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);

  readonly descriptor: AnyResourceDescriptor =
    this._route.snapshot.data[RESOURCE_DESCRIPTOR];

  /** Whether this route adds a record. If not, it opens one. */
  private readonly _creates =
    this._route.snapshot.data[RESOURCE_FORM_MODE] === 'create';

  /** The gateway, built once in this injection context. */
  private readonly _gateway = this.descriptor.gateway();

  /** The named actions of the resource, built once in this injection context. */
  private readonly _named: readonly NamedAction<ResourceRow>[] =
    this.descriptor.actions?.named?.() ?? [];

  /** The states of one row, built once in this injection context. */
  private readonly _statesOf: (row: ResourceRow) => readonly RowState[] =
    this.descriptor.rowStates?.() ?? (() => []);

  /**
   * The list this record belongs to: one segment up, in every case, because
   * the route factory says so. For a record under a row it is the list of
   * that row. A URL and not a history pop, because the page can be arrived at
   * from a link or a reload, where a pop would leave the app.
   */
  readonly listUrl = this._router.serializeUrl(
    this._router.createUrlTree(['..'], { relativeTo: this._route })
  );

  /** The rows above this one that the address names, by filter. */
  readonly parents = signal<Record<string, string>>({});

  readonly store = signal(this._storeFor(null));

  /** Whether the record was added a moment ago, by the page before this one. */
  readonly added = signal(false);

  /** Whether the operator is being asked about losing what they typed. */
  readonly leaving = signal(false);
  /** Whether the operator is being asked about the delete. */
  readonly deleting = signal(false);
  /** The named action that waits for a yes. */
  readonly asking = signal<NamedAction<ResourceRow> | null>(null);
  /** Whether a delete or a named action is on its way. */
  readonly working = signal(false);
  /** A delete that was refused: why, and where the rows that hold it are. */
  readonly refusedDelete = signal<RecordRefusal | null>(null);
  /** A named action that failed, drawn above the first section. */
  readonly refusal = signal<RecordRefusal | null>(null);

  /** What the operator answers the leave question with. */
  private _answer: ((leave: boolean) => void) | null = null;

  /** The writes to this resource that the page has already seen. */
  private _seen = this._changes.version(this.descriptor.name);

  /** What one row is called inside a sentence: "product". */
  readonly noun = computed(() => this._t(nounKeyOf(this.descriptor)));

  /** What this record is called, once it is read. */
  readonly title = computed(() => {
    const row = this.store().row();
    return row === null
      ? ''
      : this.descriptor.title(row, this._content.order());
  });

  /**
   * The heading, for the state the page is in (admin plan 0053, sections 2.3
   * and 4).
   *
   * Translated here and not in the template: the noun is an argument of
   * another key, and a pipe cannot resolve a key inside a key.
   */
  readonly heading = computed(() => {
    const store = this.store();
    if (store.mode() === 'create') {
      return this._t('resource.form.create', { name: this.noun() });
    }
    switch (store.status()) {
      case 'loading':
        return this._t('record.state.loading', { name: this.noun() });
      case 'missing':
        return this._t('record.state.missing.heading', {
          name: sentenceStart(this.noun()),
        });
      case 'error':
        return sentenceStart(this.noun());
      default:
        return this.title();
    }
  });

  readonly moreLabel = computed(() =>
    this._t('record.more', { name: this.title() })
  );

  /** The record, while the page reads it and it is there. */
  private readonly _read = computed<ResourceRow | null>(() => {
    const store = this.store();
    return store.mode() === 'read' && store.status() === 'ready'
      ? store.row()
      : null;
  });

  /** The states beside the name: the record's own, or "Editing". */
  readonly chips = computed<readonly RowState[]>(() => {
    if (this.store().mode() === 'edit') {
      return [{ label: 'record.state.editing', tone: 'neutral' }];
    }
    const row = this._read();
    return row === null ? [] : this._statesOf(row);
  });

  /** "Edit" is drawn when the form could change at least one field. */
  readonly canEdit = computed(
    () =>
      this._read() !== null &&
      this.descriptor.actions?.edit === true &&
      (this.descriptor.fields as readonly FieldDescriptor[]).some((field) =>
        isEditable(field, 'edit')
      )
  );

  /** The named actions this record can have done to it, less the ones that destroy. */
  readonly plainActions = computed(() =>
    this._offered().filter((action) => action.danger !== true)
  );

  /** The named actions that destroy. They come last, under a line. */
  readonly dangerActions = computed(() =>
    this._offered().filter((action) => action.danger === true)
  );

  readonly canDelete = computed(
    () => this._read() !== null && this.descriptor.actions?.delete === true
  );

  /** Whether leaving now would lose something the operator typed. */
  readonly dirty = computed(() => this.store().changed().length > 0);

  readonly leaveArgs = computed(() => ({
    count: this.store().changed().length,
    name: this.store().mode() === 'create' ? this.noun() : this.title(),
  }));

  /**
   * What the page says when the read failed.
   *
   * A request that got no answer says so. Any other failure says its own
   * sentence: a refusal is not a gateway that did not answer.
   */
  readonly errorText = computed(() => {
    const error = this.store().error();
    return error === null || error.status === 0 || error.status >= 500
      ? this._t('record.state.noAnswer', { name: this.noun() })
      : this._t(gatewayErrorKey(error) ?? 'resource.error.unknown');
  });

  constructor() {
    // One component serves every ID of its route. The first value arrives
    // here at once, and each later one is another record.
    const params = this._route.params.subscribe(() => this._open());
    inject(DestroyRef).onDestroy(() => {
      params.unsubscribe();
      this._answer?.(false);
    });

    // Another screen that wrote this resource says so, and a page that reads
    // then reads again. A form is never read again under the operator: it
    // catches up when it goes back to reading.
    effect(() => {
      const version = this._changes.version(this.descriptor.name);
      const record = this._read();
      untracked(() => {
        if (record !== null && version !== this._seen) {
          this._seen = version;
          void this.store().load();
        }
      });
    });

    // The browser asks before the tab closes or reloads, and only while
    // there is something to lose.
    effect((onCleanup) => {
      if (!this.dirty() || typeof window === 'undefined') {
        return;
      }
      window.addEventListener('beforeunload', askBeforeUnload);
      onCleanup(() =>
        window.removeEventListener('beforeunload', askBeforeUnload)
      );
    });
  }

  /** From reading to the form. */
  edit(): void {
    this.refusal.set(null);
    this.store().edit();
  }

  /**
   * Cancel in the bar.
   *
   * It asks the same question as leaving when something changed: one press
   * can throw away thirty fields. A record that does not exist yet has no
   * reading mode to go back to, so its Cancel is the way to the list, and the
   * guard of the route asks.
   */
  async cancel(): Promise<void> {
    const store = this.store();
    if (store.mode() === 'create') {
      void this._router.navigateByUrl(this.listUrl);
      return;
    }
    if (await this.canLeave()) {
      store.cancel();
    }
  }

  /**
   * Whether the route may be left. Nothing changed: at once. Something
   * changed: the question, and what the operator chose.
   */
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    // A second navigation while the question is up. The first one stays.
    this._answer?.(false);
    return new Promise<boolean>((resolve) => {
      this._answer = resolve;
      this.leaving.set(true);
    });
  }

  answerLeave(leave: boolean): void {
    const answer = this._answer;
    this._answer = null;
    this.leaving.set(false);
    if (leave) {
      // The draft goes before the navigation does, so nothing asks twice.
      this.store().cancel();
    }
    answer?.(leave);
  }

  /**
   * A save went through. Whatever still shows this resource reads again, and
   * then the page does what follows a save.
   */
  saved(row: ResourceRow): void {
    const added = this.store().mode() === 'create';
    this._wrote();
    if (!added) {
      return;
    }

    // The next step is usually on the new record, so the app opens it. A
    // resource whose rows have no page, or that says so, goes to the list.
    const id = idOf(this.descriptor, row);
    if (
      this.descriptor.record?.afterAdd === 'list' ||
      !hasDetailScreen(this.descriptor) ||
      id === ''
    ) {
      void this._router.navigateByUrl(this.listUrl);
      return;
    }
    void this._router.navigate(['..', id], {
      relativeTo: this._route,
      state: { [ADDED_STATE]: true },
    });
  }

  addAnother(): void {
    void this._router.navigate(['..', 'new'], { relativeTo: this._route });
  }

  retry(): void {
    void this.store().load();
  }

  async confirmDelete(): Promise<void> {
    const store = this.store();
    const row = store.row();
    if (row === null) {
      return;
    }

    this.working.set(true);
    const removed = await store.remove();
    this.working.set(false);
    this.deleting.set(false);

    if (removed) {
      this._wrote();
      void this._router.navigateByUrl(this.listUrl);
      return;
    }

    const error = store.error();
    if (error !== null) {
      this.refusedDelete.set(this._refusalOf(error, row));
    }
  }

  /** A named action: asked about first when it says so. */
  async run(action: NamedAction<ResourceRow>): Promise<void> {
    if (action.confirm !== undefined) {
      this.asking.set(action);
      return;
    }
    await this._run(action);
  }

  /** The operator said yes to a named action. */
  async confirmAction(): Promise<void> {
    const action = this.asking();
    if (action !== null) {
      await this._run(action);
    }
  }

  /**
   * Run it, then read the record again or go to the list.
   *
   * Reading again and not guessing what the action did: an action this page
   * knows nothing about can change any field.
   */
  private async _run(action: NamedAction<ResourceRow>): Promise<void> {
    const store = this.store();
    const row = store.row();
    if (row === null) {
      return;
    }

    this.working.set(true);
    this.refusal.set(null);
    try {
      await action.run(row);
    } catch (error) {
      this.refusal.set(this._refusalOf(toGatewayError(error), row));
      return;
    } finally {
      this.working.set(false);
      this.asking.set(null);
    }

    this._wrote();
    if (action.after === 'leave') {
      void this._router.navigateByUrl(this.listUrl);
      return;
    }
    await store.load();
  }

  /** The record the address names now, opened from the start. */
  private _open(): void {
    const snapshot = this._route.snapshot;
    const id = this._creates
      ? null
      : snapshot.data[RESOURCE_ID_FROM] === undefined
        ? (snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? null)
        : routeParam(snapshot, snapshot.data[RESOURCE_ID_FROM]);

    this.parents.set(
      parentsFromRoute(this._registry, this.descriptor, snapshot)
    );

    const store = this._storeFor(id);
    this.store.set(store);
    this.deleting.set(false);
    this.asking.set(null);
    this.refusal.set(null);
    this.refusedDelete.set(null);
    this._seen = this._changes.version(this.descriptor.name);

    // Said once, by the navigation that brought the new record. The state is
    // then taken out of the history entry, so a reload does not say it again.
    const state = this._router.currentNavigation()?.extras.state;
    const added = id !== null && state?.[ADDED_STATE] === true;
    this.added.set(added);
    if (added) {
      afterNextRender(() => this._forgetAdded(), { injector: this._injector });
    }

    const asForm =
      id !== null && snapshot.queryParamMap.get(RECORD_EDIT_PARAM) === '1';
    void store.load().then(() => {
      if (asForm && this.store() === store && this.canEdit()) {
        store.edit();
      }
    });
    if (asForm) {
      // After the render and not now: the navigation that brought the
      // parameter is still on its way while the page is built.
      afterNextRender(
        () =>
          void this._router.navigate([], {
            relativeTo: this._route,
            queryParams: { [RECORD_EDIT_PARAM]: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          }),
        { injector: this._injector }
      );
    }
  }

  private _storeFor(id: string | null): RecordStore<ResourceRow> {
    return new RecordStore<ResourceRow>(
      this.descriptor,
      this._gateway,
      id,
      id === null && this._creates ? this._prefill() : {}
    );
  }

  /**
   * What a new record opens with: the parent the address names, and the
   * fields a caller filled in through the query string.
   *
   * `price-scopes/new?supermarketId=<id>` from the leaflet upload of admin
   * plan 0010 is the caller it exists for. Only over fields the descriptor
   * names, which the store enforces again, and only the kinds whose control
   * holds a plain string.
   */
  private _prefill(): ResourceDraft {
    const snapshot = this._route.snapshot;
    const parents = parentsFromRoute(this._registry, this.descriptor, snapshot);
    const draft: Record<string, string> = {};

    // A row made under a chain belongs to it.
    const parent = this.descriptor.parent;
    const parentId = parent === undefined ? undefined : parents[parent.filter];
    if (parent !== undefined && parentId !== undefined) {
      draft[parent.filter] = parentId;
    }

    for (const field of this.descriptor.fields) {
      if (!STRING_FIELD_KINDS.includes(field.kind)) {
        continue;
      }
      const value = snapshot.queryParamMap.get(field.name);
      if (value !== null && value !== '' && draft[field.name] === undefined) {
        draft[field.name] = value;
      }
    }

    return draft;
  }

  private _offered(): readonly NamedAction<ResourceRow>[] {
    const row = this._read();
    return row === null
      ? []
      : this._named.filter((action) => action.available?.(row) !== false);
  }

  /** A refusal about this record: its sentence, and the row it names. */
  private _refusalOf(error: GatewayError, row: ResourceRow): RecordRefusal {
    const declared = this.descriptor.errorLinks?.[error.code];
    // A link that names no detail is about this record itself.
    const id =
      declared === undefined
        ? null
        : declared.detail === undefined
          ? idOf(this.descriptor, row)
          : error.detailString(declared.detail);

    return {
      key: gatewayErrorKey(error) ?? 'resource.error.unknown',
      link:
        declared === undefined || id === null
          ? null
          : this._registry.linkFor(declared, id, {
              ...row,
              ...this.parents(),
            }),
    };
  }

  /** This page wrote the resource, and has seen its own write. */
  private _wrote(): void {
    this._changes.wrote(this.descriptor.name);
    this._seen = this._changes.version(this.descriptor.name);
  }

  /** Take "added" out of the history entry, and leave the rest of it. */
  private _forgetAdded(): void {
    const state = this._location.getState();
    if (
      typeof state !== 'object' ||
      state === null ||
      !(ADDED_STATE in state)
    ) {
      return;
    }
    const rest: Record<string, unknown> = { ...state };
    delete rest[ADDED_STATE];
    this._location.replaceState(this._location.path(true), '', rest);
  }

  /**
   * One key, translated now and again when the words arrive.
   *
   * `t` reads no signal. Without the two reads a `computed` that ran before
   * the catalogue was loaded would hold the raw key for good.
   */
  private _t(key: string, values?: Record<string, unknown>): string {
    this._translator.loaded();
    this._translator.locale();
    return this._translator.t(key, undefined, undefined, values);
  }
}

/** Ask the browser to ask. Old browsers want `returnValue` set as well. */
function askBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = true;
}
