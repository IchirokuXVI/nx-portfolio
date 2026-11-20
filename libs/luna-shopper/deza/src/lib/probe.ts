import {
  SourceProbeRecorder,
  belowFloor,
  countingFetch,
  hasText,
  mostRowsCarry,
  pacedAcquire,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import { DEZA_BASE_URL, DEZA_PRODUCTS_PATH, DezaClient } from './deza.client';
import { leafSections } from './sections';

/**
 * Leaf sections a walk enumerates. The section tree of the landing page
 * captured on 2026-09-05 holds several dozen.
 */
const SECTION_FLOOR = 5;

/** What {@link probeDeza} takes: the seams its client takes. */
export interface DezaProbeOptions {
  userAgent: string;
  /** From the source row's `config.baseUrl`, as a run reads it. */
  baseUrl?: string;
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
 * Two steps against DEZA (plan 0219, section 3.2): the section tree, and the
 * first page of the first leaf section.
 *
 * **No product step and no price.** A DEZA row has no product page and no URL,
 * and the site prints no price (plan 0085): the blank price elements in its
 * markup are the storefront's hidden prices, and nothing here reads them. The
 * shops come from the rows, so the listing step checks those instead.
 *
 * Never throws for a source failure. `retries` is 0, so a 403 or a 429 throws
 * at once and the probe makes no request after it.
 */
export async function probeDeza(
  options: DezaProbeOptions
): Promise<SourceProbeResult> {
  const counter = countingFetch(options.fetchImpl ?? fetch);
  const client = new DezaClient({
    userAgent: options.userAgent,
    baseUrl: options.baseUrl,
    acquire: pacedAcquire({
      acquire: options.acquire,
      minIntervalMs: options.minIntervalMs ?? 1000,
      sleep: options.sleepImpl,
      now: options.now,
    }),
    fetchImpl: counter.fetchImpl,
    sleepImpl: options.sleepImpl,
    signal: options.signal,
    retries: 0,
  });
  const url = `${(options.baseUrl ?? DEZA_BASE_URL).replace(/\/+$/, '')}${DEZA_PRODUCTS_PATH}`;
  const probe = new SourceProbeRecorder(options.now);

  const leaves = await probe.step(
    'categories',
    url,
    async () => leafSections(await client.fetchSectionTree()),
    (value) => ({
      problems: belowFloor(value.length, SECTION_FLOOR, 'leaf sections'),
      sample: {
        sections: value.length,
        first: value[0]?.code ?? null,
        firstName: value[0]?.name ?? null,
      },
    })
  );
  const section = leaves?.[0];
  if (!section) {
    return probe.result(counter.count());
  }

  await probe.step(
    'listing',
    url,
    () => client.openQuery({ section: section.code }),
    (page) => ({
      problems: mostRowsCarry(page.rows, {
        name: (row) => hasText(row.name),
        'a shop code': (row) => row.shops.some((shop) => hasText(shop.code)),
      }),
      sample: {
        section: section.code,
        rows: page.rows.length,
        lastPage: page.lastPage,
        firstName: page.rows[0]?.name ?? null,
        firstShops: page.rows[0]?.shops.length ?? null,
      },
    })
  );
  return probe.result(counter.count());
}
