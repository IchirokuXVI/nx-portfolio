import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ItemSectionsPanel } from '../item-sections-panel';
import { ItemSourceEntries } from '../item-source-entries';
import { ProductContext } from './product-context';

/**
 * The "Where it is" tab of a product (admin plan 0043, target 3): where the
 * product is in each chain's shops.
 *
 * A component of its own because a route draws a component, and the panel
 * takes its product as an input. The page above holds the product, so this
 * reads it from there and never from the address a second time.
 */
@Component({
  selector: 'lib-product-where-tab',
  imports: [ItemSectionsPanel],
  template: `
    @if (product.id(); as id) {
      <lib-item-sections-panel [itemId]="id" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductWhereTab {
  readonly product = inject(ProductContext);
}

/**
 * The Sources tab of a product (admin plan 0043, target 3): the chain rows
 * that name it. The tab's count is the page's, read once for the header.
 */
@Component({
  selector: 'lib-product-sources-tab',
  imports: [ItemSourceEntries],
  template: `
    @if (product.id(); as id) {
      <lib-item-source-entries [itemId]="id" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductSourcesTab {
  readonly product = inject(ProductContext);
}
