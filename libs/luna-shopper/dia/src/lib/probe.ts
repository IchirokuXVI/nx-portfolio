import {
  SourceProbeRecorder,
  belowFloor,
  hasText,
  isFiniteNumber,
  isPositive,
  mostRowsCarry,
  parserErrorsAsProblems,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import { DIA_BASE_URL, DiaClient } from './dia.client';

/** 29 roots and well over 100 leaves in the menu captured on 2026-10-02. */
const LEAF_FLOOR = 20;
/** 3,238 records in the shop file of the same day, DIA and Clarel. */
const SHOP_FLOOR = 100;

/** What {@link probeDia} takes: the seams its client takes. */
export interface DiaProbeOptions {
  /** From the source row's `config.baseUrl`, as a run reads it. */
  baseUrl?: string;
  /** The run's token bucket at the row's rate. */
  acquire?: () => Promise<void>;
  /** The least time between two requests, held beside `acquire`. Default 1000 ms. */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** The clock a step's duration and the client's interval are read from. */
  now?: () => number;
}

/**
 * Three steps against DIA (plan 0219, section 3.2): the category menu, page 1
 * of the first leaf, and the shop file with the detail of its first shop.
 *
 * **No product step.** A DIA walk reads no product page: the listing carries
 * the price.
 *
 * Never throws for a source failure, and retries nothing: `retries` is 0 and
 * `retryForbidden` is false (section 3.6), so a 403 fails at once and the
 * probe does not wait 60 seconds to send it again.
 */
export async function probeDia(
  options: DiaProbeOptions = {}
): Promise<SourceProbeResult> {
  const client = new DiaClient({
    baseUrl: options.baseUrl,
    acquire: options.acquire,
    minIntervalMs: options.minIntervalMs ?? 1000,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    nowImpl: options.now,
    signal: options.signal,
    retries: 0,
    retryForbidden: false,
  });
  const base = (options.baseUrl ?? DIA_BASE_URL).replace(/\/+$/, '');
  const probe = new SourceProbeRecorder(options.now);

  const menu = await probe.step(
    'categories',
    `${base}/api/v1/common-aggregator/menu-data`,
    () => client.menu(),
    (value) => {
      const whole = value.leaves.filter(
        (leaf) => hasText(leaf.id) && hasText(leaf.name) && hasText(leaf.path)
      ).length;
      const problems = belowFloor(value.leaves.length, LEAF_FLOOR, 'leaves');
      if (whole < value.leaves.length) {
        problems.push(
          `${value.leaves.length - whole} of ${value.leaves.length} leaves carried no id, name or path`
        );
      }
      return {
        problems,
        sample: {
          roots: value.roots.length,
          leaves: value.leaves.length,
          firstLeaf: value.leaves[0]?.path ?? null,
        },
      };
    }
  );
  const leaf = menu?.leaves[0];
  if (!leaf) {
    return probe.result(client.requests);
  }

  const listing = await probe.step(
    'listing',
    `${base}/api/v1/plp-back/reduced${leaf.path}`,
    () => client.listing(leaf.path),
    (page) => ({
      problems: mostRowsCarry(page.rows, {
        skuId: (row) => hasText(row.skuId),
        displayName: (row) => hasText(row.displayName),
        'prices.price above zero': (row) => isPositive(row.prices?.price),
      }),
      sample: {
        leaf: leaf.path,
        rows: page.rows.length,
        totalPages: page.totalPages,
        firstName: page.rows[0]?.displayName ?? null,
        firstPriceCents: cents(page.rows[0]?.prices?.price),
      },
    })
  );
  if (listing === undefined) {
    return probe.result(client.requests);
  }

  await probe.step(
    'shops',
    `${base}/tiendas/buscador-tiendas-folletos`,
    parserErrorsAsProblems(async () => {
      const file = await client.storeFile();
      const first = file.stores[0];
      const detail = first ? await client.storeDetail(first.idTienda) : null;
      return { file, detail };
    }, isDiaShapeError),
    ({ file, detail }) => {
      const whole = file.stores.filter(
        (store) =>
          hasText(store.idTienda) &&
          isFiniteNumber(store.latitude) &&
          isFiniteNumber(store.longitude)
      ).length;
      const problems = belowFloor(
        whole,
        SHOP_FLOOR,
        'shops with an idTienda and a position'
      );
      if (!detail) {
        problems.push('the first shop answered no detail');
      } else {
        if (!hasText(detail.storeCode)) {
          problems.push('the shop detail carried no storeCode');
        }
        if (!hasText(detail.postalCode)) {
          problems.push('the shop detail carried no postalCode');
        }
      }
      return {
        problems,
        sample: {
          shops: file.stores.length,
          firstShop: file.stores[0]?.idTienda ?? null,
          storeCode: detail?.storeCode ?? null,
          postalCode: detail?.postalCode ?? null,
        },
      };
    }
  );
  return probe.result(client.requests);
}

/**
 * The two plain errors DIA's shop reads throw when the chain answered in a
 * shape they do not read: a store finder page that names no shop file, and a
 * shop file that is not a list. Each one is the storefront changing, so the
 * probe records it as a problem (plan 0219, section 5).
 */
function isDiaShapeError(error: unknown): boolean {
  if (!(error instanceof Error) || 'status' in error) {
    return false;
  }
  return (
    error.message === 'The DIA store finder page names no shop file.' ||
    error.message === 'The DIA shop file is not a list of records.'
  );
}

function cents(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;
}
