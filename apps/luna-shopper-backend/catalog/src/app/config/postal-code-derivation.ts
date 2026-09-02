/**
 * How far a location's coordinates may be from a postal code centroid before
 * catalog declines to guess (plan 0061, section 4).
 *
 * Its own module, small as it is, because two things that must agree read it
 * from two different worlds: {@link catalogValidationSchema} inside Nest, and
 * the backfill migration outside it. A migration importing `app-config` would
 * pull Joi and `@nestjs/config` into the bundled `migrate.js` for one number.
 *
 * Configuration rather than a constant, which is plan 0060 section 6's rule: a
 * centroid is one point standing in for an area, and the area is a few hundred
 * metres in central Madrid and tens of kilometres in rural Córdoba. Five
 * kilometres is a starting value, not a measurement, and it errs toward
 * declining: a store whose nearest centroid is further than this keeps a null
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
