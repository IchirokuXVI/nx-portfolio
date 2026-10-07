import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RECORD_CONTEXT } from '@portfolio/luna-shopper-admin/feature-resource';
import { ItemSectionsPanel } from '../item-sections-panel';
import { ItemSourceEntries } from '../item-source-entries';

/**
 * The "Where it is" tab of a product (admin plan 0043, target 3): where the
 * product is in each chain's shops.
 *
 * A component of its own because a route draws a component, and the panel
 * takes its product as an input. It is a part of the product's record (admin
 * plan 0055, target 7), so it learns the product from `RECORD_CONTEXT` and
 * never from the address. The page builds it again for another product.
 */
@Component({
  selector: 'lib-product-where-tab',
  imports: [ItemSectionsPanel],
  template: ` <lib-item-sections-panel [itemId]="itemId" /> `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductWhereTab {
  readonly itemId = inject(RECORD_CONTEXT).id;
}

/**
 * The Sources tab of a product (admin plan 0043, target 3): the chain rows
 * that name it. The count beside the tab is `ProductCounts`', read once for
 * the header.
 */
@Component({
  selector: 'lib-product-sources-tab',
  imports: [ItemSourceEntries],
  template: ` <lib-item-source-entries [itemId]="itemId" /> `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductSourcesTab {
  readonly itemId = inject(RECORD_CONTEXT).id;
}
