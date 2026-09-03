import { ItemCategory } from '@portfolio/luna-shopper/contracts';
import { resolveCategory, type CategoryPathNode } from './categories';
import {
  isRecord,
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readString,
  type Json,
} from './json';
import type {
  MercadonaCategory,
  MercadonaListProduct,
  MercadonaProduct,
} from './types';
import { mapSizeFormat } from './units';

/**
 * Raw Mercadona JSON in, plain records out. Pure: no network, no clock, no
 * database, so every rule below is testable against a checked in fixture.
 *
 * The one rule that matters (plan 0038, section 2.4): **`bulk_price` is stored
 * verbatim and never recomputed.** `unit_price / unit_size` reproduces it for
 * 3,760 of 4,232 products and `unit_price / total_units` for 326 more, but 110
 * products match neither and are inconsistent with their own stated size.
 * Deriving would silently disagree with the chain on one product in forty, in the
 * field whose only purpose is comparison.
 */

/** The category tree, two levels, as `GET /categories/` returns it. */
export function normalizeCategories(payload: Json): MercadonaCategory[] {
  return readArray(payload, 'results').map(toCategory);
}

function toCategory(node: Json): MercadonaCategory {
  return {
    id: readNumber(node, 'id') ?? 0,
    name: readString(node, 'name') ?? '',
    // Absent means published: only the withdrawn ones say so.
    published: readBoolean(node, 'published') ?? true,
    children: readArray(node, 'categories').map(toCategory),
  };
}

/**
 * One expanded level 1 category: its level 2 children with their products inline.
 * Yields each product with the path the walk took to reach it, which is what the
 * category mapping reads (section 5.6: map from the deepest node, not the root).
 */
export function normalizeCategoryProducts(
  payload: Json,
  ancestors: CategoryPathNode[] = []
): MercadonaListProduct[] {
  const self: CategoryPathNode = {
    id: readNumber(payload, 'id') ?? undefined,
    name: readString(payload, 'name') ?? '',
  };
  const path = self.name ? [...ancestors, self] : ancestors;

  const own = readArray(payload, 'products').map((product) =>
    toListProduct(product, path)
  );
  const nested = readArray(payload, 'categories').flatMap((child) =>
    normalizeCategoryProducts(child, path)
  );
  return [...own, ...nested];
}

function toListProduct(
  raw: Json,
  path: CategoryPathNode[]
): MercadonaListProduct {
  const price = readRecord(raw, 'price_instructions');
  const sizeFormat = readString(price, 'size_format');
  return {
    externalId: readString(raw, 'id') ?? '',
    displayName: readString(raw, 'display_name') ?? '',
    packaging: readString(raw, 'packaging'),
    shareUrl: readString(raw, 'share_url'),
    published: readBoolean(raw, 'published') ?? true,
    unitSize: readNumber(price, 'unit_size'),
    unit: mapSizeFormat(sizeFormat),
    sizeFormat,
    price: readNumber(price, 'unit_price'),
    unitPrice: readNumber(price, 'bulk_price'),
    unitPriceLabel: readString(price, 'reference_format'),
    categoryPath: path,
  };
}

export interface NormalizeProductOptions {
  /**
   * The path the walk took to this product. Preferred over the product's own
   * `categories` block, because the walk knows which branch it came down and the
   * product may be filed under several.
   */
  categoryPath?: CategoryPathNode[];
  /** The English `display_name`, fetched separately (section 6.2). */
  englishName?: string | null;
  observedAt?: Date;
}

/**
 * A product detail payload, normalized. This is the only place `ean` and `brand`
 * exist, which is the arithmetic behind the whole shape of the plan: capturing
 * them for the assortment is one request per product.
 */
export function normalizeProduct(
  raw: Json,
  options: NormalizeProductOptions = {}
): MercadonaProduct {
  const price = readRecord(raw, 'price_instructions');
  const sizeFormat = readString(price, 'size_format');
  const path = options.categoryPath ?? readProductCategoryPath(raw);
  const spanishName = readString(raw, 'display_name') ?? '';
  const english = options.englishName?.trim();

  return {
    externalId: readString(raw, 'id') ?? '',
    ean: readString(raw, 'ean'),
    name: {
      es: spanishName,
      // Falls back to Spanish when Mercadona has no English string, so an
      // English speaking user sees Spanish. Refusing to import is worse
      // (section 11); the caller flags it for curation.
      ...(english ? { en: english } : {}),
    },
    brand: readString(raw, 'brand'),
    unitSize: readNumber(price, 'unit_size'),
    unit: mapSizeFormat(sizeFormat),
    category: path.length > 0 ? resolveCategory(path) : ItemCategory.OTHER,
    categoryPath: path.map((node) => node.name),
    price: readNumber(price, 'unit_price'),
    unitPrice: readNumber(price, 'bulk_price'),
    unitPriceLabel: readString(price, 'reference_format'),
    currency: 'EUR',
    // A detail payload exists, so the warehouse carries it. A 404 never reaches
    // here: the client turns it into null and the caller records unavailable.
    available: readBoolean(raw, 'published') ?? true,
    sourceUrl: readString(raw, 'share_url'),
    observedAt: options.observedAt ?? new Date(),
  };
}

/**
 * The category chain a detail payload carries. Mercadona nests it (level 1 with a
 * `categories` array holding level 2), and the chain is walked to its deepest
 * node so the mapping sees `Queso` rather than `Charcutería y quesos`.
 */
function readProductCategoryPath(raw: Json): CategoryPathNode[] {
  const path: CategoryPathNode[] = [];
  let cursor: Json = readArray(raw, 'categories')[0];
  while (isRecord(cursor)) {
    const name = readString(cursor, 'name');
    if (name) {
      path.push({ id: readNumber(cursor, 'id') ?? undefined, name });
    }
    cursor = readArray(cursor, 'categories')[0];
  }
  return path;
}

/**
 * The unavailable product (section 2.6): a 404 from a detail call is a **value**
 * meaning "not stocked in this warehouse", not an error. It sets availability
 * rather than failing a run, and carries no price at all rather than a stale one.
 */
export function unavailableProduct(
  externalId: string,
  observedAt: Date
): MercadonaProduct {
  return {
    externalId,
    ean: null,
    name: { es: '' },
    brand: null,
    unitSize: null,
    unit: null,
    category: ItemCategory.OTHER,
    categoryPath: [],
    price: null,
    unitPrice: null,
    unitPriceLabel: null,
    currency: 'EUR',
    available: false,
    sourceUrl: null,
    observedAt,
  };
}
