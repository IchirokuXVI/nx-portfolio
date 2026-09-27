import {
  trackToWalk,
  walkToDocument,
  type Track,
  type Walk,
  type WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import type { PlotRect } from './walk-plot';

/** How many empty cells `walkToDocument` leaves around the walk (recorder plan 0001, section 3). */
const MARGIN_CELLS = 2;

/**
 * The draft map of recorder plan 0001 over a snap mode's track, as rectangles in
 * metres on the track's own floor (recorder plan 0002, section 7.3).
 *
 * `trackToWalk` puts the track on cells with the start at cell `(0, 0)`, x east and
 * y north like the track itself. `walkToDocument` then moves the walk so its
 * bounding box starts `MARGIN_CELLS` from the document's corner, with rows running
 * down the page. So a document cell goes back to a walk cell by undoing both, and a
 * walk cell times `cellMetres` is a point on the track.
 *
 * Answers no rectangles when either function throws, so a draft that cannot be made
 * hides its layer rather than the viewer.
 */
export function draftRects(walk: WalkFile, track: Track): PlotRect[] {
  let draft: Walk;
  try {
    draft = trackToWalk(walk, track);
  } catch {
    return [];
  }

  let doc: ReturnType<typeof walkToDocument>;
  try {
    doc = walkToDocument(draft, { cellMetres: walk.settings.cellMetres });
  } catch {
    return [];
  }

  const cell = walk.settings.cellMetres;
  const box = cellBox(draft);

  return doc.fixtures.map((fixture) => {
    // Document columns run east from the box's west edge less the margin; document
    // rows run south from its north edge plus the margin.
    const west = fixture.x + box.minX - MARGIN_CELLS;
    const north = box.maxY + MARGIN_CELLS - fixture.y;
    return {
      id: fixture.id,
      kind: fixture.kind,
      // A cell is centred on its coordinate, so its edge is half a cell out.
      x: (west - 0.5) * cell,
      y: (north - fixture.h + 0.5) * cell,
      w: fixture.w * cell,
      h: fixture.h * cell,
    };
  });
}

/** The walk's bounding box in cells, over its segments and its marks. */
export function cellBox(walk: Walk): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const cells = [
    { x: 0, y: 0 },
    ...walk.segments.flatMap((s) => [s.from, s.to]),
    ...walk.marks.map((m) => m.at),
    ...walk.notes.map((n) => n.at),
    ...walk.scans.map((s) => s.at),
  ];
  return {
    minX: Math.min(...cells.map((c) => c.x)),
    minY: Math.min(...cells.map((c) => c.y)),
    maxX: Math.max(...cells.map((c) => c.x)),
    maxY: Math.max(...cells.map((c) => c.y)),
  };
}
