import type { ActivatedRouteSnapshot } from '@angular/router';
import {
  visitFloor,
  type AddTargetList,
  type CatalogVisit,
} from '@portfolio/velista/models';
import type { ProductRowAdd } from '@portfolio/velista/ui';

/** What the plus of every row draws, for one chosen list. */
export interface RowAdds {
  /**
   * The plus of a row with nothing on the chosen list. One object for all of
   * them, so a row is redrawn only when its own count moves. Null with no list to
   * add to, which draws no plus at all.
   */
  readonly plain: ProductRowAdd | null;
  /** The rows that hold a count, by product. */
  readonly byItem: ReadonlyMap<string, ProductRowAdd>;
}

/**
 * The plus of each product row (velista `0134`, section 4.1), from the chosen
 * list, the record of the visit and the row whose stepper is open.
 *
 * Shared by the catalog page and the product page, whose similar products carry
 * the same plus and add to the same list.
 */
export function rowAdds(
  target: AddTargetList | null,
  visit: CatalogVisit,
  stepperOpen: string | null
): RowAdds {
  const byItem = new Map<string, ProductRowAdd>();
  if (target === null) {
    return { plain: null, byItem };
  }
  for (const entry of visit) {
    if (entry.listId === target.listId) {
      byItem.set(entry.itemId, {
        count: entry.quantity,
        floor: visitFloor(entry),
        open: stepperOpen === entry.itemId,
        list: target.name,
      });
    }
  }
  return {
    plain: { count: 0, floor: 1, open: false, list: target.name },
    byItem,
  };
}

/**
 * The URL of the page a sheet covers: every segment down to its parent route, which
 * is that page, and nothing of the sheet below it.
 *
 * Read from the route rather than built from a path, because the sheet of lists is
 * declared over two pages and the only fact they share is that the sheet is their
 * direct child. The locale and the mount are already among the segments, so a
 * standalone build and the portfolio's mount both come out right.
 */
export function coveredPageUrl(sheet: ActivatedRouteSnapshot): string {
  const segments = (sheet.parent?.pathFromRoot ?? []).flatMap((route) =>
    route.url.map((segment) => encodeURIComponent(segment.path))
  );
  return `/${segments.join('/')}`;
}
