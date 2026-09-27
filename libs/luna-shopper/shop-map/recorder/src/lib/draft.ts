import { positionAt } from './metrics';
import { headingOf, headingStep } from './recorder';
import type { ShopMapDocument } from './shop-map-document';
import type { Track } from './track-types';
import type { Cell, Walk } from './walk';
import type { WalkFile } from './walk-file';

export interface WalkToDocumentOptions {
  size?: { cols: number; rows: number };
  outline?: ShopMapDocument['outline'];
  /** Which side a scanned product sits on, 'right' by default. */
  hand?: 'right' | 'left';
  /** The document's informative `cell`, 0.5 by default. */
  cellMetres?: number;
}

export function walkToDocument(
  walk: Walk,
  options: WalkToDocumentOptions = {}
): ShopMapDocument {
  void walk;
  void options;
  throw new Error('not implemented');
}

/**
 * A plan 0001 `Walk` from a track, so that `walkToDocument` can draw a draft
 * from any mode (a snap mode gives straight aisles).
 *
 * - Each segment's heading is the grid heading nearest the direction from its
 *   first point to its last. A position in metres starts at `{0, 0}` and each
 *   point of the segment moves it by the distance from the previous point,
 *   along that grid heading. A point's cell is that position divided by
 *   `settings.cellMetres` and rounded, so segments chain end to start, each
 *   is a straight run of cells, and the rounding error never accumulates.
 * - A mark sits at the cell of the point `positionAt` answers for its `t`.
 * - `entrance`, `checkout` and `checkpoint` marks carry over as marks with
 *   their label; `note` marks become notes (the label is the text).
 * - The walk file has no scans. `startedAt` is `startedAt` parsed to epoch
 *   milliseconds and `finishedAt` adds `durationMs`.
 */
export function trackToWalk(walk: WalkFile, track: Track): Walk {
  const cellMetres = walk.settings.cellMetres;
  const pts = track.points;
  const pointCell: Cell[] = pts.map(() => ({ x: 0, y: 0 }));
  const segments: Walk['segments'] = [];
  let metres = { x: 0, y: 0 };
  const toCell = (): Cell => ({
    x: Math.round(metres.x / cellMetres),
    y: Math.round(metres.y / cellMetres),
  });
  for (const seg of track.segments) {
    const a = pts[seg.fromIndex];
    const b = pts[seg.toIndex];
    if (!a || !b) continue;
    const heading = headingOf(Math.atan2(b.x - a.x, b.y - a.y));
    const d = headingStep(heading);
    const from = toCell();
    pointCell[seg.fromIndex] = from;
    for (let i = seg.fromIndex + 1; i <= seg.toIndex; i++) {
      const step = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      metres = { x: metres.x + step * d.x, y: metres.y + step * d.y };
      pointCell[i] = toCell();
    }
    const cursor = toCell();
    segments.push({
      from,
      to: { ...cursor },
      heading,
      steps: seg.toIndex - seg.fromIndex,
      confidence: seg.confidence,
    });
  }
  const indexAt = (t: number): number => {
    const p = positionAt(track, t);
    const i = pts.indexOf(p);
    return i < 0 ? 0 : i;
  };
  const marks: Walk['marks'] = [];
  const notes: Walk['notes'] = [];
  for (const m of walk.marks) {
    const at = { ...(pointCell[indexAt(m.t)] ?? { x: 0, y: 0 }) };
    if (m.kind === 'note') {
      notes.push({ text: m.label ?? '', at });
    } else {
      marks.push({ kind: m.kind, at, ...(m.label ? { label: m.label } : {}) });
    }
  }
  const startedAt = Date.parse(walk.startedAt);
  const start = Number.isFinite(startedAt) ? startedAt : 0;
  return {
    segments,
    marks,
    scans: [],
    notes,
    startedAt: start,
    finishedAt: start + walk.durationMs,
  };
}
