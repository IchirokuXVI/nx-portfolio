import {
  shopperView,
  type ShopMapDocumentV2,
  type ShopperView,
} from '@portfolio/luna-shopper/shop-map/model';
import { basketRowPick, type Basket } from './basket-view';
import type { BasketRowState } from './enums';
import type { ShopSectionName } from './shop';
import type { LocalizedName } from './shopping-profile';

/**
 * One shop as its own page draws it (velista `0121`, target 2;
 * `GET /v1/catalog/locations/:id`).
 *
 * Rule D4: ours, mapped from `unknown`. The chain's name is not on the location
 * read, so it comes from a second read of the chain and is null until that read
 * answers, which draws the page with no chain line rather than holding it back.
 */
export interface ShopDetail {
  readonly id: string;
  readonly supermarketId: string;
  /** The chain, named, or null when the chain read did not answer. */
  readonly chain: LocalizedName | null;
  /** The shop's own name, which most shops of a chain do not have. */
  readonly label: LocalizedName | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  /**
   * The area of the building outline in square metres, as OpenStreetMap maps it
   * (backend `0176`), or null when it is not known, which is most shops.
   */
  readonly footprintM2: number | null;
  /** The shop has a walk shown to shoppers, so its map can be read (backend `0168`). */
  readonly hasMap: boolean;
  /** The shop's sections in the order it is walked. Empty draws no list. */
  readonly sections: readonly ShopSectionName[];
}

/** One section name of the shown walk and the chain section it resolved to. */
export interface ShopMapSection {
  /** The name as the mapper typed it, which is how the map's areas name it. */
  readonly name: string;
  readonly sectionId: string;
}

/** A note the mapper left on the map, in metres. */
export interface ShopMapNote {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/**
 * A shop's map, as velista draws it (velista `0121`, target 3;
 * `GET /v1/catalog/locations/:id/map`).
 *
 * The wire answers what a shopper is shown (`shopperView` of model plan 0002),
 * and the shared canvas mounts a document. {@link document} is that document,
 * rebuilt from the view by {@link shopMapDocumentOf} so that the canvas draws the
 * view it was sent. It is refused when `validateShopMapV2` finds a problem with it,
 * which is the mapper's business, not this type's.
 */
export interface ShopMap {
  readonly walkId: string;
  /** When the shown walk was last saved, or null when the wire did not say. */
  readonly savedAt: Date | null;
  readonly document: ShopMapDocumentV2;
  readonly notes: readonly ShopMapNote[];
  /** The chain sections the walk's section names resolved to, in walk order. */
  readonly sections: readonly ShopMapSection[];
}

/** How a map read answered: a map, no map for this shop, or no answer at all. */
export type ShopMapRead =
  | { readonly kind: 'map'; readonly map: ShopMap }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

/**
 * One line of the basket as the map counts it (velista `0121`, target 3).
 *
 * A basket row cut down to what a badge and the section sheet need, so the map
 * can be kept on the device with the lines it was opened with and still open in
 * a shop with no signal (target 6).
 */
export interface ShopMapLine {
  readonly rowKey: string;
  readonly content: string;
  /** What the row asks for, which is the quantity the sheet draws. */
  readonly quantity: number;
  /** The server's state for the row. */
  readonly state: BasketRowState;
  /** Which of the shop's sections hold the row's product, in the shop's ids. */
  readonly sectionIds: readonly string[];
}

/** A section's badge on the map: how many are left, or how many were got. */
export interface ShopMapBadgeCount {
  readonly count: number;
  readonly done: boolean;
}

/** Whether a line is settled: bought, or closed because the shop had none. */
export function isSettledMapLine(line: Pick<ShopMapLine, 'state'>): boolean {
  return line.state === 'DONE' || line.state === 'NOT_AVAILABLE';
}

/**
 * The basket's lines as the map counts them.
 *
 * `REMOVED` rows are left out, as every count on the basket page leaves them
 * out. A row's sections are its pick's, which is the rule the aisle grouping
 * of velista `0120` files a row by, so a row counts under the same sections on
 * the map as it is drawn under on the basket.
 */
export function shopMapLinesOf(basket: Basket): ShopMapLine[] {
  return basket.rows
    .filter((row) => row.state !== 'REMOVED')
    .map((row) => ({
      rowKey: row.rowKey,
      content: row.content,
      quantity: row.asked,
      state: row.state,
      sectionIds: basketRowPick(row, basket.products)?.sectionIds ?? [],
    }));
}

/** How the backend compares a section name: trimmed and lower cased (backend `0168`). */
export function sameSectionName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The section a name on the map resolves to, or null for a name the read did not resolve. */
export function shopMapSectionNamed(
  map: Pick<ShopMap, 'sections'>,
  name: string
): ShopMapSection | null {
  return map.sections.find((one) => sameSectionName(one.name, name)) ?? null;
}

/** The lines one section holds, in the basket's order. */
export function shopMapLinesIn(
  lines: readonly ShopMapLine[],
  sectionId: string
): ShopMapLine[] {
  return lines.filter((line) => line.sectionIds.includes(sectionId));
}

/**
 * The badges the map draws, keyed by the name each area spells its section
 * with, which is the key the canvas reads (velista `0121`, the mock's decisions).
 *
 * A badge counts the lines of that section still to get, and turns into a tick
 * and the number got once every line there is settled. A section holding no line
 * gets no badge, which the canvas draws dimmed while any badge is shown.
 */
export function shopMapBadges(
  map: Pick<ShopMap, 'document' | 'sections'>,
  lines: readonly ShopMapLine[]
): Record<string, ShopMapBadgeCount> {
  const badges: Record<string, ShopMapBadgeCount> = {};
  for (const area of map.document.areas) {
    if (area.section === undefined || area.section in badges) {
      continue;
    }
    const section = shopMapSectionNamed(map, area.section);
    if (section === null) {
      continue;
    }
    const held = shopMapLinesIn(lines, section.sectionId);
    if (held.length === 0) {
      continue;
    }
    const pending = held.filter((line) => !isSettledMapLine(line)).length;
    badges[area.section] =
      pending > 0
        ? { count: pending, done: false }
        : { count: held.length, done: true };
  }
  return badges;
}

/** How far a note may be from a section's area and still be that section's. */
export const SECTION_NOTE_REACH_METRES = 1.5;

/**
 * The note on the map for a section, or null (velista `0121`, target 4).
 *
 * A note is a point and names no section, so it belongs to the section whose area
 * it sits in or beside: the nearest note within {@link SECTION_NOTE_REACH_METRES}
 * of any area of that section.
 */
export function shopMapSectionNote(
  map: Pick<ShopMap, 'document' | 'notes'>,
  sectionName: string
): ShopMapNote | null {
  const areas = map.document.areas.filter(
    (area) =>
      area.section !== undefined && sameSectionName(area.section, sectionName)
  );
  let best: ShopMapNote | null = null;
  let bestDistance = SECTION_NOTE_REACH_METRES + 1e-9;
  for (const note of map.notes) {
    for (const area of areas) {
      const dx = Math.max(area.x - note.x, 0, note.x - (area.x + area.w));
      const dy = Math.max(area.y - note.y, 0, note.y - (area.y + area.h));
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = note;
      }
    }
  }
  return best;
}

/**
 * Where a section falls on the way round, one based, and how many there are
 * (velista `0121`, target 4), or null for a section the map does not name.
 */
export function shopMapSectionPosition(
  map: Pick<ShopMap, 'sections'>,
  sectionId: string
): { readonly position: number; readonly total: number } | null {
  const ids: string[] = [];
  for (const one of map.sections) {
    if (!ids.includes(one.sectionId)) {
      ids.push(one.sectionId);
    }
  }
  const index = ids.indexOf(sectionId);
  return index < 0 ? null : { position: index + 1, total: ids.length };
}

/**
 * A building's size as the shop page says it (velista `0121`): to the nearest
 * hundred square metres, or to the nearest ten below a hundred so a corner shop
 * is not called bigger than it is. Null for no size, or for one that is not a
 * positive number.
 */
export function roundedFootprint(m2: number | null): number | null {
  if (m2 === null || !Number.isFinite(m2) || m2 <= 0) {
    return null;
  }
  return m2 < 100
    ? Math.max(10, Math.round(m2 / 10) * 10)
    : Math.round(m2 / 100) * 100;
}

/** The cell of the model's raster, which the walkway rings are drawn on. */
const CELL_METRES = 0.5;

/**
 * A document the shared canvas draws as `view` (velista `0121`, target 3).
 *
 * The map read answers `shopperView(document)` and never the document itself,
 * which only somebody who maps may read, while `mountShopMap` takes a document and
 * works the view out again. So the document is rebuilt: every area as it was,
 * every note as a note mark, and the walkway as walked points on the
 * corners of its cells.
 *
 * The model marks every cell within 0.75 m of a walked point as floor. A point on
 * the corner four cells share reaches exactly those four, so the walkway is given
 * back as one walked point per 2 by 2 block of walkway (and shelf, which is never
 * floor). A cell no block reaches and the model would not call a gap is walked
 * through its own centre, which draws a cell more than the view around it: rare,
 * because a walkway is at least a metre and a half wide.
 */
export function shopMapDocumentOf(view: ShopperView): ShopMapDocumentV2 {
  return {
    version: 2,
    areas: view.areas.map((area) => ({
      id: area.id,
      kind: area.kind,
      x: area.x,
      y: area.y,
      w: area.w,
      h: area.h,
      ...(area.section !== undefined ? { section: area.section } : {}),
      ...(area.label !== undefined ? { label: area.label } : {}),
      colour: area.colour,
      origin: 'drawn' as const,
    })),
    marks: view.notes.map((note) => ({
      id: note.id,
      kind: 'note' as const,
      x: note.x,
      y: note.y,
      heading: 0,
      text: note.text,
      logMs: 0,
    })),
    path: walkedPointsOf(view),
  };
}

/** Whether a point is inside the rings, by the even odd rule the view is drawn with. */
function insideRings(
  rings: readonly (readonly [number, number])[][],
  x: number,
  y: number
): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function walkedPointsOf(view: ShopperView): { points: [number, number][] }[] {
  const vertices = view.walkway.flat();
  if (vertices.length === 0) {
    return [];
  }
  const i0 = Math.floor(Math.min(...vertices.map((p) => p[0])) / CELL_METRES);
  const i1 = Math.ceil(Math.max(...vertices.map((p) => p[0])) / CELL_METRES);
  const j0 = Math.floor(Math.min(...vertices.map((p) => p[1])) / CELL_METRES);
  const j1 = Math.ceil(Math.max(...vertices.map((p) => p[1])) / CELL_METRES);
  const centre = (index: number) => (index + 0.5) * CELL_METRES;
  const key = (i: number, j: number) => `${i},${j}`;

  const walkway = new Set<string>();
  const blocked = new Set<string>();
  const blocking = view.areas.filter((area) => area.kind !== 'entrance');
  // One cell of margin, so a cell at the edge of the walkway sees its neighbours.
  for (let j = j0 - 1; j <= j1; j++) {
    for (let i = i0 - 1; i <= i1; i++) {
      const cx = centre(i);
      const cy = centre(j);
      if (insideRings(view.walkway, cx, cy)) {
        walkway.add(key(i, j));
      }
      if (
        blocking.some(
          (a) => cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h
        )
      ) {
        blocked.add(key(i, j));
      }
    }
  }

  const cellOf = (k: string) => k.split(',').map(Number) as [number, number];
  const open = (i: number, j: number) =>
    walkway.has(key(i, j)) || blocked.has(key(i, j));

  // A point on the corner four cells share is within reach of those four centres
  // and of no other, so every 2 by 2 block of walkway and shelf is one point.
  const corners = new Set<string>();
  const floor = new Set<string>();
  for (const k of walkway) {
    const [i, j] = cellOf(k);
    for (const [a, b] of [
      [i, j],
      [i + 1, j],
      [i, j + 1],
      [i + 1, j + 1],
    ]) {
      if (
        open(a - 1, b - 1) &&
        open(a, b - 1) &&
        open(a - 1, b) &&
        open(a, b) &&
        !corners.has(key(a, b))
      ) {
        corners.add(key(a, b));
        for (const [c, d] of [
          [a - 1, b - 1],
          [a, b - 1],
          [a - 1, b],
          [a, b],
        ]) {
          if (!blocked.has(key(c, d))) {
            floor.add(key(c, d));
          }
        }
      }
    }
  }

  // A cell no block reaches is still drawn when the model will call it a gap
  // under a metre, as it did the first time. Anything else is walked through its
  // own centre, which also reaches the eight cells round it.
  const gap = (i: number, j: number) =>
    !blocked.has(key(i, j)) &&
    ((floor.has(key(i - 1, j)) && floor.has(key(i + 1, j))) ||
      (floor.has(key(i, j - 1)) && floor.has(key(i, j + 1))));
  const centres: [number, number][] = [];
  for (const k of walkway) {
    const [i, j] = cellOf(k);
    if (!floor.has(k) && !gap(i, j)) {
      centres.push([i, j]);
    }
  }

  const points: [number, number][] = [
    ...[...corners]
      .map(cellOf)
      .map(([a, b]) => [a * CELL_METRES, b * CELL_METRES] as [number, number]),
    ...centres.map(([i, j]) => [centre(i), centre(j)] as [number, number]),
  ];
  points.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  return points.map((point) => ({ points: [point] }));
}

/** Whether a rebuilt document draws exactly the view it came from. For specs and checks. */
export function drawsAsView(
  document: ShopMapDocumentV2,
  view: ShopperView
): boolean {
  return JSON.stringify(shopperView(document)) === JSON.stringify(view);
}
