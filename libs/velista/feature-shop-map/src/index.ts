/**
 * A shop's own page, and the map of the shop you are in (velista `0121`).
 *
 * Every page and sheet under `shops/:locationId` lives here: the shop page, the
 * map every shopper sees and the section sheet over it, and the Angular wrapper
 * of the shared canvas. Velista `0122`, `0123` and `0126` add their routes under
 * the same path in this library.
 *
 * Everything reachable from a route is exported here and nowhere else: the route
 * table lazy loads through this barrel.
 */
export * from './lib/section-sheet/section-sheet';
export * from './lib/shop-map-page/shop-map-page';
export * from './lib/shop-map-view/shop-map-view';
export * from './lib/shop-page/shop-page';
