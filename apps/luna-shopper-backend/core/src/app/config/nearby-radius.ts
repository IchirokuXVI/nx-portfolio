/**
 * How far around a postal code its neighbours are looked for (plan 0062,
 * section 4).
 *
 * **Two kilometres, as configuration, from the first commit, and per country
 * even though only one country exists.** The value that makes sense in central
 * Madrid and the one that makes sense in rural Córdoba are unlikely to be the
 * same number, and a constant would have to be found and changed in a service
 * before anybody could find that out.
 *
 * Worth knowing before tuning it: two kilometres around a dense urban centroid
 * may pull in several codes and around a rural one may pull in none, leaving that
 * user with exactly the code they typed and a screen that looks broken to them
 * and correct to us. Once plan 0060's table is loaded the distribution is a
 * twenty line script over real data rather than a guess, and it may argue for
 * "the nearest N codes, capped by distance" instead of a pure radius — which is
 * `PROFILE_LIMITS.maxNearbyPerPostalCode` beside this, and a change to the
 * recompute's body and to nothing else.
 */
export const DEFAULT_NEARBY_RADIUS_METRES = 2000;

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
