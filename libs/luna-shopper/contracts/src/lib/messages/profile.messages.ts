import type { GenerationScope } from '../enums/profile.enums';

/**
 * Shopping profile message contracts (plan 0049). Core owns the profile, keyed by
 * an opaque `userId`, and references catalog only by an opaque `supermarketId`
 * exactly as `ListLine` references an item (plan 0012, section 4).
 *
 * The gateway is the only caller. Every request carries the `userId` the token
 * resolved to, and a `profileId` that is not that user's is answered as **not
 * found** rather than as forbidden (section 1.3): a profile is private, and
 * telling a stranger that an id exists is telling them something.
 */
export const PROFILE_PATTERNS = {
  list: 'profiles.list',
  create: 'profiles.create',
  update: 'profiles.update',
  setDefault: 'profiles.setDefault',
  delete: 'profiles.delete',
  /**
   * What the gateway asks before a catalog read (plan 0049, section 2.1).
   *
   * It answers a {@link ProfileScopeSelector} and **not a set of price scope
   * ids**, which is the split section 1.1 asks for: the profile stores postal
   * codes, and the mapping from a postal code to a scope belongs to the chain and
   * moves without telling us, so it is resolved per query by catalog, which owns
   * the scopes. Core answers what the user said; catalog answers what it means
   * today.
   */
  resolveScopes: 'profiles.resolveScopes',
} as const;

/**
 * The caps (plan 0049, section 8). A bound rather than a budget: the scope set
 * the basket optimizer works over is the product of these two, and ten profiles
 * of five codes is already more places than anybody shops from.
 */
export const PROFILE_LIMITS = {
  maxProfiles: 10,
  maxPostalCodes: 5,
  maxSupermarketPreferences: 100,
  maxGenerationSources: 100,
  nameMaxLength: 64,
  postalCodeMaxLength: 16,
  labelMaxLength: 64,
  addressMaxLength: 200,
} as const;

// --- Views -----------------------------------------------------------------

/**
 * One postal code the profile shops from, **stored exactly as it was typed**
 * (plan 0049, section 1.1). What it resolves to is asked per query.
 */
export interface ProfilePostalCodeView {
  id: string;
  postalCode: string;
  /** "home", "the office". Display only; nothing is derived from it. */
  label: string | null;
  position: number;
}

/**
 * A chain the profile does or does not shop (plan 0049, section 1.2).
 *
 * It names the **chain and never a location**: "no DIA" means no DIA anywhere,
 * and which stores a chain reaches is the resolver's business. `excluded` exists
 * so "everything except DIA" does not force the user to enumerate every other
 * chain, and so a chain added to the catalog later is included by default rather
 * than silently missing from a hand written allowlist.
 */
export interface ProfileSupermarketPreferenceView {
  id: string;
  supermarketId: string;
  excluded: boolean;
}

/**
 * A zone, or one list within it, that feeds a generated basket. Only meaningful
 * while `generationScope` is `SELECTED`. `listId` null means the whole zone.
 */
export interface ProfileGenerationSourceView {
  id: string;
  zoneId: string;
  listId: string | null;
}

/**
 * One way a person shops (plan 0049, section 1): where they are, which chains
 * they will set foot in, and what a second stop has to save.
 *
 * `name` is nullable and a null name is **not** a missing one: the client renders
 * the localized default ("My profile" / "Mi perfil"), because core does not know
 * the caller's locale and a stored English word in a Spanish account is wrong
 * forever (section 1.3).
 */
export interface ShoppingProfileView {
  id: string;
  name: string | null;
  isDefault: boolean;
  position: number;
  /** Display and context only. Nothing is geocoded; the postal codes resolve. */
  addressText: string | null;
  /** What a second stop must save before the generator suggests it (0050). */
  minSavingCents: number;
  /** The optional relative floor beside the absolute one. */
  minSavingPercent: number | null;
  generationScope: GenerationScope;
  postalCodes: ProfilePostalCodeView[];
  supermarkets: ProfileSupermarketPreferenceView[];
  generationSources: ProfileGenerationSourceView[];
}

/**
 * Every profile the caller has, in `position` order.
 *
 * Not a page. There are at most ten of them (`PROFILE_LIMITS.maxProfiles`) and a
 * cursor over ten rows is a cursor nobody would ever pass back, so this is a
 * named object rather than a `Paginated`.
 */
export interface ShoppingProfileListResult {
  profiles: ShoppingProfileView[];
}

/**
 * What the caller said about where they shop, before catalog says what it means
 * (plan 0049, sections 1.1 and 2.1).
 *
 * `empty` is the one field a caller must branch on: a profile holding no postal
 * code and no included chain has said nothing at all, and section 3 answers that
 * with `CATALOG_SCOPE_REQUIRED` rather than with everything or with nothing.
 * A profile holding only *exclusions* is empty too, for the same reason: "not
 * DIA" is not a place.
 */
export interface ProfileScopeSelector {
  profileId: string;
  postalCodes: string[];
  /** Chains the profile listed. Empty means "every chain that serves me". */
  supermarketIds: string[];
  excludedSupermarketIds: string[];
  empty: boolean;
}

// --- Requests --------------------------------------------------------------

/**
 * List the caller's profiles, **creating the default one if they have none**
 * (plan 0049, section 1.3). Idempotent under concurrency: two of these racing
 * create one profile between them, enforced by the partial unique index.
 */
export interface ListShoppingProfilesRequest {
  userId: string;
}

/** One postal code as the client sends it. The id and position are core's. */
export interface ProfilePostalCodeInput {
  postalCode: string;
  label?: string | null;
}

export interface ProfileSupermarketPreferenceInput {
  supermarketId: string;
  excluded?: boolean;
}

export interface ProfileGenerationSourceInput {
  zoneId: string;
  listId?: string | null;
}

export interface CreateShoppingProfileRequest {
  userId: string;
  name?: string | null;
  addressText?: string | null;
  minSavingCents?: number;
  minSavingPercent?: number | null;
  generationScope?: GenerationScope;
  postalCodes?: ProfilePostalCodeInput[];
  supermarkets?: ProfileSupermarketPreferenceInput[];
  generationSources?: ProfileGenerationSourceInput[];
}

/**
 * Edit a profile. The three collections are **full replacements** and not
 * patches: an absent one is left alone, a present one becomes exactly what was
 * sent, and an empty array clears it. A per row add and remove surface would be
 * three more subjects to describe a list of five postal codes.
 */
export interface UpdateShoppingProfileRequest {
  userId: string;
  profileId: string;
  name?: string | null;
  addressText?: string | null;
  minSavingCents?: number;
  minSavingPercent?: number | null;
  generationScope?: GenerationScope;
  postalCodes?: ProfilePostalCodeInput[];
  supermarkets?: ProfileSupermarketPreferenceInput[];
  generationSources?: ProfileGenerationSourceInput[];
}

export interface ShoppingProfileIdRequest {
  userId: string;
  profileId: string;
}

/**
 * Resolve the caller's profile to what they said about where they shop.
 *
 * With no `profileId` this is the default profile, created on the spot if the
 * user has none, so a catalog read from a brand new account resolves rather than
 * failing on a missing row.
 */
export interface ResolveProfileScopesRequest {
  userId: string;
  profileId?: string;
}
