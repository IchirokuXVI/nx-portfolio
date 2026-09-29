import type {
  AreaKind,
  MapArea,
  ShopMapDocumentV2,
  ShopMapProblemCodeV2,
  ShopMapProblemV2,
} from './types';

/** The codes of section 2, in the order they are checked and reported. */
export const PROBLEM_ORDER_V2: readonly ShopMapProblemCodeV2[] = [
  'AREA_TOO_SMALL',
  'BLOCKING_OVERLAP',
  'SECTION_ON_WRONG_KIND',
  'BAD_COLOUR',
  'MARK_UNNAMED',
];

/** Below this on a side an area is refused. */
export const MIN_AREA_SIDE_METRES = 0.3;
/** Two blocking areas may overlap by this much, a drawing tolerance. */
export const OVERLAP_TOLERANCE_METRES = 0.1;

/** Float slack, far below the two decimals a normalized document keeps. */
const EPSILON = 1e-6;

/** Whether nobody walks through an area of this kind. `path` and `entrance` are walked. */
export function isBlockingArea(kind: AreaKind): boolean {
  return kind !== 'path' && kind !== 'entrance';
}

/** How far two rectangles overlap: the smaller side of their intersection, 0 when apart. */
export function overlapMetres(a: MapArea, b: MapArea): number {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.max(0, Math.min(ix, iy));
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * The problems of a version 2 document, grouped by code in
 * {@link PROBLEM_ORDER_V2} and in document order within a code. Empty means
 * valid. An overlap is reported once per pair and names the later area. A
 * document with no entrance or no checkout is valid.
 */
export function validateShopMapV2(doc: ShopMapDocumentV2): ShopMapProblemV2[] {
  const problems: ShopMapProblemV2[] = [];

  for (const area of doc.areas) {
    if (
      !(area.w >= MIN_AREA_SIDE_METRES - EPSILON) ||
      !(area.h >= MIN_AREA_SIDE_METRES - EPSILON)
    ) {
      problems.push({ code: 'AREA_TOO_SMALL', id: area.id });
    }
  }

  const blocking = doc.areas.filter((a) => isBlockingArea(a.kind));
  for (let j = 1; j < blocking.length; j++) {
    for (let i = 0; i < j; i++) {
      if (
        overlapMetres(blocking[i], blocking[j]) >
        OVERLAP_TOLERANCE_METRES + EPSILON
      ) {
        problems.push({
          code: 'BLOCKING_OVERLAP',
          id: blocking[j].id,
          otherId: blocking[i].id,
        });
      }
    }
  }

  for (const area of doc.areas) {
    if (
      area.section !== undefined &&
      area.kind !== 'shelf' &&
      area.kind !== 'counter'
    ) {
      problems.push({ code: 'SECTION_ON_WRONG_KIND', id: area.id });
    }
  }

  for (const area of doc.areas) {
    if (area.colour.mode === 'custom' && !HEX_COLOUR.test(area.colour.value)) {
      problems.push({ code: 'BAD_COLOUR', id: area.id });
    }
  }

  for (const mark of doc.marks) {
    if (
      (mark.kind === 'section' || mark.kind === 'counter') &&
      mark.text.trim() === ''
    ) {
      problems.push({ code: 'MARK_UNNAMED', id: mark.id });
    }
  }

  return problems;
}
