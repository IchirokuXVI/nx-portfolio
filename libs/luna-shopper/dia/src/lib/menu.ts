import type { DiaLeaf, DiaMenu, DiaRoot } from './types';

/** `L150` Ofertas: a mix of every root, which a walk never reads. */
export const DIA_OFFERS_CATEGORY_ID = 'L150';

/**
 * `GET /api/v1/common-aggregator/menu-data` as roots and leaves (plan 0174,
 * section 1).
 *
 * Two levels. Each root also carries a "Todo" child that repeats the root's own
 * id, which is the whole root again and not a leaf, so it is dropped here. The
 * offers category sits outside `categories` and is reported apart.
 */
export function parseMenu(json: unknown): DiaMenu {
  const body = asRecord(json);
  const roots: DiaRoot[] = [];
  for (const raw of asArray(body['categories'])) {
    const node = asRecord(raw);
    const id = text(node['id']);
    const name = text(node['name']);
    const path = text(node['link']);
    if (!id || !name || !path || id === DIA_OFFERS_CATEGORY_ID) {
      continue;
    }
    const leaves: DiaLeaf[] = [];
    for (const rawChild of asArray(node['children'])) {
      const child = asRecord(rawChild);
      const childId = text(child['id']);
      const childName = text(child['name']);
      const childPath = text(child['link']);
      if (!childId || !childName || !childPath || childId === id) {
        continue;
      }
      leaves.push({
        id: childId,
        name: childName,
        path: childPath,
        rootId: id,
        rootName: name,
      });
    }
    roots.push({ id, name, path, leaves });
  }
  const offer = text(asRecord(body['offer_category'])['id']);
  return {
    roots,
    leaves: roots.flatMap((root) => root.leaves),
    offerCategoryId: offer,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
