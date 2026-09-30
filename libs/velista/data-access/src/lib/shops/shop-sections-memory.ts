import { Injectable } from '@angular/core';
import type { ShopSection, ShopSections } from '@portfolio/velista/models';
import type { ShopSectionsServiceI } from './shop-sections-service';

/**
 * The sections of the one shop in memory that has any (velista `0120`).
 *
 * `loc-tejares` is `BasketMemory`'s Mercadona, and it has a single section, eggs, so
 * a backend-less basket bought there draws one aisle, the band, and the milk under
 * its own category. Every other shop has none, which is the shop nobody configured.
 */
export const MEMORY_SHOP_SECTIONS: Readonly<
  Record<string, readonly ShopSection[]>
> = {
  'loc-tejares': [
    {
      id: 'sec-mercadona-eggs',
      supermarketId: 'sm-mercadona',
      slug: 'eggs',
      name: { en: 'Eggs', es: 'Huevos' },
      position: 0,
      categoryIds: ['cat-eggs'],
    },
  ],
};

/**
 * Which sections of a memory shop hold a product, as the basket read at that shop
 * answers it: the product's ids at a shop with sections, an empty list at a shop
 * with none, and null at no shop.
 */
export function memorySectionIdsAt(
  locationId: string | undefined,
  categoryIds: readonly string[]
): readonly string[] | null {
  if (locationId === undefined) {
    return null;
  }
  return (MEMORY_SHOP_SECTIONS[locationId] ?? [])
    .filter((one) => one.categoryIds.some((id) => categoryIds.includes(id)))
    .map((one) => one.id);
}

/** The in memory twin of `ShopSectionsApi`. Asked for by name, never a default. */
@Injectable()
export class ShopSectionsMemory implements ShopSectionsServiceI {
  /** Every shop asked about, in order, for a spec that counts requests. */
  readonly asked: string[] = [];

  /** Set to make every read fail, as a gateway that does not answer would. */
  failing = false;

  async sections(locationId: string): Promise<ShopSections | null> {
    this.asked.push(locationId);
    if (this.failing) {
      return null;
    }
    return {
      sections: MEMORY_SHOP_SECTIONS[locationId] ?? [],
      source: 'CHAIN',
    };
  }
}
