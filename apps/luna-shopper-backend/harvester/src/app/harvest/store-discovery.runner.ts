import { Injectable } from '@nestjs/common';
import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import { LidlStoreDiscoveryRunner } from './lidl-store-discovery.runner';
import { MercadonaStoreDiscoveryRunner } from './mercadona-store-discovery.runner';
import { OsmStoreDiscoveryRunner } from './osm-store-discovery.runner';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryRunner as StoreDiscoveryCase,
  StoreDiscoveryInput,
} from './store-discovery-runner';

export type { StoreDiscoveryInput } from './store-discovery-runner';

/**
 * `STORE_DISCOVERY`, dispatched to the source the chain's row names (plan 0089,
 * section 9).
 *
 * **The mode did not gain a sibling; the source did**, twice. LIDL names all 730
 * of its own shops with the price region on every one of them, which is a field
 * OpenStreetMap does not have and cannot be derived from a postal code (plan
 * 0089). Mercadona names all 1,675 of its own, with a postal code and
 * coordinates on every one and no gaps at all (plan 0106).
 *
 * This file used to say that Mercadona published no store list. That was never
 * checked against Mercadona: plan 0038 section 2.8 measured **OpenStreetMap's**
 * data, found its postcodes missing two thirds of the time, and concluded that a
 * radius was the only way to find shops. The conclusion stays true of
 * OpenStreetMap and was never true of the chain.
 *
 * **A run with no chain takes the OpenStreetMap case**, and that is every run
 * the postal code discovery queue starts: it is about a place rather than about
 * a chain, and it finds many chains at once.
 */
@Injectable()
export class StoreDiscoveryRunner {
  /** The chains that name their own shops, by the adapter key that reads them. */
  private readonly cases: Partial<Record<AdapterKey, StoreDiscoveryCase>>;

  constructor(
    private readonly osm: OsmStoreDiscoveryRunner,
    lidl: LidlStoreDiscoveryRunner,
    mercadona: MercadonaStoreDiscoveryRunner
  ) {
    this.cases = { 'lidl-api': lidl, 'mercadona-api': mercadona };
  }

  // `async` so a refusal is a rejected promise rather than a synchronous throw
  // out of a method whose signature promises one.
  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    await this.runnerFor(source?.adapterKey).run(
      context,
      report,
      input,
      source
    );
  }

  /**
   * The case this run takes.
   *
   * A lookup rather than a conditional, so a third chain that names its own
   * shops is a table entry. Everything that is not in the table is
   * OpenStreetMap, which is the honest default rather than a refusal:
   * `deza-web` and `carrefour-web` publish an assortment and no store list, and
   * a run with no source at all is the queue's.
   */
  private runnerFor(adapterKey: AdapterKey | undefined): StoreDiscoveryCase {
    return (adapterKey ? this.cases[adapterKey] : undefined) ?? this.osm;
  }
}
