/**
 * Pulling what a run needs out of a loaded page (plan 0090, section 10).
 *
 * Every Carrefour page renders its own data into `window.__INITIAL_STATE__`: a
 * listing page puts its cards, its pagination and its child categories there,
 * and a product page puts the product. **After hydration the served HTML no
 * longer contains the literal blob**, so the object is read from the live page
 * rather than parsed out of markup, and a captured copy of that object is what
 * this library's fixtures are.
 *
 * Everything here is defensive by construction. The state is a large object
 * owned by somebody else, so every field is read through a guard and a missing
 * one produces an empty value rather than a throw. A run that meets a page it
 * does not understand should record nothing for it and carry on.
 */

import type {
  CarrefourCard,
  CarrefourCategoryLink,
  CarrefourDetail,
  CarrefourListing,
} from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * The child or sibling categories a navigation block names.
 *
 * A node with no id or no url is dropped here rather than downstream, because
 * the walk addresses a category by its url and can do nothing with a half
 * stated one.
 */
function categoryLinks(node: unknown): CarrefourCategoryLink[] {
  const items = asRecord(node)['items'];
  if (!Array.isArray(items)) {
    return [];
  }
  const links: CarrefourCategoryLink[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    const id = asString(item['id']);
    const url = asString(item['url']);
    if (id && url) {
      links.push({ id, name: asString(item['display_name']), url });
    }
  }
  return links;
}

/**
 * Read a listing page.
 *
 * The two totals are **different questions and both are kept**. `total_results`
 * on the card list is what the result set holds; `total_pages * page_size` is
 * what paging will hand over, and it stops at the ceiling however large the
 * first number is (plan 0090, section 7). Comparing the wrong one against the
 * ceiling is how a run silently loses five products in six.
 */
export function readListing(state: Record<string, unknown>): CarrefourListing {
  const results = asRecord(asRecord(state['productCardList'])['results']);
  const pagination = asRecord(state['pagination']);
  const category = asRecord(state['category']);
  const navigation = asRecord(state['horizontalNavigation']);

  const cards = Array.isArray(results['items'])
    ? (results['items'] as unknown[])
        .map((item) => asRecord(item))
        .filter(
          (item) =>
            typeof item['product_id'] === 'string' &&
            typeof item['name'] === 'string'
        )
        .map((item) => item as unknown as CarrefourCard)
    : [];

  const pageSize = asNumber(pagination['page_size']);
  const totalPages = asNumber(pagination['total_pages']);

  return {
    cards,
    totalResults: asNumber(results['total_results']),
    pageableResults: pageSize * totalPages,
    pageSize,
    totalPages,
    displayName: asString(category['display_name']),
    firstLevelCategories: categoryLinks(navigation['firstLevelCategories']),
    secondLevelCategories: categoryLinks(navigation['secondLevelCategories']),
  };
}

/**
 * The size of the result set as the page itself states it, or null when the
 * page states none.
 *
 * {@link readListing} answers 0 for a missing total, which is right for the
 * frontier and wrong for the one question this answers: whether an empty page
 * is the end of its category. A page that states 0 says the set is empty; a
 * page that states nothing says nothing, and a walk must not read that as an
 * end.
 */
export function statedTotalResults(
  state: Record<string, unknown>
): number | null {
  const raw = asRecord(asRecord(state['productCardList'])['results'])[
    'total_results'
  ];
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return null;
  }
  const total = Number(raw);
  return raw !== '' && Number.isFinite(total) ? total : null;
}

/**
 * What paging will serve, `total_pages * page_size`, as the page itself states
 * it, or null when the page states either figure not at all (plan 0090,
 * section 7).
 *
 * {@link readListing} answers 0 for a missing figure, which a walk bounding
 * its last page by this number must not mistake for a page that serves
 * nothing.
 */
export function statedPageableResults(
  state: Record<string, unknown>
): number | null {
  const pagination = asRecord(state['pagination']);
  const size = statedNumber(pagination['page_size']);
  const pages = statedNumber(pagination['total_pages']);
  return size === null || pages === null ? null : size * pages;
}

function statedNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return null;
  }
  const number = Number(raw);
  return raw !== '' && Number.isFinite(number) ? number : null;
}

/**
 * Read a product page for the one field it is loaded for (plan 0090, 12.1).
 *
 * `pdp.product.ean` is a real EAN-13. Everything else the page adds, the
 * ingredients, the net content, the diet flags, is left where it is: the detail
 * pass costs one page load per product and exists to fill the field that lets a
 * product resolve with no person in the loop.
 *
 * A page with no product at all gives null, which is what a moved or a removed
 * product looks like, and a product with no EAN gives a detail whose `ean` is
 * null. **The second is a value and not an error**: some pages carry none, the
 * entry is written without one, and the fuzzy rung does its job.
 */
export function readDetail(
  state: Record<string, unknown>
): CarrefourDetail | null {
  const product = asRecord(asRecord(state['pdp'])['product']);
  const externalId = asString(product['product_id']);
  if (!externalId) {
    return null;
  }
  const ean = asString(product['ean']).trim();
  return { externalId, ean: ean || null };
}
