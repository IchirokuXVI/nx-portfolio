import { appPath } from './app-path';

/**
 * Where the catalog's pages and sheets live in the route table (velista `0134`),
 * in one place.
 *
 * Here and not in the feature library that draws them, for `SHOP_PATHS`' reason:
 * the list page, the line page and the basket link to a product's page, and none
 * of them may import a lazily loaded feature library. `routes.spec.ts` asserts
 * the table agrees.
 */
export const CATALOG_PATHS = {
  /** `catalog`: the tab. */
  tab: 'catalog',
  /** `catalog/products/:itemId`: a product's own page. */
  products: 'products',
  /**
   * `<the covered page>/sheet/add-list`: the sheet that chooses the list the plus
   * adds to. Over the tab and over a product's page.
   */
  addListSheet: 'add-list',
  /** `catalog/sheet/added`: the sheet of what this visit added. Over the tab. */
  addedSheet: 'added',
} as const;

/** The URL of a product's page: `/{mount}/{locale}/catalog/products/{itemId}`. */
export function productPagePath(
  locale: string,
  basePath: string,
  itemId: string
): string {
  return appPath(
    locale,
    basePath,
    CATALOG_PATHS.tab,
    CATALOG_PATHS.products,
    itemId
  );
}
