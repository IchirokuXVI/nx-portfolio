import type { ActivatedRouteSnapshot } from '@angular/router';

/**
 * The path of the page a route draws, as the URL holds it: the mount, the locale
 * and every segment down to this route, with no query and none of its children.
 *
 * Read off the route rather than off the URL, so a sheet open over the page or a
 * query on it never ends up in a link the page builds.
 */
export function routePath(route: ActivatedRouteSnapshot): string {
  const segments = route.pathFromRoot.flatMap((step) =>
    step.url.map((segment) => segment.path)
  );
  return `/${segments.join('/')}`;
}

/**
 * The page that opened a catalog picker (velista `0140`, review point 2): the
 * picker's own path with its own segments taken off.
 *
 * The supermarket and the category pickers are pages declared under the page
 * that opens them: `catalog/supermarket` under the tab and
 * `…/lines/:lineId/product/supermarket` under the catalog that chooses. So the way
 * back is in the route, and the same picker returns to whichever opened it, with
 * the mode and the line intact.
 *
 * @param own How many segments the picker adds: one for `supermarket` and
 *   `categories`, two for `categories/:parentSlug`.
 */
export function catalogOpenerPath(
  route: ActivatedRouteSnapshot,
  own: number
): string {
  const segments = routePath(route)
    .split('/')
    .filter((part) => part !== '');
  return `/${segments.slice(0, Math.max(0, segments.length - own)).join('/')}`;
}
