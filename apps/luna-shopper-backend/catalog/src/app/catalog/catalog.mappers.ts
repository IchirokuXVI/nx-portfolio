import {
  CONTENT_LOCALES,
  type ContentLocale,
  type ItemOfferView,
  type ItemPriceView,
  type ItemView,
  type LocalizedText,
  type PricePolicyView,
  type PriceScopeView,
  type ProductGroupView,
  type SupermarketItemView,
  type SupermarketLocationItemView,
  type SupermarketLocationView,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import {
  decodeCursor,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
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
 * The content locales, the caller's first (plan 0111, section 4).
 *
 * No language goes first on its own account. A reader of Spanish falls through
 * Spanish and then English, a reader of English the other way about, and both
 * still see a row that carries only the other language rather than a blank.
 *
 * A supported request locale the catalog writes no content in contributes
 * nothing and leaves the rest in their declared order, so adding a request
 * language before the content that goes with it is not a special case here.
 */
export function readingOrder(
  locale: SupportedLocale
): readonly ContentLocale[] {
  return [
    ...CONTENT_LOCALES.filter((l) => l === locale),
    ...CONTENT_LOCALES.filter((l) => l !== locale),
  ];
}

/**
 * The sort key for a localized name, in SQL: the caller's language, then the
 * others, never null (plan 0079, section 3; the caller's order is plan 0111).
 *
 * The three admin listings that page by name use it in the `ORDER BY`, in the
 * keyset seek and, through {@link displayName}, in the cursor value, and the
 * three must agree. A row comparison with a NULL member yields NULL and a NULL
 * predicate drops the row, so seeking on `name ->> 'en'` alone made every
 * Spanish only product appear on no page at all, with nothing to say so. Not
 * indexed, and not worth indexing: these are admin listings of a few thousand
 * rows.
 *
 * Now that the order depends on the caller, the locale it was built under is a
 * fourth thing that has to agree, which is why the cursor carries it (section
 * 5) and a page cut under another language starts over instead of seeking.
 *
 * The interpolation is safe and must stay auditable: `locale` is the narrowed
 * `SupportedLocale` union, and `toSupportedLocale` is the only way into that
 * type. A locale that reached this function unnarrowed is SQL injection, so
 * pass what the request context holds and never a request string.
 */
export const displayNameSql = (
  alias: string,
  locale: SupportedLocale
): string =>
  `coalesce(${readingOrder(locale)
    .map((l) => `${alias}.name ->> '${l}'`)
    .join(', ')}, '')`;

/** The TypeScript half of {@link displayNameSql}: the same rule, for the cursor. */
export function displayName(
  name: LocalizedText,
  locale: SupportedLocale
): string {
  for (const l of readingOrder(locale)) {
    const value = name[l];
    if (value != null) {
      return value;
    }
  }
  return '';
}

/**
 * Decodes a listing cursor and discards one that was cut under a different
 * language (plan 0111, section 5).
 *
 * A name ordered page seeks with `(displayNameSql(locale), id) > (value, id)`,
 * so the value in the token means something only under the locale that produced
 * it. An operator who switches language halfway down a list would otherwise
 * page with one language's predicate against the other language's key and get
 * rows repeated or silently skipped, with nothing on screen to say so.
 *
 * Discarding is the whole mechanism, because {@link decodeCursor} already
 * treats a cursor it cannot use as "start from the beginning" rather than an
 * error. A restarted page is a visible, harmless outcome; a mismatched seek is
 * an invisible, wrong one.
 *
 * Every order is checked and not just `name`, even though `created` and
 * `updated` sort by a timestamp no language touches. One token cannot be
 * half valid, the caller cannot tell which orders are locale sensitive, and the
 * cost of being uniform is one restarted page on a listing the operator was
 * about to refetch anyway.
 */
export function decodeCursorForLocale<T extends { locale: SupportedLocale }>(
  cursor: string | null | undefined,
  locale: SupportedLocale
): T | undefined {
  // Cast for the same reason every call site used to: an interface carries no
  // index signature, so it does not satisfy `decodeCursor`'s constraint.
  const decoded = decodeCursor(cursor) as T | undefined;
  return decoded?.locale === locale ? decoded : undefined;
}

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

/**
 * @param priceScopeIds the shop's stack, most specific first (plan 0105,
 * section 3). Read separately rather than joined, because every caller but
 * `get` is mapping a page and a to-many join multiplies the rows a `limit`
 * counts.
 */
export function toSupermarketLocationView(
  row: SupermarketLocation,
  priceScopeIds: readonly string[]
): SupermarketLocationView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    priceScopeId: priceScopeIds[0],
    priceScopeIds: [...priceScopeIds],
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
    priority: row.priority,
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
    // Loaded only by the history read (plan 0081, section 6.4). An unloaded
    // relation and a row no leaflet wrote are both null, and the difference
    // does not matter to any caller: nothing branches on it.
    details: row.details
      ? {
          offerId: row.details.offerId ?? null,
          page: row.details.page ?? null,
          rawText: row.details.rawText ?? [],
          promotion: row.details.promotion ?? null,
          loyalty: row.details.loyalty ?? null,
        }
      : null,
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
    availabilitySourceKind: row.availabilitySourceKind,
    availabilityObservedAt: row.availabilityObservedAt
      ? row.availabilityObservedAt.toISOString()
      : null,
    availabilitySourceRunId: row.availabilitySourceRunId,
  };
}
