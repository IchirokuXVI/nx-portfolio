import {
  SourceProbeRecorder,
  hasText,
  isPositive,
  mostRowsCarry,
  pacedAcquire,
  type SourceProbeResult,
  type SourceProbeSample,
} from '@portfolio/luna-shopper/contracts';
import { isGroceryCategory } from './categories';
import type { Json } from './json';
import { LidlClient } from './lidl.client';
import {
  normalizeListPage,
  normalizeStorePage,
  type LidlListPage,
} from './normalize';
import { LIDL_BASE_URL, LIDL_STORES_URL, type LidlListRow } from './types';

/** The shops the store step reads: one page of five, as the live spec read. */
const STORE_PAGE = 5;

/** The rows one listing step asks for: one page of the walk. */
const LISTING_PAGE = 100;

/** What a listing step says when no page it read held a grocery row. */
export const LIDL_PROBE_NO_GROCERY_NOTE = 'no grocery product was read';

/** What {@link probeLidl} takes: the seams its client takes. */
export interface LidlProbeOptions {
  userAgent: string;
  /** From the source row's `config.baseUrl`, as a run reads it. */
  baseUrl?: string;
  storesUrl?: string;
  storesApiKey?: string;
  /** The run's token bucket at the row's rate. */
  acquire?: () => Promise<void>;
  /** The least time between two requests. Default 1000 ms. */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** The clock a step's duration is read from. */
  now?: () => number;
}

/**
 * Three or four steps against LIDL (plan 0219, section 3.2): the in store
 * index at offset 0, the page of the first grocery row, and one store page of
 * five.
 *
 * **The product is a grocery row, as the walk reads** (plan 0252). The window
 * opens with the weekly bazar on some days, and a bazar product carries no
 * region price. When the first page holds no grocery row the probe asks for
 * the next page once. With none there either it reads no product, says so in
 * the listing step, and still reads the shops.
 *
 * **No category step.** The walk pages the in store index and has no tree
 * (plan 0089). The index is a rolling window of the week's offers, so a count
 * is a floor of one and never a total.
 *
 * Never throws for a source failure. `retries` is 0, so a 403 or a 429 throws
 * at once and the probe makes no request after it.
 */
export async function probeLidl(
  options: LidlProbeOptions
): Promise<SourceProbeResult> {
  const client = new LidlClient({
    userAgent: options.userAgent,
    baseUrl: options.baseUrl,
    storesUrl: options.storesUrl,
    storesApiKey: options.storesApiKey,
    pageSize: LISTING_PAGE,
    acquire: pacedAcquire({
      acquire: options.acquire,
      minIntervalMs: options.minIntervalMs ?? 1000,
      sleep: options.sleepImpl,
      now: options.now,
    }),
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    signal: options.signal,
    retries: 0,
  });
  const base = (options.baseUrl ?? LIDL_BASE_URL).replace(/\/+$/, '');
  const probe = new SourceProbeRecorder(options.now);

  /** One page of the index. `last` is true when no page follows it. */
  const listing = (name: string, offset: number, last: boolean) =>
    probe.step(
      name,
      client.searchUrl(offset),
      async () =>
        normalizeListPage((await client.captureSearchPage(offset)) as Json),
      (value) => {
        const problems = isPositive(value.total)
          ? []
          : ['the index stated no total above zero'];
        problems.push(
          ...mostRowsCarry(value.rows, {
            externalId: (row) => hasText(row.externalId),
            path: (row) => hasText(row.path),
            // A bazar row carries a category too, just not a grocery one. A
            // page with none lost the field grocery is told from bazar by.
            siteCategory: (row) => hasText(row.siteCategory),
          })
        );
        const sample: SourceProbeSample = {
          total: value.total,
          rows: value.rows.length,
          firstName: value.rows[0]?.name ?? null,
          groceryRows: value.rows.filter((row) =>
            isGroceryCategory(row.siteCategory)
          ).length,
        };
        if (!groceryRow(value) && (last || !hasNextPage(value))) {
          sample['note'] = LIDL_PROBE_NO_GROCERY_NOTE;
        }
        return { problems, sample };
      }
    );

  const page = await listing('listing', 0, false);
  if (page === undefined) {
    return probe.result(client.requests);
  }
  let row = groceryRow(page);
  if (row === undefined && hasNextPage(page)) {
    const next = await listing('listing page 2', LISTING_PAGE, true);
    if (next === undefined) {
      return probe.result(client.requests);
    }
    row = groceryRow(next);
  }

  // No grocery row on either page is no product to read, not a change of
  // shape: the listing step said so, and the shop step still runs.
  if (row !== undefined) {
    const product = await productStep(row);
    if (product === undefined) {
      return probe.result(client.requests);
    }
  }

  await probe.step(
    'shops',
    options.storesUrl ?? LIDL_STORES_URL,
    async () =>
      normalizeStorePage((await client.captureStorePage(STORE_PAGE)) as Json),
    (value) => {
      const unnamed = value.stores.filter((shop) => !hasText(shop.regionId));
      const problems =
        value.stores.length === 0 ? ['the store page named no shop'] : [];
      if (unnamed.length > 0) {
        problems.push(
          `${unnamed.length} of ${value.stores.length} shops named no offer region`
        );
      }
      return {
        problems,
        sample: {
          total: value.total,
          shops: value.stores.length,
          firstRegion: value.stores[0]?.regionId ?? null,
        },
      };
    }
  );
  return probe.result(client.requests);

  function productStep(row: LidlListRow) {
    return probe.step(
      'product',
      `${base}${row.path}`,
      () => client.getProduct(row),
      (value) => {
        if (value === null) {
          return {
            problems: [`product ${row.externalId} answered no payload`],
          };
        }
        const problems: string[] = [];
        if (!hasText(value.ean)) {
          problems.push('the product carried no ean');
        }
        if (value.prices.length === 0) {
          problems.push('the product carried no region price');
        }
        return {
          problems,
          sample: {
            id: value.externalId,
            ean: value.ean,
            prices: value.prices.length,
            firstPriceCents: cents(value.prices[0]?.price),
          },
        };
      }
    );
  }
}

/**
 * The row the product step reads (plan 0252, section 1): the first grocery
 * row with a path and a price, else the first grocery row with a path. A
 * week's window holds products with no price at all, and they are real
 * answers, not a change. A row {@link isGroceryCategory} refuses is never
 * read, because the walk never reads one.
 */
function groceryRow(page: LidlListPage): LidlListRow | undefined {
  const grocery = page.rows.filter(
    (row) => hasText(row.path) && isGroceryCategory(row.siteCategory)
  );
  return grocery.find((row) => row.listPrice !== null) ?? grocery[0];
}

/** False only when the total says the first page was the whole index. */
function hasNextPage(page: LidlListPage): boolean {
  return page.total === null || page.total > LISTING_PAGE;
}

function cents(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;
}
