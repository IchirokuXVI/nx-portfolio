import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ResourceFormPage } from '@portfolio/luna-shopper-admin/feature-resource';
import { ConfirmDialog, ResourceForm } from '@portfolio/luna-shopper-admin/ui';
import { PriceScopeNote } from './price-scope-note';

/**
 * The one screen in the catalog that is not a descriptor (plan 0005, section 4).
 *
 * It is the generic form with one thing above it: a note saying what the chosen
 * price scope actually is, what kind it is, and how many shops it covers. That
 * note is the whole reason this component exists.
 *
 * **A price is not attached to a shop.** The row is keyed on
 * `(itemId, priceScopeId)`, Mercadona publishes one price per warehouse, and
 * twelve shops in Córdoba share it. An operator correcting a price they saw in
 * one of those shops changes it for eleven others, and a form that let them do
 * that without saying so would be creating wrong data politely. The generic
 * form cannot say it, because saying it means a second read of a different
 * resource about the value that was just chosen.
 *
 * Everything else is inherited, deliberately. Validation display, the dirty
 * check, the confirmation before discarding, where a server's field errors
 * land, and the rule that the form derives nothing are solved once in
 * {@link ResourceFormPage}, and a price screen that reimplemented any of them
 * would be the fifth screen that disagrees with the first about what a
 * validation error looks like.
 *
 * The template is restated rather than projected into, because the note needs
 * the draft's current scope and content projected into a component cannot read
 * that component's state. It is the same markup with one element added, and the
 * inputs it passes are the same ones the base computes.
 */
@Component({
  selector: 'lib-price-form-page',
  imports: [ResourceForm, ConfirmDialog, RokuTranslatorPipe, PriceScopeNote],
  template: `
    @if (store.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.form.loading' | rokuT }}</p>
    } @else if (store.status() === 'error') {
      <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
    } @else {
      <lib-price-scope-note [scopeId]="scopeId()" />

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
  /**
   * The scope the form currently names.
   *
   * Read from the draft rather than from the saved row, so the note follows the
   * picker while the operator is still choosing. On an edit the scope is not
   * editable and the draft does not hold it, so the row answers instead.
   */
  readonly scopeId = computed(() => {
    const drafted = this.store.draft()['priceScopeId'];
    if (typeof drafted === 'string' && drafted !== '') {
      return drafted;
    }

    const saved = this.store.row()?.['priceScopeId'];
    return typeof saved === 'string' ? saved : '';
  });
}
