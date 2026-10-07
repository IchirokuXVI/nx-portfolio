/**
 * The catalog: every product every supermarket sells, browsed rather than searched
 * from a composer (velista `0100`).
 *
 * Everything reachable from a route is exported here and nowhere else: the route table
 * lazy loads through this barrel, so a component that is not in it cannot be a page.
 */
export * from './lib/add-list-sheet/add-list-sheet';
export * from './lib/added-sheet/added-sheet';
export * from './lib/catalog-page/catalog-page';
export * from './lib/categories-page/categories-page';
export * from './lib/category-children-page/category-children-page';
export * from './lib/product-page/product-page';
export * from './lib/supermarket-page/supermarket-page';
