import type {
  LocalizedName,
  ShopSection,
  ShopSectionName,
  ShopSections,
} from '@portfolio/velista/models';
import { isRecord, mapArray, numOr, oneOf, str, strOr } from './primitives';

/**
 * A shop's sections, read off the wire (velista `0120`, backend `0167`). Rule D4:
 * every function takes `unknown`, and no contract type is named.
 */

/** A name with at least one language in it, or null: a blank heading is worse than none. */
function readableName(raw: unknown): LocalizedName | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = { en: strOr(raw['en'], ''), es: strOr(raw['es'], '') };
  return name.en !== '' || name.es !== '' ? name : null;
}

/** From `SupermarketSectionView`: one section, or null for one nothing can head. */
export function toShopSection(raw: unknown): ShopSection | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const name = readableName(raw['name']);
  if (id === null || id === '' || name === null) {
    return null;
  }

  return {
    id,
    supermarketId: strOr(raw['supermarketId'], ''),
    slug: strOr(raw['slug'], ''),
    name,
    position: numOr(raw['position'], 0),
    categoryIds: mapArray(raw['categoryIds'], str),
  };
}

/**
 * `LocationSectionNameView[]` (backend `0170`): a shop's section names, on every
 * view a picker row is built from.
 *
 * In the order the wire sent them, which is the shop's own, for the reason
 * {@link toShopSections} gives. An unreadable or repeated entry is dropped, and
 * anything that is not a list is no sections at all, which draws no line: a row
 * cannot tell a server that sent none from one that is older than the field, and
 * neither is worth a line.
 */
export function toShopSectionNames(raw: unknown): readonly ShopSectionName[] {
  const seen = new Set<string>();
  return mapArray(raw, (entry): ShopSectionName | null => {
    if (!isRecord(entry)) {
      return null;
    }
    const id = str(entry['id']);
    const name = readableName(entry['name']);
    if (id === null || id === '' || name === null || seen.has(id)) {
      return null;
    }
    seen.add(id);
    return { id, name };
  });
}

/**
 * `GET /v1/catalog/locations/:id/sections`: `{ sections, source }`.
 *
 * The sections stay **in the order the wire sent them**, which is the shop's order
 * (backend `0167`): `position` is the chain's default order and a shop with a list
 * of its own walks it differently, so sorting by it would undo the shop's own list.
 * An unreadable section is dropped. Null for a body that is not this shape, which
 * the store reads as a read that did not answer.
 */
export function toShopSections(raw: unknown): ShopSections | null {
  if (!isRecord(raw) || !Array.isArray(raw['sections'])) {
    return null;
  }

  const seen = new Set<string>();
  const sections = mapArray(raw['sections'], toShopSection).filter((one) => {
    if (seen.has(one.id)) {
      return false;
    }
    seen.add(one.id);
    return true;
  });
  return {
    sections,
    source: oneOf(raw['source'], ['LOCATION', 'CHAIN'] as const, 'CHAIN'),
  };
}

/**
 * `BasketItemView.sectionIds` (backend `0167`, section 4): which of the read's
 * shop's sections hold a product.
 *
 * Null when absent or not a list, which is a read at no shop, or one whose sections
 * call the server could not make. An empty list is kept as it is, since it is an
 * answer: no section of this shop holds the product. Anything in it that is not an
 * id is dropped, and a repeated id is kept once.
 */
export function toSectionIds(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  return [
    ...new Set(
      mapArray(raw, (one) => {
        const id = str(one);
        return id === null || id === '' ? null : id;
      })
    ),
  ];
}
