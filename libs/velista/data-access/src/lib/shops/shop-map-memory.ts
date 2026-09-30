import { Injectable } from '@angular/core';
import {
  shopperView,
  type ShopMapDocumentV2,
} from '@portfolio/luna-shopper/shop-map/model';
import type { ShopMapRead } from '@portfolio/velista/models';
import { toShopMapRead } from '../mapping/shop-map-mappers';
import type { ShopMapServiceI } from './shop-map-service';

/**
 * The walk behind `loc-tejares`'s map: a 12 m by 8 m shop with two gondolas, the
 * eggs of `MEMORY_SHOP_SECTIONS` and a note beside them, a checkout and the door.
 */
const TEJARES_WALK: ShopMapDocumentV2 = {
  version: 2,
  areas: [
    {
      id: 'area-eggs',
      kind: 'shelf',
      x: 2,
      y: 2,
      w: 6,
      h: 1,
      section: 'Huevos',
      colour: { mode: 'default' },
      origin: 'section-run',
    },
    {
      id: 'area-pantry',
      kind: 'shelf',
      x: 2,
      y: 4.5,
      w: 6,
      h: 1,
      section: 'Despensa',
      colour: { mode: 'default' },
      origin: 'section-run',
    },
    {
      id: 'area-till',
      kind: 'checkout',
      x: 9.5,
      y: 6,
      w: 1.5,
      h: 1,
      colour: { mode: 'default' },
      origin: 'drawn',
    },
    {
      id: 'area-door',
      kind: 'entrance',
      x: 0.5,
      y: 7,
      w: 2,
      h: 0.5,
      colour: { mode: 'default' },
      origin: 'drawn',
    },
  ],
  marks: [
    {
      id: 'note-eggs',
      kind: 'note',
      x: 8.5,
      y: 2.5,
      heading: 90,
      text: 'Free range eggs are on the bottom shelf.',
      logMs: 42_000,
    },
  ],
  path: [
    {
      points: [
        [1, 7],
        [1, 1],
        [9, 1],
        [9, 7],
        [1, 7],
      ],
    },
    {
      points: [
        [1, 3.75],
        [9, 3.75],
      ],
    },
  ],
};

/** Each shop's map as the gateway would answer it, keyed by location id. */
export const MEMORY_SHOP_MAPS: Readonly<Record<string, unknown>> = {
  'loc-tejares': {
    map: {
      walkId: 'walk-tejares',
      savedAt: '2026-09-29T12:42:00.000Z',
      view: shopperView(TEJARES_WALK),
      sections: [
        { name: 'Huevos', sectionId: 'sec-mercadona-eggs' },
        { name: 'Despensa', sectionId: 'sec-mercadona-pantry' },
      ],
    },
  },
};

/** The in memory twin of `ShopMapApi`. Asked for by name, never a default. */
@Injectable()
export class ShopMapMemory implements ShopMapServiceI {
  /** Every shop asked about, in order, for a spec that counts requests. */
  readonly asked: string[] = [];

  /** Set to make every read fail, as a gateway that does not answer would. */
  failing = false;

  async map(locationId: string): Promise<ShopMapRead> {
    this.asked.push(locationId);
    if (this.failing) {
      return { kind: 'failed' };
    }
    return toShopMapRead(MEMORY_SHOP_MAPS[locationId] ?? { map: null });
  }
}
