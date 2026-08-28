import {
  DEFAULT_LOCALE,
  runWithRequestContext,
  SUPPORTED_LOCALES,
  validateUsername,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import type { UsernamePool } from './pool';
import {
  USERNAME_POOLS,
  UsernameGenerator,
} from './username-generator.service';

const allWords = (pool: UsernamePool): string[] => [
  ...pool.nouns.map((n) => n.word),
  ...pool.adjectives.flatMap((a) => [a.m, a.f].filter(Boolean) as string[]),
];

const everyName = (pool: UsernamePool): string[] =>
  pool.nouns.flatMap((noun) =>
    pool.adjectives.map((adjective) => pool.compose(noun, adjective))
  );

/**
 * These protect the load bearing invariant of plan 0018, section 3.1: a name is
 * drawn from one locale's pool only, and the pools share no word, so a name never
 * needs translating and can be stored and shown verbatim.
 */
describe('username pools', () => {
  it.each(SUPPORTED_LOCALES)('has a non-empty pool for %s', (locale) => {
    const pool = USERNAME_POOLS[locale];
    expect(pool).toBeDefined();
    expect(pool.nouns.length).toBeGreaterThan(0);
    expect(pool.adjectives.length).toBeGreaterThan(0);
  });

  it('the pools are pairwise disjoint on every word', () => {
    // A translated word slipping into the other pool is the one mistake that
    // breaks the invariant silently, so it is asserted rather than assumed.
    const locales = [...SUPPORTED_LOCALES];
    for (const a of locales) {
      for (const b of locales) {
        if (a === b) {
          continue;
        }
        const other = new Set(allWords(USERNAME_POOLS[b]));
        const shared = allWords(USERNAME_POOLS[a]).filter((w) => other.has(w));
        expect(shared).toEqual([]);
      }
    }
  });

  it('every Spanish noun declares a gender and every adjective has both forms', () => {
    for (const noun of USERNAME_POOLS.es.nouns) {
      expect(noun.gender).toMatch(/^[mf]$/);
    }
    for (const adjective of USERNAME_POOLS.es.adjectives) {
      expect(adjective.f).toBeTruthy();
    }
  });

  it('composes English adjective-first, with no agreement', () => {
    const pool = USERNAME_POOLS.en;
    expect(pool.compose({ word: 'Sail' }, { m: 'Swift' })).toBe('Swift Sail');
  });

  it('composes Spanish noun-first, agreeing with the noun gender', () => {
    const pool = USERNAME_POOLS.es;
    const rapido = { m: 'Rápido', f: 'Rápida' };
    expect(pool.compose({ word: 'Vela', gender: 'f' }, rapido)).toBe(
      'Vela Rápida'
    );
    expect(pool.compose({ word: 'Timón', gender: 'm' }, rapido)).toBe(
      'Timón Rápido'
    );
  });

  it.each(SUPPORTED_LOCALES)(
    'every name %s can produce passes validation',
    (locale) => {
      // Every combination, not a sample: a single unlucky pairing that the
      // validator rejects would be an identity that cannot be created.
      for (const name of everyName(USERNAME_POOLS[locale])) {
        expect(() => validateUsername(name)).not.toThrow();
      }
    }
  );
});

describe('UsernameGenerator', () => {
  const generator = new UsernameGenerator();

  const drawnFrom = (locale: SupportedLocale, name: string): boolean =>
    everyName(USERNAME_POOLS[locale]).includes(name);

  it.each(SUPPORTED_LOCALES)('draws only from the %s pool', (locale) => {
    for (let i = 0; i < 50; i++) {
      expect(drawnFrom(locale, generator.generate(locale))).toBe(true);
    }
  });

  it('falls back to English for an unsupported or missing locale', () => {
    expect(drawnFrom(DEFAULT_LOCALE, generator.generate('fr'))).toBe(true);
    expect(drawnFrom(DEFAULT_LOCALE, generator.generate(null))).toBe(true);
  });

  it('takes the request locale when none is passed', () => {
    // The locale reaches auth on the NATS headers, seeded into the request
    // context by RpcCorrelationInterceptor (plan 0018, section 3.4).
    runWithRequestContext({ correlationId: 'c', locale: 'es' }, () => {
      expect(drawnFrom('es', generator.generate())).toBe(true);
    });
  });

  it('varies: a thousand draws are not all the same name', () => {
    const drawn = new Set(
      Array.from({ length: 1000 }, () => generator.generate('en'))
    );
    expect(drawn.size).toBeGreaterThan(100);
  });
});
