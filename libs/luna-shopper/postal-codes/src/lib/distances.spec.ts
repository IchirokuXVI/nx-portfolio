import {
  DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES,
  postalCodeDeriveMaxMetres,
} from './distances';

/**
 * The signature is the part with a trap in it.
 *
 * This entry point is reachable from the browser: `@portfolio/velista/models`
 * re-exports the GeoNames attribution from it, so the Angular builds compile
 * this file with no node types and a `process.env` read here fails them with
 * TS2591. That is why `raw` is a required parameter the caller fills from its
 * own environment, and why this file must never read the environment itself.
 * The tests pin the parsing rule the two services share.
 */
describe('postalCodeDeriveMaxMetres', () => {
  it('takes the configured value', () => {
    expect(postalCodeDeriveMaxMetres('1200')).toBe(1200);
  });

  it('falls back to the default when nothing is configured', () => {
    expect(postalCodeDeriveMaxMetres(undefined)).toBe(
      DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES
    );
  });

  it('falls back on zero and on nonsense', () => {
    expect(postalCodeDeriveMaxMetres('0')).toBe(
      DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES
    );
    expect(postalCodeDeriveMaxMetres('-1')).toBe(
      DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES
    );
    expect(postalCodeDeriveMaxMetres('near enough')).toBe(
      DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES
    );
  });
});
