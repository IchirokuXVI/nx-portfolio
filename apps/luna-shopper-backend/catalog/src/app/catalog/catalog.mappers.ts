import type {
  ItemView,
  PriceScopeView,
  SupermarketItemView,
  SupermarketLocationItemView,
  SupermarketLocationView,
  SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import type {
  Item,
  PriceScope,
  SupermarketItem,
  SupermarketLocationItem,
  SupermarketLocation,
  Supermarket,
} from '../entities';

/**
 * Postgres `numeric` comes back as a **string** through node-postgres, so every
 * numeric column is normalised here rather than cast. A cast would produce the
 * string on the wire and a silent NaN the first time anything did arithmetic.
 */
function toNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

export function toSupermarketView(row: Supermarket): SupermarketView {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    websiteUrl: row.websiteUrl,
    externalBrandKey: row.externalBrandKey,
  };
}

export function toSupermarketLocationView(
  row: SupermarketLocation
): SupermarketLocationView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    priceScopeId: row.priceScopeId,
    label: row.label,
    address: row.address,
    city: row.city,
    country: row.country,
    postalCode: row.postalCode,
    latitude: row.latitude,
    longitude: row.longitude,
    externalRef: row.externalRef,
    externalProvider: row.externalProvider,
  };
}

export function toPriceScopeView(row: PriceScope): PriceScopeView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    kind: row.kind,
    externalKey: row.externalKey,
    label: row.label,
  };
}

export function toItemView(row: Item): ItemView {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    imageUrl: row.imageUrl,
    sku: row.sku,
    ean: row.ean,
    unitSize: toNumber(row.unitSize),
    category: row.category,
    defaultUnit: row.defaultUnit,
  };
}

export function toSupermarketItemView(
  row: SupermarketItem
): SupermarketItemView {
  return {
    id: row.id,
    itemId: row.itemId,
    priceScopeId: row.priceScopeId,
    price: toNumber(row.price),
    currency: row.currency,
    unitPrice: toNumber(row.unitPrice),
    unitPriceLabel: row.unitPriceLabel,
    priceObservedAt: row.priceObservedAt
      ? row.priceObservedAt.toISOString()
      : null,
    priceSourceKind: row.priceSourceKind,
    available: row.available,
  };
}

export function toSupermarketLocationItemView(
  row: SupermarketLocationItem
): SupermarketLocationItemView {
  return {
    id: row.id,
    itemId: row.itemId,
    supermarketLocationId: row.supermarketLocationId,
    positionInStore: row.positionInStore,
    available: row.available,
  };
}
