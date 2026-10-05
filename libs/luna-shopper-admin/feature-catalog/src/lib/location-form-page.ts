import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
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
import { ShopContext } from './chains/shop-context';

/**
 * The shop's form, in the two places it is drawn (admin plan 0042, target 5).
 *
 * - **A new shop** is a page at `/chains/{chainId}/shops/new`, with the header
 *   every form has. Its chain is the one in the address. Saving opens the shop
 *   that was made.
 * - **A shop that exists** is the Details tab of its page, which drew the
 *   header. Saving stays on the tab, and the page reads the shop again so that
 *   its title and its "Priced by" line say what was saved.
 *
 * The shop's sections used to be a panel under this form. They are the tab
 * beside it now.
 */
@Component({
  selector: 'lib-location-form-page',
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
export class LocationFormPage extends ResourceFormPage {
  private readonly _shopRoute = inject(ActivatedRoute);
  private readonly _shopRouter = inject(Router);
  private readonly _shop = inject(ShopContext, { optional: true });

  /** Whether the last act was a save, for the line under the form. */
  readonly savedNow = signal(false);

  constructor() {
    super();

    // "Change" on the page's "Priced by" line writes the shop's scopes while
    // this tab is open, and the form held the row it read before that. So
    // when the shop the page holds names other scopes than the form's row,
    // the form reads again. Not over something typed: a form that is being
    // changed keeps what it holds, and its save sends the changed fields
    // alone, so the scopes written beside it are not put back.
    effect(() => {
      const held = this._shop?.shop()?.priceScopeIds ?? null;
      const shown = this.store.row()?.['priceScopeIds'];
      untracked(() => {
        if (
          this.mode !== 'edit' ||
          held === null ||
          !Array.isArray(shown) ||
          this.store.status() !== 'ready' ||
          this.store.dirty() ||
          sameIds(held, shown)
        ) {
          return;
        }
        void this.store.load();
      });
    });
  }

  /** A new shop opens its own page. A changed one stays on its tab. */
  protected override afterSave(row: ResourceRow): void {
    const id = row['id'];
    if (this.mode === 'create' && typeof id === 'string') {
      void this._shopRouter.navigate(['..', id], {
        relativeTo: this._shopRoute,
      });
      return;
    }
    this.confirmingLeave.set(false);
    this.savedNow.set(true);
    void this._shop?.reload();
  }

  /**
   * Cancel. From a new shop, back to the chain's shops. On the Details tab
   * there is nowhere to go back to, so it puts back what the shop holds.
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

/** Whether two lists name the same ids, in any order. */
function sameIds(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
