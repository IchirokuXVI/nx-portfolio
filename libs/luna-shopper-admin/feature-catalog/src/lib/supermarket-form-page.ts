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
 * The chain's form, in the two places it is drawn (admin plan 0042, target 8).
 *
 * - **A new chain** is a page of its own at `/chains/new`, with the header
 *   every form has. Saving opens the chain that was made.
 * - **A chain that exists** is the Details tab of its page. The page above
 *   drew the header and the tabs, so this draws the form alone, and saving
 *   stays on the tab: there is no list to go back to, and the page is what
 *   the operator was looking at.
 *
 * It used to hold tabs of its own, Details and Sections. The sections are a
 * tab of the chain's page now, beside this one.
 */
@Component({
  selector: 'lib-supermarket-form-page',
  imports: [PageHeader, ResourceForm, ConfirmDialog, RokuTranslatorPipe],
  template: `
    @if (mode === 'create') {
      <lib-page-header
        (back)="leave()"
        [backDisabled]="store.busy()"
        [backLabel]="'resource.action.back' | rokuT"
        [frameTabs]="false"
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
export class SupermarketFormPage extends ResourceFormPage {
  private readonly _chainRoute = inject(ActivatedRoute);
  private readonly _chainRouter = inject(Router);

  /** Whether the last act was a save, for the line under the form. */
  readonly savedNow = signal(false);

  /** A new chain opens its own page. A changed one stays on its tab. */
  protected override afterSave(row: ResourceRow): void {
    const id = row['id'];
    if (this.mode === 'create' && typeof id === 'string') {
      void this._chainRouter.navigate(['..', id], {
        relativeTo: this._chainRoute,
      });
      return;
    }
    this.confirmingLeave.set(false);
    this.savedNow.set(true);
  }

  /**
   * Cancel. From a new chain, back to the list. On the Details tab there is
   * nowhere to go back to, so it puts back what the chain holds.
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
