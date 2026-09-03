import type { GenerationScope } from './enums';
import type { GeneratedListSource } from './generated-list-view';

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
 *
 *   **They are still read, and they are read somewhere else** (plan 0049, section 3).
 *   {@link ProfileGenerationScope} is its own type behind its own call, held by the
 *   generation sheet and never merged into the profile the profiles page edits and
 *   saves. Keeping the field off this interface was the safe choice available at the
 *   time; keeping it off while reading it separately is the safe choice that also
 *   prefills the sheet. The point is not to be careful with a field that can erase
 *   somebody's stored scope, it is that no field on this object can.
 * - `minSavingPercent` is the optional relative floor beside the absolute one. Nothing
 *   on this page draws it, and the same replacement argument applies one field down.
 * - `addressText` is gone from here for a different reason (plan 0058, section 2). It
 *   was a free text address that nothing geocoded and nothing read, sitting above the
 *   postal codes that do the work, and a field that asks somebody where they live and
 *   then ignores the answer is worse than no field: it invites them to believe the app
 *   knows. **The column stays** in core, because dropping text a person typed is not
 *   reversible and it costs nothing where it is. What replaced it on screen is
 *   {@link ProfilePostalCode.label}, which is the thing it was pretending to be.
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
 * Where a postal code on a profile came from (plan 0058, section 4; backend 0062).
 *
 * Two of these are the user's and one is ours, and the screen says which. `NEARBY`
 * is a code the server added because it is close to one the user gave: it is
 * removable like any other row, and it is **not addable**, because it is not a
 * sentence a person says. Typing one that happens to be derived is an ordinary add
 * and the server promotes it, so there is no error state to render for that.
 */
export const POSTAL_CODE_SOURCES = ['TYPED', 'DEVICE', 'NEARBY'] as const;
export type PostalCodeSource = (typeof POSTAL_CODE_SOURCES)[number];

/**
 * What a source we do not recognise reads as.
 *
 * The user's own, which is the conservative way to be wrong: a `TYPED` chip is
 * removable and carries no derived treatment, so a value added to the wire later
 * degrades to an ordinary chip rather than to one this app refuses to draw.
 */
export const POSTAL_CODE_SOURCE_FALLBACK: PostalCodeSource = 'TYPED';

/**
 * One postal code a profile shops from, stored exactly as it was typed.
 *
 * What it resolves to is asked per query and never stored, so there is nothing here
 * about scopes or shops. Whether anybody serves it is {@link PostalCodeCoverage},
 * which is a statement about our data and not about this row.
 */
export interface ProfilePostalCode {
  readonly id: string;
  readonly postalCode: string;
  /**
   * "home", "the office". Display only; nothing is derived from it.
   *
   * Null is ordinary and the screen falls back to the code itself rather than to a
   * blank or a placeholder, which is what somebody recognises anyway. It is also the
   * field the free text address used to pretend to be (plan 0058, section 2).
   */
  readonly label: string | null;
  readonly position: number;
  /** Whose code this is: theirs, their device's, or one we concluded. */
  readonly source: PostalCodeSource;
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
  /** What a second stop must save before a generated basket suggests it, in cents. */
  readonly minSavingCents: number;
  readonly postalCodes: readonly ProfilePostalCode[];
  readonly chains: readonly ChainPreference[];
}

/**
 * What a profile draws from when it generates a basket (plan 0049, section 3).
 *
 * **Its own type, read by its own call, held on its own.** It comes off the same
 * listing response as {@link ShoppingProfile} and is deliberately not part of it: the
 * profiles page holds a profile and saves it, `PATCH` treats a present collection as a
 * full replacement, and a field riding along on an object that gets saved is a field
 * that will one day be saved empty. That is not a thing to be careful about, it is a
 * thing to make impossible, and this type is how.
 *
 * The generation sheet is the only reader. It prechecks its tree from
 * {@link sources} where the scope is `SELECTED`, and prechecks everything where it is
 * `ALL`, which is both today's behaviour and the right default for somebody who has
 * never narrowed anything.
 */
export interface ProfileGenerationScope {
  readonly profileId: string;
  readonly scope: GenerationScope;
  /**
   * The stored sources, meaningful only when {@link scope} is `SELECTED`.
   *
   * A null `listId` is the whole group including lists made later, exactly as it is on
   * a generation request, which is why this is `GeneratedListSource` and not a second
   * type saying the same thing. The server keeps them under `ALL` too and this carries
   * whatever it sent, because a scope widened to `ALL` and then narrowed again should
   * find its old ticks where it left them.
   */
  readonly sources: readonly GeneratedListSource[];
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
  /**
   * The user's **own** codes, `TYPED` and `DEVICE` together.
   *
   * Derived rows do not count against it and could not: five codes each pulling in
   * their neighbours is a set the user never sized, and refusing an expansion because
   * the cap on what somebody typed had been reached would make the cap mean two
   * different things.
   */
  maxPostalCodes: 5,
  nameMaxLength: 64,
  postalCodeMaxLength: 16,
  labelMaxLength: 64,
  // `addressMaxLength` was here and is gone with the field that used it (plan 0058,
  // section 2). The column still exists in core; nothing in this app writes to it, so
  // a limit here would be a limit on a request this app cannot make.
} as const;
