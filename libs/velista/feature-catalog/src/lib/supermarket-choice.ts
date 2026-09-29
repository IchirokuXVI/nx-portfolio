import type { Params } from '@angular/router';
import { CATEGORY_PARAM } from './category-choice';

/**
 * The query parameters that hold the catalog's supermarket (velista `0124`,
 * target 8), beside `?category=`.
 *
 * `?chain=<supermarketId>` narrows the tab to one chain, and `?shop=<locationId>`
 * narrows it further to one of that chain's shops. A shop also sets its chain, so a
 * link names both. The URL is the one place the choice lives, because the picker is
 * a page of its own and a component signal on the tab is a place that page cannot
 * reach. Nothing is remembered on the next visit.
 */
export const CHAIN_PARAM = 'chain';
export const SHOP_PARAM = 'shop';

/** Everything the tab can be narrowed by through its URL. */
export interface CatalogChoice {
  readonly category: string | null;
  readonly chain: string | null;
  readonly shop: string | null;
}

/** The choice a URL's query holds. A blank value is no value. */
export function catalogChoiceOf(params: {
  get(name: string): string | null;
}): CatalogChoice {
  const read = (name: string) => {
    const value = params.get(name);
    return value === null || value.trim() === '' ? null : value;
  };
  return {
    category: read(CATEGORY_PARAM),
    chain: read(CHAIN_PARAM),
    shop: read(SHOP_PARAM),
  };
}

/** The query that carries a choice, with nothing for what is not chosen. */
export function catalogQueryOf(choice: CatalogChoice): Params {
  const query: Params = {};
  if (choice.category !== null) {
    query[CATEGORY_PARAM] = choice.category;
  }
  if (choice.chain !== null) {
    query[CHAIN_PARAM] = choice.chain;
  }
  if (choice.shop !== null) {
    query[SHOP_PARAM] = choice.shop;
  }
  return query;
}
