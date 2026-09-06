import { Injectable } from '@nestjs/common';
import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import { CarrefourCatalogRunner } from './carrefour-catalog.runner';
import { CarrefourDetailRunner } from './carrefour-detail.runner';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { DezaCatalogRunner } from './deza-catalog.runner';
import { LidlCatalogRunner } from './lidl-catalog.runner';
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
    private readonly deza: DezaCatalogRunner,
    private readonly carrefour: CarrefourCatalogRunner,
    private readonly carrefourDetail: CarrefourDetailRunner,
    private readonly lidl: LidlCatalogRunner
  ) {}

  // `async` so a refusal is a rejected promise rather than a synchronous throw
  // out of a method whose signature promises one. The executor's own try/catch
  // handles both, but nothing else that calls a runner should have to.
  async run(
    context: RunContext,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    await this.runnerFor(source.adapterKey, input).run(context, input, source);
  }

  /**
   * The adapter, or a refusal naming the row that has to change.
   *
   * A backfill dispatches here too, because it is a `carrefour-web` run
   * against the same chain asking a second question of the same pages, and a
   * mode of its own would say it was a different kind of act.
   *
   * `osm-places` and `manual` are deliberately absent: the first belongs to a
   * store discovery run and the second means a person types the prices, so
   * neither has an assortment to walk. Reaching here with one of them is a
   * misconfigured source rather than a missing feature, and the message says so.
   */
  private runnerFor(
    adapterKey: AdapterKey,
    input: CatalogDiscoveryInput
  ): CatalogRunner {
    switch (adapterKey) {
      case 'mercadona-api':
        return this.mercadona;
      case 'deza-web':
        return this.deza;
      case 'carrefour-web':
        // The one adapter with two passes over the same pages (plan 0090,
        // section 12.1). The switch is on the run and not on the row, because
        // an hour long price crawl and a backfill of the order of a day are
        // two things an operator starts on purpose, never one that implies the
        // other.
        return input.detailBackfill ? this.carrefourDetail : this.carrefour;
      case 'lidl-api':
        // The one adapter that resolves its own price scopes, from the region
        // map every product carries (plan 0089, section 4). The spawn refuses
        // a run that names one, rather than writing 59 regions into it.
        return this.lidl;
      default:
        throw new Error(
          `The adapter "${adapterKey}" has no catalog discovery. Set this ` +
            "chain's source to one that does with supermarketSource.upsert."
        );
    }
  }
}
