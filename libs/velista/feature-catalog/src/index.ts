/**
 * The catalog: every product every supermarket sells, browsed rather than searched
 * from a composer.
 *
 * The library exists before the screen does, and deliberately so. velista `0097` added
 * the bar with a Catalog tab in it, and a tab that leads nowhere is worse than no tab,
 * so it ships with a route and a page that says the screen is coming. `0100` builds the
 * screen at the same URL, in this library.
 *
 * Everything reachable from a route is exported here and nowhere else: the route table
 * lazy loads through this barrel, so a component that is not in it cannot be a page.
 */
export * from './lib/catalog-page/catalog-page';
