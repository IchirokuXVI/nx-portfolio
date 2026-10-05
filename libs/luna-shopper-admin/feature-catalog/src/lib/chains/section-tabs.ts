import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChainSections } from '../chain-sections';
import { LocationSections } from '../location-sections';
import { ChainContext } from './chain-context';
import { ShopContext } from './shop-context';

/**
 * The Sections tab of a chain (admin plan 0042, target 6): the chain's
 * sections panel, given the chain the page is about.
 *
 * A component of its own because a route draws a component, and the panel
 * takes its chain as an input. The page above holds the chain, so this reads
 * it from there and never from the address a second time.
 */
@Component({
  selector: 'lib-chain-sections-tab',
  imports: [ChainSections],
  template: `
    @if (chain.id(); as id) {
      <lib-chain-sections [supermarketId]="id" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainSectionsTab {
  readonly chain = inject(ChainContext);
}

/**
 * The Sections tab of a shop (admin plan 0042, target 5): the order the shop
 * walks its sections in.
 *
 * The panel needs the shop's chain and whether a map writes the list, and both
 * are on the shop the page already read. Until that read answers there is
 * nothing to order.
 */
@Component({
  selector: 'lib-shop-sections-tab',
  imports: [LocationSections, RokuTranslatorPipe],
  template: `
    @if (shop.shop(); as row) {
      <lib-location-sections
        [hasMap]="row.hasMap"
        [locationId]="row.id"
        [supermarketId]="row.supermarketId"
      />
    } @else if (shop.status() === 'loading') {
      <p class="muted" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    .muted {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopSectionsTab {
  readonly shop = inject(ShopContext);
}
