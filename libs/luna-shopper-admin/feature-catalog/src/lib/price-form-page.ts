import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceFormPage } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  fieldMessage,
  parseMoney,
  type FieldMessage,
} from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, ResourceForm } from '@portfolio/luna-shopper-admin/ui';
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

/**
 * The price editor: the generic form, plus the one sentence that stops it
 * creating wrong data (plan 0005, sections 2 and 4).
 *
 * Everything a form does is inherited rather than rewritten. Validation, the
 * per locale inputs, server errors landing on their fields, the dirty state and
 * its confirmation, the disabled state during a submit: all of that is
 * {@link ResourceFormPage}, and a price gets the fix when any of it is fixed.
 * What is added here is the **notice**, and it is added because a price is the
 * one row in the catalog whose meaning is not visible in its own fields.
 *
 * A price belongs to a **scope**, not to a shop. `SupermarketItem` is keyed on
 * `(itemId, priceScopeId)`, and twelve shops served by one warehouse share one
 * row, so "correct the price I saw in this shop" is really "change it for every
 * shop this warehouse serves". The notice says which scope, what kind it is,
 * and how many shops that is, and it says the count out loud rather than
 * leaving an operator to infer it from the word "warehouse".
 *
 * **The scope picker offers scopes and never shops**, which is the descriptor's
 * doing rather than this component's: `priceScopeId` is a reference to
 * `price-scopes`, so there is no control on this screen that a shop could be
 * chosen in. That is what makes "cannot submit against a location" a property of
 * the form rather than a check inside it.
 */
@Component({
  selector: 'lib-price-form-page',
  imports: [ResourceForm, ConfirmDialog, PriceScopeNotice, RokuTranslatorPipe],
  template: `
    @if (store.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.form.loading' | rokuT }}</p>
    } @else if (store.status() === 'error') {
      <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
    } @else {
      <lib-price-scope-notice
        [atLeast]="countIsFloor()"
        [counting]="counting()"
        [kindLabel]="scopeKindLabel()"
        [locationCount]="locationCount()"
        [scopeName]="scopeName()"
      />

      <!-- A proposal and nothing more (admin plan 0033): the unit price field
           stays as typed until the operator chooses to use it, so nothing is
           sent that they did not see. -->
      @if (proposal(); as proposed) {
        <section class="proposal" role="note">
          <p class="what">
            {{
              'catalog.prices.proposal.heading'
                | rokuT: { price: proposed.unitPrice, label: proposed.label }
            }}
          </p>
          <p class="muted">{{ 'catalog.prices.proposal.caution' | rokuT }}</p>
          @if (proposalInUse()) {
            <p class="muted">{{ 'catalog.prices.proposal.inUse' | rokuT }}</p>
          } @else {
            <button (click)="useProposal()" type="button">
              {{ 'catalog.prices.proposal.use' | rokuT }}
            </button>
          }
        </section>
      }

      <lib-resource-form
        (leave)="leave()"
        (save)="submit()"
        (valueChange)="change($event)"
        [busy]="store.busy()"
        [draft]="store.draft()"
        [errorKey]="bannerKey()"
        [fields]="descriptor.fields"
        [lookup]="references"
        [messages]="priceMessages()"
        [mode]="mode"
        [readonlyCells]="readonlyCells()"
        [strayErrors]="store.strayErrors()"
        [subtitle]="subtitle()"
        [titleArgs]="titleArgs()"
        [titleKey]="titleKey()"
      />
    }

    @if (confirmingLeave()) {
      <lib-confirm-dialog
        (confirm)="goBack()"
        (dismiss)="confirmingLeave.set(false)"
        bodyKey="resource.confirm.discard.body"
        confirmKey="resource.confirm.discard.confirm"
        headingKey="resource.confirm.discard.heading"
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

    .proposal {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: flex-start;
      max-inline-size: 36rem;
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

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceFormPage extends ResourceFormPage {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _translate = inject(RokuTranslatorService);

  /** What the scope is called, once it has been read. */
  readonly scopeName = signal<string | null>(null);
  /** Its kind, already translated. */
  readonly scopeKindLabel = signal('');
  /** How many shops it reaches, or `null` while that is not known. */
  readonly locationCount = signal<number | null>(null);
  /** Whether the count is a floor rather than the whole answer. */
  readonly countIsFloor = signal(false);
  readonly counting = signal(false);

  /**
   * The scope the form is currently pointed at.
   *
   * The draft first, and the row behind it. On a create the scope is what the
   * operator has just chosen, so it is in the draft. On an edit it is **not**:
   * the key columns are settable once, so the draft does not carry them and the
   * row is the only thing that knows. Reading the draft alone would leave the
   * notice saying "choose a scope" on the exact screen the notice exists for.
   */
  private readonly _scopeId = computed(() => {
    const chosen = this.store.draft()['priceScopeId'];
    if (typeof chosen === 'string' && chosen !== '') {
      return chosen;
    }

    const onRow = this.store.row()?.['priceScopeId'];
    return typeof onRow === 'string' && onRow !== '' ? onRow : null;
  });

  /**
   * The read this screen is on, so a slower earlier answer cannot overwrite a
   * later one.
   *
   * The scope changes when the operator picks a different one, and two reads
   * can be in flight at once. Without a token the first to be asked for and the
   * last to answer would win, and the notice would name a scope the form is no
   * longer editing, which is exactly the wrong thing for this particular
   * sentence to do.
   */
  private _generation = 0;

  /** The product the form prices, read for its size and unit. */
  private readonly _item = signal<{
    readonly unitSize: number | null;
    readonly defaultUnit: string;
  } | null>(null);
  private _itemGeneration = 0;

  /** The product the form is pointed at, from the draft or the row. */
  private readonly _itemId = computed(() => {
    const chosen = this.store.draft()['itemId'];
    if (typeof chosen === 'string' && chosen !== '') {
      return chosen;
    }
    const onRow = this.store.row()?.['itemId'];
    return typeof onRow === 'string' && onRow !== '' ? onRow : null;
  });

  /**
   * The price divided by the size in the product's base unit, offered and
   * never applied (admin plan 0033).
   *
   * `prices.ts` records why the app derives nothing: the obvious division
   * disagrees with the source on 110 of 4,232 products. So this is a proposal
   * with its working shown, and only a click puts it in the field. Drawn on the
   * add form alone, which is the only form this screen has.
   */
  readonly proposal = computed<UnitPriceProposal | null>(() => {
    const item = this._item();
    if (item === null || this.mode !== 'create') {
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
    const key = checkObservedAt(this.store.draft()['observedAt'], Date.now());
    return key === null ? null : fieldMessage(key);
  });

  /** The form's own messages, with the observed date's window beside them. */
  readonly priceMessages = computed<
    Readonly<Record<string, readonly FieldMessage[]>>
  >(() => {
    const problem = this.observedAtProblem();
    const messages = this.messages();
    return problem === null
      ? messages
      : {
          ...messages,
          observedAt: [...(messages['observedAt'] ?? []), problem],
        };
  });

  constructor() {
    super();

    effect(() => {
      const scopeId = this._scopeId();
      void this._describe(scopeId);
    });

    effect(() => {
      const itemId = this._itemId();
      void this._readItem(itemId);
    });
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

  /** Refused here while the observed date is outside its window. */
  override async submit(): Promise<void> {
    if (this.observedAtProblem() !== null) {
      return;
    }
    await super.submit();
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
      const scope = await this._gateways.for(priceScopeSource()).read(scopeId);
      if (generation !== this._generation) {
        return;
      }

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
      // as a failure. The form itself is what refuses an unreadable value, and
      // a second error message beside its own would say nothing new.
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
