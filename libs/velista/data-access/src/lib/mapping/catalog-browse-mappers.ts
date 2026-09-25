import {
  catalogPriceState,
  PRICE_UNIT_BASES,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_FALLBACK,
  UNIT_OF_MEASURE_FALLBACK,
  UNITS_OF_MEASURE,
  type CatalogBrowseContext,
  type CatalogChain,
  type CatalogProduct,
  type CatalogScopeChain,
  type CatalogScopeOffer,
  type LocalizedName,
  type Supermarket,
} from '@portfolio/velista/models';
import {
  toLocalizedName,
  toPostalCodeCoverage,
  toProductOffer,
} from './mappers';
import {
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
    category: oneOf(
      raw['category'],
      PRODUCT_CATEGORIES,
      PRODUCT_CATEGORY_FALLBACK
    ),
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
