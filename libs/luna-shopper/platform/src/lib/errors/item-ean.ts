import { readGtin } from '@portfolio/luna-shopper/contracts';
import {
  ITEM_EAN_DETAIL,
  ITEM_EAN_REASON_DETAIL,
  ItemEanInvalidException,
} from './domain-exception';

/**
 * The EAN a product write may store: a real barcode, or null (plan 0184).
 *
 * One function for the gateway's item create and for catalog's own writes, so
 * the two refuse the same codes with the same sentence. Null and undefined
 * answer null, because a product with no barcode is an ordinary product.
 * Everything else goes through `readGtin`, and what it does not call a real
 * barcode is refused with `item_ean_invalid`.
 *
 * It answers the code trimmed, which is what gets stored.
 */
export function requireProductEan(
  ean: string | null | undefined
): string | null {
  if (ean === null || ean === undefined) {
    return null;
  }
  const reading = readGtin(ean);
  if (reading.kind === 'GTIN') {
    return reading.gtin;
  }
  const reason = reading.kind === 'IN_STORE' ? 'IN_STORE' : reading.reason;
  throw new ItemEanInvalidException(
    reading.kind === 'IN_STORE'
      ? `EAN ${ean} is an in-store code: 13 digits that start with 2 name a ` +
          'product inside one shop only. A product holds a real barcode or none.'
      : `EAN ${JSON.stringify(ean)} is not a barcode (${reason}). A barcode ` +
          'is 8, 12, 13 or 14 digits with a valid check digit.',
    { details: { [ITEM_EAN_DETAIL]: ean, [ITEM_EAN_REASON_DETAIL]: reason } }
  );
}
