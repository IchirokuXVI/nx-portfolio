import type { ActivatedRouteSnapshot } from '@angular/router';
import type { CatalogAddMet } from '@portfolio/velista/data-access';
import {
  addUnitRefusalKey,
  canStepLine,
  isUnsavedLine,
  LINE_UNIT_FALLBACK,
  type AddTargetList,
  type AddUnitRefusal,
  type HeldLine,
  type HoldingRow,
  type LineUnit,
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
  /**
   * What the plus of one row draws, for a product the plus adds in `unit`: the
   * same object for the same product and unit until the lines move, so a row is
   * redrawn only when its own lines do. Null with no list to add to.
   */
  readonly of: (itemId: string, unit: LineUnit) => ProductRowAdd | null;
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
 *
 * Two or more saved lines at zero and none above switch the plus off too (the
 * owner's ruling of 2026-11-16): the server would ask which one, and the card asks
 * nothing. `pickLine` says so, and the person raises one of the lines under the
 * card with its own stepper. No link then: the list hides its lines at zero. One
 * line at zero keeps the plus, which raises it.
 *
 * Both count only the lines in the unit the plus adds in, the `unit` the row hands
 * the add (`lineUnitOfProduct`, carried as `ProductRowView.lineUnit`), because the
 * server matches a product add against the lines of its own unit alone (backend
 * `0260`, the matches of an add). A line of another unit is still drawn under the
 * card with its stepper; a press then meets no line of its unit and is refused with
 * the sentence of section 4, never answered as already on the list.
 */
export function rowAdds(
  target: AddTargetList | null,
  held: readonly HeldLine[],
  pathOf: (target: AddTargetList) => string
): RowAdds {
  if (target === null) {
    return { plain: null, of: () => null };
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
  const plain: ProductRowAdd = { list: target.name, lines: [] };
  const drawn = new Map<string, ProductRowAdd>();
  const of = (itemId: string, unit: LineUnit): ProductRowAdd => {
    const rows = lines.get(itemId);
    if (rows === undefined) {
      return plain;
    }
    const key = `${unit}/${itemId}`;
    const known = drawn.get(key);
    if (known !== undefined) {
      return known;
    }
    const saved = rows.filter(
      (row) =>
        !isUnsavedLine(row.lineId) &&
        // A line read with no unit counts pieces, as every mapper reads it.
        (row.unit ?? LINE_UNIT_FALLBACK) === unit
    );
    const wanted = saved.find((row) => row.quantity > 0);
    const kept = saved.filter((row) => row.quantity <= 0).length;
    const add: ProductRowAdd = {
      list: target.name,
      lines: rows,
      ...(wanted !== undefined
        ? { onList: { lineId: wanted.lineId, path } }
        : kept > 1
          ? { pickLine: true as const }
          : {}),
    };
    drawn.set(key, add);
    return add;
  };

  return { plain, of };
}

/**
 * The sentence a failed add says (velista `0134`, section 4.1), as a key and its
 * arguments: why, for a product the list counts in another unit (velista `0185`,
 * section 4); why, for a plus the server answered with a line already on the list
 * (`met`, a card drawn before another device changed the list), in the card's own
 * words; and the generic sentence for any other failure.
 */
export function addFailedCopy(
  refusal: AddUnitRefusal | null,
  met: CatalogAddMet | null = null
): {
  readonly key: string;
  readonly args: Record<string, unknown>;
} {
  if (refusal !== null) {
    return {
      key: addUnitRefusalKey(refusal, 'list'),
      args: { name: refusal.name },
    };
  }
  if (met !== null) {
    return {
      key:
        met.kind === 'onList'
          ? 'catalog.held.alreadyOn'
          : 'catalog.held.pickLine',
      args: { list: met.list },
    };
  }
  return { key: 'catalog.add.failed', args: {} };
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
