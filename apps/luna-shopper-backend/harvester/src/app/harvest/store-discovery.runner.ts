import { Injectable } from '@nestjs/common';
import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import { LidlStoreDiscoveryRunner } from './lidl-store-discovery.runner';
import { OsmStoreDiscoveryRunner } from './osm-store-discovery.runner';
import type { RunContext } from './run-context';
import type {
  StoreDiscoveryRunner as StoreDiscoveryCase,
  StoreDiscoveryInput,
} from './store-discovery-runner';

export type { StoreDiscoveryInput } from './store-discovery-runner';

/**
 * `STORE_DISCOVERY`, dispatched to the source the chain's row names (plan 0089,
 * section 9).
 *
 * **The mode did not gain a sibling; the source did.** Mercadona publishes no
 * store list, so plan 0038 had to ask OpenStreetMap for one, and that was the
 * only case there was. LIDL names all 730 of its own shops, with the price
 * region on every one of them, which is a field OpenStreetMap does not have and
 * cannot be derived from a postal code.
 *
 * **A run with no chain takes the OpenStreetMap case**, and that is every run
 * the postal code discovery queue starts: it is about a place rather than about
 * a chain, and it finds many chains at once.
 */
@Injectable()
export class StoreDiscoveryRunner {
  constructor(
    private readonly osm: OsmStoreDiscoveryRunner,
    private readonly lidl: LidlStoreDiscoveryRunner
  ) {}

  // `async` so a refusal is a rejected promise rather than a synchronous throw
  // out of a method whose signature promises one.
  async run(
    context: RunContext,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    await this.runnerFor(source?.adapterKey).run(context, input, source);
  }

  /**
   * The case this run takes.
   *
   * Everything that is not a chain naming its own shops is OpenStreetMap, which
   * is the honest default rather than a refusal: `mercadona-api`, `deza-web`
   * and `carrefour-web` all publish an assortment and no store list, and a run
   * with no source at all is the queue's.
   */
  private runnerFor(adapterKey: AdapterKey | undefined): StoreDiscoveryCase {
    return adapterKey === 'lidl-api' ? this.lidl : this.osm;
  }
}
