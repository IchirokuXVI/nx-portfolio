/**
 * OpenStreetMap place shapes (plan 0038, section 3.2).
 *
 * The library is named after the provider on purpose: OSM's data model
 * (elements, tags, ODbL) leaks into the result shape and pretending otherwise
 * would be dishonest. A second provider gets its own library and a shared result
 * type.
 */

/** A geographic point. The one thing every OSM element has (section 2.7). */
export interface LatLon {
  lat: number;
  lon: number;
}

export interface DiscoveredPlace {
  provider: 'OSM';
  /** `node/1156230891`. Type included, because ids are unique only per type. */
  externalRef: string;
  /**
   * `brand:wikidata`, the chain's identity. **Not the brand name**: in the 14013
   * area `Dia` and `Maxi Dia` share `Q925132` and `ALDI` and `Aldi` share
   * `Q41171373`, so name matching would split one chain into several. It cuts
   * the other way too, which is why the owner must be able to override it:
   * `Carrefour` and `Carrefour Express` carry different QIDs.
   */
  brandKey: string | null;
  brandName: string | null;
  name: string | null;
  latitude: number;
  longitude: number;
  /** `addr:street` joined with `addr:housenumber`. 35% of elements carry it. */
  street: string | null;
  city: string | null;
  /**
   * 33% coverage, which is why discovery is a radius and never a postcode
   * filter: two thirds of stores would vanish (section 2.7).
   */
  postalCode: string | null;
  website: string | null;
  openingHours: string | null;
  /** Kept whole and unreshaped, so provenance stays intact (section 8.2). */
  tags: Record<string, string>;
}

export interface OsmPlacesClientOptions {
  /**
   * A genuine User-Agent with a contact address. Nominatim's usage policy
   * **requires** one, and a request without it is refused rather than throttled.
   */
  userAgent: string;
  nominatimUrl?: string;
  /** Configurable so a self hosted instance can be pointed at without a code
   *  change if usage ever grows (section 8.2). */
  overpassUrl?: string;
  /** Awaited before every request; the harvester passes its per run bucket. */
  acquire?: () => Promise<void>;
  /**
   * Sequential fallback pacing. Nominatim's policy is at most one request per
   * second, so this defaults to 1000 rather than 0: the polite value is the one
   * you get by not thinking about it.
   */
  minIntervalMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  sleepImpl?: (ms: number) => Promise<void>;
}
