import {
  catalogPriceState,
  PRICE_UNIT_BASES,
  UNIT_OF_MEASURE_FALLBACK,
  UNITS_OF_MEASURE,
  type CatalogBrowseContext,
  type CatalogChain,
  type CatalogLocation,
  type CatalogProduct,
  type CatalogScopeChain,
  type CatalogScopeOffer,
  type LocalizedName,
  type PricePoint,
  type ProductPriceHistory,
  type ScopePriceSeries,
  type Supermarket,
} from '@portfolio/velista/models';
import { toProductCategories } from './category-mappers';
import {
  toLocalizedName,
  toPostalCodeCoverage,
  toProductOffer,
} from './mappers';
import {
  date,
  isRecord,
  mapArray,
  nullableNum,
  nullableStr,
  oneOf,
  oneOfOrNull,
  str,
} from './primitives';
import { toShopChainSummary } from './shop-mappers';

/**
 * From `catalog.ItemView`, for the catalog tab (velista `0100`, section 3).
 *
 * Only what a row and the sheet header draw. `sku`, `ean`, `productGroupId` and
 * the `offers` array are on the wire and are not read, because nothing on this
 * screen renders them (rule D4).
 *
 * The price goes through {@link toProductOffer}, the one offer mapper in the app,
 * and the unit basis is read beside it: it is the one field of an offer that only
 * this screen draws.
 */
export function toCatalogProduct(raw: unknown): CatalogProduct | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  if (id === null) {
    return null;
  }

  const offer = toProductOffer(raw['bestOffer']);
  const bestOffer = raw['bestOffer'];

  return {
    id,
    name: toLocalizedName(raw['name']),
    brand: nullableStr(raw['brand']),
    imageUrl: nullableStr(raw['imageUrl']),
    size: nullableNum(raw['unitSize']),
    unit: oneOf(raw['defaultUnit'], UNITS_OF_MEASURE, UNIT_OF_MEASURE_FALLBACK),
    categories: toProductCategories(raw['categories']),
    offer,
    // Null with no offer, so a basis can never describe a price that is not there.
    unitBasis:
      offer !== null && isRecord(bestOffer)
        ? oneOfOrNull(bestOffer['unitBasis'], PRICE_UNIT_BASES)
        : null,
  };
}

/**
 * From `catalog.SupermarketItemView` (`GET /v1/catalog/items/:id/offers`).
 *
 * `available` defaults to **false**. The one thing the sheet does with a true is
 * say the chain sells the product, and a row this build cannot read must not
 * claim that.
 */
export function toCatalogScopeOffer(raw: unknown): CatalogScopeOffer | null {
  if (!isRecord(raw)) {
    return null;
  }

  const offer = toProductOffer(raw);
  return offer === null
    ? null
    : { offer, available: raw['available'] === true };
}

/**
 * From `SupermarketLocationView` (`GET /v1/catalog/locations/:id`): the shop the
 * catalog tab is priced at, named (velista `0124`). Null without an id or a chain.
 */
export function toCatalogLocation(raw: unknown): CatalogLocation | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const supermarketId = str(raw['supermarketId']);
  if (id === null || supermarketId === null) {
    return null;
  }

  return {
    id,
    supermarketId,
    label: isRecord(raw['label']) ? toLocalizedName(raw['label']) : null,
    address: nullableStr(raw['address']),
    city: nullableStr(raw['city']),
  };
}

/**
 * From `catalog.ItemPriceHistoryView` (backend `0196`, section 2).
 *
 * Null when the answer or its range is unreadable: the chart cannot place a line
 * without knowing where the range starts. A series or a point this build cannot
 * read is dropped alone.
 */
export function toProductPriceHistory(
  raw: unknown
): ProductPriceHistory | null {
  if (!isRecord(raw)) {
    return null;
  }
  const from = date(raw['from']);
  const to = date(raw['to']);
  if (from === null || to === null) {
    return null;
  }
  return { from, to, series: mapArray(raw['series'], toScopePriceSeries) };
}

function toScopePriceSeries(raw: unknown): ScopePriceSeries | null {
  if (!isRecord(raw)) {
    return null;
  }
  const priceScopeId = str(raw['priceScopeId']);
  const supermarketId = str(raw['supermarketId']);
  if (priceScopeId === null || supermarketId === null) {
    return null;
  }
  return {
    priceScopeId,
    supermarketId,
    points: mapArray(raw['points'], toPricePoint),
  };
}

function toPricePoint(raw: unknown): PricePoint | null {
  if (!isRecord(raw)) {
    return null;
  }
  const at = date(raw['at']);
  return at === null
    ? null
    : {
        at,
        price: nullableNum(raw['price']),
        unitPrice: nullableNum(raw['unitPrice']),
      };
}

/** From one `catalog.ResolvedScopeView`. */
function toCatalogScopeChain(raw: unknown): CatalogScopeChain | null {
  if (!isRecord(raw)) {
    return null;
  }

  const priceScopeId = str(raw['priceScopeId']);
  const supermarketId = str(raw['supermarketId']);
  return priceScopeId === null || supermarketId === null
    ? null
    : { priceScopeId, supermarketId };
}

/**
 * The catalog tab's context, from three answers (velista `0100`, section 2).
 *
 * - `scope` is `CatalogScopeView` (`GET /v1/catalog/scope`): the person's postal
 *   codes and the scopes they resolve to.
 * - `summary` is `ShopChainSummariesView` (`GET /v1/catalog/shops/summary`): the
 *   chains near them, refused ones left out, which is the chip row.
 * - `supermarkets` names every chain, for a scope whose chain is not a chip.
 *
 * Null when the scope answer is unreadable. The state it decides is the one thing
 * the screen cannot guess: calling it `noPlace` would tell somebody who has a
 * postal code that they have none.
 */
export function toCatalogBrowseContext(
  scope: unknown,
  summary: unknown,
  supermarkets: readonly Supermarket[]
): CatalogBrowseContext | null {
  if (!isRecord(scope)) {
    return null;
  }

  const priceScopeIds = mapArray(scope['priceScopeIds'], str);
  const coverage = mapArray(scope['coverage'], toPostalCodeCoverage);
  const chains: CatalogChain[] = mapArray(
    isRecord(summary) ? summary['chains'] : undefined,
    toShopChainSummary
  )
    // The summary leaves refused chains out already. A row that still says so is
    // a server older than that rule, and a chip for a refused chain would list
    // products priced at a shop the person said they never enter.
    .filter((chain) => !chain.excludedChain && chain.locations > 0)
    .map((chain) => ({
      supermarketId: chain.supermarketId,
      name: chain.name,
      locations: chain.locations,
      logoUrl: chain.logoUrl,
    }));

  const chainNames = new Map<string, LocalizedName>();
  for (const chain of supermarkets) {
    chainNames.set(chain.id, chain.name);
  }
  for (const chain of chains) {
    chainNames.set(chain.supermarketId, chain.name);
  }

  return {
    state: catalogPriceState(priceScopeIds, coverage, chains),
    postalCodes: coverage.map((code) => code.postalCode),
    chains,
    scopes: mapArray(scope['scopes'], toCatalogScopeChain),
    chainNames,
  };
}
