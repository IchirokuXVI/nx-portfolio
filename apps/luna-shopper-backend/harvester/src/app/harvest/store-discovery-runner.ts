import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';

/** What a `STORE_DISCOVERY` is asked to find. */
export interface StoreDiscoveryInput {
  /**
   * The centre of the search, for a source that has to be asked where shops
   * are. **A chain that publishes its own shop list takes neither this nor the
   * radius** (plan 0089, section 9): it names every shop in the country in
   * three requests, so there is nothing to centre on.
   */
  postalCode: string;
  country: string;
  radiusMetres: number;
  /**
   * The chain whose own store list is read, when the run names one. Absent for
   * an OpenStreetMap run, which finds many chains at once and several of them
   * will not exist as `Supermarket` rows until it finishes.
   */
  supermarketId?: string;
}

/**
 * One store discovery, whatever the source of the shops is.
 *
 * The interface exists because `STORE_DISCOVERY` has **two** cases (plan 0089,
 * section 9) and the run picks between them on `source.adapterKey`, exactly as
 * `CATALOG_DISCOVERY` has since plan 0085. The mode did not change: finding the
 * shops of a chain is a store discovery whether OpenStreetMap answers or the
 * chain does.
 *
 * **Neither case creates anything in catalog.** The rule from plan 0038 section
 * 6.1 holds for both: a run writes `DiscoveredPlace` rows and import is a
 * second, explicit step by an admin. A source naming its own shops does not
 * change who decides that a shop of theirs becomes a shop of ours.
 */
export interface StoreDiscoveryRunner {
  run(
    context: RunContext,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void>;
}
