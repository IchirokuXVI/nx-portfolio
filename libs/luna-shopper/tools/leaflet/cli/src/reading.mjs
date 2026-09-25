/**
 * One row of a page reading, read the same way by everything that reads one.
 *
 * **Every chain prompt asks for one shape** (plan 0002 in `cli/plans/`): the
 * catalog fields at the top in camelCase, and the fields only a leaflet prints
 * nested under `leaflet`. El Jamon's prompt used to ask for a flat row with
 * snake_case keys, and the builder read only the nested shape, so a whole El
 * Jamon reading reached the document as name, brand and headline price. The
 * readings taken in that flat shape still exist, so `readRow` takes both and
 * the builder and the sanity pass read the answer rather than the keys.
 *
 * `unknownKeys` is the other half: a key neither shape names is a field
 * somebody asked a model for and nothing reads, which is how the flat shape
 * went unnoticed. The builder names each one.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

const num = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const first = (...values) => values.find((value) => value != null) ?? null;

/** The keys a row may carry at its top level, in either shape. */
const ROW_KEYS = new Set([
  // The shape every prompt asks for.
  'name',
  'brand',
  'unitSize',
  'sizeFormat',
  'price',
  'unitPrice',
  'unitPriceLabel',
  'category',
  'categoryPath',
  'leaflet',
  // The flat shape El Jamon's prompt asked for before plan 0002.
  'format',
  'basis',
  'was_price',
  'unit_price',
  'unit_price_per',
  'loyalty',
  'promotion',
]);

/** The keys the nested `leaflet` block may carry. */
const LEAFLET_KEYS = new Set([
  'format',
  'basis',
  'wasPrice',
  'loyalty',
  'promotion',
  'validUntil',
  'validityText',
]);

/** The keys a promotion may carry, in either spelling. */
const PROMOTION_KEYS = new Set([
  'type',
  'rawText',
  'requiredQuantity',
  'effectiveUnitPrice',
  'totalPrice',
  'singleUnitPrice',
  'raw_text',
  'required_quantity',
  'effective_unit_price',
  'total_price',
  'single_unit_price',
]);

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Every key of a row that neither shape names, as a dotted path:
 * `colour`, `leaflet.stock`, `leaflet.promotion.minimum`.
 */
export function unknownKeys(row) {
  if (!isObject(row)) {
    return [];
  }
  const out = [];
  const walk = (bag, known, prefix) => {
    for (const key of Object.keys(bag)) {
      if (!known.has(key)) {
        out.push(prefix + key);
      }
    }
  };
  walk(row, ROW_KEYS, '');
  if (isObject(row.leaflet)) {
    walk(row.leaflet, LEAFLET_KEYS, 'leaflet.');
    if (isObject(row.leaflet.promotion)) {
      walk(row.leaflet.promotion, PROMOTION_KEYS, 'leaflet.promotion.');
    }
  }
  if (isObject(row.promotion)) {
    walk(row.promotion, PROMOTION_KEYS, 'promotion.');
  }
  return out;
}

/** One row of a reading, from either of the two shapes, in one set of names. */
export function readRow(row) {
  const leaflet = isObject(row?.leaflet) ? row.leaflet : {};
  const promotion = first(leaflet.promotion, row?.promotion);
  const unitPriceLabel = text(first(row?.unitPriceLabel));
  const unitPricePer = text(first(row?.unit_price_per));
  return {
    name: text(row?.name),
    brand: text(row?.brand),
    price: num(row?.price),
    unitSize: num(row?.unitSize),
    sizeFormat: text(row?.sizeFormat),
    category: text(row?.category),
    categoryPath: Array.isArray(row?.categoryPath)
      ? row.categoryPath.filter((value) => typeof value === 'string')
      : [],
    format: text(first(leaflet.format, row?.format)),
    basis: text(first(leaflet.basis, row?.basis)),
    wasPrice: num(first(leaflet.wasPrice, row?.was_price)),
    unitPrice: num(first(row?.unitPrice, row?.unit_price)),
    unitPriceLabel,
    unitPricePer,
    // What the sanity pass asks: is there anything at all that says what the
    // unit price is per.
    unitPriceBasis: first(unitPricePer, unitPriceLabel),
    loyalty: first(leaflet.loyalty, row?.loyalty) === true,
    validUntil: text(leaflet.validUntil),
    validityText: text(leaflet.validityText),
    promotion: isObject(promotion)
      ? {
          type: text(promotion.type),
          rawText: text(first(promotion.rawText, promotion.raw_text)),
          requiredQuantity: num(
            first(promotion.requiredQuantity, promotion.required_quantity)
          ),
          effectiveUnitPrice: num(
            first(promotion.effectiveUnitPrice, promotion.effective_unit_price)
          ),
          totalPrice: num(first(promotion.totalPrice, promotion.total_price)),
          singleUnitPrice: num(
            first(promotion.singleUnitPrice, promotion.single_unit_price)
          ),
        }
      : null,
  };
}
