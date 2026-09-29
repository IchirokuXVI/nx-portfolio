import type { ShopMapGrid } from '../grid';
import { distancesOver } from '../grid';
import type { ShopMapCell } from '../types';
import { pathLength, solvePath } from '../walk-order';
import { byId, round2 } from './normalize';
import {
  RASTER_CELL_METRES,
  distanceToArea,
  nearestCell,
  rasterize,
} from './raster';
import type { MapArea, ShopMapDocumentV2, WalkOrderV2 } from './types';

interface Stop {
  cell: ShopMapCell;
  dist: ShopMapGrid<number>;
}

interface SectionStop {
  name: string;
  areaIds: string[];
  stop: Stop;
}

/** How two section names compare: trimmed and case folded. */
function sectionKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The walk through every section of a version 2 document (shop-map plan
 * 0002, section 4).
 *
 * The document is rasterized at 0.5 m. The walk starts on the free cell
 * nearest the first entrance by id, else nearest the first walked point. It
 * visits, for each section, the free cell nearest its area that the start can
 * reach, where two areas whose section names match after trimming and case
 * folding are one stop at the first of them by id. The order is `walkOrder`'s
 * nearest neighbour and 2-opt over breadth first distances. The walk ends
 * beside the checkout that makes it shortest (ties to the first by id), else
 * at the free cell nearest the last walked point, else wherever the last
 * section is.
 *
 * A shopper stands at most 1.5 m from an area. A section with no reachable
 * cell that close is left out, so a draft still answers a walk over what can
 * be walked, and an entrance or checkout that far from the floor counts as
 * absent.
 */
export function walkOrderV2(doc: ShopMapDocumentV2): WalkOrderV2 {
  const raster = rasterize(doc);
  const empty: WalkOrderV2 = {
    sections: [],
    startsAtEntrance: false,
    endsAtCheckout: false,
  };
  const areas = [...doc.areas].sort(byId);
  const firstPoint = doc.path.find((l) => l.points.length > 0)?.points[0];
  const lastLine = [...doc.path].reverse().find((l) => l.points.length > 0);
  const lastPoint = lastLine?.points[lastLine.points.length - 1];
  const anyCell = () => true;
  const toArea = (a: MapArea) => (cx: number, cy: number) =>
    distanceToArea(cx, cy, a);
  const toPoint =
    ([px, py]: [number, number]) =>
    (cx: number, cy: number) =>
      Math.hypot(cx - px, cy - py);

  let startCell: ShopMapCell | null = null;
  let startsAtEntrance = false;
  for (const entrance of areas.filter((a) => a.kind === 'entrance')) {
    startCell = nearestCell(raster, toArea(entrance), anyCell);
    if (startCell) {
      startsAtEntrance = true;
      break;
    }
  }
  if (!startCell && firstPoint) {
    startCell = nearestCell(raster, toPoint(firstPoint), anyCell);
  }
  if (!startCell) return empty;

  const start: Stop = {
    cell: startCell,
    dist: distancesOver(raster.free, [startCell]),
  };
  const reachable = (c: ShopMapCell) => start.dist[c.y][c.x] !== Infinity;
  const standOn = (distance: (cx: number, cy: number) => number) => {
    const cell = nearestCell(raster, distance, reachable);
    return cell ? { cell, dist: distancesOver(raster.free, [cell]) } : null;
  };

  const groups = new Map<string, { name: string; areas: MapArea[] }>();
  for (const area of areas) {
    if (area.section === undefined || area.section.trim() === '') continue;
    const key = sectionKey(area.section);
    const group = groups.get(key);
    if (group) group.areas.push(area);
    else groups.set(key, { name: area.section.trim(), areas: [area] });
  }
  const sections: SectionStop[] = [];
  for (const group of groups.values()) {
    for (const area of group.areas) {
      const stop = standOn(toArea(area));
      if (stop) {
        sections.push({
          name: group.name,
          areaIds: group.areas.map((a) => a.id),
          stop,
        });
        break;
      }
    }
  }

  const stops: Stop[] = [start, ...sections.map((s) => s.stop)];
  const between = stops.map((a) =>
    stops.map((b) => a.dist[b.cell.y][b.cell.x])
  );
  const interior = sections.map((_, k) => k + 1);
  const withEnd = (toEnd: number[]) => {
    const cost = between.map((row, k) => [...row, toEnd[k]]);
    cost.push([...toEnd, 0]);
    return cost;
  };

  let best: { cost: number[][]; path: number[] } | null = null;
  let endsAtCheckout = false;
  for (const checkout of areas.filter((a) => a.kind === 'checkout')) {
    const end = standOn(toArea(checkout));
    if (!end) continue;
    const cost = withEnd(stops.map((s) => s.dist[end.cell.y][end.cell.x]));
    const path = solvePath(cost, interior);
    if (!best || pathLength(cost, path) < pathLength(best.cost, best.path)) {
      best = { cost, path };
      endsAtCheckout = true;
    }
  }
  if (!best) {
    const end = lastPoint ? standOn(toPoint(lastPoint)) : null;
    const cost = withEnd(
      stops.map((s) => (end ? s.dist[end.cell.y][end.cell.x] : 0))
    );
    best = { cost, path: solvePath(cost, interior) };
  }

  let walked = 0;
  const ordered: WalkOrderV2['sections'] = [];
  for (let k = 1; k < best.path.length - 1; k++) {
    walked += best.cost[best.path[k - 1]][best.path[k]];
    const s = sections[best.path[k] - 1];
    ordered.push({
      name: s.name,
      areaIds: s.areaIds,
      atMetres: round2(walked * RASTER_CELL_METRES),
    });
  }
  return { sections: ordered, startsAtEntrance, endsAtCheckout };
}
