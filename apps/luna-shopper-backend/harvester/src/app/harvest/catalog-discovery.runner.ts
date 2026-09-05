import { Injectable } from '@nestjs/common';
import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { DezaCatalogRunner } from './deza-catalog.runner';
import { MercadonaCatalogRunner } from './mercadona-catalog.runner';
import type { RunContext } from './run-context';

export type { CatalogDiscoveryInput } from './catalog-runner';

/**
 * `CATALOG_DISCOVERY`, dispatched to the adapter the chain's source row names
 * (plan 0085, section 9).
 *
 * **The mode did not gain a sibling; the adapter did.** A walk of a chain's
 * whole assortment is a catalog discovery whether the chain answers JSON, as
 * Mercadona does, or renders a page, as DEZA does. What differs is the client,
 * the way the assortment is enumerated, and what the source is able to say about
 * a product, and `SupermarketSource.adapterKey` has been the field that says
 * which since plan 0038. It simply had one possible value until now.
 *
 * This class held the Mercadona implementation before that second value
 * appeared. It kept the name so `run-executor.service.ts` still branches on the
 * mode alone, and the choice of adapter lives in exactly one place.
 */
@Injectable()
export class CatalogDiscoveryRunner {
  constructor(
    private readonly mercadona: MercadonaCatalogRunner,
    private readonly deza: DezaCatalogRunner
  ) {}

  // `async` so a refusal is a rejected promise rather than a synchronous throw
  // out of a method whose signature promises one. The executor's own try/catch
  // handles both, but nothing else that calls a runner should have to.
  async run(
    context: RunContext,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    await this.runnerFor(source.adapterKey).run(context, input, source);
  }

  /**
   * The adapter, or a refusal naming the row that has to change.
   *
   * `osm-places` and `manual` are deliberately absent: the first belongs to a
   * store discovery run and the second means a person types the prices, so
   * neither has an assortment to walk. Reaching here with one of them is a
   * misconfigured source rather than a missing feature, and the message says so.
   */
  private runnerFor(adapterKey: AdapterKey): CatalogRunner {
    switch (adapterKey) {
      case 'mercadona-api':
        return this.mercadona;
      case 'deza-web':
        return this.deza;
      default:
        throw new Error(
          `The adapter "${adapterKey}" has no catalog discovery. Set this ` +
            "chain's source to one that does with supermarketSource.upsert."
        );
    }
  }
}
