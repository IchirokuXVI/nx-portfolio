import type {
  HarvestDocument,
  HarvestDocumentPrice,
  HarvestDocumentProduct,
} from './harvest-document';
import { HARVEST_DOCUMENT_2_VERSION } from './harvest-document-2.schema';

/**
 * The currency a version 1 product that named none was stating.
 *
 * Every producer this backend has is Spanish. Version 1 allowed a `unit_price`
 * carrying only an amount and a label, so the turn into version 2, where
 * `currency` is required beside every price, has to fill one in.
 */
const DEFAULT_CURRENCY = 'EUR';

/**
 * A validated document in the version 2 shape, whatever version it named (plan
 * 0103, D7).
 *
 * **Nothing downstream of the reader knows there are two versions.** The turn is
 * made once, here, rather than by every caller asking which fields to look at: a
 * version 1 product's `price` and `unit_price` become a one entry `prices` array
 * naming no scope, and a version 1 document declares no scopes, which means
 * every price belongs to the one the operator chose at the spawn.
 *
 * It is called after validation and never instead of it. A document that does
 * not match its own schema is refused by name, and this only reshapes one that
 * already matched.
 */
export function normalizeHarvestDocument(
  document: HarvestDocument
): HarvestDocument {
  if (document.schema_version === HARVEST_DOCUMENT_2_VERSION) {
    return document;
  }
  return {
    ...document,
    schema_version: HARVEST_DOCUMENT_2_VERSION,
    products: document.products.map(normalizeProduct),
  };
}

/**
 * One version 1 product, as version 2 states it.
 *
 * `price` and `unit_price` are dropped rather than carried beside `prices`, so a
 * reader that forgot to look at the new field fails loudly instead of silently
 * reading the old one.
 */
function normalizeProduct(
  product: HarvestDocumentProduct
): HarvestDocumentProduct {
  const { price, unit_price: unitPrice, ...rest } = product;
  if (!price && !unitPrice) {
    return { ...rest, prices: [] };
  }
  const entry: HarvestDocumentPrice = {
    scope: null,
    // Null rather than zero for a product that stated only a comparison figure,
    // which is a per kilogram offer with no pack price. Zero would be a lie
    // about a real product, and it is why version 2's `amount` is nullable.
    amount: price?.amount ?? null,
    currency: price?.currency ?? unitPrice?.currency ?? DEFAULT_CURRENCY,
    ...(unitPrice
      ? { unit_price: { amount: unitPrice.amount, label: unitPrice.label } }
      : {}),
    ...(product.validity ? { validity: product.validity } : {}),
    ...(product.observed_at ? { observed_at: product.observed_at } : {}),
  };
  return { ...rest, prices: [entry] };
}
