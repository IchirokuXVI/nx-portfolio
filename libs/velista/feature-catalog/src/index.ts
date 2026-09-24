/**
 * The catalog: every product every supermarket sells, browsed rather than searched
 * from a composer (velista `0100`).
 *
 * Everything reachable from a route is exported here and nowhere else: the route table
 * lazy loads through this barrel, so a component that is not in it cannot be a page.
 */
export * from './lib/catalog-page/catalog-page';
export * from './lib/product-sheet/product-sheet';
