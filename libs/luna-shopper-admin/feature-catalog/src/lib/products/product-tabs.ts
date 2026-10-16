import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RECORD_CONTEXT } from '@portfolio/luna-shopper-admin/feature-resource';
import { ItemSourceEntries } from '../item-source-entries';

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
