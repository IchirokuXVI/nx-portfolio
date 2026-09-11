import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';

/** One row a backfill reads a page for, as the run that found it described it. */
export interface BackfillEntry {
  externalId: string;
  /** The product page to read. A row with none is not a backfill candidate. */
  url: string;
  name: string;
  brand: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  categoryPath: string[];
}

/**
 * One group of shops a walk covers, with the key the source knows it by (plan
 * 0108, section 1).
 *
 * **The key is the warehouse.** A Mercadona walk fetches the warehouse named
 * here and stamps its prices with the same string, so the two cannot disagree.
 * They used to be separate inputs, `source.config.warehouse` and a scope chosen
 * at the spawn, and nothing compared them: a run configured for `4661` and
 * started with the scope keyed `4804` walked Córdoba and wrote those prices onto
 * A Coruña's scope with no error anywhere.
 *
 * It carries the id as well because the id is what an operator chose and what
 * the run's payload records, and a message that names the scope reads better
 * with it. Nothing in a runner resolves it: a runner reports the key, and the
 * orchestrator turns keys into rows (plan 0103, section 3).
 */
export interface RunPriceScope {
  id: string;
  /** `PriceScope.externalKey`, which for this chain is the warehouse code. */
  externalKey: string;
}

/** What a `CATALOG_DISCOVERY` is asked to walk. */
export interface CatalogDiscoveryInput {
  supermarketId: string;
  priceScopeId?: string;
  /**
   * The scopes this walk covers, one warehouse each (plan 0108, section 2).
   *
   * A list and not one id, because the cost of a walk is dominated by the
   * product detail phase and that phase is shared across warehouses: the detail
   * call answers `ean` and `brand`, and neither depends on the warehouse, so six
   * warehouses cost about 5,300 requests together against 26,298 apart.
   *
   * **Resolved by the executor, not by the runner** (plan 0103, section 6.4).
   * The spawn checks the ids against the adapter's band and records them on the
   * run; the executor reads the rows and hands over the keys, because a runner
   * fetches and reports and holds no `CatalogClient` to look one up with.
   */
  priceScopes?: readonly RunPriceScope[];
  /**
   * Read product pages for the EAN instead of crawling the assortment (plan
   * 0090, section 12.1). Allowed only for an adapter that has a product page,
   * and refused at the spawn for every other one.
   */
  detailBackfill?: boolean;
  /**
   * The rows a backfill run reads pages for, prepared by the orchestrator (plan
   * 0103, section 6.2).
   *
   * The runner used to load these itself, holding a repository to do it. It
   * fetches a page per entry and reports products exactly as a walk does, so
   * nothing about the write side of a backfill is special any more.
   *
   * **The row's own fields travel with it**, because the page a backfill reads
   * answers the EAN and nothing else. A product is reported whole, and rung 1
   * rewrites the source group from what it is told, so a backfill that reported
   * only an id and an EAN would blank the name the crawl wrote.
   */
  backfill?: readonly BackfillEntry[];
}

/**
 * One chain's catalog discovery, whatever its source looks like.
 *
 * The interface exists because `CATALOG_DISCOVERY` has **two** adapters under it
 * (plan 0085, section 9) and the run picks between them on `source.adapterKey`,
 * which is the field that has been on `SupermarketSource` since plan 0038 and
 * had one possible value until now. The mode did not change: a walk of a chain's
 * whole assortment is a catalog discovery whether the chain answers JSON or
 * renders a page.
 */
export interface CatalogRunner {
  run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void>;
}
