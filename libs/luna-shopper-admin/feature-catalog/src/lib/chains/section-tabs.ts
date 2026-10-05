import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  RECORD_CONTEXT,
  ResourceChanges,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ChainSections } from '../chain-sections';
import { LocationSections } from '../location-sections';

/**
 * The Sections tab of a chain (admin plan 0042, target 6): the chain's
 * sections panel, given the chain the page is about.
 *
 * A component of its own because a route draws a component, and the panel
 * takes its chain as an input. It is a part of the chain's record (admin
 * plan 0056, section 3.1), so it learns the chain from `RECORD_CONTEXT` and
 * never from the address. The page builds it again for another chain.
 */
@Component({
  selector: 'lib-chain-sections-tab',
  imports: [ChainSections],
  template: ` <lib-chain-sections [supermarketId]="chainId" /> `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainSectionsTab {
  readonly chainId = inject(RECORD_CONTEXT).id;
}

/**
 * The Sections tab of a shop (admin plan 0042, target 5): the order the shop
 * walks its sections in.
 *
 * The panel needs the shop's chain and whether a map writes the list, and both
 * are on the shop the page already read. Until that read answers there is
 * nothing to order.
 *
 * **The count beside the tab is the shop's own list of sections**, so a save
 * of the order reads the shop again. The page does not: it reads again for
 * its own resource and for the lists it holds, and the order of a shop is
 * neither.
 */
@Component({
  selector: 'lib-shop-sections-tab',
  imports: [LocationSections, RokuTranslatorPipe],
  template: `
    @if (shop.row(); as row) {
      <lib-location-sections
        [hasMap]="row['hasMap'] === true"
        [locationId]="shop.id"
        [supermarketId]="chainOf(row)"
      />
    } @else {
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
  readonly shop = inject(RECORD_CONTEXT);

  constructor() {
    const changes = inject(ResourceChanges);
    let seen = changes.version('location-sections');
    effect(() => {
      const version = changes.version('location-sections');
      untracked(() => {
        if (version !== seen) {
          seen = version;
          void this.shop.reload();
        }
      });
    });
  }

  chainOf(row: Readonly<Record<string, unknown>>): string {
    const chain = row['supermarketId'];
    return typeof chain === 'string' ? chain : '';
  }
}
