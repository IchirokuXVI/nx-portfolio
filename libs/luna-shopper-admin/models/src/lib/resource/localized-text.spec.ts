import {
  CONTENT_LOCALES,
  emptyLocalizedText,
  localizedTextValue,
  missingLocales,
  toLocalizedText,
} from './localized-text';

describe('toLocalizedText', () => {
  it('keeps the string entries and drops everything else', () => {
    expect(toLocalizedText({ en: 'Milk', es: 'Leche', count: 3 })).toEqual({
      en: 'Milk',
      es: 'Leche',
    });
  });

  it('answers an empty object for anything that is not one', () => {
    expect(toLocalizedText(null)).toEqual({});
    expect(toLocalizedText('Milk')).toEqual({});
    expect(toLocalizedText(['Milk'])).toEqual({});
  });
});

describe('localizedTextValue', () => {
  it('takes the first preferred locale that has something in it', () => {
    expect(localizedTextValue({ en: 'Milk', es: 'Leche' }, ['es', 'en'])).toBe(
      'Leche'
    );
  });

  it('skips a locale that is present but blank', () => {
    expect(localizedTextValue({ en: 'Milk', es: '  ' }, ['es', 'en'])).toBe(
      'Milk'
    );
  });

  /**
   * A name in the wrong language reads better in a table than a blank cell
   * does, and an operator can act on it.
   */
  it('falls back to a locale nobody asked for rather than nothing', () => {
    expect(localizedTextValue({ fr: 'Lait' }, ['en', 'es'])).toBe('Lait');
  });

  it('answers the empty string when there is no string at all', () => {
    expect(localizedTextValue({ en: '' }, ['en'])).toBe('');
    expect(localizedTextValue(null, ['en'])).toBe('');
  });
});

describe('emptyLocalizedText', () => {
  it('is one empty string per locale, so every input renders', () => {
    expect(emptyLocalizedText(CONTENT_LOCALES)).toEqual({ en: '', es: '' });
  });
});

describe('missingLocales', () => {
  it('names the locales with nothing in them', () => {
    expect(missingLocales({ en: 'Milk', es: '' }, ['en', 'es'])).toEqual([
      'es',
    ]);
  });

  it('says nothing is missing when every locale is filled', () => {
    expect(missingLocales({ en: 'Milk', es: 'Leche' }, ['en', 'es'])).toEqual(
      []
    );
  });
});
