import {
  DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES,
  postalCodeDeriveMaxMetres,
} from './distances';

/**
 * The environment read is the part with a trap in it.
 *
 * This entry point is reachable from the browser: `@portfolio/velista/models`
 * re-exports the GeoNames attribution from it, so the Angular builds compile
 * this file with no node types and a bare `process.env` fails them with TS2591.
 * The read goes through `globalThis` for that reason, and these tests say the
 * value still arrives in a service, so that nobody restores the shorter
 * expression and breaks two builds to do it.
 */
describe('postalCodeDeriveMaxMetres', () => {
  const KEY = 'POSTAL_CODE_DERIVE_MAX_METRES';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  it('reads the configured value out of the environment', () => {
    process.env[KEY] = '1200';

    expect(postalCodeDeriveMaxMetres()).toBe(1200);
  });

  it('falls back to the default when nothing is configured', () => {
    delete process.env[KEY];

    expect(postalCodeDeriveMaxMetres()).toBe(
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

  it('takes an explicit argument over the environment', () => {
    process.env[KEY] = '1200';

    expect(postalCodeDeriveMaxMetres('3400')).toBe(3400);
  });
});
