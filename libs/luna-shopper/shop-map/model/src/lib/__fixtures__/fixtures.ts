import type { ShopMapDocument, ShopMapProblem, WalkOrder } from '../types';
import corner from './corner-shop.json';
import expected from './expected.json';
import invalid from './invalid.json';
import supermarket from './supermarket.json';

/** One aisle between two shelves, a deli counter, no checkout. */
export const cornerShop = corner as ShopMapDocument;

/** Six parallel aisles, a deli counter along the top, two checkouts. */
export const supermarketShop = supermarket as ShopMapDocument;

/** One document per rule of section 2, keyed by the code it breaks. */
export const invalidShops = invalid as Record<string, ShopMapDocument>;

export const expectedCornerShop = expected['corner-shop'] as {
  problems: ShopMapProblem[];
  walk: WalkOrder;
};

export const expectedSupermarket = expected.supermarket as {
  problems: ShopMapProblem[];
  walk: Omit<WalkOrder, 'route'> & {
    routeLength: number;
    routeStart: { x: number; y: number };
    routeEnd: { x: number; y: number };
  };
};

export const expectedInvalid = expected.invalid as Record<
  string,
  ShopMapProblem[]
>;

/** A deep copy, so a spec may change a fixture without touching the others. */
export function copyOf(doc: ShopMapDocument): ShopMapDocument {
  return JSON.parse(JSON.stringify(doc));
}
