import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import {
  LIDL_BASE_URL,
  LidlClient,
  LidlHttpError,
  type LidlListRow,
  type LidlProduct,
} from '@portfolio/luna-shopper/lidl';
import {
  MercadonaClient,
  MercadonaHttpError,
  type MercadonaProduct,
} from '@portfolio/luna-shopper/mercadona';
import type { SourceCatalogEntry, SupermarketSource } from '../entities';
import type {
  PartialSourceObservation,
  SourceObservationPrice,
} from './source-ingest';

/** What one fetcher is given: one row, its chain, and where to read it. */
export interface RefreshFetchRequest {
  entry: SourceCatalogEntry;
  source: SupermarketSource;
  /** The `externalKey` of the fetch scope: a warehouse, or a region. */
  fetchKey: string;
  /** Aborts at the refresh timeout (section 6). */
  signal: AbortSignal;
  userAgent: string;
  mercadonaBaseUrl?: string;
  /** Injected in tests. Defaults to Node's global fetch. */
  fetchImpl?: typeof fetch;
}

/** What one request read: a price for the row, or that the source stocks none. */
export type RefreshFetchResult =
  | { found: true; observation: PartialSourceObservation }
  | { found: false };

export type RefreshFetcher = (
  request: RefreshFetchRequest
) => Promise<RefreshFetchResult>;

/**
 * Admits every request at once. A refresh is one request, bounded by the
 * cooldowns of section 5 and not by a run's token bucket, and a client given
 * an `acquire` uses no pacing of its own.
 */
const admitAtOnce = async (): Promise<void> => undefined;

/**
 * Mercadona: one product detail for the warehouse of the fetch key (section
 * 6), built as the walk builds its client, with no guard because a refresh is
 * not a run. A 404 is "not stocked in this warehouse" and writes nothing.
 *
 * The detail names one warehouse only, which is why a walk prices from the
 * listing. For the warehouse it was asked of, the detail and the listing state
 * the same number, `bulk_price` included, and for a product sold by weight the
 * detail's price is the price of a kilo, as the listing's is.
 */
export const fetchMercadona: RefreshFetcher = async (request) => {
  const client = new MercadonaClient({
    warehouse: request.fetchKey,
    userAgent: request.userAgent,
    baseUrl: request.mercadonaBaseUrl,
    acquire: admitAtOnce,
    signal: request.signal,
    fetchImpl: request.fetchImpl,
  });
  const detail = await client.fetchProduct(request.entry.externalId, ['es']);
  if (!detail) {
    return { found: false };
  }
  return {
    found: true,
    observation: {
      externalId: request.entry.externalId,
      detailFetched: false,
      observedAt: detail.observedAt,
      soldByWeight: detail.soldByWeight,
      prices: mercadonaPrices(detail, request.fetchKey),
    },
  };
};

/**
 * LIDL: the product page, by the path the stored row's address names (section
 * 6). The page states one price per offer region with its window, and every
 * region it names is written, because one request returned all of them. A
 * region with no scope yet is dropped by the write, which creates no scope.
 *
 * The list row is rebuilt from the stored row. The fields the page restates
 * are read from the page; the others are the stored values or empty.
 */
export const fetchLidl: RefreshFetcher = async (request) => {
  const baseUrl = lidlBaseUrl(request.source);
  const client = new LidlClient({
    userAgent: request.userAgent,
    baseUrl,
    acquire: admitAtOnce,
    signal: request.signal,
    fetchImpl: request.fetchImpl,
  });
  const product = await client.getProduct(lidlRowOf(request.entry, baseUrl));
  if (!product) {
    return { found: false };
  }
  return {
    found: true,
    observation: {
      externalId: request.entry.externalId,
      detailFetched: false,
      observedAt: product.observedAt,
      // The page has no field for it (plan 0181), so the row keeps its own.
      prices: lidlPrices(product),
    },
  };
};

/**
 * One fetcher per adapter that can refresh one product (section 6). An adapter
 * with none is refused before any claim, by its `refreshesOneProduct`.
 */
export const PRICE_REFRESH_FETCHERS: Partial<
  Record<AdapterKey, RefreshFetcher>
> = {
  'mercadona-api': fetchMercadona,
  'lidl-api': fetchLidl,
};

/** The injection token for the table above, so a spec can hand in fakes. */
export const REFRESH_FETCHERS = Symbol('PRICE_REFRESH_FETCHERS');

/**
 * Whether a fetch error is the chain refusing (section 6): a 403 from either
 * client, which is `BLOCKED` and never retried. A 429 that outlived the
 * client's retries is a failure of this one request, not a block.
 */
export function isRefusal(error: unknown): boolean {
  return (
    (error instanceof MercadonaHttpError || error instanceof LidlHttpError) &&
    error.status === 403
  );
}

function mercadonaPrices(
  detail: MercadonaProduct,
  warehouse: string
): SourceObservationPrice[] {
  if (detail.price === null && detail.unitPrice === null) {
    return [];
  }
  return [
    {
      scopeKey: warehouse,
      price: detail.price,
      currency: detail.currency,
      unitPrice: detail.unitPrice,
      unitPriceLabel: detail.unitPriceLabel,
      // A storefront price has no window (plan 0086, section 5).
      validFrom: null,
      validUntil: null,
    },
  ];
}

/**
 * One price per region, verbatim, with no unit price, as the walk writes them
 * (`lidl-catalog.runner.ts`): LIDL publishes no per kilogram figure.
 */
function lidlPrices(product: LidlProduct): SourceObservationPrice[] {
  return product.prices.flatMap((price) =>
    price.regions.map((region) => ({
      scopeKey: region.id,
      price: price.price,
      currency: price.currency,
      unitPrice: null,
      unitPriceLabel: null,
      validFrom: price.validFrom,
      validUntil: price.validUntil,
    }))
  );
}

/** The base URL a walk of this chain reads, from its row (plan 0083). */
function lidlBaseUrl(source: SupermarketSource): string {
  const value = source.config?.['baseUrl'];
  return (
    typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : LIDL_BASE_URL
  ).replace(/\/+$/, '');
}

/**
 * The list row a page read needs, from the stored row: `externalId`, and the
 * path of its stored address with the base URL removed.
 */
function lidlRowOf(entry: SourceCatalogEntry, baseUrl: string): LidlListRow {
  return {
    externalId: entry.externalId,
    name: entry.name,
    brand: entry.brand,
    siteCategory: '',
    categoryPath: [],
    path: pathOf(entry.url, baseUrl),
    sizeFormat: entry.sizeFormat,
    listPrice: null,
    ian: null,
    image: null,
    imageList: [],
  };
}

/** The address with the base removed, or its path when it names another host. */
function pathOf(url: string | null, baseUrl: string): string | null {
  if (!url) {
    return null;
  }
  if (url.startsWith(baseUrl)) {
    return url.slice(baseUrl.length) || null;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.startsWith('/') ? url : null;
  }
}
