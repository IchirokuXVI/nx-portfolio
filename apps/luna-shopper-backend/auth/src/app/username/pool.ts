import type { SupportedLocale } from '@portfolio/luna-shopper/platform';

/**
 * The shape of a generated-name pool (plan 0018, section 3.2).
 *
 * A pool owns both its words and its composition function, deliberately. A
 * shared `"{adjective} {noun}"` template with a slot per language is exactly the
 * construction that produces `Rápida Timón`: Spanish puts the adjective after the
 * noun and inflects it to the noun's grammatical gender, English does neither. So
 * word order and agreement are per locale code, not per locale data.
 */

export interface NounEntry {
  word: string;
  /** Required for locales whose adjectives inflect; ignored where they do not. */
  gender?: 'm' | 'f';
}

export interface AdjectiveEntry {
  /** A locale with no inflection supplies one form under `m` and omits `f`. */
  m: string;
  f?: string;
}

export interface UsernamePool {
  nouns: NounEntry[];
  adjectives: AdjectiveEntry[];
  compose(noun: NounEntry, adjective: AdjectiveEntry): string;
}

export type UsernamePools = Record<SupportedLocale, UsernamePool>;
