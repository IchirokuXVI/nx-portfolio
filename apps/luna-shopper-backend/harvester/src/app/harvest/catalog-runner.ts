import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';

/** What a `CATALOG_DISCOVERY` is asked to walk. */
export interface CatalogDiscoveryInput {
  supermarketId: string;
  priceScopeId?: string;
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
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void>;
}
