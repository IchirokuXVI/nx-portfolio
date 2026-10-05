import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  runInInjectionContext,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  type RecordStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  draftFor,
  fieldMessage,
  hasDetailScreen,
  idOf,
  isEditable,
  nounKeyOf,
  recordLayout,
  toInput,
  toRecordValue,
  type AnyResourceDescriptor,
  type ErrorLinkTarget,
  type FieldDescriptor,
  type FieldMessage,
  type RecordValue,
  type ResourceRow,
  type ScopeMarkView,
} from '@portfolio/luna-shopper-admin/models';
import {
  CautionLine,
  describedByOf,
  FieldControl,
  FieldRow,
  FieldValue,
  LockedValue,
  NAME_UNREAD,
  RecordId,
  RecordSection,
  SaveBar,
  Viewport,
  type ReferenceName,
} from '@portfolio/luna-shopper-admin/ui';
import { gatewayErrorKey } from './gateway-error-key';
import { RecordChildren } from './record-children';
import {
  ResourceReferences,
  ResourceRegistry,
  type KnownParents,
} from './resource-registry';

/** A refusal that belongs to no field: its sentence, and where it points. */
export interface RecordRefusal {
  /** A translation key. */
  readonly key: string;
  readonly link: ErrorLinkTarget | null;
}

/** The first thing of the form that takes the focus, whatever its control is. */
const FIRST_CONTROL = ['input', 'select', 'textarea', 'button', '[tabindex]']
  .map((part) => `lib-field-control ${part}`)
  .join(', ');

const NO_MESSAGES: readonly FieldMessage[] = [];
const NO_NAMES: Readonly<Record<string, ReferenceName>> = {};
const NO_LINKS: Readonly<Record<string, readonly string[]>> = {};
const NO_MARKS: Readonly<Record<string, ScopeMarkView>> = {};

/**
 * The body of the record page (admin plan 0053, section 2.2): the lines, the
 * sections, the Record block and the bar.
 *
 * It has no header, so that a later plan can put it in a tab or in a pane.
 * `RecordPage` draws the header above it and decides where the app goes.
 *
 * **One set of rows for three modes.** Reading draws each value as a
 * `lib-field-value`. Changing and adding draw the control of the field in the
 * same row, or a `lib-locked-value` for a field the form cannot change. So
 * nothing moves when "Edit" is pressed.
 *
 * **It draws no control of its own.** Every control is `lib-field-control`, and
 * Save and Cancel are the bar.
 *
 * **Every reference is drawn by name.** The view resolves each one through
 * `ResourceReferences`, whatever `nameLookup` says: one record is a handful of
 * reads. A list is not, and the rule of plan 0023 still holds there.
 *
 * **The collections of the record come after its sections** (admin plan
 * 0054): `lib-record-children` draws the panels and the links, and reads the
 * record from `RECORD_CONTEXT`, which the page provides.
 */
@Component({
  selector: 'lib-record-view',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    CautionLine,
    FieldControl,
    FieldRow,
    FieldValue,
    LockedValue,
    RecordChildren,
    RecordId,
    RecordSection,
    SaveBar,
  ],
  template: `
    @let record = store();
    @let mode = record.mode();
    @let form = mode !== 'read';
    @let loading = record.status() === 'loading';

    <div class="lines">
      @if (!form && added()) {
        <lib-caution-line
          [text]="'record.added' | rokuT: { name: nounStart() }"
          tone="saved"
          data-added
        >
          <button (click)="addAnother.emit()" class="link" type="button">
            {{ 'record.addAnother' | rokuT: { name: noun() } }}
          </button>
        </lib-caution-line>
      } @else if (!form && savedAt(); as time) {
        <lib-caution-line
          [text]="'record.savedAt' | rokuT: { time }"
          tone="saved"
          data-saved
        />
      }

      @for (notice of notices(); track notice) {
        <p class="notice" role="status">{{ notice | rokuT }}</p>
      }

      <!-- What saving does beyond writing the row. Only while the page is a
           form: a caution is read before the action, and reading acts on
           nothing. -->
      @if (form && descriptor().caution; as key) {
        <lib-caution-line [text]="key | rokuT" data-caution />
      }

      @if (shownRefusal(); as refused) {
        <lib-caution-line
          [text]="refused.key | rokuT"
          tone="refused"
          data-refusal
        >
          @if (refused.link; as link) {
            <a
              [queryParams]="link.queryParams ?? null"
              [routerLink]="link.commands"
              >{{ link.labelKey | rokuT }}</a
            >
          }
        </lib-caution-line>
      }

      @for (message of record.strayErrors(); track $index) {
        <lib-caution-line [text]="message" tone="refused" data-stray />
      }
    </div>

    <div [attr.aria-busy]="loading ? 'true' : null" class="body">
      <div class="sections">
        @for (section of layout().sections; track section.title) {
          <lib-record-section [heading]="section.title | rokuT">
            @for (field of section.fields; track field.name) {
              @if (loading) {
                <lib-field-row [label]="field.label | rokuT" [loading]="true" />
              } @else if (isControl(field)) {
                @let said = saidOf(field);
                <lib-field-row
                  [changed]="changed().has(field.name)"
                  [controlId]="labelledId(field)"
                  [help]="field.help ?? null"
                  [label]="field.label | rokuT"
                  [messages]="said"
                  [required]="field.required === true"
                >
                  <lib-field-control
                    (valueChange)="record.set(field.name, $event)"
                    [context]="context()"
                    [controlId]="controlId(field)"
                    [describedBy]="describedBy(field, said.length)"
                    [disabled]="record.busy()"
                    [field]="field"
                    [invalid]="said.length > 0"
                    [lookup]="references"
                    [value]="record.draft()[field.name] ?? ''"
                  />
                </lib-field-row>
              } @else {
                <lib-field-row
                  [help]="
                    !form && field.editable === false
                      ? (field.help ?? null)
                      : null
                  "
                  [label]="field.label | rokuT"
                >
                  @if (form) {
                    <lib-locked-value [reason]="lockReason(field)">
                      <lib-field-value
                        [marks]="marksOf(field)"
                        [names]="namesOf(field)"
                        [value]="valueOf(field)"
                      />
                    </lib-locked-value>
                  } @else {
                    <lib-field-value
                      [links]="linksOf(field)"
                      [marks]="marksOf(field)"
                      [names]="namesOf(field)"
                      [value]="valueOf(field)"
                    />
                  }
                </lib-field-row>
              }
            }
          </lib-record-section>
        }

        <!-- What the record holds: its panels, then its links (admin plan
             0054). Never part of the form, so the same in both modes. A
             record that does not exist yet holds nothing, and one that is
             still being read has no ID to ask with. -->
        @if (mode !== 'create' && !loading) {
          <lib-record-children />
        }
      </div>

      <!-- The record itself: when it was made and changed, and its ID. A
           record that does not exist yet has none of them. -->
      @if (mode !== 'create') {
        <aside class="facts">
          <lib-record-section [heading]="'record.facts.heading' | rokuT">
            @let facts = layout().facts;
            <dl>
              @if (facts.added; as field) {
                <div class="fact" data-fact="added">
                  <dt>{{ facts.addedLabel | rokuT }}</dt>
                  <dd>
                    @if (loading) {
                      <span class="bar"></span>
                    } @else {
                      <lib-field-value [value]="valueOf(field)" />
                      @if (facts.addedBy; as by) {
                        @if (valueOf(by).kind !== 'none') {
                          <span class="by" data-by>
                            {{ 'record.facts.by' | rokuT }}
                            <lib-field-value
                              [links]="form ? noLinks : linksOf(by)"
                              [names]="namesOf(by)"
                              [value]="valueOf(by)"
                            />
                          </span>
                        }
                      }
                    }
                  </dd>
                </div>
              }
              @if (facts.changed; as field) {
                <div class="fact" data-fact="changed">
                  <dt>{{ facts.changedLabel | rokuT }}</dt>
                  <dd>
                    @if (loading) {
                      <span class="bar"></span>
                    } @else {
                      <lib-field-value [value]="valueOf(field)" />
                      @if (facts.changedBy; as by) {
                        @if (valueOf(by).kind !== 'none') {
                          <span class="by" data-by>
                            {{ 'record.facts.by' | rokuT }}
                            <lib-field-value
                              [links]="form ? noLinks : linksOf(by)"
                              [names]="namesOf(by)"
                              [value]="valueOf(by)"
                            />
                          </span>
                        }
                      }
                    }
                  </dd>
                </div>
              }
              @for (field of facts.also; track field.name) {
                <div [attr.data-fact]="field.name" class="fact">
                  <dt>{{ field.label | rokuT }}</dt>
                  <dd>
                    @if (loading) {
                      <span class="bar"></span>
                    } @else {
                      <lib-field-value
                        [links]="form ? noLinks : linksOf(field)"
                        [names]="namesOf(field)"
                        [value]="valueOf(field)"
                      />
                    }
                  </dd>
                </div>
              }
              <div class="fact" data-fact="id">
                <dt>{{ 'record.facts.id' | rokuT }}</dt>
                <dd>
                  @if (recordId(); as id) {
                    <lib-record-id [value]="id" />
                  } @else {
                    <span class="bar"></span>
                  }
                </dd>
              </div>
            </dl>
          </lib-record-section>
        </aside>
      }
    </div>

    @if (form && !loading) {
      <lib-save-bar
        (cancel)="cancel.emit()"
        (goToFirst)="goToFirst()"
        (save)="save()"
        [saveLabel]="saveLabel()"
        [state]="record.bar()"
      />
    }
  `,
  styles: `
    /* The view lays itself out by its own width and not by the window's, so
       it is the same view in a pane (admin plan 0053, target 12). */
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
      container-type: inline-size;
    }

    .lines {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      max-inline-size: 47.5rem;
    }

    .lines:empty {
      display: none;
    }

    .notice {
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius-control);
      background: var(--admin-neutral-wash);
      color: var(--admin-neutral-on-wash);
    }

    /* Reads as a link and is a button: it asks the page for a new record. */
    .link {
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 0.1875rem;
      color: inherit;
      cursor: pointer;
    }

    .link:focus-visible {
      outline: 2px solid currentcolor;
      outline-offset: 2px;
    }

    .body {
      display: flex;
      flex: 1;
      flex-direction: column;
      justify-content: flex-start;
      gap: var(--admin-space-4);
      align-items: stretch;
    }

    .sections {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
      max-inline-size: 47.5rem;
    }

    /* After the sections the Record block is one more of them, and as wide. */
    .facts {
      max-inline-size: 47.5rem;
    }

    /* Beside the sections when the view is 60 rem wide or more, and after
       them when it is not. */
    @container (min-width: 60rem) {
      .body {
        flex-direction: row;
        gap: var(--admin-space-5, 1.25rem);
        align-items: flex-start;
      }

      .sections {
        flex: 1 1 0;
      }

      .facts {
        flex: none;
        inline-size: 18rem;
      }
    }

    .fact {
      display: flex;
      flex-direction: column;
      gap: 0.0625rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }

    dt {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    dd {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--admin-space-2);
      align-items: baseline;
      min-inline-size: 0;
      font-size: 0.84375rem;
    }

    .by {
      display: inline-flex;
      gap: var(--admin-space-1);
      color: var(--admin-ink-muted);
    }

    .bar {
      display: block;
      inline-size: min(10rem, 100%);
      block-size: 0.75rem;
      margin-block: 0.25rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
    }

    /* The bar reaches the edges of the page, as the header does. */
    lib-save-bar {
      margin-inline: calc(-1 * var(--admin-page-inline));
      margin-block-end: calc(-1 * var(--admin-page-block));
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordView {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _viewport = inject(Viewport);

  readonly references = inject(ResourceReferences);

  /** Whether the view is gone. A save can answer after that. */
  private _destroyed = false;

  readonly descriptor = input.required<AnyResourceDescriptor>();
  readonly store = input.required<RecordStore<ResourceRow>>();
  /** The rows above this one that the address names. */
  readonly parents = input<KnownParents>({});
  /** Draw the line "added", with "Add another". */
  readonly added = input(false);
  /**
   * A refusal the page holds and the store does not: a named action that
   * failed. Drawn where a refused save about no field is drawn.
   */
  readonly refusal = input<RecordRefusal | null>(null);

  /** The operator pressed Cancel. The page decides whether to ask first. */
  // The name the plan gives it. It is the Cancel of the bar and not the DOM
  // event of a dialog, which never reaches a custom element.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly cancel = output<void>();
  /** A save went through, with the row the gateway answered. */
  readonly saved = output<ResourceRow>();
  readonly addAnother = output<void>();

  readonly noLinks = NO_LINKS;

  /** The sections and the Record block, for the mode the store is in. */
  readonly layout = computed(() =>
    recordLayout(this.descriptor(), this.store().mode())
  );

  /** Every field the page draws, in the order of the page. */
  private readonly _fields = computed<readonly FieldDescriptor[]>(() => {
    const { sections, facts } = this.layout();
    return [
      ...sections.flatMap((section) => section.fields),
      ...[facts.added, facts.addedBy, facts.changed, facts.changedBy].filter(
        (field): field is FieldDescriptor => field !== null
      ),
      ...facts.also,
    ];
  });

  /**
   * The row the values are read from.
   *
   * A record that does not exist yet has no row. What the address says about
   * it stands in for one, so the parent it will belong to can be drawn.
   */
  private readonly _shown = computed<ResourceRow>(() => {
    const store = this.store();
    return store.mode() === 'create'
      ? { ...store.draft(), ...this.parents() }
      : (store.row() ?? {});
  });

  /**
   * The row as the form holds it: what was read, with the draft over it. A
   * `references` field reads its scope and its locks from this (admin plan
   * 0028, section 3).
   */
  readonly context = computed<ResourceRow>(() => ({
    ...(this.store().row() ?? {}),
    ...this.store().draft(),
  }));

  /** Every value of the page, by field. `models` says what each one is. */
  private readonly _values = computed<Readonly<Record<string, RecordValue>>>(
    () => {
      const row = this._shown();
      const drafted = this._drafted();
      const options = {
        locale: this._translator.locale(),
        contentLocales: this._content.order(),
      };
      const values: Record<string, RecordValue> = {};
      for (const field of this._fields()) {
        // A value that is worked out from other fields follows the form.
        values[field.name] = toRecordValue(
          field,
          field.read === undefined ? row : drafted,
          options
        );
      }
      return values;
    }
  );

  /**
   * The row a value that is worked out from other fields is read from.
   *
   * While the page changes a record, that is the row as a save would leave
   * it: what was read, with what the form would send over it. The link to a
   * map then follows the two numbers that were typed, and never shows the
   * place that was saved beside the numbers of another one.
   */
  private readonly _drafted = computed<ResourceRow>(() => {
    const store = this.store();
    const row = store.row();
    if (store.mode() !== 'edit' || row === null) {
      return this._shown();
    }
    const descriptor = this.descriptor();
    return {
      ...row,
      ...toInput(
        descriptor,
        store.draft(),
        'edit',
        draftFor(descriptor, row, 'edit')
      ),
    };
  });

  /**
   * The values whose targets are read in an order of the field's own, by
   * field (`readOrder`). Only while the page reads, and only once every
   * target is read, so the rows never move while one of them arrives.
   */
  private readonly _ordered = computed<Readonly<Record<string, RecordValue>>>(
    () => {
      const ordered: Record<string, RecordValue> = {};
      if (this.store().mode() !== 'read') {
        return ordered;
      }
      const rows = this._rows();
      const values = this._values();
      for (const field of this._fields()) {
        const value = values[field.name];
        if (
          field.kind !== 'references' ||
          field.readOrder === undefined ||
          value?.kind !== 'references'
        ) {
          continue;
        }
        const read = new Map<string, ResourceRow>();
        for (const id of value.ids) {
          const row = rows[referenceKey(value, id)];
          if (row !== undefined) {
            read.set(id, row);
          }
        }
        if (read.size !== value.ids.length) {
          continue;
        }
        const compare = (a: string, b: string): number =>
          field.readOrder?.(
            read.get(a) as ResourceRow,
            read.get(b) as ResourceRow
          ) ?? 0;
        ordered[field.name] = { ...value, ids: [...value.ids].sort(compare) };
      }
      return ordered;
    }
  );

  /**
   * The names the lookup answered, by resource and ID. `null` is a record
   * that is gone, `NAME_UNREAD` is a read that failed, and an absent entry is
   * still being read.
   */
  private readonly _resolved = signal<Readonly<Record<string, ReferenceName>>>(
    {}
  );
  /**
   * The rows the lookup answered, by resource and ID. A field that draws a
   * mark before a target reads it off the target's own row (admin plan 0056,
   * section 2).
   */
  private readonly _rows = signal<Readonly<Record<string, ResourceRow>>>({});
  /** What was asked for already, so one reference is one read. */
  private readonly _asked = new Set<string>();

  /** The names of the references of one field, by ID. */
  private readonly _names = computed(() => {
    const resolved = this._resolved();
    const names: Record<string, Readonly<Record<string, ReferenceName>>> = {};
    for (const [name, value] of Object.entries(this._values())) {
      const held: Record<string, ReferenceName> = {};
      for (const id of referenceIds(value)) {
        const key = referenceKey(value, id);
        if (key in resolved) {
          held[id] = resolved[key];
        }
      }
      names[name] = held;
    }

    // What the field itself calls a target, once the target is read: a
    // fact about the two rows, which the title of the target cannot say.
    const rows = this._rows();
    const context = this.context();
    for (const field of this._fields()) {
      const value = this._values()[field.name];
      if (
        field.kind !== 'references' ||
        field.nameOf === undefined ||
        value?.kind !== 'references'
      ) {
        continue;
      }
      const held = { ...names[field.name] };
      for (const id of value.ids) {
        const row = rows[referenceKey(value, id)];
        const said = row === undefined ? undefined : field.nameOf(context, row);
        if (said !== undefined) {
          held[id] =
            said.kind === 'text' ? said.text : this._t(said.key, said.args);
        }
      }
      names[field.name] = held;
    }
    return names;
  });

  /**
   * Where each reference of one field leads, by ID.
   *
   * A reference is a link when the registry knows a page for its target. One
   * with no page is text: a link that leads to a 404 is worse.
   */
  private readonly _links = computed(() => {
    const known = { ...this._shown(), ...this.parents() };
    const links: Record<
      string,
      Readonly<Record<string, readonly string[]>>
    > = {};
    for (const [name, value] of Object.entries(this._values())) {
      const held: Record<string, readonly string[]> = {};
      // Every record the value points at, also one the row already named:
      // a name that came with the row is as much a link as one looked up.
      for (const id of targetIds(value)) {
        const target = this._registry.byName(resourceOf(value));
        const path =
          target !== undefined && hasDetailScreen(target)
            ? this._registry.rowPath(target.name, id, known)
            : null;
        if (path !== null) {
          held[id] = path;
        }
      }
      links[name] = held;
    }
    return links;
  });

  /**
   * The scope mark before each target of one field, by ID. Only a field that
   * states `mark`, and only a target the lookup has read.
   */
  private readonly _marks = computed(() => {
    const rows = this._rows();
    const marks: Record<string, Readonly<Record<string, ScopeMarkView>>> = {};
    for (const field of this._fields()) {
      const value = this._values()[field.name];
      if (
        field.kind !== 'references' ||
        field.mark === undefined ||
        value?.kind !== 'references'
      ) {
        continue;
      }
      const held: Record<string, ScopeMarkView> = {};
      for (const id of value.ids) {
        const row = rows[referenceKey(value, id)];
        const mark = row === undefined ? undefined : field.mark(row);
        if (mark !== undefined) {
          held[id] = mark;
        }
      }
      marks[field.name] = held;
    }
    return marks;
  });

  /** What to say under each field, by name. */
  readonly messages = computed<
    Readonly<Record<string, readonly FieldMessage[]>>
  >(() => {
    const store = this.store();
    const descriptor = this.descriptor();
    const messages: Record<string, readonly FieldMessage[]> = {};
    for (const field of descriptor.fields) {
      const said = store.messagesFor(field.name);
      if (said.length > 0) {
        messages[field.name] = said;
      }
    }

    // A refusal the descriptor says is about one field is said under it, and
    // not as the line above the sections (admin plan 0036).
    const error = store.error();
    const about =
      error === null ? undefined : descriptor.errorFields?.[error.code];
    const key = gatewayErrorKey(error);
    if (about !== undefined && key !== null) {
      messages[about] = [...(messages[about] ?? []), fieldMessage(key)];
    }
    return messages;
  });

  readonly changed = computed(() => new Set(this.store().changed()));

  /**
   * The refusal about no field: the page's own, or that of the last save.
   *
   * The save's only while the page is a form. A delete that was refused is
   * also in `store.error`, and the page says that one in a dialog.
   */
  readonly shownRefusal = computed<RecordRefusal | null>(() => {
    const given = this.refusal();
    if (given !== null) {
      return given;
    }

    const store = this.store();
    const descriptor = this.descriptor();
    const error = store.error();
    if (error === null || store.mode() === 'read') {
      return null;
    }
    // A refusal explained field by field is under those fields. Saying it
    // here as well would say it twice.
    if (
      Object.keys(error.fieldErrors).length > 0 ||
      descriptor.errorFields?.[error.code] !== undefined
    ) {
      return null;
    }

    const declared = descriptor.errorLinks?.[error.code];
    const row = store.row();
    // A link that names no detail is about this record itself.
    const id =
      declared === undefined
        ? null
        : declared.detail === undefined
          ? row === null
            ? null
            : idOf(descriptor, row)
          : error.detailString(declared.detail);

    return {
      key: gatewayErrorKey(error) ?? 'resource.error.unknown',
      link:
        declared === undefined || id === null
          ? null
          : this._registry.linkFor(declared, id, {
              ...this.context(),
              ...this.parents(),
            }),
    };
  });

  /**
   * The sentences the resource says right now. Built in an injection context,
   * as the list builds them, and once for each descriptor.
   */
  private readonly _notices = computed<Signal<readonly string[]> | null>(() => {
    const descriptor = this.descriptor();
    return untracked(() =>
      runInInjectionContext(
        this._injector,
        () => descriptor.notices?.() ?? null
      )
    );
  });
  readonly notices = computed(() => this._notices()?.() ?? []);

  /** What one row is called inside a sentence: "product". */
  readonly noun = computed(() => this._t(nounKeyOf(this.descriptor())));
  /** The same word at the start of a sentence: "Product". */
  readonly nounStart = computed(() => sentenceStart(this.noun()));

  /** "Save", or "Add product" for a record that does not exist yet. */
  readonly saveLabel = computed(() =>
    this.store().mode() === 'create'
      ? this._t('record.action.add', { name: this.noun() })
      : this._t('resource.action.save')
  );

  /** When the last save went through, as a time of day: "12:04". */
  readonly savedAt = computed(() => {
    const at = this.store().savedAt();
    return at === null
      ? null
      : new Intl.DateTimeFormat(this._translator.locale(), {
          hour: '2-digit',
          minute: '2-digit',
        }).format(at);
  });

  /** The ID of the record, once it is read. */
  readonly recordId = computed(() => {
    const row = this.store().row();
    return row === null ? null : idOf(this.descriptor(), row) || null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this._destroyed = true));

    // Every reference whose row carries no name is asked for once. The answer
    // is written from outside the effect, so the effect follows the values
    // and not its own writes.
    effect(() => {
      for (const value of Object.values(this._values())) {
        for (const id of referenceIds(value)) {
          const key = referenceKey(value, id);
          if (this._asked.has(key)) {
            continue;
          }
          this._asked.add(key);
          void this.references.read(resourceOf(value), id).then((read) => {
            // "Gone" is what a 404 says. A read that failed says nothing
            // about the record, so the value does not either.
            this._resolved.update((names) => ({
              ...names,
              [key]:
                read.state === 'found'
                  ? read.option.title
                  : read.state === 'gone'
                    ? null
                    : NAME_UNREAD,
            }));
            const row = read.state === 'found' ? read.option.row : undefined;
            if (row !== undefined) {
              this._rows.update((rows) => ({ ...rows, [key]: row }));
            }
          });
        }
      }
    });
  }

  /** Whether the form may change this field now. */
  isControl(field: FieldDescriptor): boolean {
    const mode = this.store().mode();
    if (mode === 'read' || !isEditable(field, mode)) {
      return false;
    }
    // The parent the address names is answered already. A picker for it would
    // be a second place to answer, and the two could disagree.
    return !this._fromAddress(field);
  }

  /**
   * Why the form cannot change this field, as a translation key (admin plan
   * 0052, section 3.8). The first that fits.
   */
  lockReason(field: FieldDescriptor): string {
    if (field.setBy !== undefined) {
      return field.setBy;
    }
    if (this._fromAddress(field)) {
      return 'record.locked.fromAddress';
    }
    if (field.editable === 'create' && this.store().mode() === 'edit') {
      return 'record.locked.fixedOnAdd';
    }
    return 'record.locked.system';
  }

  /** What is said under one field. */
  saidOf(field: FieldDescriptor): readonly FieldMessage[] {
    return this.messages()[field.name] ?? NO_MESSAGES;
  }

  valueOf(field: FieldDescriptor): RecordValue {
    return (
      this._ordered()[field.name] ??
      this._values()[field.name] ?? { kind: 'none' }
    );
  }

  namesOf(field: FieldDescriptor): Readonly<Record<string, ReferenceName>> {
    return this._names()[field.name] ?? NO_NAMES;
  }

  linksOf(field: FieldDescriptor): Readonly<Record<string, readonly string[]>> {
    return this._links()[field.name] ?? NO_LINKS;
  }

  marksOf(field: FieldDescriptor): Readonly<Record<string, ScopeMarkView>> {
    return this._marks()[field.name] ?? NO_MARKS;
  }

  /** The id the control of a field is handed. */
  controlId(field: FieldDescriptor): string {
    return `record-field-${field.name}`;
  }

  /**
   * The id of the element the label of a field points at.
   *
   * The control's own id, but for a text in several languages: that control
   * is one box for each language, and the first box is the one a press on the
   * label reaches.
   */
  labelledId(field: FieldDescriptor): string {
    const id = this.controlId(field);
    return field.kind === 'localized-text' && field.locales.length > 0
      ? `${id}-${field.locales[0]}`
      : id;
  }

  /** The lines under a control that describe it: its refusals and its help. */
  describedBy(field: FieldDescriptor, messages: number): string | null {
    return describedByOf(
      this.labelledId(field),
      messages,
      field.help !== undefined
    );
  }

  /**
   * Send it. On a phone a refusal about fields moves the page to the first of
   * them, because the bar has no room there for "Go to the first".
   */
  async save(): Promise<void> {
    const store = this.store();
    const row = await store.submit();
    // The view can be gone by now: the operator left while the save was on
    // its way. An output of a view that is gone throws, and so does a render
    // hook. The store has already told whoever listens for the write.
    if (this._destroyed) {
      return;
    }
    if (row !== null) {
      this.saved.emit(row);
      return;
    }
    if (this._viewport.compact() && store.bar().kind === 'invalid') {
      afterNextRender(() => this.goToFirst(), { injector: this._injector });
    }
  }

  /** Put the focus on the first field that was refused, in page order. */
  goToFirst(): void {
    const refused = new Set(this.store().invalid());
    const first = this.layout()
      .sections.flatMap((section) => section.fields)
      .find((field) => refused.has(field.name));
    if (first === undefined) {
      return;
    }

    const element = this._host.nativeElement.querySelector<HTMLElement>(
      `[id="${this.labelledId(first)}"]`
    );
    element?.focus();
  }

  /**
   * Put the focus on the first control of the form, in page order.
   *
   * For the page, after "Edit": the button that was pressed leaves the page,
   * and the focus would fall to the document.
   */
  focusFirst(): void {
    const first = this.layout()
      .sections.flatMap((section) => section.fields)
      .find((field) => this.isControl(field));
    const host = this._host.nativeElement;
    const named =
      first === undefined
        ? null
        : host.querySelector<HTMLElement>(`[id="${this.labelledId(first)}"]`);
    // A control whose id is on no element that takes the focus still has a
    // first thing to press.
    (named ?? host.querySelector<HTMLElement>(FIRST_CONTROL))?.focus();
  }

  /** Whether this field is the parent of a new record that the address names. */
  private _fromAddress(field: FieldDescriptor): boolean {
    const parent = this.descriptor().parent?.filter;
    const id = this.parents()[field.name];
    return (
      this.store().mode() === 'create' &&
      field.name === parent &&
      typeof id === 'string' &&
      id !== ''
    );
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

/** The IDs a value points at that the row did not name. */
function referenceIds(value: RecordValue): readonly string[] {
  if (value.kind === 'reference') {
    return value.name === null ? [value.id] : [];
  }
  return value.kind === 'references' ? value.ids : [];
}

/** The IDs a value points at, named by the row or not. */
function targetIds(value: RecordValue): readonly string[] {
  if (value.kind === 'reference') {
    return [value.id];
  }
  return value.kind === 'references' ? value.ids : [];
}

function resourceOf(value: RecordValue): string {
  return value.kind === 'reference' || value.kind === 'references'
    ? value.resource
    : '';
}

function referenceKey(value: RecordValue, id: string): string {
  return `${resourceOf(value)}\u0000${id}`;
}

/** A word as the first word of a sentence. */
export function sentenceStart(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
