import type { Params } from '@angular/router';
import { catalogOrdersFor, type CatalogOrder } from '@portfolio/velista/models';
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

/**
 * The text in the field and the order pill, for the same reason. The pickers are
 * pages, the tab is destroyed while one is open, and whatever the URL does not hold
 * is gone when the answer comes back. A picker hands every parameter it was not
 * asked about back as it received it.
 */
export const SEARCH_PARAM = 'q';
export const ORDER_PARAM = 'order';

/** Every parameter of the choice, for a URL that has to be rid of an old one. */
export const CATALOG_PARAMS: readonly string[] = [
  CATEGORY_PARAM,
  CHAIN_PARAM,
  SHOP_PARAM,
  SEARCH_PARAM,
  ORDER_PARAM,
];

/** Everything the tab can be narrowed by through its URL. */
export interface CatalogChoice {
  readonly category: string | null;
  readonly chain: string | null;
  readonly shop: string | null;
  /** The text in the field, or null for none. */
  readonly query: string | null;
  /** The order, or null for the one the text alone decides (rule C2). */
  readonly order: CatalogOrder | null;
}

/** The order a search opens on: Best match with text, A to Z without (rule C2). */
export function defaultCatalogOrder(query: string): CatalogOrder {
  return catalogOrdersFor(query)[0];
}

/**
 * The order once this text has been asked for (rule C2): Best match is chosen the
 * moment a search begins and dropped the moment it ends.
 */
export function catalogOrderAfter(
  before: string,
  after: string,
  order: CatalogOrder
): CatalogOrder {
  if (before.trim() === '' && after.trim() !== '') {
    return 'relevance';
  }
  return after.trim() === '' && order === 'relevance' ? 'name' : order;
}

/**
 * The choice a URL's query holds. A blank value is no value, and so is an order the
 * text does not offer or would have chosen by itself.
 */
export function catalogChoiceOf(params: {
  get(name: string): string | null;
}): CatalogChoice {
  const read = (name: string) => {
    const value = params.get(name);
    return value === null || value.trim() === '' ? null : value;
  };
  const query = read(SEARCH_PARAM);
  const named = read(ORDER_PARAM);
  const order = catalogOrdersFor(query ?? '').find(
    (offered) => offered === named
  );
  return {
    category: read(CATEGORY_PARAM),
    chain: read(CHAIN_PARAM),
    shop: read(SHOP_PARAM),
    query,
    order:
      order === undefined || order === defaultCatalogOrder(query ?? '')
        ? null
        : order,
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
  if (choice.query !== null) {
    query[SEARCH_PARAM] = choice.query;
  }
  if (choice.order !== null) {
    query[ORDER_PARAM] = choice.order;
  }
  return query;
}
