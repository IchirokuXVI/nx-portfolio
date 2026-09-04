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
import { ConfirmDialog, ResourceForm } from '@portfolio/luna-shopper-admin/ui';
import { PRICE_SCOPE_KIND_OPTIONS } from './catalog-enums';
import { locationSource, priceScopeSource } from './catalog-sources';
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

      <lib-resource-form
        (leave)="leave()"
        (save)="submit()"
        (valueChange)="change($event)"
        [busy]="store.busy()"
        [draft]="store.draft()"
        [errorKey]="bannerKey()"
        [fields]="descriptor.fields"
        [lookup]="references"
        [messages]="messages()"
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

  constructor() {
    super();

    effect(() => {
      const scopeId = this._scopeId();
      void this._describe(scopeId);
    });
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
