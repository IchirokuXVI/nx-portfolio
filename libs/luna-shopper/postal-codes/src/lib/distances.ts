/**
 * How far a point may be from a postal code centroid before we decline to guess
 * which code it is in (plan 0061, section 4).
 *
 * It lives here, in the framework free library, because **two services read it
 * and they must not disagree**. Catalog derives a `SupermarketLocation`'s
 * postcode with it, and since plan 0097 the harvester derives a discovered
 * place's postcode with the same rule, so a shop and the place it was imported
 * from would otherwise be able to land in different codes depending on which
 * bound each service happened to be configured with.
 *
 * Configuration rather than a constant, which is plan 0060 section 6's rule: a
 * centroid is one point standing in for an area, and the area is a few hundred
 * metres in central Madrid and tens of kilometres in rural Córdoba. Five
 * kilometres is a starting value, not a measurement, and it errs toward
 * declining: a place whose nearest centroid is further than this keeps a null
 * postcode, which reads downstream as an approximate price that says so.
 */
export const DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES = 5_000;

/** The configured bound, or the default. Zero and nonsense both fall back. */
export function postalCodeDeriveMaxMetres(
  raw: string | undefined = process.env['POSTAL_CODE_DERIVE_MAX_METRES']
): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES;
}

/**
 * How far around a postal code its neighbours are looked for (plan 0062,
 * section 4).
 *
 * **Two kilometres, as configuration, from the first commit, and per country
 * even though only one country exists.** The value that makes sense in central
 * Madrid and the one that makes sense in rural Córdoba are unlikely to be the
 * same number, and a constant would have to be found and changed in a service
 * before anybody could find that out. Core reads it per country through its own
 * `NearbyRadiusConfig`; this is the fallback both that and the back office's
 * neighbours route start from (plan 0097, section 4).
 *
 * Worth knowing before tuning it: two kilometres around a dense urban centroid
 * may pull in several codes and around a rural one may pull in none, leaving
 * that user with exactly the code they typed and a screen that looks broken to
 * them and correct to us.
 *
 * It is **not** the discovery radius. That one decides how far around a code's
 * centre to look for shops and is comfortably larger, because a shop at the edge
 * of a code is still that code's shop; this one decides which postal codes a
 * person shops in. Giving the two one key is plan 0063 section 7's mistake to
 * avoid.
 */
export const DEFAULT_NEARBY_RADIUS_METRES = 2000;
