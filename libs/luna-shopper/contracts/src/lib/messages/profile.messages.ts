import type {
  GenerationScope,
  ProfilePostalCodeSource,
} from '../enums/profile.enums';

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
  /**
   * Add one postal code to a profile, optionally widening it (plan 0062,
   * section 6).
   *
   * A row at a time rather than the replacement collection above, because a
   * profile's postal codes are no longer all the user's: the derived ones are
   * ours, the client never states them, and stating the set would either lose
   * them or promote them wholesale. The three collections on `update` stay a
   * replacement, and `postalCodes` there means **the profile's own codes**.
   */
  addPostalCode: 'profiles.addPostalCode',
  /**
   * Remove one postal code from a profile.
   *
   * It takes no argument saying how. Whether the row is deleted or suppressed
   * follows from its own `source`, which the server knows and the client should
   * not have to (plan 0062, sections 3.1 and 6).
   */
  removePostalCode: 'profiles.removePostalCode',
} as const;

/**
 * The caps (plan 0049, section 8). A bound rather than a budget: the scope set
 * the basket optimizer works over is the product of these two, and ten profiles
 * of five codes is already more places than anybody shops from.
 */
export const PROFILE_LIMITS = {
  maxProfiles: 10,
  /**
   * The user's **own** codes, `TYPED` and `DEVICE` together (plan 0062).
   *
   * Derived rows do not count against it and could not: five codes each pulling
   * in their neighbours is a set the user never sized, and refusing an expansion
   * because the cap on what somebody typed had been reached would make the cap
   * mean two different things.
   */
  maxPostalCodes: 5,
  /**
   * How many neighbours one expanding code contributes, nearest first (plan
   * 0062, section 4).
   *
   * A bound on top of the radius rather than instead of it. Two kilometres
   * around a dense urban centroid can pull in a dozen codes and around a rural
   * one none at all, so the radius alone leaves the size of the derived set to
   * the geography of wherever the user happens to live. Section 4 already
   * anticipates "the nearest N codes, capped by distance" once the distribution
   * over real data can be looked at; this is that N, and tuning it is a change
   * to the recompute's body and to nothing else.
   */
  maxNearbyPerPostalCode: 10,
  maxSupermarketPreferences: 100,
  maxGenerationSources: 100,
  nameMaxLength: 64,
  postalCodeMaxLength: 16,
  labelMaxLength: 64,
  addressMaxLength: 200,
} as const;

/**
 * The country a postal code is read against when nobody says (plan 0062,
 * section 1).
 *
 * The centroid table is keyed on `(country, postalCode)`, and a lookup with no
 * country searches Spain and Bolivia together, which is how `08001` becomes a
 * neighbour of a code two thousand kilometres away. Only `es` ships today; the
 * column exists so the day a second one does is a data change.
 */
export const DEFAULT_POSTAL_CODE_COUNTRY = 'es';

// --- Views -----------------------------------------------------------------

/**
 * One postal code the profile shops from, **stored exactly as it was typed**
 * (plan 0049, section 1.1). What it resolves to is asked per query.
 *
 * A code the user suppressed is **absent** from every view rather than present
 * with a flag (plan 0062, section 6): no client has a reason to render one, and
 * an absent row cannot be shown by accident.
 */
export interface ProfilePostalCodeView {
  id: string;
  postalCode: string;
  /** "home", "the office". Display only; nothing is derived from it. */
  label: string | null;
  position: number;
  /** ISO 3166-1 alpha-2, lowercase. `es` unless somebody said otherwise. */
  country: string;
  /** Whose code this is: the user's, or one we concluded (plan 0062). */
  source: ProfilePostalCodeSource;
  /**
   * Whether this code's neighbours were asked for. Meaningful on a `TYPED` or
   * `DEVICE` row only; always false on a `NEARBY` one, which cannot expand
   * further or the derived set would be a transitive closure over the country.
   */
  expandNearby: boolean;
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
 * `empty` says a profile holds no postal code and no included chain, so it has
 * said nothing at all. A profile holding only *exclusions* is empty too, for the
 * same reason: "not DIA" is not a place.
 *
 * It is worth knowing and no longer a reason to refuse a read. Since plan 0069
 * the gateway resolves an empty profile to no scopes and the catalog answers
 * unpriced; the field survives because the answer is arrived at without a round
 * trip to catalog, and because a client still wants to say "you have not told us
 * where you shop".
 */
export interface ProfileScopeSelector {
  profileId: string;
  postalCodes: string[];
  /** Chains the profile listed. Empty means "every chain that serves me". */
  supermarketIds: string[];
  excludedSupermarketIds: string[];
  /**
   * Shops the profile refused one by one, as opposed to the chains above (plan
   * 0064).
   *
   * **Optional, and absent means none.** Plan 0064 owns the table it is read
   * from and has not landed; the shop reads of plan 0068 pass whatever is here
   * straight to catalog, so they are complete the day it does and refuse nothing
   * until then. A reader treats absent and empty alike.
   */
  excludedSupermarketLocationIds?: string[];
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

/**
 * One postal code as the client sends it. The id and position are core's.
 *
 * **Always one of the user's own**, and never a derived one: `source` accepts
 * `TYPED` and `DEVICE` and nothing else (plan 0062, section 2). A code that
 * happens to be derived already is promoted rather than refused (section 3.2),
 * which is also the way back from having suppressed it.
 */
export interface ProfilePostalCodeInput {
  postalCode: string;
  label?: string | null;
  /** ISO 3166-1 alpha-2. Defaults to {@link DEFAULT_POSTAL_CODE_COUNTRY}. */
  country?: string;
  /** `TYPED` unless the client says the device resolved it. */
  source?: ProfilePostalCodeSource.TYPED | ProfilePostalCodeSource.DEVICE;
  /** Whether to add the codes near this one, marked as ours. Default false. */
  expandNearby?: boolean;
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

/**
 * Add one postal code to a profile (plan 0062, section 2).
 *
 * The row at a time counterpart of `postalCodes` on the update request, and the
 * one a client that renders derived rows must use: the replacement collection
 * states the profile's own codes, so echoing a derived row back through it would
 * promote it to the user's, which is not what rendering a list and saving it
 * means.
 *
 * Answers the whole profile, because one add can write several rows: the parent
 * and, with `expandNearby`, its neighbours.
 */
export interface AddProfilePostalCodeRequest {
  userId: string;
  profileId: string;
  postalCode: string;
  label?: string | null;
  country?: string;
  source?: ProfilePostalCodeSource.TYPED | ProfilePostalCodeSource.DEVICE;
  expandNearby?: boolean;
}

/**
 * Remove one postal code from a profile (plan 0062, sections 2 and 3.1).
 *
 * The code rather than the row id, so the caller does not need to have read the
 * profile since the last recompute; `uq_profile_postal_code` is what makes that
 * unambiguous, and it is why no country travels here. It carries no argument
 * saying whether to delete or to suppress: a `TYPED` or `DEVICE` row is deleted
 * and the recompute prunes whatever it was justifying, and a `NEARBY` row is
 * suppressed, because a pure recompute would otherwise put it straight back.
 */
export interface RemoveProfilePostalCodeRequest {
  userId: string;
  profileId: string;
  postalCode: string;
}
