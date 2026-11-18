import type { ActivatedRouteSnapshot } from '@angular/router';
import type { CatalogAddMet } from '@portfolio/velista/data-access';
import {
  addUnitRefusalKey,
  canStepLine,
  isUnsavedLine,
  lineStepOf,
  type AddTargetList,
  type AddUnitRefusal,
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
  /**
   * What the plus of one row draws: the same object for the same product until
   * the lines move, so a row is redrawn only when its own lines do. Null with no
   * list to add to.
   */
  readonly of: (itemId: string) => ProductRowAdd | null;
}

/**
 * The plus of each product row and the lines under it (velista `0134`, section
 * 4.1), from the chosen list and the lines the store holds.
 *
 * Shared by the catalog page and the product page, whose similar products carry
 * the same plus and add to the same list.
 *
 * The plus is on only for a product that no saved line of the list holds (the
 * owner's decision 51 of 2026-11-16, which replaces velista `0185` decision C).
 * Any line counts, alone or among other products, at any amount, zero included,
 * and in any unit (decision 52 a): a line of another unit than the add's switches
 * the plus off too, so the server's refusal for a unit is never the answer to a
 * press. The line an add still on its way drew does not count, because it has no
 * id the list knows.
 *
 * A line above zero sets `onList`: the first such line in the order the card draws
 * them, and `pathOf` the list's URL, which the card's link opens with `?line=`.
 * Lines all at zero set `atZero`: the person raises the line under the card with
 * its own stepper, and there is no link, because the list hides its lines at zero.
 *
 * `productOf` is the page's records of the products it shows (velista `0186`,
 * decision E): each held row steps by `lineStepOf` over them, so a row of a
 * product stepped at 100 g steps its lines by 100 g. Absent, every row steps by
 * its unit's default.
 */
export function rowAdds(
  target: AddTargetList | null,
  held: readonly HeldLine[],
  pathOf: (target: AddTargetList) => string,
  productOf?: (itemId: string) => LineUnitProduct | null | undefined
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
  const path = pathOf(target);
  const plain: ProductRowAdd = { list: target.name, lines: [] };
  const drawn = new Map<string, ProductRowAdd>();
  const of = (itemId: string): ProductRowAdd => {
    const rows = lines.get(itemId);
    if (rows === undefined) {
      return plain;
    }
    const known = drawn.get(itemId);
    if (known !== undefined) {
      return known;
    }
    const saved = rows.filter((row) => !isUnsavedLine(row.lineId));
    const wanted = saved.find((row) => row.quantity > 0);
    const add: ProductRowAdd = {
      list: target.name,
      lines: rows,
      ...(wanted !== undefined
        ? { onList: { lineId: wanted.lineId, path } }
        : saved.length > 0
          ? { atZero: true as const }
          : {}),
    };
    drawn.set(itemId, add);
    return add;
  };

  return { plain, of };
}

/**
 * The sentence a failed add says (velista `0134`, section 4.1), as a key and its
 * arguments: why, for a product the list counts in another unit (velista `0185`,
 * section 4), which a card drawn before another device changed the list can still
 * meet; why, for a plus the server answered with a line already on the list
 * (`met`, a card drawn the same way), in the card's own words; and the generic
 * sentence for any other failure.
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
          : 'catalog.held.atZero',
      args: { list: met.list },
    };
  }
  return { key: 'catalog.add.failed', args: {} };
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
    line.step !== undefined
      ? line.step
      : productOf === undefined
        ? null
        : lineStepOf(line, productOf);
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
