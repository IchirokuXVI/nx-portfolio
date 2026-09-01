/**
 * The basket: the screen you carry around the shop, and the people you send it
 * to.
 *
 * Started by plan `0044` for the basket, its join screen and its sheets, and
 * shared with `0045`, which puts the history page and its rows here rather than
 * in a second library. Both are the same noun, a generated shopping list, and
 * splitting them would put a row and the page it opens on opposite sides of a
 * library boundary.
 *
 * Everything reachable from a route is exported here and nowhere else: the route
 * table lazy loads through this barrel, so a component that is not in it cannot
 * be a page.
 */
export * from './lib/basket-paths';
