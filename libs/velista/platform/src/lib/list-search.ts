import { computed, inject, Injectable, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, type ActivatedRoute, type Params } from '@angular/router';
import { PageNavigation } from './page-navigation';

/**
 * The query parameter that says a page's list search is open (velista `0109`).
 *
 * Only the open state is in the URL, never the term: the term changes on every
 * keystroke, and a history entry per keystroke is a back button nobody can use.
 */
export const SEARCH_QUERY_PARAM = 'search';

/**
 * Whether the list search on this page is open, from `?search=1`.
 *
 * The URL and not the field is what knows, so that the phone's back button has an entry
 * to pop: opening pushes one, and back takes it off and the field closes, the way it
 * closes a sheet.
 */
export function searchOpenOf(route: ActivatedRoute): Signal<boolean> {
  const query = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });

  return computed(() => query().has(SEARCH_QUERY_PARAM));
}

/**
 * Opening and closing a page's list search, which the zone list page and the basket
 * page do the same way (velista `0109`).
 *
 * `route` is the page's own route, so a URL built from it is the page and never a sheet
 * that happens to be open over it.
 */
@Injectable({ providedIn: 'root' })
export class ListSearchNavigation {
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);

  /**
   * The page again with `search=1` merged in, as a push, so that back has an entry to
   * take off. Merged, because the list page also reads `?line=`.
   */
  open(route: ActivatedRoute): Promise<boolean> {
    return this._router.navigate([], {
      relativeTo: route,
      queryParams: { [SEARCH_QUERY_PARAM]: '1' },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Cancel and Escape. They go back, as the phone's back button does, so the entry
   * opening pushed is taken off rather than covered by another.
   *
   * The fallback is the page without the parameter, for a URL with `search=1` opened
   * cold: nothing of this app is behind it, so the entry is replaced and the reader
   * stays in velista.
   */
  close(route: ActivatedRoute): Promise<void> {
    const fallback = this._router.createUrlTree(['.'], {
      relativeTo: route,
      queryParams: { [SEARCH_QUERY_PARAM]: null },
      queryParamsHandling: 'merge',
    });

    return this._pages.back(this._router.serializeUrl(fallback));
  }

  /**
   * The query a sheet opened over the page carries, so that closing the sheet comes
   * back to the search that was open under it rather than to a closed field and every
   * line.
   */
  kept(route: ActivatedRoute): Params {
    return route.snapshot.queryParamMap.has(SEARCH_QUERY_PARAM)
      ? { [SEARCH_QUERY_PARAM]: '1' }
      : {};
  }
}
