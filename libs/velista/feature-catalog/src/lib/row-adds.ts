import type { ActivatedRouteSnapshot } from '@angular/router';
import {
  canStepLine,
  isUnsavedLine,
  lineStepOf,
  type AddTargetList,
  type HeldLine,
  type HoldingRow,
  type LineUnitProduct,
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
 * `productOf` is the page's records of the products it shows (velista `0186`,
 * decision E): each held row steps by `lineStepOf` over them, so a row of a
 * product stepped at 100 g steps its lines by 100 g. Absent, every row steps by
 * its unit's default.
 */
export function rowAdds(
  target: AddTargetList | null,
  held: readonly HeldLine[],
  productOf?: (itemId: string) => LineUnitProduct | null | undefined
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
      ...stepOf(line, productOf),
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
  for (const [itemId, rows] of lines) {
    byItem.set(itemId, { list: target.name, lines: rows });
  }

  return { plain: { list: target.name, lines: [] }, byItem };
}

/**
 * A held row's step, as a field to spread: the store's (`HeldLine.step`, over
 * the products this session read), else `lineStepOf` over the page's records,
 * else nothing, which steps by the unit's default.
 */
function stepOf(
  line: HeldLine,
  productOf:
    | ((itemId: string) => LineUnitProduct | null | undefined)
    | undefined
): { readonly step?: number } {
  const step =
    line.step ?? (productOf === undefined ? null : lineStepOf(line, productOf));
  return step === null ? {} : { step };
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
