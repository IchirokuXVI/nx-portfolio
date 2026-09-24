import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  RESOURCE_ID_PARAM,
  ResourceFormPage,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ConfirmDialog, ResourceForm } from '@portfolio/luna-shopper-admin/ui';
import { ItemSourceEntries } from './item-source-entries';

/**
 * The product screen: the generic form, and below it what the product is
 * bound to and priced at (admin plan 0033).
 *
 * Everything the form does is inherited, exactly as the price editor inherits
 * it. What is added is only on an existing product: a way to its prices at
 * every scope, and the source products panel. A product being created has no
 * prices and nothing bound to it, so neither is drawn there.
 *
 * **The panel is drawn whatever the form's read did.** It reads the harvester
 * and the form reads catalog, so a product whose row cannot be read can still
 * show which chain rows name it, and a harvester that does not answer costs the
 * panel and not the form.
 */
@Component({
  selector: 'lib-item-form-page',
  imports: [
    ResourceForm,
    ConfirmDialog,
    ItemSourceEntries,
    RouterLink,
    RokuTranslatorPipe,
  ],
  template: `
    @if (store.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.form.loading' | rokuT }}</p>
    } @else if (store.status() === 'error') {
      <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
    } @else {
      <lib-resource-form
        (leave)="leave()"
        (save)="submit()"
        (valueChange)="change($event)"
        [busy]="store.busy()"
        [context]="context()"
        [draft]="store.draft()"
        [errorKey]="bannerKey()"
        [errorLink]="bannerLink()"
        [fields]="descriptor.fields"
        [lookup]="references"
        [messages]="messages()"
        [mode]="mode"
        [noteKey]="descriptor.formNote ?? null"
        [readonlyCells]="readonlyCells()"
        [strayErrors]="store.strayErrors()"
        [subtitle]="subtitle()"
        [titleArgs]="titleArgs()"
        [titleKey]="titleKey()"
      />
    }

    @if (itemId(); as id) {
      <div class="beside">
        @if (pricesLink(); as link) {
          <a [routerLink]="link" class="prices">{{
            'catalog.items.pricesLink' | rokuT
          }}</a>
        }
        <lib-item-source-entries [itemId]="id" />
      </div>
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
      gap: var(--admin-space-6);
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

    .beside {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      padding-block-start: var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }

    .prices {
      align-self: flex-start;
      color: var(--admin-accent);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemFormPage extends ResourceFormPage {
  private readonly _itemRoute = inject(ActivatedRoute);
  private readonly _itemRegistry = inject(ResourceRegistry);

  /** The product being edited, or `null` on a create. */
  readonly itemId = computed(() =>
    this.mode === 'edit'
      ? (this._itemRoute.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? null)
      : null
  );

  /** The product at every scope, under wherever the registry mounted items. */
  readonly pricesLink = computed(() => {
    const id = this.itemId();
    const path = this._itemRegistry.pathOf('items');
    return id === null || path === null ? null : [...path, id, 'prices'];
  });
}
