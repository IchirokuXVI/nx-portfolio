import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  RESOURCE_ID_PARAM,
  ResourceFormPage,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  ConfirmDialog,
  PageHeader,
  ResourceForm,
} from '@portfolio/luna-shopper-admin/ui';
import { LocationSections } from './location-sections';

/**
 * The shop screen: the generic form, and under it the sections this shop has
 * (admin plan 0037, target 2).
 *
 * The panel needs the shop's chain, which only the row read can say, so it is
 * drawn once the form has read the shop. A shop being created has no sections
 * of its own yet and gets no panel.
 */
@Component({
  selector: 'lib-location-form-page',
  imports: [
    PageHeader,
    ResourceForm,
    ConfirmDialog,
    LocationSections,
    RokuTranslatorPipe,
  ],
  template: `
    <!-- At the top of the page and in every state, so that the title, the way
         back and the tabs do not arrive a moment after the page. -->
    <lib-page-header
      (back)="leave()"
      [backDisabled]="store.busy()"
      [backLabel]="'resource.action.back' | rokuT"
      [heading]="titleKey() | rokuT: titleArgs()"
      [subtitle]="subtitle()"
    />

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
        [fields]="descriptor.fields"
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
    }

    @if (locationId(); as id) {
      @if (chainId(); as chain) {
        <div class="beside">
          <lib-location-sections
            [hasMap]="hasMap()"
            [locationId]="id"
            [supermarketId]="chain"
          />
        </div>
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
      padding-block-start: var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationFormPage extends ResourceFormPage {
  private readonly _shopRoute = inject(ActivatedRoute);

  /** The shop being edited, or `null` on a create. */
  readonly locationId = computed(() =>
    this.mode === 'edit'
      ? (this._shopRoute.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? null)
      : null
  );

  /**
   * Whether the shop has a walk shown to shoppers, from the location read
   * (backend plan 0168). Its section list follows that map (admin plan 0040).
   */
  readonly hasMap = computed(() => this.store.row()?.['hasMap'] === true);

  /** The shop's chain, once the row has been read. */
  readonly chainId = computed(() => {
    const chain = this.store.row()?.['supermarketId'];
    return typeof chain === 'string' && chain !== '' ? chain : null;
  });
}
