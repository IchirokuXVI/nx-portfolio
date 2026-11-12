import type { ActivatedRouteSnapshot } from '@angular/router';
import {
  addUnitRefusalKey,
  canStepLine,
  isUnsavedLine,
  type AddTargetList,
  type AddUnitRefusal,
  type HeldLine,
  type HoldingRow,
} from '@portfolio/velista/models';
import type { ProductRowAdd } from '@portfolio/velista/ui';

/** What the plus of every row draws, for one chosen list. */
export interface RowAdds {
  /**
   * The plus of a row whose product the chosen list does not hold. One object for
   * all of them, so a row is redrawn only when its own lines move. Null with no
   * list to add to, which draws no plus at all.
   */
  readonly plain: ProductRowAdd | null;
  /** The rows whose product the chosen list holds, by product. */
  readonly byItem: ReadonlyMap<string, ProductRowAdd>;
}

/**
 * The plus of each product row and the lines under it (velista `0134`, section
 * 4.1), from the chosen list and the lines the store holds.
 *
 * Shared by the catalog page and the product page, whose similar products carry
 * the same plus and add to the same list.
 *
 * A product a line of the list asks for, alone or among other products, has its
 * plus switched off (velista `0185`, C1 and decision C): an add would change
 * nothing. `onList` names the first such line in the order the card draws them,
 * and `pathOf` the list's URL, which the card's link opens with `?line=`. A line at
 * zero does not count, because a press raises it, and neither does the line an
 * add still on its way drew, which has no id the list knows.
 */
export function rowAdds(
  target: AddTargetList | null,
  held: readonly HeldLine[],
  pathOf: (target: AddTargetList) => string
): RowAdds {
  const byItem = new Map<string, ProductRowAdd>();
  if (target === null) {
    return { plain: null, byItem };
  }

  const lines = new Map<string, HoldingRow[]>();
  for (const line of held) {
    if (line.listId !== target.listId) {
      continue;
    }
    const row: HoldingRow = {
      lineId: line.lineId,
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      editable:
        !isUnsavedLine(line.lineId) &&
        canStepLine(target.permissions, line.pending),
      pending: line.pending,
    };
    for (const itemId of line.itemIds) {
      const rows = lines.get(itemId);
      if (rows === undefined) {
        lines.set(itemId, [row]);
      } else {
        rows.push(row);
      }
    }
  }
  const path = pathOf(target);
  for (const [itemId, rows] of lines) {
    const wanted = rows.find(
      (row) => row.quantity > 0 && !isUnsavedLine(row.lineId)
    );
    byItem.set(itemId, {
      list: target.name,
      lines: rows,
      ...(wanted === undefined
        ? {}
        : { onList: { lineId: wanted.lineId, path } }),
    });
  }

  return { plain: { list: target.name, lines: [] }, byItem };
}

/**
 * The sentence a failed add says (velista `0134`, section 4.1), as a key and its
 * arguments: why, for a product the list counts in another unit (velista `0185`,
 * section 4), and the generic sentence for any other failure.
 */
export function addFailedCopy(refusal: AddUnitRefusal | null): {
  readonly key: string;
  readonly args: Record<string, unknown>;
} {
  return refusal === null
    ? { key: 'catalog.add.failed', args: {} }
    : { key: addUnitRefusalKey(refusal, 'list'), args: { name: refusal.name } };
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
