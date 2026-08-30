import { normalizeGeocode, normalizeOverpassResponse } from './normalize';
import type {
  DiscoveredPlace,
  LatLon,
  OsmPlacesClientOptions,
} from './types';

/**
 * Nominatim for geocoding a postal code, Overpass for the query (plan 0038,
 * section 3.2).
 *
 * The posture here is different from Mercadona's, because the data is openly
 * licensed and the access is sanctioned. It still has rules, and they are
 * stricter about *how* than about *whether* (section 8.2):
 *
 * - **ODbL.** Discovered store data must carry "© OpenStreetMap contributors"
 *   wherever it is shown. {@link OSM_ATTRIBUTION} is that string, exported so
 *   the obligation travels with the data rather than living in a comment.
 * - **Nominatim**: at most one request per second, a genuine User-Agent with a
 *   contact, no bulk geocoding, results may be cached. This plan geocodes **one
 *   postal code per discovery run**, so it sits far inside the policy.
 * - **Overpass** is volunteer funded: one query per run, a bounded radius, and a
 *   configurable URL so a self hosted instance can be pointed at.
 *
 * Framework free, like the Mercadona library: no TypeORM, no Nest, no database.
 */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export class OsmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`OpenStreetMap answered ${status} for ${url}`);
    this.name = 'OsmHttpError';
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class OsmPlacesClient {
  private readonly nominatimUrl: string;
  private readonly overpassUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(private readonly options: OsmPlacesClientOptions) {
    this.nominatimUrl = (options.nominatimUrl ?? NOMINATIM_URL).replace(
      /\/+$/,
      ''
    );
    this.overpassUrl = options.overpassUrl ?? OVERPASS_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.retries = options.retries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
    // Nominatim's policy is one request per second. Defaulting to it means the
    // polite value is what a caller gets by not thinking about it.
    this.minIntervalMs = options.minIntervalMs ?? 1000;
  }

  /**
   * A postal code to the point at its centre. The bounding box Nominatim also
   * returns is **discarded** (section 2.8): for 14013 it spans most of Córdoba,
   * and the 12 Mercadonas inside it are in four other postcodes.
   */
  async geocodePostalCode(
    postalCode: string,
    country = 'es'
  ): Promise<LatLon | null> {
    const query = new URLSearchParams({
      postalcode: postalCode,
      country,
      format: 'jsonv2',
      limit: '1',
    });
    const url = `${this.nominatimUrl}/search?${query.toString()}`;
    const payload = await this.request(url, { headers: this.headers() });
    return normalizeGeocode(payload);
  }

  /**
   * Every `shop=supermarket` within `radiusMetres` of a point, in one query.
   *
   * `nwr` covers nodes, ways and relations, and `out center tags` is what makes a
   * way usable: it has no position of its own, only member nodes.
   *
   * **It does not filter by brand.** Filtering happens after, in the harvester,
   * because the run is chain agnostic by design: one query answers "what
   * supermarkets are near me" for every chain at once, which is what makes OSM
   * the right source rather than each chain's own store finder.
   */
  async findSupermarkets(
    centre: LatLon,
    radiusMetres: number
  ): Promise<DiscoveredPlace[]> {
    const query =
      `[out:json][timeout:60];` +
      `nwr["shop"="supermarket"](around:${radiusMetres},${centre.lat},${centre.lon});` +
      `out center tags;`;
    const payload = await this.request(this.overpassUrl, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ data: query }).toString(),
    });
    return normalizeOverpassResponse(payload);
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      'user-agent': this.options.userAgent,
    };
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      this.options.signal?.throwIfAborted();
      await this.gate();

      const response = await this.fetchImpl(url, {
        ...init,
        signal: this.options.signal,
      });
      if (response.ok) {
        return response.json();
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.retries) {
        throw new OsmHttpError(response.status, url);
      }
      const backoff = this.backoffBaseMs * 2 ** attempt;
      await this.sleep(backoff + Math.floor(Math.random() * backoff));
      attempt += 1;
    }
  }

  private async gate(): Promise<void> {
    if (this.options.acquire) {
      await this.options.acquire();
      return;
    }
    if (this.minIntervalMs <= 0) {
      return;
    }
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.lastRequestAt = Date.now();
  }
}
