import { computed, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { ActivatedRoute } from '@angular/router';

/**
 * The route parameters every screen in this library reads, as signals.
 *
 * ## Why not a snapshot
 *
 * The router **reuses a component** when only a parameter changes, so
 * `route.snapshot.paramMap.get('zoneId')` read once in a constructor is correct exactly
 * until somebody navigates from one group to another. After that the page renders the
 * new group's name over the old group's rows, which is the kind of bug that survives
 * review because every screenshot of it looks fine.
 *
 * ## Why not `withComponentInputBinding`
 *
 * That would be the tidier version of the same thing, and this app cannot rely on it.
 * Velista is mounted by the shell, so the **shell's** `provideRouter` decides whether
 * route inputs are bound, and it does not enable them. A page written against route
 * inputs would work in the standalone build and receive `undefined` in the one that
 * ships (plan 0001, the extraction contract).
 *
 * The parameter is walked up the route tree rather than read off one route, because a
 * sheet is a child of the page it covers: `MemberActionSheet` sits three levels below
 * the route that declares `:zoneId` and still needs it.
 */
function paramSignal(route: ActivatedRoute, name: string): Signal<string> {
  const params = toSignal(route.paramMap, {
    initialValue: route.snapshot.paramMap,
  });

  return computed(() => {
    // Reading the signal is what makes this recompute on a parameter change; the walk
    // below still has to start from the snapshot, because only the leaf route's own
    // map is emitted and an ancestor's is not.
    const own = params().get(name);
    if (own !== null) {
      return own;
    }

    for (
      let current: ActivatedRoute | null = route.snapshot.parent
        ? route.parent
        : null;
      current !== null;
      current = current.parent
    ) {
      const value = current.snapshot.paramMap.get(name);
      if (value !== null) {
        return value;
      }
    }

    return '';
  });
}

/** The group this screen is about. Empty string only if the route is misdeclared. */
export function zoneIdOf(route: ActivatedRoute): Signal<string> {
  return paramSignal(route, 'zoneId');
}

/** The membership a confirm sheet is about. */
export function membershipIdOf(route: ActivatedRoute): Signal<string> {
  return paramSignal(route, 'membershipId');
}

/** The list this screen is about (plan 0012, rule L1). */
export function listIdOf(route: ActivatedRoute): Signal<string> {
  return paramSignal(route, 'listId');
}

/**
 * The line a sheet over the list page is about.
 *
 * Walked up the tree like the rest, which matters more here than anywhere: the delete
 * confirm sits at `lines/:lineId/confirm/delete`, two levels below the route that
 * declares the parameter.
 */
export function lineIdOf(route: ActivatedRoute): Signal<string> {
  return paramSignal(route, 'lineId');
}

/**
 * The basket a screen under `shopping-lists/:generatedListId` is about.
 *
 * Walked up the tree like the rest, and every reader of it is a sheet rather than the
 * page: the page holds the parameter on its own route, while the sheets that cover it
 * sit one and three levels below it.
 */
export function generatedListIdOf(route: ActivatedRoute): Signal<string> {
  return paramSignal(route, 'generatedListId');
}

/**
 * The line a link asked the list page to show, from `?line=` (plan 0032, section 8).
 *
 * A **query parameter** and not a route segment, and that is the whole design rather
 * than a shortcut. The list page has three sheets that address a line and all three
 * *do something* to it — edit, comment, delete. None of them simply shows one. A link
 * in a chat message that opened an edit form would have changed what the app is doing
 * because somebody wanted to look at something, and for the people that panel exists
 * for an unasked-for form over the screen is the failure mode, not a convenience.
 *
 * So this addresses a line without routing to one: the page scrolls to it, marks it,
 * and opens nothing. Empty when absent, which is the ordinary case for every arrival
 * that did not come from a reply.
 */
export function lineQueryOf(route: ActivatedRoute): Signal<string> {
  const query = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });

  // Query parameters belong to the whole URL rather than to one route, so unlike the
  // parameters above there is no tree to walk: the leaf's map already has them.
  return computed(() => query().get('line') ?? '');
}
