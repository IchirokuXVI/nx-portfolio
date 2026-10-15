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
import { LocationSections } from '../location-sections';

/**
 * The Sections tab of a shop (admin plan 0063): the one place a section of
 * the shop is added, opened, ordered and deleted.
 *
 * The panel needs the shop's chain, which is part of the address of a
 * section, and whether a map writes the order. Both are on the shop the page
 * already read. Until that read answers there is nothing to draw.
 *
 * **The count beside the tab is the shop's own list of section names**, so a
 * write of a section or of the order reads the shop again. The page does not:
 * it reads again for its own resource and for the lists it holds, and the
 * sections of a shop are neither.
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
    const written = () =>
      changes.version('location-sections') + changes.version('sections');
    let seen = written();
    effect(() => {
      const version = written();
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
