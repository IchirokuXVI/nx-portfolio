import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { encodeCursor } from '@portfolio/luna-shopper/platform';
import {
  decodeCursorForLocale,
  displayName,
  displayNameSql,
  readingOrder,
} from './catalog.mappers';

/**
 * Neither language goes first (plan 0111, sections 4 and 5).
 *
 * The rule these three hold between them is that a name is read in the caller's
 * language and falls through to the rest, so a reader of Spanish sorts by
 * Spanish and still sees an English only row rather than a blank. Before this
 * plan the order was English, then Spanish, for everybody.
 *
 * The paging half of it is in `localized-name-paging.integration.spec.ts`,
 * because the claim there is about what Postgres does with a row comparison and
 * a mocked repository cannot check it. What is here is the rule itself.
 */
describe('readingOrder', () => {
  it('puts the caller´s language first and keeps the rest', () => {
    expect(readingOrder('es')).toEqual(['es', 'en']);
    expect(readingOrder('en')).toEqual(['en', 'es']);
  });

  it('names every content locale exactly once, whatever the caller reads', () => {
    // The coalesce and the fallback are both built from this, so a locale
    // dropped here is a name that silently reads blank, and one repeated is a
    // longer `coalesce` that quietly still works. Neither would fail a test
    // that only checked the first entry.
    for (const locale of ['en', 'es'] as const) {
      expect([...readingOrder(locale)].sort()).toEqual(['en', 'es']);
    }
  });
});

describe('displayName', () => {
  const both: LocalizedText = { en: 'Cheese', es: 'Queso' };

  it('answers the caller´s language when the row has it', () => {
    expect(displayName(both, 'es')).toBe('Queso');
    expect(displayName(both, 'en')).toBe('Cheese');
  });

  it('falls through to the other language rather than going blank', () => {
    // This is the half that keeps a row visible. A reader of Spanish meeting an
    // English only product sees the English name, which is what they would have
    // seen before this plan too, and the reverse now holds as well.
    expect(displayName({ en: 'Cheese' }, 'es')).toBe('Cheese');
    expect(displayName({ es: 'Queso' }, 'en')).toBe('Queso');
  });

  it('answers the empty string for a row with neither', () => {
    // Never null. The value is a keyset cursor's sort key, and a NULL member in
    // a row comparison yields NULL, which drops the row from every page after
    // the first with nothing to say so.
    expect(displayName({}, 'es')).toBe('');
    expect(displayName({}, 'en')).toBe('');
  });
});

describe('displayNameSql', () => {
  it('coalesces in the caller´s order', () => {
    expect(displayNameSql('i', 'es')).toBe(
      `coalesce(i.name ->> 'es', i.name ->> 'en', '')`
    );
    expect(displayNameSql('i', 'en')).toBe(
      `coalesce(i.name ->> 'en', i.name ->> 'es', '')`
    );
  });

  it('ends in the empty string so the key is never null', () => {
    for (const locale of ['en', 'es'] as const) {
      expect(displayNameSql('g', locale)).toContain(`, '')`);
    }
  });

  it('interpolates only locales from the narrowed union', () => {
    // The locale reaches a template string, so this is the audit that it can
    // only ever be one of two literals. `toSupportedLocale` is the only way
    // into the type and a locale that arrived unnarrowed would be injection.
    for (const locale of ['en', 'es'] as const) {
      expect(displayNameSql('s', locale)).toMatch(
        /^coalesce\((s\.name ->> '(en|es)', ){2}''\)$/
      );
    }
  });
});

describe('decodeCursorForLocale', () => {
  const cursor = (locale: string) =>
    encodeCursor({ order: 'name', locale, value: 'Queso', id: 'i-1' });

  it('returns the payload when the language matches', () => {
    expect(decodeCursorForLocale(cursor('es'), 'es')).toEqual({
      order: 'name',
      locale: 'es',
      value: 'Queso',
      id: 'i-1',
    });
  });

  it('discards a cursor cut under another language', () => {
    // The value in the token means something only under the locale that
    // produced it. Seeking with one language's predicate against the other
    // language's key repeats or skips rows and says nothing about it, so an
    // operator who switches language halfway down a list starts the list over
    // instead, which is visible and harmless.
    expect(decodeCursorForLocale(cursor('en'), 'es')).toBeUndefined();
    expect(decodeCursorForLocale(cursor('es'), 'en')).toBeUndefined();
  });

  it('discards a cursor from before the locale was recorded', () => {
    // A token already in a back office tab when this shipped carries no locale,
    // so it restarts the listing rather than seeking on an order nobody can
    // name. One page redrawn, once.
    const old = encodeCursor({ order: 'name', value: 'Queso', id: 'i-1' });
    expect(decodeCursorForLocale(old, 'en')).toBeUndefined();
  });

  it('treats a missing or malformed cursor as the first page', () => {
    expect(decodeCursorForLocale(undefined, 'en')).toBeUndefined();
    expect(
      decodeCursorForLocale('not base64url at all!!', 'en')
    ).toBeUndefined();
  });
});
