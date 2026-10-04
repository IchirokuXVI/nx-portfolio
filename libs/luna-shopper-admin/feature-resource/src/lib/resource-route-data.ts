import type { ActivatedRouteSnapshot } from '@angular/router';

/**
 * The keys the resource screens read off their route.
 *
 * Constants rather than string literals typed twice, because a mistyped route
 * `data` key is not a compile error anywhere: the route would carry a property
 * nobody reads and the page would find `undefined` where a descriptor should be.
 */

/** Route `data` key holding the {@link ResourceDescriptor} for the screen. */
export const RESOURCE_DESCRIPTOR = 'descriptor';

/** Route `data` key holding `'create'` or `'edit'`. */
export const RESOURCE_FORM_MODE = 'mode';

/** Route parameter holding the row's id, on the edit route. */
export const RESOURCE_ID_PARAM = 'id';

/**
 * Route `data` key naming the route parameter that holds the row's id, when it
 * is not {@link RESOURCE_ID_PARAM} (admin plan 0042).
 *
 * A chain's form is the Details tab at `/chains/:chainId/details`. The id is a
 * parameter of the page above the tab and is called what that page calls it.
 * The form looks for it on its own route and then on each route above.
 */
export const RESOURCE_ID_FROM = 'idParam';

/**
 * Route `data` key saying that the list is part of a larger page (admin plan
 * 0042), and which part.
 *
 * - `'tab'`: the list is a tab of a page that already drew the header, so it
 *   draws none and keeps its table.
 * - `'column'`: the list is a column beside the row that is open, so it draws
 *   one line per row and marks the open one.
 *
 * Absent, the list is the whole page, which is what it always was.
 */
export const RESOURCE_LIST_EMBED = 'embed';

/** What {@link RESOURCE_LIST_EMBED} holds. */
export type ResourceListEmbed = 'tab' | 'column';

/**
 * A route parameter, read from the closest route that holds it.
 *
 * A child route does not inherit the parameters of a parent that has a
 * component, so a tab cannot read the id of the page it is a tab of from its
 * own snapshot. This walks up instead, closest first.
 */
export function routeParam(
  route: ActivatedRouteSnapshot,
  name: string
): string | null {
  for (const snapshot of [...route.pathFromRoot].reverse()) {
    const value = snapshot.paramMap.get(name);
    if (value !== null && value !== '') {
      return value;
    }
  }
  return null;
}
