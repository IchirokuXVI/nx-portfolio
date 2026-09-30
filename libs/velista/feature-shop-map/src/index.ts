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
export * from './lib/edit/area-sheet';
export * from './lib/edit/edit-map-page';
export * from './lib/edit/hold-menu';
export * from './lib/edit/map-edits';
export * from './lib/edit/resize-controls';
export * from './lib/edit/unsaved-dialog';
export * from './lib/record/mark-sheet';
export * from './lib/record/record-walk-page';
export * from './lib/record/suggestion-sheet';
export * from './lib/record/walk-recording';
export * from './lib/section-sheet/section-sheet';
export * from './lib/shop-map-page/shop-map-page';
export * from './lib/shop-map-view/shop-map-view';
export * from './lib/shop-page/shop-page';
export * from './lib/walks/delete-walk-sheet';
export * from './lib/walks/mapping-settings-page';
export * from './lib/walks/new-walk-sheet';
export * from './lib/walks/resume-warning-sheet';
export * from './lib/walks/shop-walks-page';
export * from './lib/walks/walk-history-page';
export * from './lib/walks/walk-rewind-page';
export * from './lib/walks/walk-settings-page';
export * from './lib/walks/walk-text';
