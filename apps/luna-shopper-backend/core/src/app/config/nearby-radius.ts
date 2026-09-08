/**
 * The per country widening radius (plan 0062, section 4).
 *
 * The default itself lives in `@portfolio/luna-shopper/postal-codes`, because
 * the back office's neighbours route needs the same number and the gateway
 * cannot import a constant out of this service (plan 0097, section 4). What
 * stays here is the per country parsing, which is core's alone.
 */
export { DEFAULT_NEARBY_RADIUS_METRES } from '@portfolio/luna-shopper/postal-codes';

/** The radius per country, and the fallback for one nobody listed. */
export interface NearbyRadiusConfig {
  defaultMetres: number;
  /** Lowercase alpha-2 to metres. Empty is the ordinary case today. */
  byCountry: Record<string, number>;
}

/**
 * `es=2000,bo=5000`, or empty.
 *
 * Malformed entries are **dropped rather than thrown on**, and the default takes
 * over for that country. A typo in an override is a value that reverts to two
 * kilometres, not a service that will not boot: the number widens a net a little,
 * and refusing to start over it would trade a small wrong radius for a total
 * outage.
 */
export function parseRadiusByCountry(
  raw: string | undefined
): Record<string, number> {
  const parsed: Record<string, number> = {};
  for (const entry of (raw ?? '').split(',')) {
    const [country, metres] = entry.split('=');
    const key = country?.trim().toLowerCase();
    const value = Number(metres?.trim());
    if (!key || !Number.isFinite(value) || value < 0) {
      continue;
    }
    parsed[key] = Math.round(value);
  }
  return parsed;
}

/** The radius this country expands by, falling back to the default. */
export function radiusFor(config: NearbyRadiusConfig, country: string): number {
  return config.byCountry[country.trim().toLowerCase()] ?? config.defaultMetres;
}
