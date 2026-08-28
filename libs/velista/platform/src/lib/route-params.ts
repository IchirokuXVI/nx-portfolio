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
