import type { ShopMapDocument } from './types';

/** The metres per cell a new document carries. Informative only. */
export const DEFAULT_CELL_METRES = 0.5;

/** The id of the one fixture an empty document has. */
export const EMPTY_ENTRANCE_ID = 'entrance';

/**
 * A valid empty document: all floor, with one entrance cell in the middle of
 * the bottom border, because a document with no entrance is not valid.
 */
export function emptyShopMap(cols: number, rows: number): ShopMapDocument {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 1 ||
    rows < 1
  ) {
    throw new RangeError(
      `A shop map needs whole positive sizes, got ${cols}x${rows}`
    );
  }
  return {
    version: 1,
    cell: DEFAULT_CELL_METRES,
    size: { cols, rows },
    fixtures: [
      {
        id: EMPTY_ENTRANCE_ID,
        kind: 'entrance',
        x: Math.floor(cols / 2),
        y: rows - 1,
        w: 1,
        h: 1,
      },
    ],
    anchors: [],
  };
}
