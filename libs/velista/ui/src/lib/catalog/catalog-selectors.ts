import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  CategorySelectorView,
  SupermarketSelectorView,
} from '@portfolio/velista/models';
import {
  ChevronDownIcon,
  CloseIcon,
  ListLinesIcon,
  StoreIcon,
} from '../icons/icons';
import { ChainLogo, type ChainLogoView } from '../shops/chain-logo';

/**
 * The catalog's two selectors, in one row under the search (velista `0134`,
 * section 2).
 *
 * The Supermarket button, the category row and the order pills were three stacked
 * rows. Each selector now names what the list shows, so a row of two says all of
 * it: "All supermarkets", "All categories", or the chain and the category chosen.
 *
 * ## A chosen selector is two controls
 *
 * The body opens the picker to change the choice. The cross is its own button
 * behind a hairline and clears that choice alone, so the other selector keeps its
 * value. With nothing chosen there is nothing to clear and the selector is one
 * button.
 *
 * ## The category shows the leaf alone
 *
 * Half a row has no room for "Drinks · Coffee". The accessible name says both.
 *
 * Plain values in, four events out: the page opens the picker pages and writes the
 * URL, because the choice lives in the address.
 */
@Component({
  selector: 'lib-catalog-selectors',
  imports: [
    ChainLogo,
    ChevronDownIcon,
    CloseIcon,
    ListLinesIcon,
    RokuTranslatorPipe,
    StoreIcon,
  ],
  template: `
    <span [class.is-set]="supermarket().chosen" class="pick is-wide">
      <button
        (click)="supermarketOpened.emit()"
        [attr.aria-label]="
          supermarketLabel().key | rokuT: supermarketLabel().args
        "
        class="body"
        type="button"
        data-selector="supermarket"
      >
        @if (supermarket().chosen) {
          <lib-chain-logo [logo]="logo()" size="xs" />
          <span class="text">{{ supermarket().name }}</span>
        } @else {
          <lib-store-icon class="lead" />
          <span class="text">{{ 'catalog.supermarket.all' | rokuT }}</span>
        }
        <lib-chevron-down-icon class="chevron" />
      </button>
      @if (supermarket().chosen) {
        <button
          (click)="supermarketCleared.emit()"
          [attr.aria-label]="'catalog.supermarket.clear' | rokuT"
          class="clear"
          type="button"
        >
          <lib-close-icon class="clear-glyph" />
        </button>
      }
    </span>

    <span [class.is-set]="category().chosen" class="pick">
      <button
        (click)="categoryOpened.emit()"
        [attr.aria-label]="categoryLabel().key | rokuT: categoryLabel().args"
        class="body"
        type="button"
        data-selector="category"
      >
        <lib-list-lines-icon class="lead" />
        <span class="text">{{
          category().chosen
            ? category().name
            : ('catalog.categories.all' | rokuT)
        }}</span>
        <lib-chevron-down-icon class="chevron" />
      </button>
      @if (category().chosen) {
        <button
          (click)="categoryCleared.emit()"
          [attr.aria-label]="'catalog.categories.clear' | rokuT"
          class="clear"
          type="button"
        >
          <lib-close-icon class="clear-glyph" />
        </button>
      }
    </span>
  `,
  styleUrl: './catalog-selectors.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogSelectors {
  readonly supermarket = input.required<SupermarketSelectorView>();
  readonly category = input.required<CategorySelectorView>();

  /** The Supermarket selector's body: open the supermarket picker. */
  readonly supermarketOpened = output<void>();
  /** Its cross: every supermarket again. */
  readonly supermarketCleared = output<void>();
  /** The Category selector's body: open the category picker. */
  readonly categoryOpened = output<void>();
  /** Its cross: every category again. */
  readonly categoryCleared = output<void>();

  protected readonly logo = computed<ChainLogoView>(() => ({
    logoUrl: this.supermarket().logoUrl,
    name: this.supermarket().name,
    store: false,
  }));

  /** What the selector holds and what a press does, in one name. */
  protected readonly supermarketLabel = computed(() => {
    const view = this.supermarket();
    if (!view.chosen) {
      return { key: 'catalog.selector.supermarketAll', args: {} };
    }
    return {
      key: view.anyShop
        ? 'catalog.selector.supermarketAny'
        : 'catalog.selector.supermarketShop',
      args: { chain: view.name },
    };
  });

  protected readonly categoryLabel = computed(() => {
    const view = this.category();
    if (!view.chosen) {
      return { key: 'catalog.selector.categoryAll', args: {} };
    }
    return view.root === null
      ? { key: 'catalog.selector.categoryRoot', args: { root: view.name } }
      : {
          key: 'catalog.selector.categoryLeaf',
          args: { root: view.root, leaf: view.name },
        };
  });
}
