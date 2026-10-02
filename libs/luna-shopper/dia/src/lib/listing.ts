import type {
  DiaListingPage,
  DiaListingRow,
  DiaPromotion,
  DiaRawPrices,
} from './types';

/** The listing answers 20 rows per page and takes no other size. */
export const DIA_PAGE_SIZE = 20;

/**
 * One page of `GET /api/v1/plp-back/reduced/<root>/<leaf>/c/L<code>` (plan
 * 0174, section 1).
 *
 * The row carries everything a price run needs, so no product page is read. A
 * page past the end answers 200 with no rows, which is an empty `rows` here and
 * not an error.
 */
export function parseListing(json: unknown): DiaListingPage {
  const body = asRecord(json);
  const pagination = asRecord(body['pagination']);
  const rows: DiaListingRow[] = [];
  for (const raw of asArray(body['plp_items'])) {
    const row = parseRow(asRecord(raw));
    if (row) {
      rows.push(row);
    }
  }
  return {
    rows,
    pageNumber: number(pagination['page_number']) ?? 1,
    totalPages: number(pagination['total_pages']) ?? 1,
    totalItems: number(body['total_items']),
    categoryId: text(body['selected_category_id']),
    categoryName: text(asRecord(body['seo'])['current_category_name']),
    movedTo: null,
  };
}

function parseRow(raw: Record<string, unknown>): DiaListingRow | null {
  const skuId = text(raw['sku_id']) ?? text(raw['object_id']);
  const displayName = text(raw['display_name']);
  if (!skuId || !displayName) {
    return null;
  }
  return {
    skuId,
    displayName,
    brand: text(raw['brand']),
    url: text(raw['url']),
    image: text(raw['image']),
    prices: parsePrices(raw['prices']),
    promotions: asArray(raw['promotions']).map(parsePromotion),
    unitsInStock: number(raw['units_in_stock']) ?? 0,
    weightInGrams: number(raw['weight_in_grams']),
    averageWeight: number(raw['average_weight']),
  };
}

function parsePrices(raw: unknown): DiaRawPrices | null {
  const prices = asRecord(raw);
  const price = number(prices['price']);
  if (price === null) {
    return null;
  }
  return {
    currency: text(prices['currency']) ?? 'EUR',
    price,
    // No row was seen without one (section 4). A missing one is read as "no
    // other price", which is what an equal one says.
    strikethroughPrice: number(prices['strikethrough_price']) ?? price,
    pricePerUnit: number(prices['price_per_unit']),
    measureUnit: text(prices['measure_unit']),
    isClubPrice: prices['is_club_price'] === true,
    isPromoPrice: prices['is_promo_price'] === true,
    discountPercentage: number(prices['discount_percentage']),
  };
}

function parsePromotion(raw: unknown): DiaPromotion {
  const promotion = asRecord(raw);
  return {
    description: text(promotion['description']),
    shortDescription: text(promotion['short_description']),
    onlyClubDia: promotion['only_club_dia'] === true,
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

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
