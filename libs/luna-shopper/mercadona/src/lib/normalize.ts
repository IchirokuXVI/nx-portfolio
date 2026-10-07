import { packCountOf, UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
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
import { isImportableSizeFormat, mapSizeFormat } from './units';

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
  const soldByWeight = readSoldByWeight(price);
  return {
    externalId: readString(raw, 'id') ?? '',
    displayName: readString(raw, 'display_name') ?? '',
    packaging: readString(raw, 'packaging'),
    shareUrl: readString(raw, 'share_url'),
    published: readBoolean(raw, 'published') ?? true,
    soldByWeight,
    unitSize: soldByWeight ? null : readUnitSize(price),
    unit: mapSizeFormat(sizeFormat),
    sizeFormat,
    packCount: readPackCount(price),
    price: readPrice(price, soldByWeight),
    unitPrice: readNumber(price, 'bulk_price'),
    unitPriceLabel: readUnitPriceLabel(price),
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
  const soldByWeight = readSoldByWeight(price);

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
    soldByWeight,
    unitSize: soldByWeight ? null : readUnitSize(price),
    unit: mapSizeFormat(sizeFormat),
    packCount: readPackCount(price),
    categorySlug: resolveCategory(path),
    categoryPath: path.map((node) => node.name),
    price: readPrice(price, soldByWeight),
    unitPrice: readNumber(price, 'bulk_price'),
    unitPriceLabel: readUnitPriceLabel(price),
    currency: 'EUR',
    // A detail payload exists, so the warehouse carries it. A 404 never reaches
    // here: the client turns it into null and the caller records unavailable.
    available: readBoolean(raw, 'published') ?? true,
    sourceUrl: readString(raw, 'share_url'),
    observedAt: options.observedAt ?? new Date(),
  };
}

/**
 * Whether the chain sells the product by weight (plan 0181).
 *
 * **`approx_size` is the field.** It is true on a piece whose weight is not
 * the same on every pack: a piece of cheese, a tray of meat, loose fruit. The
 * weight the payload states for such a piece is an estimate, and the owner's
 * rule is that a weight that is not the same on every pack is not a format.
 *
 * Proved by `product-approximate-weight.json`, product 50946, captured on
 * 2026-10-04: a piece of cheese answers `approx_size: true`, `unit_size:
 * 1.54`, `size_format: "kg"`, `unit_price: "14.49"`, `bulk_price: "9.41"`
 * and `reference_format: "kg"`, under the in-store barcode 2105600509460.
 *
 * **An in-store barcode does not say it.** Product 84692, in
 * `product-fixed-pack-in-store-barcode.json`, carries one too
 * (2105972846927) and answers `approx_size: false`: a croissant of 0.05 kg
 * at 0.55, the same on every piece. So a barcode that starts with 2 is never
 * read as sold by weight. `selling_method` is 0 on both, so it does not
 * separate them either.
 *
 * The size format must be `kg` as well, because the price written for such a
 * product is the price of a kilo, and `bulk_price` is one only then.
 */
function readSoldByWeight(price: Json): boolean {
  return (
    readBoolean(price, 'approx_size') === true &&
    mapSizeFormat(readString(price, 'size_format')) === UnitOfMeasure.KILOGRAM
  );
}

/**
 * The price of the product: of one pack, or of a kilo when the product is
 * sold by weight (plan 0181).
 *
 * `unit_price` is the price of one piece. For a piece sold by approximate
 * weight it is `bulk_price` times an estimated weight, so a 1.54 kg cheese
 * carried 14.49 beside 9.41 a kilo, and the same cheese in another warehouse
 * carried another number for the same kilo. The product has no size, so its
 * price is the price of a kilo: `bulk_price`, read verbatim and never
 * computed (plan 0038, section 2.4).
 */
function readPrice(price: Json, soldByWeight: boolean): number | null {
  return readNumber(price, soldByWeight ? 'bulk_price' : 'unit_price');
}

/**
 * The size the chain states, or null when the number it sent is not one (plan
 * 0183).
 *
 * A product sold by weight never reaches this: its size is null, because the
 * weight the payload states is an estimate (plan 0181).
 *
 * `unit_size` is the size as it stands for every product but two kinds.
 *
 * **A size in a unit the catalog does not hold is no size.** Every
 * `size_format` outside `kg`, `g`, `l`, `ml` and `ud` answers null, which is
 * what `isImportableSizeFormat` decides. The one the assortment prints is
 * `m`, the metres on a roll of foil or film (`product-size-format-m.json`),
 * and a length is a dimension and not a size. Any other word would be stored
 * as a number with no unit beside it, and a number with no unit reads as a
 * count.
 *
 * **A count of one is a placeholder until the payload proves it.** For a pack
 * of pads, wipes or blades the chain answers `unit_size: 1` and `size_format:
 * "ud"`, and the real count is in `total_units`. So when the size is exactly
 * `1 ud`, the comparison price says what the chain divided by:
 *
 * 1. `total_units` is a whole number above 1 and the comparison price is the
 *    pack price over it: the size is `total_units`. Proved by
 *    `product-pack-of-pads.json`, product 16566, captured on 2026-10-04:
 *    `unit_size: 1`, `size_format: "ud"`, `total_units: 10`, `unit_name:
 *    "ud."`, `unit_price: "3.20"`, `reference_price: "0.320"`, and 3.20 over
 *    10 is 0.320. `product-pack-of-wipes.json`, product 47293, says the same
 *    with `total_units: 15`, `unit_price: "0.80"` and `reference_price:
 *    "0.054"`.
 * 2. Otherwise the comparison price is the pack price itself: the chain did
 *    mean one, and the size is 1. Proved by `product-single-razor.json`,
 *    product 22083: `total_units: null`, `unit_price: "3.00"`,
 *    `reference_price: "3.000"`. Also by `product-roll-of-services.json`,
 *    product 49173, which is why the first rule checks the price and does not
 *    trust `total_units` alone: one roll of paper answers `total_units: 600`
 *    with `unit_name: "servicios"`, and its `reference_price` of 3.750 is the
 *    3.75 roll over one. The 600 counts sheets, and the chain sells one roll.
 * 3. Neither holds: null. A size of 1 the chain did not mean is never
 *    written.
 *
 * The comparison price is read here as evidence and is still stored verbatim
 * (plan 0038, section 2.4). Nothing derives one.
 */
function readUnitSize(price: Json): number | null {
  const unitSize = readNumber(price, 'unit_size');
  const sizeFormat = readString(price, 'size_format');
  if (unitSize === null || !isImportableSizeFormat(sizeFormat)) {
    return null;
  }
  if (unitSize !== 1 || mapSizeFormat(sizeFormat) !== UnitOfMeasure.UNIT) {
    return unitSize;
  }
  const totalUnits = readNumber(price, 'total_units');
  if (
    totalUnits !== null &&
    Number.isInteger(totalUnits) &&
    totalUnits > 1 &&
    comparedOver(price, totalUnits)
  ) {
    return totalUnits;
  }
  return comparedOver(price, 1) ? 1 : null;
}

/**
 * Whether the comparison price the chain prints is the pack price over
 * `pieces`.
 *
 * `reference_price` carries three decimals and `bulk_price` two, so the first
 * is read when the payload has it. The chain rounds either way (1.20 over 26
 * is printed 0.047), so the two agree within one step of the last decimal.
 */
function comparedOver(price: Json, pieces: number): boolean {
  const unitPrice = readNumber(price, 'unit_price');
  const reference = readNumber(price, 'reference_price');
  const compared = reference ?? readNumber(price, 'bulk_price');
  if (unitPrice === null || compared === null) {
    return false;
  }
  const step = reference === null ? 0.01 : 0.001;
  return Math.abs(compared - unitPrice / pieces) <= step + 1e-9;
}

/** `bulk_price` carries two decimals and `reference_price` three. */
const BULK_PRICE_STEP = 0.01;
const REFERENCE_PRICE_STEP = 0.001;

/**
 * The labels that name `reference_price` and not `bulk_price` (plan 0189):
 * what `bulk_price` is multiplied by to give `reference_price`, and the
 * label that is true of `bulk_price`, in the spelling the chain uses for it.
 */
const SCALED_LABELS: Readonly<
  Record<string, { factor: number; base: string }>
> = {
  '100 ml': { factor: 0.1, base: 'L' },
  '100 g': { factor: 0.1, base: 'kg' },
  dz: { factor: 12, base: 'ud' },
  dc: { factor: 12, base: 'ud' },
};

/** The label of a wash, and the label of each size format a wash is sold in. */
const WASH_LABEL = 'lv';
const SIZE_FORMAT_LABELS: Readonly<Record<string, string>> = {
  l: 'L',
  kg: 'kg',
};

/**
 * The label that is true of the unit price this adapter stores (plan 0189).
 *
 * The unit price stored is `bulk_price`, verbatim (plan 0038, section 2.4).
 * **`reference_format` is the label of `reference_price`, which is another
 * field.** The two fields hold the same figure for most products, and then
 * the label fits both. They differ for the products below, and there the
 * label as sent is false of the figure stored: a body oil of 200 ml at 3.40
 * was stored as 17 with the label "100 ml".
 *
 * This reads the three fields and changes the label only. No figure is
 * multiplied, divided or rounded on the way in, and `reference_price` is
 * evidence here, as it is in {@link comparedOver}. It is not stored.
 *
 * 1. `reference_price` equals `bulk_price` within one step of the last
 *    decimal: the label as sent. That is every `kg`, `L` and `ud` product.
 *    Proved by `product-detail-es.json`.
 * 2. The label is `100 ml`, `100 g`, `dz` or `dc`, and `reference_price`
 *    is `bulk_price` over ten, or times twelve: the figure stored is per
 *    litre, kilo or piece, so the label is `L`, `kg` or `ud`. Proved by
 *    three products captured on 2026-10-06:
 *    - `product-reference-format-100ml.json`, product 46815, a body oil of
 *      0.2 l at 3.40: `bulk_price: "17.00"`, `reference_price: "1.700"`.
 *    - `product-reference-format-100g.json`, product 34149, a spice of
 *      0.049 kg at 1.60: `bulk_price: "32.65"`, `reference_price: "3.266"`.
 *      The chain rounds each field on its own, so the two agree within a
 *      step and not to the digit.
 *    - `product-eggs-per-dozen.json`, product 15768, twelve eggs at 3.35
 *      under `dc`: `bulk_price: "0.28"` is one egg and `reference_price:
 *      "3.350"` is the dozen.
 * 3. The label is `lv`, a wash. `reference_price` is the pack price over
 *    the washes in `total_units`, and `bulk_price` is the pack price over
 *    `unit_size`: the figure stored is per litre or per kilo, so the label
 *    is `L` or `kg`, after `size_format`. Proved by
 *    `product-detergent-per-wash.json`, product 86400, captured on
 *    2026-10-06: 3 l at 5.85 with `total_units: 50` and `unit_name:
 *    "lavados"` answers `bulk_price: "1.95"` and `reference_price:
 *    "0.117"`. A pack of tablets whose two fields both hold the price of a
 *    wash falls under the first rule and keeps `lv`, which is true of it.
 * 4. Anything else: the label as sent. A product whose numbers agree with no
 *    rule keeps what the chain wrote, as its `bulk_price` does. A nail
 *    polish of 11 ml carries its own pack price as the figure, and nothing in
 *    the payload says what that figure is per.
 *
 * A payload with no `reference_price` has no evidence, and keeps its label.
 */
function readUnitPriceLabel(price: Json): string | null {
  const label = readString(price, 'reference_format');
  const bulk = readNumber(price, 'bulk_price');
  const reference = readNumber(price, 'reference_price');
  if (label === null || bulk === null || reference === null) {
    return label;
  }
  if (agree(reference, bulk, BULK_PRICE_STEP)) {
    return label;
  }
  const key = label.trim().toLowerCase();
  const scaled = Object.prototype.hasOwnProperty.call(SCALED_LABELS, key)
    ? SCALED_LABELS[key]
    : null;
  if (scaled !== null) {
    // Each field is rounded on its own, so the room is one step of the
    // coarser of the two after the scaling.
    const step = Math.max(
      REFERENCE_PRICE_STEP,
      BULK_PRICE_STEP * scaled.factor
    );
    return agree(reference, bulk * scaled.factor, step) ? scaled.base : label;
  }
  if (key === WASH_LABEL) {
    return washedLabel(price, bulk) ?? label;
  }
  return label;
}

/**
 * The label of a figure sent under `lv` that is not the price of a wash, or
 * null when the payload does not say what it is. See rule 3 above.
 */
function washedLabel(price: Json, bulk: number): string | null {
  const unitPrice = readNumber(price, 'unit_price');
  const unitSize = readNumber(price, 'unit_size');
  const washes = readNumber(price, 'total_units');
  const sizeFormat = readString(price, 'size_format')?.trim().toLowerCase();
  if (
    unitPrice === null ||
    unitSize === null ||
    unitSize <= 0 ||
    washes === null ||
    washes <= 0 ||
    sizeFormat === undefined ||
    !Object.prototype.hasOwnProperty.call(SIZE_FORMAT_LABELS, sizeFormat)
  ) {
    return null;
  }
  return comparedOver(price, washes) &&
    agree(bulk, unitPrice / unitSize, BULK_PRICE_STEP)
    ? SIZE_FORMAT_LABELS[sizeFormat]
    : null;
}

/** Whether two printed figures are the same within `step`. */
function agree(a: number, b: number, step: number): boolean {
  return Math.abs(a - b) <= step + 1e-9;
}

/**
 * How many units the pack holds (plan 0162, section 1).
 *
 * **A pack has a count.** When `is_pack` is true the count is `pack_size`, or
 * `total_units` when `pack_size` is not set. When both are set and differ the
 * source contradicts itself and the answer is null, because a count is read
 * and never chosen.
 *
 * Proved by `product-capsules-per-unit.json` (`is_pack: true`, `pack_size: 20`,
 * `total_units: 20`, so the two agree) and by `product-detail-es.json`
 * (`is_pack: false`). The other two cases are that capsule fixture with one
 * field changed in the spec, because no captured product shows them.
 *
 * **So has a box priced as one piece that the chain compares per piece inside
 * (plan 0177).** `is_pack` is false on such a product, and the count is
 * `total_units` when all three of these hold:
 *
 * 1. `total_units` is set,
 * 2. `reference_format` is `ud`, so the comparison price the chain prints is
 *    the box price over the pieces inside, and
 * 3. `size_format` is a weight or a volume and not `ud`, so `unit_size` is
 *    what the box weighs and not already a count.
 *
 * The second is what makes `total_units` a count of what is inside rather than
 * a number about the sale, and the third keeps the rule off a product whose
 * size is itself a count, where `unit_size` already says it. Proved by
 * `product-box-of-capsules.json`, product 11801, captured on 2026-10-04: a box
 * printed "Caja 16 cápsulas (160 g)" answers `is_pack: false`, `pack_size:
 * null`, `total_units: 16`, `unit_size: 0.16`, `size_format: "kg"`,
 * `reference_format: "ud"`, and its `bulk_price` of 0.31 is the 4.95 box over
 * 16. The other two chains print the same box as `16 ud`, and the count here is
 * what lets the two sizes be recognised as one format.
 *
 * Anything else is null: `total_units` with a comparison price per kilo or per
 * litre says nothing this adapter can read as a count.
 */
function readPackCount(price: Json): number | null {
  const packSize = readNumber(price, 'pack_size');
  const totalUnits = readNumber(price, 'total_units');
  if (readBoolean(price, 'is_pack') === true) {
    if (packSize !== null && totalUnits !== null && packSize !== totalUnits) {
      return null;
    }
    return packCountOf(packSize ?? totalUnits);
  }
  const comparedPerPiece =
    readString(price, 'reference_format')?.trim().toLowerCase() === 'ud';
  const sizeUnit = mapSizeFormat(readString(price, 'size_format'));
  const sizedByContent = sizeUnit !== null && sizeUnit !== UnitOfMeasure.UNIT;
  return comparedPerPiece && sizedByContent ? packCountOf(totalUnits) : null;
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
 *
 * It carries no **name** either, and now says so: `{}` rather than `{ es: '' }`
 * (plan 0111, section 9). An empty object is not a name and no caller may treat
 * it as one. This row exists to carry availability, and a blank string in a
 * required key was the old type forcing it to claim otherwise.
 */
export function unavailableProduct(
  externalId: string,
  observedAt: Date
): MercadonaProduct {
  return {
    externalId,
    ean: null,
    name: {},
    brand: null,
    soldByWeight: false,
    unitSize: null,
    unit: null,
    packCount: null,
    categorySlug: null,
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
