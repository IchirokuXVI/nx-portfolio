const ROW = 'li.line[data-line-id]';

/**
 * The row a line is drawn as on the zone list, its amount control, and the mark
 * beside the row the popover is held against, or null when no row of the column
 * draws the line (a search or a filter that leaves it out, or a due row, which has
 * no amount control of this kind). Where the question goes and how the row is
 * brought into view is the `ExtraAskHost`'s (velista `0208`, target state 10).
 */
export function extraAskParts(
  column: HTMLElement,
  lineId: string
): {
  readonly row: HTMLElement;
  readonly anchor: HTMLElement;
  readonly origin: HTMLElement;
} | null {
  for (const item of Array.from(column.querySelectorAll<HTMLElement>(ROW))) {
    if (item.dataset['lineId'] !== lineId) {
      continue;
    }
    const row = item.querySelector<HTMLElement>('[data-line-row]');
    const anchor = row?.querySelector<HTMLElement>('[data-amount-control]');
    const origin = item.querySelector<HTMLElement>(
      ':scope > [data-ask-anchor]'
    );
    if (row && anchor && origin) {
      return { row, anchor, origin };
    }
  }
  return null;
}

/**
 * Lay the mark over the amount control, in the list item's own coordinates, so the
 * popover held against the mark points at the control and moves with the row.
 */
export function placeOver(origin: HTMLElement, control: HTMLElement): void {
  const item = origin.offsetParent ?? origin.parentElement;
  const from = item?.getBoundingClientRect();
  const box = control.getBoundingClientRect();
  origin.style.top = `${box.top - (from?.top ?? 0)}px`;
  origin.style.left = `${box.left - (from?.left ?? 0)}px`;
  origin.style.width = `${box.width}px`;
  origin.style.height = `${box.height}px`;
}
