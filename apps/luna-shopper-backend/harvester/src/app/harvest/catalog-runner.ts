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

/** What a `CATALOG_DISCOVERY` is asked to walk. */
export interface CatalogDiscoveryInput {
  supermarketId: string;
  priceScopeId?: string;
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
