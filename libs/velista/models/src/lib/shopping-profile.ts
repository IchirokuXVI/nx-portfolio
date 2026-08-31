/**
 * Where somebody shops, as this app models it (plan 0046; backend plan 0049).
 *
 * Rule D4 applies here as everywhere: these are **our** types, mapped from `unknown`,
 * and a backend rename breaks one mapper rather than a page. Two of the wire's fields
 * are deliberately absent, and their absence is load bearing rather than lazy:
 *
 * - `generationScope` and `generationSources` are what feeds a generated basket, and
 *   plan 0046 section 9 keeps them off this screen. `PATCH` treats an absent
 *   collection as "leave it alone" and a present one as a full replacement, so a model
 *   that carried them would sooner or later be sent back with whatever this build
 *   happened to hold, which for a build that never renders them is nothing.
 * - `minSavingPercent` is the optional relative floor beside the absolute one. Nothing
 *   on this page draws it, and the same replacement argument applies one field down.
 */

/**
 * A name the catalog holds in both languages.
 *
 * Kept as the pair rather than resolved when it is mapped, because the locale can
 * change under a page that is already open and a string chosen at fetch time would
 * stay in the language the fetch happened in.
 */
export interface LocalizedName {
  readonly en: string;
  readonly es: string;
}

/**
 * The pair in one language, falling back to English.
 *
 * The fallback is the same one `RokuTranslator` uses, so a chain the catalog has only
 * named once reads the same way a missing translation key does.
 */
export function inLocale(name: LocalizedName, locale: string): string {
  const spanish = locale.startsWith('es') ? name.es : '';
  return spanish !== '' ? spanish : name.en;
}

/**
 * One supermarket chain, from the unscoped listing (backend `0049` section 3).
 *
 * The chain and never one of its shops: a preference names the franchise, and which
 * locations it reaches is the resolver's business.
 */
export interface Supermarket {
  readonly id: string;
  readonly name: LocalizedName;
}

/**
 * One postal code a profile shops from, stored exactly as it was typed.
 *
 * What it resolves to is asked per query and never stored, so there is nothing here
 * about scopes or shops. Whether anybody serves it is {@link PostalCodeCoverage}.
 */
export interface ProfilePostalCode {
  readonly id: string;
  readonly postalCode: string;
  /** "home", "the office". Display only; nothing is derived from it. */
  readonly label: string | null;
  readonly position: number;
}

/**
 * A chain the profile does or does not shop.
 *
 * `excluded` exists so "everything except DIA" does not mean enumerating every other
 * chain, and so a chain added to the catalog later is included by default rather than
 * missing from a handwritten allowlist. A chain with no preference row at all is
 * included, which is why the page draws every chain and not only these.
 */
export interface ChainPreference {
  readonly id: string;
  readonly supermarketId: string;
  readonly excluded: boolean;
}

/**
 * One way a person shops.
 *
 * `name` is nullable and a null name is **not** a missing one: the client renders the
 * localized default ("My profile" / "Mi perfil"), because the server does not know the
 * caller's language and a stored English word in a Spanish account is wrong forever.
 */
export interface ShoppingProfile {
  readonly id: string;
  readonly name: string | null;
  readonly isDefault: boolean;
  readonly position: number;
  /** Display and context only. Nothing is geocoded; the postal codes resolve. */
  readonly addressText: string | null;
  /** What a second stop must save before a generated basket suggests it, in cents. */
  readonly minSavingCents: number;
  readonly postalCodes: readonly ProfilePostalCode[];
  readonly chains: readonly ChainPreference[];
}

/**
 * Whether we know of anybody serving one postal code.
 *
 * A code no chain serves is **kept and flagged, never rejected**: coverage is a
 * property of our data and not of the user's address, and refusing the code would tell
 * somebody they live nowhere.
 */
export interface PostalCodeCoverage {
  readonly postalCode: string;
  readonly served: boolean;
}

/** What `GET /v1/catalog/scope` says about where the caller currently shops. */
export interface CatalogScope {
  /** The profile that supplied the selector, or null when the caller stated one. */
  readonly profileId: string | null;
  /** One entry per postal code asked about, in the order they were given. */
  readonly coverage: readonly PostalCodeCoverage[];
  /** True when any price shown came off the chain's fallback scope rather than yours. */
  readonly approximate: boolean;
}

/**
 * The caps the server enforces (backend `0049` section 8), restated for the fields
 * that need them.
 *
 * Kept in sync by hand with `PROFILE_LIMITS` in `@portfolio/luna-shopper/contracts`,
 * for the reason `problem.ts` gives about its own copy: that library pulls NestJS into
 * anything that imports it, so it is never safe in a browser bundle. The client uses
 * them to stop a request that would be refused, never to decide anything the server
 * does not already decide.
 */
export const PROFILE_LIMITS = {
  maxProfiles: 10,
  maxPostalCodes: 5,
  nameMaxLength: 64,
  postalCodeMaxLength: 16,
  labelMaxLength: 64,
  addressMaxLength: 200,
} as const;
