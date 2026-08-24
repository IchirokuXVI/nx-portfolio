import {
  DEFAULT_LOCALE,
  localeFromAcceptLanguage,
  resolveLocale,
  toSupportedLocale,
} from './locale';

describe('locale resolution', () => {
  it('narrows to the primary language subtag', () => {
    expect(toSupportedLocale('es-419')).toBe('es');
    expect(toSupportedLocale('EN_US')).toBe('en');
  });

  it('rejects unsupported languages', () => {
    expect(toSupportedLocale('fr')).toBeUndefined();
    expect(toSupportedLocale('')).toBeUndefined();
    expect(toSupportedLocale(null)).toBeUndefined();
  });

  it('honours Accept-Language quality ordering', () => {
    expect(localeFromAcceptLanguage('es;q=0.9, en;q=0.8')).toBe('es');
    expect(localeFromAcceptLanguage('fr, en;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage('fr, de')).toBeUndefined();
  });

  it('prefers explicit over header over stored, else defaults to English', () => {
    expect(
      resolveLocale({
        explicit: 'es',
        acceptLanguage: 'en',
        storedPreference: 'en',
      })
    ).toBe('es');
    expect(
      resolveLocale({
        explicit: 'fr',
        acceptLanguage: 'es',
        storedPreference: 'en',
      })
    ).toBe('es');
    expect(resolveLocale({ storedPreference: 'es' })).toBe('es');
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
  });
});
