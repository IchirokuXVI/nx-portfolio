import { wholeCells } from './outline';
import type { ShopMapAnchor, ShopMapDocument, ShopMapFixture } from './types';

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Copies the named keys in the order given, leaving out the absent ones. */
function pick<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[]
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function normalizeFixture(f: ShopMapFixture): ShopMapFixture {
  return {
    id: f.id,
    kind: f.kind,
    x: wholeCells(f.x),
    y: wholeCells(f.y),
    w: wholeCells(f.w),
    h: wholeCells(f.h),
    ...pick(f, ['label']),
  };
}

function normalizeAnchor(a: ShopMapAnchor): ShopMapAnchor {
  return {
    id: a.id,
    kind: a.kind,
    at: { x: wholeCells(a.at.x), y: wholeCells(a.at.y) },
    ...pick(a, ['face', 'sectionId', 'categoryId', 'itemId', 'ean', 'text']),
  };
}

/**
 * The canonical form of a document: fixtures and anchors sorted by id, every
 * grid number a whole cell, keys in one order and absent fields left out, so
 * two equal documents serialize, and therefore hash, equal. `cell` and the
 * outline's `bearing` are informative and kept as they are.
 */
export function normalizeShopMap(doc: ShopMapDocument): ShopMapDocument {
  return {
    version: 1,
    cell: doc.cell,
    size: { cols: wholeCells(doc.size.cols), rows: wholeCells(doc.size.rows) },
    ...(doc.outline
      ? {
          outline: {
            points: doc.outline.points.map(
              ([x, y]) => [wholeCells(x), wholeCells(y)] as [number, number]
            ),
            bearing: doc.outline.bearing,
          },
        }
      : {}),
    fixtures: [...doc.fixtures].sort(byId).map(normalizeFixture),
    anchors: [...doc.anchors].sort(byId).map(normalizeAnchor),
  };
}
