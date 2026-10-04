import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
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
import { ChainSections } from './chain-sections';

/** The chain screen's two tabs. */
export type ChainTab = 'details' | 'sections';

/**
 * The chain screen: the generic form, and beside it a Sections tab (admin plan
 * 0037, target 1).
 *
 * A tab rather than a panel under the form, because the two answer different
 * questions and each is long enough on a phone to push the other off the
 * screen: the form is what the chain *is*, and the sections are how its shops
 * are laid out. The form stays mounted while the other tab is open, so
 * switching tabs never loses what was typed.
 *
 * A chain being created has no sections yet, and gets no tabs at all.
 */
@Component({
  selector: 'lib-supermarket-form-page',
  imports: [
    PageHeader,
    ResourceForm,
    ConfirmDialog,
    ChainSections,
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

    @if (supermarketId() !== null) {
      <div
        [attr.aria-label]="'catalog.chainTabs.label' | rokuT"
        class="tabs"
        role="tablist"
      >
        <button
          (click)="tab.set('details')"
          [attr.aria-selected]="tab() === 'details'"
          [class.on]="tab() === 'details'"
          aria-controls="chain-tab-details"
          id="chain-tab-details-button"
          role="tab"
          type="button"
        >
          {{ 'catalog.chainTabs.details' | rokuT }}
        </button>
        <button
          (click)="tab.set('sections')"
          [attr.aria-selected]="tab() === 'sections'"
          [class.on]="tab() === 'sections'"
          aria-controls="chain-tab-sections"
          id="chain-tab-sections-button"
          role="tab"
          type="button"
        >
          {{ 'catalog.chainTabs.sections' | rokuT }}
        </button>
      </div>
    }

    <div
      [hidden]="tab() !== 'details'"
      aria-labelledby="chain-tab-details-button"
      class="panel"
      id="chain-tab-details"
      role="tabpanel"
    >
      @if (store.status() === 'loading') {
        <p class="state" role="status">
          {{ 'resource.form.loading' | rokuT }}
        </p>
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
    </div>

    @if (supermarketId(); as id) {
      @if (tab() === 'sections') {
        <div
          aria-labelledby="chain-tab-sections-button"
          class="panel"
          id="chain-tab-sections"
          role="tabpanel"
        >
          <lib-chain-sections [supermarketId]="id" />
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
      gap: var(--admin-space-4);
    }

    .tabs {
      display: flex;
      gap: var(--admin-space-1);
      border-block-end: 1px solid var(--admin-border);
    }

    .tabs button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: none;
      border-block-end: 2px solid transparent;
      margin-block-end: -1px;
      background: none;
      font: inherit;
      color: var(--admin-ink-muted);
      cursor: pointer;
    }

    .tabs button.on {
      border-block-end-color: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-ink);
    }

    .tabs button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .panel[hidden] {
      display: none;
    }

    .panel {
      display: flex;
      flex: 1;
      flex-direction: column;
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
export class SupermarketFormPage extends ResourceFormPage {
  private readonly _chainRoute = inject(ActivatedRoute);

  /** The tab open now. The form's own tab first, as the screen always opened. */
  readonly tab = signal<ChainTab>('details');

  /** The chain being edited, or `null` on a create. */
  readonly supermarketId = computed(() =>
    this.mode === 'edit'
      ? (this._chainRoute.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? null)
      : null
  );
}
