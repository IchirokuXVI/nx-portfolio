import {
  SourceProbeRecorder,
  belowFloor,
  hasText,
  isFiniteNumber,
  isPositive,
  mostRowsCarry,
  pacedAcquire,
  parserErrorsAsProblems,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ELJAMON_BASE_URL,
  ELJAMON_LOCATOR_URL,
  ElJamonClient,
} from './eljamon.client';
import { parseListingPage } from './listing';

/** Eleven top level categories on the home page captured for the fixtures. */
const CATEGORY_FLOOR = 5;

/** What {@link probeElJamon} takes: the seams its client takes. */
export interface ElJamonProbeOptions {
  userAgent: string;
  /** From the source row's `config.baseUrl`, as a run reads it. */
  baseUrl?: string;
  locatorUrl?: string;
  /** The postal code the session is set to, from `config.postalCode`. */
  postalCode?: string;
  /** The run's token bucket at the row's rate. */
  acquire?: () => Promise<void>;
  /** The least time between two requests. Default 1000 ms. */
  minIntervalMs?: number;
  /** The library's own TLS transport by default, as the client's. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** The clock a step's duration is read from. */
  now?: () => number;
}

/**
 * Four steps against El Jamón (plan 0219, section 3.2): the top level
 * categories, which start the session first, page 1 of the first category,
 * the product that page names first, and the store locator.
 *
 * Page 1 is read by its path and parsed by the walk's own parser, which is
 * the first request `walkCategory` makes. Going through the generator would
 * page on when page 1 is empty, and a probe reads one page.
 *
 * Never throws for a source failure. `retries` is 0, so a 403 or a 429 throws
 * at once and the probe makes no request after it.
 */
export async function probeElJamon(
  options: ElJamonProbeOptions
): Promise<SourceProbeResult> {
  const client = new ElJamonClient({
    userAgent: options.userAgent,
    baseUrl: options.baseUrl,
    locatorUrl: options.locatorUrl,
    postalCode: options.postalCode,
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
  const base = (options.baseUrl ?? ELJAMON_BASE_URL).replace(/\/+$/, '');
  const probe = new SourceProbeRecorder(options.now);

  const categories = await probe.step(
    'categories',
    `${base}/`,
    () => client.topCategories(),
    (value) => {
      const whole = value.filter(
        (category) =>
          hasText(category.code) &&
          hasText(category.slug) &&
          hasText(category.path)
      ).length;
      return {
        problems: belowFloor(
          whole,
          CATEGORY_FLOOR,
          'categories with a code, a slug and a path'
        ),
        sample: {
          categories: value.length,
          first: value[0]?.path ?? null,
        },
      };
    }
  );
  const category = categories?.[0];
  if (!category) {
    return probe.result(client.requests);
  }

  const page = await probe.step(
    'listing',
    `${base}${category.path}`,
    async () =>
      parseListingPage(await client.fetchDocument({ path: category.path })),
    (value) => ({
      problems: mostRowsCarry(value.rows, {
        code: (row) => hasText(row.code),
        description: (row) => hasText(row.description),
        url: (row) => hasText(row.url),
        'a price above zero': (row) => isPositive(row.price),
      }),
      sample: {
        category: category.path,
        articleCount: value.articleCount,
        rows: value.rows.length,
        firstName: value.rows[0]?.description ?? null,
        firstPriceCents: cents(value.rows[0]?.price),
      },
    })
  );
  const row = page?.rows.find((each) => hasText(each.url));
  if (!row) {
    return probe.result(client.requests);
  }

  const product = await probe.step(
    'product',
    row.url,
    () => client.getProduct(row.url),
    (value) => {
      if (value === null) {
        return { problems: [`product ${row.code} answered no product`] };
      }
      const problems: string[] = [];
      if (!hasText(value.code)) {
        problems.push('the product carried no code');
      }
      if (!hasText(value.name)) {
        problems.push('the product carried no name');
      }
      if (!isPositive(value.price)) {
        problems.push('the product carried no price above zero');
      }
      if (value.categoryPath.length === 0) {
        problems.push('the product carried no categoryPath');
      }
      return {
        problems,
        sample: {
          code: value.code,
          name: value.name,
          priceCents: cents(value.price),
          categoryPath: value.categoryPath.join(' > '),
        },
      };
    }
  );
  if (product === undefined) {
    return probe.result(client.requests);
  }

  await probe.step(
    'shops',
    options.locatorUrl ?? ELJAMON_LOCATOR_URL,
    parserErrorsAsProblems(() => client.listStores(), isElJamonShapeError),
    (list) => {
      const whole = list.stores.filter(
        (shop) =>
          hasText(shop.externalRef) &&
          hasText(shop.postalCode) &&
          isFiniteNumber(shop.latitude)
      ).length;
      return {
        problems: belowFloor(
          whole,
          1,
          'shops with an externalRef, a postalCode and a latitude'
        ),
        sample: {
          recordsRead: list.recordsRead,
          shops: list.stores.length,
          firstShop: list.stores[0]?.externalRef ?? null,
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

/**
 * The plain error the store locator's parser throws when the page holds no
 * `locations` object. It is the storefront changing, so the probe records it
 * as a problem (plan 0219, section 5).
 */
function isElJamonShapeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !('status' in error) &&
    error.message ===
      'The El Jamón store locator answered without a locations object.'
  );
}
