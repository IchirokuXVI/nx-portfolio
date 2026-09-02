import type { LocalizedName } from './shopping-profile';

/**
 * One shop in a profile's postal codes, as the screen that picks them sees it
 * (plan 0059; backend plan 0068 section 3.2).
 *
 * Rule D4 as everywhere: our type, mapped from `unknown`. Two things about its shape
 * are worth stating, because both are decisions rather than transcription.
 *
 * **It carries the chain, not only its id.** "Ronda de los Tejares" does not identify a
 * shop, so a row a screen can draw from one response has to name the brand beside the
 * location. The wire agrees and nests `supermarket` inside `ShopView`; this flattens the
 * pair, because nothing here ever holds a shop without the chain it belongs to.
 *
 * **The two names stay a pair.** `chainName` and `name` are {@link LocalizedName} rather
 * than a string chosen when the row was fetched, for the reason `Supermarket` gives: the
 * locale can change under a page that is already open.
 */
export interface Shop {
  /** The location id, which is what an exclusion names. */
  readonly id: string;
  readonly supermarketId: string;
  /** The chain, so a search result across franchises says which one it belongs to. */
  readonly chainName: LocalizedName;
  /** The shop's own name, which most shops of a chain do not have. */
  readonly name: LocalizedName | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  /**
   * The code was filled in from the nearest postal code centroid rather than observed
   * (backend plan 0061, section 5).
   *
   * Two thirds of OpenStreetMap's shops carry no postcode, so this is the common case
   * rather than the exception, and it is what makes the GeoNames attribution due beside
   * OpenStreetMap's.
   */
  readonly postalCodeDerived: boolean;
  /** Who discovered the shop. `OSM` for everything imported, null for a hand entry. */
  readonly provider: string | null;
  /** The profile refuses this shop. Only ever true on a read that asked for the refused. */
  readonly excluded: boolean;
  /** The profile refuses the whole chain, which covers shops it opens later. */
  readonly excludedChain: boolean;
}

/**
 * One chain with at least one shop in the profile's postal codes: a franchise button,
 * ready to draw (backend plan 0068, section 3.1).
 *
 * The three states of plan 0059 section 3.2 are derivable from one row, and they are
 * derived in one place, {@link chainState}, so no template works them out a second time.
 */
export interface ShopChainSummary {
  readonly supermarketId: string;
  readonly name: LocalizedName;
  /**
   * Null for an independent shop and for a chain nobody has keyed yet, which is what the
   * OTHER bucket is made of (backend plan 0068, section 4).
   *
   * The catalog holds no unbranded shop: `supermarketId` is not nullable there, so the
   * harvester gives "Frutería Paco" a chain of its own named after the shop. What
   * survives the import is the **key**, and its absence is the only thing that says
   * "not a franchise".
   */
  readonly externalBrandKey: string | null;
  /** Shops this chain has in those codes, refused or not. Never zero. */
  readonly locations: number;
  /** How many of those the profile has refused, one shop at a time. */
  readonly excluded: number;
  /** The profile refused the brand itself, which is the durable statement. */
  readonly excludedChain: boolean;
}

/**
 * What a franchise button says, and never a pair of booleans a template reassembles.
 *
 * `chain` and `some` are genuinely different promises (backend plan 0064, section 2.2):
 * the first covers shops that do not exist yet, the second covers exactly the ones
 * somebody switched off by hand and lets a new one arrive switched on. They must not
 * look the same, so they are not the same value.
 */
export type ChainState = 'none' | 'some' | 'chain';

export function chainState(summary: ShopChainSummary): ChainState {
  if (summary.excludedChain) {
    return 'chain';
  }

  return summary.excluded > 0 ? 'some' : 'none';
}

/**
 * What the profile is being told about one shop (backend plan 0064, section 5).
 *
 * `excluded: false` deletes the row rather than storing it, because absence already
 * means included: a shop imported next month is one you can see rather than one silently
 * missing. That is the server's rule, and this type only carries the statement.
 */
export interface LocationPreference {
  readonly supermarketLocationId: string;
  readonly excluded: boolean;
}
