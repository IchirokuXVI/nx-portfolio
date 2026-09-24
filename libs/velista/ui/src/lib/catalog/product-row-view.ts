import {
  catalogName,
  type CatalogProduct,
  type UnitOfMeasure,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import type { ProductRowView } from './product-row';

/** A translator call, so this stays a plain function a spec can run. */
export type CatalogTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

export interface ProductRowOptions {
  readonly locale: string;
  readonly translate: CatalogTranslate;
  /**
   * The chain a price scope belongs to, by name, or null when the read did not
   * resolve that scope.
   */
  readonly chainOf: (priceScopeId: string) => string | null;
  /**
   * One chain is chosen, so the caption is the price per litre or kilo rather
   * than the chain's name, which would be the same on every row (section 3).
   */
  readonly chainChosen: boolean;
}

/**
 * What one product row says (velista `0100`, section 3), decided once, here.
 *
 * - The name in the reader's language, and `brand · size` under it.
 * - The cheapest price at the trailing edge, and under it the chain's name, or
 *   with a chain chosen the price per unit the source published.
 * - `no price` as words when there is none.
 * - The accessible name: the product, the size and the price, in that order.
 */
export function productRowView(
  product: CatalogProduct,
  options: ProductRowOptions
): ProductRowView {
  const { locale, translate } = options;
  const name = catalogName(product.name, locale);
  const size = sizeText(product.size, product.unit, options);
  const detail = [product.brand, size]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  const offer = product.offer;
  const price =
    offer !== null && offer.price !== null
      ? formatMoney(offer.price, offer.currency, locale)
      : null;

  let caption: string | null = null;
  if (price !== null && offer !== null) {
    if (options.chainChosen) {
      caption =
        offer.unitPrice !== null && product.unitBasis !== null
          ? translate(`catalog.unit.${product.unitBasis}`, {
              price: formatMoney(offer.unitPrice, offer.currency, locale),
            })
          : null;
    } else {
      caption = options.chainOf(offer.priceScopeId);
    }
  }

  return {
    id: product.id,
    name,
    detail: detail === '' ? null : detail,
    imageUrl: product.imageUrl,
    price,
    caption,
    stale: price !== null && offer?.stale === true,
    label: [name, size, price ?? translate('catalog.row.noPrice')]
      .filter((part): part is string => part !== null)
      .join(', '),
  };
}

/**
 * How big the packet is, or null when there is nothing worth saying.
 *
 * The composer's rule (`SuggestionList.sizeOf`), for its reason: the catalog holds
 * one record per size, so the size is what tells two rows apart, and a count of
 * one is what every product is and says nothing.
 */
function sizeText(
  size: number | null,
  unit: UnitOfMeasure,
  options: ProductRowOptions
): string | null {
  if (size === null || size <= 0) {
    return null;
  }
  if ((unit === 'UNIT' || unit === 'PACK') && size < 2) {
    return null;
  }

  let number: string;
  try {
    number = new Intl.NumberFormat(options.locale, {
      maximumFractionDigits: 3,
    }).format(size);
  } catch {
    number = String(size);
  }
  return options.translate(`list.add.size.${unit}`, { size: number });
}
