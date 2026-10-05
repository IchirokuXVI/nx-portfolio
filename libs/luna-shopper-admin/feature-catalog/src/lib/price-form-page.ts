import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  RecordStore,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  LeaveQuestion,
  recordPrefill,
  RESOURCE_DESCRIPTOR,
  ResourceChanges,
  ResourceReferences,
  ResourceRegistry,
  type LeaveAware,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  fieldMessage,
  isEditable,
  nounKeyOf,
  parseMoney,
  type AnyResourceDescriptor,
  type FieldDescriptor,
  type FieldMessage,
  type ResourceRow,
  type SaveBarState,
} from '@portfolio/luna-shopper-admin/models';
import {
  CautionLine,
  ConfirmDialog,
  describedByOf,
  FieldControl,
  FieldRow,
  SaveBar,
} from '@portfolio/luna-shopper-admin/ui';
import { PRICE_SCOPE_KIND_OPTIONS } from './catalog-enums';
import {
  itemSource,
  locationSource,
  priceScopeSource,
} from './catalog-sources';
import {
  checkObservedAt,
  proposeUnitPrice,
  type UnitPriceProposal,
} from './price-proposal';
import { PriceScopeNotice } from './price-scope-notice';
import { PriceScopePicker } from './products/price-scope-picker';
import {
  ScopeChoices,
  type PriceScopeChoice,
  type ScopeRow,
} from './products/scope-choices';

/** The field the scope picker stands in for. */
const SCOPE_FIELD = 'priceScopeId';

/**
 * How many pages of shops the count is willing to read.
 *
 * A warehouse scope covers a dozen shops and a store scope covers one, so in
 * practice this is a single request. A national scope covers everything, and a
 * form that opened a hundred requests to put a number in a sentence would be
 * worse than a form that says "at least five hundred", which is true and is
 * enough to make the point the sentence exists to make.
 */
const MAX_COUNT_PAGES = 5;

/** How many shops one page of the count asks for. The gateway's own maximum. */
const COUNT_PAGE_SIZE = 100;

const NO_MESSAGES: readonly FieldMessage[] = [];

/** The field whose day is checked here before anything is sent. */
const OBSERVED_FIELD = 'observedAt';

/**
 * The form that adds a price (plan 0005, sections 2 and 4, and admin plan
 * 0060, section 2.2).
 *
 * **Built from the parts of the record page, with a layout of its own.** Each
 * field is a `lib-field-row` with a `lib-field-control`, Save and Cancel are
 * the `lib-save-bar`, and the state is a `RecordStore` that adds. So the
 * label, the star, the refusal under a field and the words of the bar are
 * the ones every other form has. What `RecordView` cannot draw is the reason
 * a price keeps a form of its own, and it is the **notice**: a price is the
 * one row in the catalog whose meaning is not visible in its own fields.
 *
 * A price belongs to a **scope**, not to a shop. `SupermarketItem` is keyed on
 * `(itemId, priceScopeId)`, and twelve shops served by one warehouse share one
 * row, so "correct the price I saw in this shop" is really "change it for every
 * shop this warehouse serves". The notice says which scope, what kind it is,
 * and how many shops that is, and it says the count out loud rather than
 * leaving an operator to infer it from the word "warehouse".
 *
 * **The scope picker offers scopes and never shops.** It asks for the chain
 * and then for one of that chain's scopes, each with the mark that says how
 * far it reaches (admin plan 0043, target 3). There is no control on this
 * screen that a shop could be chosen in, which is what makes "cannot submit
 * against a location" a property of the form rather than a check inside it.
 *
 * **It is drawn inside the Prices tab of a product**, in a panel on a wide
 * screen and a sheet on a phone, so it draws no page header of its own: the
 * panel names it. The product is the page it is opened from, so the form asks
 * for no product either. The bar is the last line of the form and does not
 * stick to the window, because the form is not a page.
 *
 * **It adds a price and never changes one.** After a save the panel closes
 * and the tab reads the scopes again: a price has no page to open.
 */
@Component({
  selector: 'lib-price-form-page',
  imports: [
    CautionLine,
    ConfirmDialog,
    FieldControl,
    FieldRow,
    PriceScopeNotice,
    PriceScopePicker,
    RokuTranslatorPipe,
    SaveBar,
  ],
  template: `
    @if (refusalKey(); as key) {
      <lib-caution-line [text]="key | rokuT" tone="refused" data-refusal />
    }
    @for (message of store.strayErrors(); track $index) {
      <lib-caution-line [text]="message" tone="refused" data-stray />
    }

    <div class="rows">
      <!-- The picker names itself to a screen reader, and it is a button, so
           the label of the row is the visible name and the star. -->
      <lib-field-row
        [changed]="changed().has(scopeField)"
        [controlId]="scopeControlId"
        [label]="'catalog.prices.priceScopeId' | rokuT"
        [messages]="scopeMessages()"
        [required]="true"
        data-scope-row
      >
        <div class="scope">
          <lib-price-scope-picker
            (choiceChange)="chooseScope($event)"
            [choice]="scopeChoice()"
            [label]="'catalog.prices.chooseScope' | rokuT"
            [placeholder]="'catalog.prices.chooseScope' | rokuT"
          />
          <lib-price-scope-notice
            [atLeast]="countIsFloor()"
            [counting]="counting()"
            [kindLabel]="scopeKindLabel()"
            [locationCount]="locationCount()"
            [scopeName]="scopeName()"
          />
        </div>
      </lib-field-row>

      @for (field of formFields; track field.name) {
        @let said = saidOf(field);
        <lib-field-row
          [attr.data-field]="field.name"
          [changed]="changed().has(field.name)"
          [controlId]="controlId(field)"
          [help]="field.help ?? null"
          [label]="field.label | rokuT"
          [messages]="said"
          [required]="field.required === true"
        >
          <lib-field-control
            (valueChange)="store.set(field.name, $event)"
            [context]="store.draft()"
            [controlId]="controlId(field)"
            [describedBy]="describedBy(field, said.length)"
            [disabled]="store.busy()"
            [field]="field"
            [invalid]="said.length > 0"
            [lookup]="references"
            [value]="store.draft()[field.name] ?? ''"
          />

          <!-- A proposal and nothing more (admin plan 0033): the unit price
               field stays as typed until the operator chooses to use it, so
               nothing is sent that they did not see. Under the price it is
               worked out from. -->
          @if (field.name === 'price') {
            @if (proposal(); as proposed) {
              <section class="proposal" role="note">
                <p class="what">
                  {{
                    'catalog.prices.proposal.heading'
                      | rokuT
                        : { price: proposed.unitPrice, label: proposed.label }
                  }}
                </p>
                <p class="muted">
                  {{ 'catalog.prices.proposal.caution' | rokuT }}
                </p>
                @if (proposalInUse()) {
                  <p class="muted">
                    {{ 'catalog.prices.proposal.inUse' | rokuT }}
                  </p>
                } @else {
                  <button (click)="useProposal()" type="button">
                    {{ 'catalog.prices.proposal.use' | rokuT }}
                  </button>
                }
              </section>
            }
          }
        </lib-field-row>
      }
    </div>

    <lib-save-bar
      (cancel)="close()"
      (goToFirst)="goToFirst()"
      (save)="submit()"
      [saveLabel]="saveLabel()"
      [state]="bar()"
      [sticky]="false"
    />

    @if (leave.asking()) {
      <lib-confirm-dialog
        (confirm)="leave.answer(true)"
        (dismiss)="leave.answer(false)"
        [bodyArgs]="leaveArgs()"
        bodyKey="record.leave.bodyNew"
        confirmKey="resource.confirm.discard.confirm"
        dismissKey="record.leave.stay"
        headingKey="resource.confirm.discard.heading"
        prefer="dismiss"
        data-leave
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
    }

    /* The rows end with a line, as the first one starts with one. */
    .rows {
      border-block-end: 1px solid var(--admin-border);
    }

    .scope {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: flex-start;
    }

    .proposal {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: flex-start;
      max-inline-size: 36rem;
      margin-block-start: var(--admin-space-2);
      padding: var(--admin-space-3) var(--admin-space-4);
      border: 1px dashed var(--admin-accent);
      border-radius: var(--admin-radius);
    }

    .proposal .what {
      font-weight: 600;
    }

    .muted {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    /* The bar is the last line of the form. The panel and the sheet both
       have an edge of their own, so the bar draws none. */
    lib-save-bar {
      padding-inline: 0;
      border-block-start: none;
      background: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceFormPage implements LeaveAware {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _choices = inject(ScopeChoices);

  readonly references = inject(ResourceReferences);

  /**
   * The prices, from the route. Not imported: the descriptor names this
   * component as its editor, and the two files would import each other.
   */
  readonly descriptor: AnyResourceDescriptor =
    this._route.snapshot.data[RESOURCE_DESCRIPTOR];

  readonly scopeField = SCOPE_FIELD;
  readonly scopeControlId = `price-field-${SCOPE_FIELD}`;

  /**
   * A record that adds. It opens with the product the address names, and
   * with the scope when the row that opened the form named one.
   */
  readonly store = new RecordStore<ResourceRow>(
    this.descriptor,
    this.descriptor.gateway(),
    null,
    recordPrefill(this._registry, this.descriptor, this._route.snapshot)
  );

  /**
   * The fields the form draws: what an added price can state.
   *
   * Not the scope, which the picker above them chooses, and not the product,
   * which is the page the form was opened from. Not the fields a shown price
   * carries and a typed one cannot set, which on a form that only adds would
   * be a column of "None".
   */
  readonly formFields: readonly FieldDescriptor[] = (
    this.descriptor.fields as readonly FieldDescriptor[]
  ).filter(
    (field) =>
      field.name !== SCOPE_FIELD &&
      field.name !== this.descriptor.parent?.filter &&
      isEditable(field, 'create')
  );

  /** The question asked before a form with something typed is left. */
  readonly leave = new LeaveQuestion(() => this.store.changed().length > 0);

  readonly changed = computed(() => new Set(this.store.changed()));

  /** The scope as it was read or picked, for the picker to name. */
  private readonly _scopeRow = signal<ScopeRow | null>(null);

  /** The chosen scope with its chain, or `null` until both are known. */
  readonly scopeChoice = computed<PriceScopeChoice | null>(() => {
    const scope = this._scopeRow();
    if (scope === null || scope.id !== this._scopeId()) {
      return null;
    }
    const chain = this._choices.chainsById().get(scope.supermarketId);
    return {
      scope,
      chain: chain ?? {
        id: scope.supermarketId,
        name: {},
        defaultPriceScopeId: null,
      },
    };
  });

  /** What the form has to say about the scope, drawn under the picker. */
  readonly scopeMessages = computed(
    () => this.priceMessages()[SCOPE_FIELD] ?? []
  );

  /** What the scope is called, once it has been read. */
  readonly scopeName = signal<string | null>(null);
  /** Its kind, already translated. */
  readonly scopeKindLabel = signal('');
  /** How many shops it reaches, or `null` while that is not known. */
  readonly locationCount = signal<number | null>(null);
  /** Whether the count is a floor rather than the whole answer. */
  readonly countIsFloor = signal(false);
  readonly counting = signal(false);

  /** The scope the form is pointed at: the one in the draft, or none. */
  private readonly _scopeId = computed(() => {
    const chosen = this.store.draft()[SCOPE_FIELD];
    return typeof chosen === 'string' && chosen !== '' ? chosen : null;
  });

  /**
   * The read this screen is on, so a slower earlier answer cannot overwrite a
   * later one.
   *
   * The scope changes when the operator picks a different one, and two reads
   * can be in flight at once. Without a token the first to be asked for and the
   * last to answer would win, and the notice would name a scope the form is no
   * longer pointed at, which is exactly the wrong thing for this particular
   * sentence to do.
   */
  private _generation = 0;

  /** The product the form prices, read for its size and unit. */
  private readonly _item = signal<{
    readonly unitSize: number | null;
    readonly defaultUnit: string;
  } | null>(null);
  private _itemGeneration = 0;

  /** The product the form is pointed at, which the address named. */
  private readonly _itemId = computed(() => {
    const chosen = this.store.draft()['itemId'];
    return typeof chosen === 'string' && chosen !== '' ? chosen : null;
  });

  /**
   * The price divided by the size in the product's base unit, offered and
   * never applied (admin plan 0033).
   *
   * `prices.ts` records why the app derives nothing: the obvious division
   * disagrees with the source on 110 of 4,232 products. So this is a proposal
   * with its working shown, and only a click puts it in the field.
   */
  readonly proposal = computed<UnitPriceProposal | null>(() => {
    const item = this._item();
    if (item === null) {
      return null;
    }
    const price = parseMoney(String(this.store.draft()['price'] ?? ''), 2);
    return price.ok && price.value !== ''
      ? proposeUnitPrice(Number(price.value), item.unitSize, item.defaultUnit)
      : null;
  });

  /** Whether the unit price field already holds the proposal. */
  readonly proposalInUse = computed(() => {
    const proposed = this.proposal();
    const typed = parseMoney(String(this.store.draft()['unitPrice'] ?? ''), 4);
    return (
      proposed !== null &&
      typed.ok &&
      typed.value !== '' &&
      Number(typed.value) === Number(proposed.unitPrice)
    );
  });

  /**
   * Why the typed `observedAt` cannot be sent, or `null`.
   *
   * The gateway refuses a date in the future or more than 30 days back, and
   * says so as a 400 naming the field. Saying it here, as the date is typed,
   * spares a round trip that would say the same thing.
   */
  readonly observedAtProblem = computed<FieldMessage | null>(() => {
    const key = checkObservedAt(this.store.draft()[OBSERVED_FIELD], Date.now());
    return key === null ? null : fieldMessage(key);
  });

  /**
   * What to say under each field: what the store says, a refusal the
   * descriptor says is about one field, and the window of the observed date.
   */
  readonly priceMessages = computed<
    Readonly<Record<string, readonly FieldMessage[]>>
  >(() => {
    const messages: Record<string, readonly FieldMessage[]> = {};
    for (const field of this.descriptor.fields) {
      const said = this.store.messagesFor(field.name);
      if (said.length > 0) {
        messages[field.name] = said;
      }
    }

    // A refusal the descriptor says is about one field is said under it, and
    // not as the line above the rows (admin plan 0036).
    const error = this.store.error();
    const about =
      error === null ? undefined : this.descriptor.errorFields?.[error.code];
    const key = gatewayErrorKey(error);
    if (about !== undefined && key !== null) {
      messages[about] = [...(messages[about] ?? []), fieldMessage(key)];
    }

    const problem = this.observedAtProblem();
    if (problem !== null) {
      messages[OBSERVED_FIELD] = [...(messages[OBSERVED_FIELD] ?? []), problem];
    }
    return messages;
  });

  /**
   * A refusal that belongs to no field, as a key. One the server explained
   * field by field is under those fields, and saying it here as well would
   * say it twice.
   */
  readonly refusalKey = computed(() => {
    const error = this.store.error();
    if (error === null) {
      return null;
    }
    return Object.keys(error.fieldErrors).length > 0 ||
      this.descriptor.errorFields?.[error.code] !== undefined
      ? null
      : (gatewayErrorKey(error) ?? 'resource.error.unknown');
  });

  /** Whether the last press on Save was refused here, for the day. */
  private readonly _dayRefused = signal(false);

  /**
   * What the bar says. The store's own answer, but for a save that the day
   * refused: the store never saw that one, and the bar still has to say that
   * nothing was saved and that a field needs a look.
   */
  readonly bar = computed<SaveBarState>(() => {
    if (this._dayRefused() && this.observedAtProblem() !== null) {
      const others = this.store
        .invalid()
        .filter((name) => name !== OBSERVED_FIELD).length;
      return { kind: 'invalid', fields: others + 1 };
    }
    return this.store.bar();
  });

  /** What one row is called inside a sentence: "price". */
  readonly noun = computed(() => this._t(nounKeyOf(this.descriptor)));

  /** "Add price". */
  readonly saveLabel = computed(() =>
    this._t('record.action.add', { name: this.noun() })
  );

  readonly leaveArgs = computed(() => ({
    count: this.store.changed().length,
    name: this.noun(),
  }));

  constructor() {
    // Said by the store and not by the form: a save that answers after the
    // panel was closed still added the price, and the tab has to read again.
    this.store.onSaved(() => this._changes.wrote(this.descriptor.name));

    // A record that adds has nothing to read: this opens the draft.
    void this.store.load();

    // The chains, so that the picker can say which chain the scope is of.
    void this._choices.loadChains();

    effect(() => {
      const scopeId = this._scopeId();
      void this._describe(scopeId);
    });

    effect(() => {
      const itemId = this._itemId();
      void this._readItem(itemId);
    });
  }

  canLeave(): boolean | Promise<boolean> {
    return this.leave.canLeave();
  }

  saidOf(field: FieldDescriptor): readonly FieldMessage[] {
    return this.priceMessages()[field.name] ?? NO_MESSAGES;
  }

  controlId(field: FieldDescriptor): string {
    return `price-field-${field.name}`;
  }

  /** The lines under a control that describe it: its refusals and its help. */
  describedBy(field: FieldDescriptor, messages: number): string | null {
    return describedByOf(
      this.controlId(field),
      messages,
      field.help !== undefined
    );
  }

  /**
   * Put the proposal in the unit price field, and its label in the label field
   * when that is empty. Both are fields on the form, so the operator sees what
   * will be sent and can still change it.
   */
  useProposal(): void {
    const proposed = this.proposal();
    if (proposed === null) {
      return;
    }
    this.store.set('unitPrice', proposed.unitPrice);
    const label = this.store.draft()['unitPriceLabel'];
    if (typeof label !== 'string' || label.trim() === '') {
      this.store.set('unitPriceLabel', proposed.label);
    }
  }

  /** A scope was chosen in the picker. It goes in the draft like any field. */
  chooseScope(choice: PriceScopeChoice | null): void {
    this._scopeRow.set(choice?.scope ?? null);
    this.store.set(SCOPE_FIELD, choice?.scope.id ?? '');
  }

  /**
   * Send it. Refused here while the observed date is outside its window.
   *
   * After a save the panel closes: one route up is the Prices tab, which
   * reads the scopes again. A price has no page to open, which is what
   * `afterAdd: 'list'` on the descriptor says.
   */
  async submit(): Promise<void> {
    if (this.observedAtProblem() !== null) {
      this._dayRefused.set(true);
      return;
    }
    this._dayRefused.set(false);

    const saved = await this.store.submit();
    if (saved !== null) {
      this.close();
    }
  }

  /**
   * Close the panel: one route up, which is the tab with no form open. With
   * something typed, the guard of the route asks first.
   */
  close(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }

  /** Put the focus on the first field that was refused, in form order. */
  goToFirst(): void {
    const refused = new Set(this.store.invalid());
    if (this.observedAtProblem() !== null) {
      refused.add(OBSERVED_FIELD);
    }
    const host = this._host.nativeElement;

    if (refused.has(SCOPE_FIELD)) {
      host.querySelector<HTMLElement>('[data-scope-row] button')?.focus();
      return;
    }
    const first = this.formFields.find((field) => refused.has(field.name));
    if (first !== undefined) {
      host
        .querySelector<HTMLElement>(`[id="${this.controlId(first)}"]`)
        ?.focus();
    }
  }

  /**
   * One key, translated now and again when the words arrive. `t` reads no
   * signal, so without the two reads a `computed` that ran before the
   * catalogue was loaded would hold the raw key for good.
   */
  private _t(key: string, values?: Record<string, unknown>): string {
    this._translate.loaded();
    this._translate.locale();
    return this._translate.t(key, undefined, undefined, values);
  }

  /** Read the product for its size and unit. A failure means no proposal. */
  private async _readItem(itemId: string | null): Promise<void> {
    this._itemGeneration += 1;
    const generation = this._itemGeneration;
    this._item.set(null);
    if (itemId === null) {
      return;
    }
    try {
      const item = await this._gateways.for(itemSource()).read(itemId);
      if (generation === this._itemGeneration) {
        this._item.set({
          unitSize: typeof item.unitSize === 'number' ? item.unitSize : null,
          defaultUnit: String(item.defaultUnit ?? ''),
        });
      }
    } catch {
      // No product, no proposal. The form itself refuses an unreadable one.
    }
  }

  /** Read the scope, then count what it covers. */
  private async _describe(scopeId: string | null): Promise<void> {
    this._generation += 1;
    const generation = this._generation;

    this.scopeName.set(null);
    this.scopeKindLabel.set('');
    this.locationCount.set(null);
    this.countIsFloor.set(false);

    if (scopeId === null) {
      this.counting.set(false);
      return;
    }

    this.counting.set(true);

    try {
      // The picker already holds the scope it chose. A scope that came in the
      // address is read.
      const picked = this._scopeRow();
      const scope =
        picked?.id === scopeId
          ? picked
          : await this._gateways.for(priceScopeSource()).read(scopeId);
      if (generation !== this._generation) {
        return;
      }

      this._scopeRow.set(scope);
      this.scopeName.set(this._nameOf(scope));
      this.scopeKindLabel.set(this._kindLabelOf(scope.kind));

      const counted = await this._countLocations(scope.supermarketId, scopeId);
      if (generation !== this._generation) {
        return;
      }

      this.locationCount.set(counted.count);
      this.countIsFloor.set(counted.atLeast);
    } catch {
      // A scope that cannot be read is drawn as "no scope chosen" rather than
      // as a failure. The gateway is what refuses an unreadable value, and a
      // second error message beside its own would say nothing new.
      if (generation === this._generation) {
        this.scopeName.set(null);
      }
    } finally {
      if (generation === this._generation) {
        this.counting.set(false);
      }
    }
  }

  /** How many shops price against this scope, and whether that is the whole answer. */
  private async _countLocations(
    supermarketId: string,
    priceScopeId: string
  ): Promise<{ count: number; atLeast: boolean }> {
    const shops = this._gateways.for(locationSource());
    const filters = { supermarketId, priceScopeId };

    let count = 0;
    let cursor: string | undefined;

    for (let page = 0; page < MAX_COUNT_PAGES; page += 1) {
      const answer = await shops.list({
        cursor,
        filters,
        limit: COUNT_PAGE_SIZE,
      });
      count += answer.items.length;

      if (answer.nextCursor === null) {
        return { count, atLeast: false };
      }
      cursor = answer.nextCursor;
    }

    return { count, atLeast: true };
  }

  /**
   * What one scope is called, which is mostly not its label.
   *
   * The same answer the scope descriptor's own `title` gives, and it is repeated
   * rather than imported because importing it would make this component depend
   * on a descriptor to render a string.
   */
  private _nameOf(scope: Record<string, unknown>): string {
    const label = scope['label'];
    if (typeof label === 'object' && label !== null) {
      const text = Object.values(label).find(
        (entry) => typeof entry === 'string' && entry.trim() !== ''
      );
      if (typeof text === 'string') {
        return text;
      }
    }

    const kind = String(scope['kind'] ?? '');
    const key = scope['externalKey'];
    return typeof key === 'string' && key !== '' ? `${kind} ${key}` : kind;
  }

  /** A scope kind as words, translated here because it goes into a sentence. */
  private _kindLabelOf(kind: unknown): string {
    const option = PRICE_SCOPE_KIND_OPTIONS.find(
      (entry) => entry.value === kind
    );
    return option === undefined
      ? String(kind ?? '')
      : this._translate.t(option.label);
  }
}
