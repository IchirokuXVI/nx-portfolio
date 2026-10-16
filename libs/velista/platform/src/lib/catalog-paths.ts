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
  /**
   * `zones/:zoneId/lists/:listId/lines/:lineId/product`: the catalog opened to
   * choose one product for a line (velista `0140`, section 3; `0146`, section 2).
   * A page and not a sheet, so it is addressed under the line and not under the
   * `sheet` marker.
   */
  pickOne: 'product',
  /**
   * `zones/:zoneId/lists/:listId/lines/:lineId/products`: the catalog opened to
   * choose the whole set of products of a line, from the line page (velista
   * `0146`, section 3). A page, under the line, for {@link pickOne}'s reason.
   */
  pickSet: 'products',
  /** `<the catalog page>/supermarket`: its supermarket picker (velista `0124`). */
  supermarketPicker: 'supermarket',
  /** `<the catalog page>/categories[/:parentSlug]`: its category picker (`0119`). */
  categoryPicker: 'categories',
} as const;

/**
 * The route data key that opens the catalog page to choose rather than as the tab
 * (velista `0140`, section 3), and the kind it chooses: `'one'`, or `'set'` for
 * the products of a line (velista `0146`). The route
 * says it because the page has no inputs, and the pickers under the page carry it
 * too, so they know they answer to it.
 */
export const CATALOG_PICK_DATA = 'catalogPick';

/**
 * The URL of the catalog opened to choose one product for a line:
 * `/{mount}/{locale}/zones/{zoneId}/lists/{listId}/lines/{lineId}/product`.
 */
export function productPickPath(
  locale: string,
  basePath: string,
  zoneId: string,
  listId: string,
  lineId: string
): string {
  return appPath(
    locale,
    basePath,
    'zones',
    zoneId,
    'lists',
    listId,
    'lines',
    lineId,
    CATALOG_PATHS.pickOne
  );
}

/**
 * The URL of the catalog opened to choose the products of a line:
 * `/{mount}/{locale}/zones/{zoneId}/lists/{listId}/lines/{lineId}/products`.
 */
export function productsPickPath(
  locale: string,
  basePath: string,
  zoneId: string,
  listId: string,
  lineId: string
): string {
  return appPath(
    locale,
    basePath,
    'zones',
    zoneId,
    'lists',
    listId,
    'lines',
    lineId,
    CATALOG_PATHS.pickSet
  );
}

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
