import { Injectable } from '@angular/core';
import type { ShopDetail } from '@portfolio/velista/models';
import type { ShopDetailRead, ShopDetailServiceI } from './shop-detail-service';
import { MEMORY_SHOP_SECTIONS } from './shop-sections-memory';

/**
 * The shops this fake can name (velista `0121`). `loc-tejares` is `BasketMemory`'s
 * Mercadona and the one shop with a map in `ShopMapMemory`; `loc-centro` has no
 * map and no known size, which is the shop page's other half.
 */
export const MEMORY_SHOP_DETAILS: Readonly<Record<string, ShopDetail>> = {
  'loc-tejares': {
    id: 'loc-tejares',
    supermarketId: 'sm-mercadona',
    chain: { en: 'Mercadona', es: 'Mercadona' },
    label: null,
    address: 'Ronda de los Tejares 32',
    city: 'Córdoba',
    postalCode: '14008',
    footprintM2: 1187,
    hasMap: true,
    sections: (MEMORY_SHOP_SECTIONS['loc-tejares'] ?? []).map((one) => ({
      id: one.id,
      name: one.name,
    })),
  },
  'loc-centro': {
    id: 'loc-centro',
    supermarketId: 'sm-dia',
    chain: { en: 'Dia', es: 'Dia' },
    label: null,
    address: 'Calle Gondomar 4',
    city: 'Córdoba',
    postalCode: '14003',
    footprintM2: null,
    hasMap: false,
    sections: [],
  },
};

/** The in memory twin of `ShopDetailApi`. Asked for by name, never a default. */
@Injectable()
export class ShopDetailMemory implements ShopDetailServiceI {
  /** Every shop asked about, in order, for a spec that counts requests. */
  readonly asked: string[] = [];

  /** Set to make every read fail, as a gateway that does not answer would. */
  failing = false;

  async location(locationId: string): Promise<ShopDetailRead> {
    this.asked.push(locationId);
    if (this.failing) {
      return { kind: 'failed' };
    }
    const shop = MEMORY_SHOP_DETAILS[locationId];
    return shop === undefined ? { kind: 'missing' } : { kind: 'shop', shop };
  }
}
