import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';

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
   * Restrict the run to shops in these postal codes. Absent means every shop
   * the chain publishes (plan 0106, section 4).
   *
   * It filters the document after it is read, because the document is one
   * request whatever is asked of it. What it genuinely saves is the second
   * request kind: a run filtered to four codes resolves four warehouses instead
   * of 1,213.
   *
   * The match is on the shop's **own** postal code, exactly, and it is a filter
   * rather than a centre. A radius here would rebuild the ambiguity plan 0038
   * section 2.8 found in OpenStreetMap, where the twelve Mercadonas inside
   * 14013's bounding box sit in 14004, 14007, 14011 and 14014. **An empty array
   * and an absent field are the same thing**, which is every shop.
   */
  postalCodes?: string[];
  /**
   * The chain whose own store list is read, when the run names one. Absent for
   * an OpenStreetMap run, which finds many chains at once and several of them
   * will not exist as `Supermarket` rows until it finishes.
   */
  supermarketId?: string;
  /**
   * The chain's own identity, read by the orchestrator (plan 0103, section
   * 6.4).
   *
   * A chain reading its own store list stamps this on every place it reports,
   * so a shop it writes groups with the same chain a radius search found. The
   * runner used to ask catalog for it, which was the last read it made.
   */
  chain?: { externalBrandKey: string | null; brandName: string | null };
}

/**
 * One store discovery, whatever the source of the shops is.
 *
 * The interface exists because `STORE_DISCOVERY` has **more than one** case
 * (plan 0089, section 9; plan 0106) and the run picks between them on
 * `source.adapterKey`, exactly as `CATALOG_DISCOVERY` has since plan 0085. The
 * mode did not change: finding the shops of a chain is a store discovery
 * whether OpenStreetMap answers or the chain does. The dispatcher holds a table
 * rather than a conditional, so a further chain that names its own shops is an
 * entry in it.
 *
 * **No case creates anything in catalog.** The rule from plan 0038 section 6.1
 * holds for every one of them: a run writes `DiscoveredPlace` rows and import
 * is a second, explicit step by an admin. A source naming its own shops does
 * not change who decides that a shop of theirs becomes a shop of ours.
 */
export interface StoreDiscoveryRunner {
  run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void>;
}
