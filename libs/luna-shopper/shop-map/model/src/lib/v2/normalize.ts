import type { AreaColour, MapArea, MapMark, ShopMapDocumentV2 } from './types';

/** Metres and degrees to two decimals, with no negative zero. */
export function round2(value: number): number {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r;
}

export const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function normalizeColour(colour: AreaColour): AreaColour {
  if (colour.mode === 'custom') {
    return { mode: 'custom', value: colour.value.toLowerCase() };
  }
  return { mode: colour.mode };
}

function normalizeHeading(heading: number): number {
  const h = round2(((heading % 360) + 360) % 360);
  return h >= 360 ? 0 : h;
}

function normalizeArea(a: MapArea): MapArea {
  return {
    id: a.id,
    kind: a.kind,
    x: round2(a.x),
    y: round2(a.y),
    w: round2(a.w),
    h: round2(a.h),
    ...(a.section !== undefined ? { section: a.section } : {}),
    ...(a.label !== undefined ? { label: a.label } : {}),
    colour: normalizeColour(a.colour),
    origin: a.origin,
  };
}

function normalizeMark(m: MapMark): MapMark {
  return {
    id: m.id,
    kind: m.kind,
    x: round2(m.x),
    y: round2(m.y),
    heading: normalizeHeading(m.heading),
    text: m.text,
    logMs: Math.round(m.logMs),
  };
}

/**
 * The canonical form of a version 2 document: areas and marks sorted by id,
 * metres and degrees to two decimals, headings in [0, 360), log times in whole
 * milliseconds, custom colours in lower case, keys in one order, absent fields
 * left out and empty polylines dropped. Two equal documents serialize, and
 * therefore hash, equal. Nothing snaps to the grid.
 */
export function normalizeShopMapV2(doc: ShopMapDocumentV2): ShopMapDocumentV2 {
  return {
    version: 2,
    areas: [...doc.areas].sort(byId).map(normalizeArea),
    marks: [...doc.marks].sort(byId).map(normalizeMark),
    path: doc.path
      .filter((line) => line.points.length > 0)
      .map((line) => ({
        points: line.points.map(
          ([x, y]) => [round2(x), round2(y)] as [number, number]
        ),
      })),
  };
}
