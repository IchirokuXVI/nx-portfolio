import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ResourceFormPage } from '@portfolio/luna-shopper-admin/feature-resource';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  PageHeader,
  ResourceForm,
} from '@portfolio/luna-shopper-admin/ui';

/**
 * The product's form, in the two places it is drawn (admin plan 0043, target
 * 3).
 *
 * - **A new product** is a page of its own at `/products/new`, with the header
 *   every form has. Saving opens the product that was made.
 * - **A product that exists** is the Details tab of its page. The page above
 *   drew the header and the tabs, so this draws the form alone, and saving
 *   stays on the tab: the page is what the operator was looking at.
 *
 * It used to draw two panels under the form, where the product is in each
 * chain's shops and the chain rows that name it, and a link to its prices.
 * Each of the three is a tab of the product's page now, beside this one.
 */
@Component({
  selector: 'lib-item-form-page',
  imports: [PageHeader, ResourceForm, ConfirmDialog, RokuTranslatorPipe],
  template: `
    @if (mode === 'create') {
      <lib-page-header
        (back)="leave()"
        [backDisabled]="store.busy()"
        [backLabel]="'resource.action.back' | rokuT"
        [heading]="titleKey() | rokuT: titleArgs()"
      />
    }

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
        [cautionKey]="descriptor.caution ?? null"
        [context]="context()"
        [draft]="store.draft()"
        [errorKey]="bannerKey()"
        [errorLink]="bannerLink()"
        [fields]="fields"
        [header]="false"
        [lookup]="references"
        [messages]="messages()"
        [mode]="mode"
        [readonlyCells]="readonlyCells()"
        [strayErrors]="store.strayErrors()"
        [subtitle]="subtitle()"
        [titleArgs]="titleArgs()"
        [titleKey]="titleKey()"
      />
      @if (savedNow() && !store.dirty()) {
        <p class="saved" role="status">{{ 'resource.form.saved' | rokuT }}</p>
      }
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

    .saved {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemFormPage extends ResourceFormPage {
  private readonly _itemRoute = inject(ActivatedRoute);
  private readonly _itemRouter = inject(Router);

  /** Whether the last act was a save, for the line under the form. */
  readonly savedNow = signal(false);

  /** A new product opens its own page. A changed one stays on its tab. */
  protected override afterSave(row: ResourceRow): void {
    const id = row['id'];
    if (this.mode === 'create' && typeof id === 'string') {
      void this._itemRouter.navigate(['..', id], {
        relativeTo: this._itemRoute,
      });
      return;
    }
    this.confirmingLeave.set(false);
    this.savedNow.set(true);
  }

  /**
   * Cancel. From a new product, back to the list. On the Details tab there is
   * nowhere to go back to, so it puts back what the product holds.
   */
  override goBack(): void {
    if (this.mode === 'create') {
      super.goBack();
      return;
    }
    this.confirmingLeave.set(false);
    this.savedNow.set(false);
    void this.store.load();
  }
}
