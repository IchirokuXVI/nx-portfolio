import type { AnchoredPopoverSide } from '@portfolio/velista/ui';

/** A band of the screen, in the viewport's pixels. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

const ROW = 'li.line[data-line-id]';

/**
 * How far from the edge of the visible area a row brought back into it stops, so
 * its question has room on that side (velista `0207`, target 11): `--app-space-5`.
 */
const ROOM = 16;

/**
 * The row a line is drawn as on the zone list, its amount control, and the mark
 * beside the row the popover is held against, or null when no row of the column
 * draws the line (a search or a filter that leaves it out, or a due row, which has
 * no amount control of this kind).
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

/**
 * What of the column can be seen: below the head block, which sits above the
 * column, and above the bar, which sits below it, inside the window.
 */
export function visibleBand(column: HTMLElement, windowHeight: number): Band {
  const rect = column.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top),
    bottom: Math.min(windowHeight, rect.bottom),
  };
}

/**
 * How far to scroll the column so the row is wholly inside the band, or 0 when it
 * already is. A row above it stops near the top, with room for the question under
 * it; a row below it stops near the bottom, with room above it.
 */
export function scrollToShow(band: Band, row: Band): number {
  if (row.top >= band.top && row.bottom <= band.bottom) {
    return 0;
  }
  return row.top < band.top
    ? row.top - (band.top + ROOM)
    : row.bottom - (band.bottom - ROOM);
}

/** Below a row in the upper half of the band, above one in the lower half. */
export function sideIn(band: Band, row: Band): AnchoredPopoverSide {
  const middle = (band.top + band.bottom) / 2;
  return (row.top + row.bottom) / 2 < middle ? 'below' : 'above';
}
