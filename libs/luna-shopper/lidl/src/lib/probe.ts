import {
  SourceProbeRecorder,
  hasText,
  isPositive,
  mostRowsCarry,
  pacedAcquire,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import type { Json } from './json';
import { LidlClient } from './lidl.client';
import { normalizeListPage, normalizeStorePage } from './normalize';
import { LIDL_BASE_URL, LIDL_STORES_URL } from './types';

/** The shops the store step reads: one page of five, as the live spec read. */
const STORE_PAGE = 5;

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
 * Three steps against LIDL (plan 0219, section 3.2): the in store index at
 * offset 0, the page of the first priced row, and one store page of five.
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

  const page = await probe.step(
    'listing',
    client.searchUrl(0),
    async () => normalizeListPage((await client.captureSearchPage(0)) as Json),
    (value) => {
      const problems = isPositive(value.total)
        ? []
        : ['the index stated no total above zero'];
      problems.push(
        ...mostRowsCarry(value.rows, {
          externalId: (row) => hasText(row.externalId),
          path: (row) => hasText(row.path),
        })
      );
      return {
        problems,
        sample: {
          total: value.total,
          rows: value.rows.length,
          firstName: value.rows[0]?.name ?? null,
        },
      };
    }
  );
  // A priced row, because a week's window holds products with no price at all
  // and they are real answers, not a change.
  const row =
    page?.rows.find((each) => hasText(each.path) && each.listPrice !== null) ??
    page?.rows.find((each) => hasText(each.path));
  if (!row) {
    return probe.result(client.requests);
  }

  const product = await probe.step(
    'product',
    `${base}${row.path}`,
    () => client.getProduct(row),
    (value) => {
      if (value === null) {
        return { problems: [`product ${row.externalId} answered no payload`] };
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
  if (product === undefined) {
    return probe.result(client.requests);
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
}

function cents(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;
}
