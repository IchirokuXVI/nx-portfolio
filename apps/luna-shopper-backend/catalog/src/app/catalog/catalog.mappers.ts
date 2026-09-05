import type {
  ItemOfferView,
  ItemPriceView,
  ItemView,
  PricePolicyView,
  PriceScopeView,
  ProductGroupView,
  SupermarketItemView,
  SupermarketLocationItemView,
  SupermarketLocationView,
  SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import type {
  Item,
  ItemPrice,
  PricePolicy,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
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
    defaultPriceScopeId: row.defaultPriceScopeId,
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
    postalCodeSource: row.postalCodeSource,
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

export function toProductGroupView(row: ProductGroup): ProductGroupView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    referenceUnit: row.referenceUnit,
    // A row written before the column had a default, or one hand edited in psql,
    // can hold a shape the type promises is there. The search degrades to no
    // synonyms rather than throwing halfway through building a suggestion.
    synonyms: {
      en: row.synonyms?.en ?? [],
      es: row.synonyms?.es ?? [],
    },
  };
}

/**
 * An item on the wire.
 *
 * `bestOffer` is added **only when there is one**, rather than always written as
 * null: the field is optional in the contract precisely so the reads with no
 * scopes to price against say nothing about price at all, and a literal `null`
 * on `item.get` would be a claim that this product has no price anywhere.
 */
export function toItemView(row: Item, bestOffer?: ItemOfferView): ItemView {
  const view: ItemView = {
    id: row.id,
    name: row.name,
    brand: row.brand,
    imageUrl: row.imageUrl,
    sku: row.sku,
    ean: row.ean,
    unitSize: toNumber(row.unitSize),
    category: row.category,
    defaultUnit: row.defaultUnit,
    productGroupId: row.productGroupId,
  };
  return bestOffer ? { ...view, bestOffer } : view;
}

/** A timestamp on the wire, or null. Raw rows hand back strings, entities hand back dates. */
function toInstant(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function toItemOfferView(row: SupermarketItem): ItemOfferView {
  return {
    itemId: row.itemId,
    priceScopeId: row.priceScopeId,
    price: toNumber(row.price),
    currency: row.currency,
    unitPrice: toNumber(row.unitPrice),
    unitPriceLabel: row.unitPriceLabel,
    observedAt: toInstant(row.priceObservedAt),
    sourceKind: row.priceSourceKind ?? null,
    stale: row.stale ?? false,
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
    observedAt: toInstant(row.priceObservedAt),
    sourceKind: row.priceSourceKind ?? null,
    stale: row.stale ?? false,
    validUntil: toInstant(row.validUntil),
    itemPriceId: row.itemPriceId ?? null,
    available: row.available,
  };
}

export function toItemPriceView(row: ItemPrice): ItemPriceView {
  return {
    id: row.id,
    itemId: row.itemId,
    priceScopeId: row.priceScopeId,
    sourceKind: row.sourceKind,
    price: toNumber(row.price),
    currency: row.currency,
    unitPrice: toNumber(row.unitPrice),
    unitPriceLabel: row.unitPriceLabel,
    observedAt: toInstant(row.observedAt) ?? '',
    lastObservedAt: toInstant(row.lastObservedAt) ?? '',
    validFrom: toInstant(row.validFrom),
    validUntil: toInstant(row.validUntil),
    sourceRunId: row.sourceRunId ?? null,
    lastObservedRunId: row.lastObservedRunId ?? null,
    overrides: row.overrides ?? null,
    protectedUntil: toInstant(row.protectedUntil),
  };
}

export function toPricePolicyView(row: PricePolicy): PricePolicyView {
  return {
    sourceKind: row.sourceKind,
    priority: row.priority,
    maxAgeDays: row.maxAgeDays ?? null,
    enabled: row.enabled,
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
