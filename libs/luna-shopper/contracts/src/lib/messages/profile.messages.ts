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
  /**
   * Turn a point a device reported into a postal code (`apps/velista/plans/0058`,
   * section 3).
   *
   * The user facing half of catalog's `postalCode.nearest`, which plan 0060
   * section 7 deliberately left without a gateway route of its own: a public
   * lookup over the centroid table would be a geocoding service nobody asked
   * for, so the point is only ever asked about on behalf of a signed in caller
   * who is filling in a profile.
   *
   * It **writes nothing**. The coordinates arrive, they are answered, and they
   * are not stored on the profile, in a log line or in an event, which is what
   * makes the sentence the sheet shows before the permission prompt true. The
   * caller adds the code it gets back through {@link PROFILE_PATTERNS.addPostalCode}
   * with `source: DEVICE`, after a human has confirmed it.
   */
  resolvePostalCode: 'profiles.resolvePostalCode',
  /**
   * Say which individual shops this profile does and does not go to (plan 0064,
   * section 5).
   *
   * **Several at once, and set and clear are the same call.** Absence means
   * included, so a row saying `excluded: false` and no row at all describe the
   * same profile; sending `false` is therefore how a shop is switched back on,
   * and the row is deleted rather than stored saying nothing. The screen's
   * natural gesture is several toggles together and one request per checkbox is
   * a poor fit for a phone on a bus, so the bulk shape is the only shape.
   *
   * It is a **partial** write and not a replacement, which is the one place it
   * parts company with `supermarkets` on {@link PROFILE_PATTERNS.update}: shops
   * this call does not mention keep whatever they had. A replacement would make
   * one toggle require the client to hold every shop it has ever seen.
   */
  setLocationPreferences: 'profiles.setLocationPreferences',
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
  /**
   * How many individual shops one profile may hold an opinion about (plan 0064).
   *
   * Larger than the chain cap because it counts a finer thing: a profile with
   * five postal codes and their neighbours can see several hundred shops, and
   * the chain list only ever holds brands. Still a bound rather than a budget,
   * and only exclusions occupy it: switching a shop back on deletes its row.
   */
  maxLocationPreferences: 500,
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
 * A chain the profile does or does not shop (plan 0049, section 1.2, as
 * superseded by plan 0064).
 *
 * **The durable statement about a brand.** "No DIA" means no DIA anywhere,
 * including the DIA that opens down the road next month, and it keeps being
 * true with no maintenance. {@link ProfileLocationPreferenceView} beside it is
 * the specific one, about a shop rather than a brand, and an excluded chain
 * hides every one of its shops whatever their own rows say (plan 0064, section
 * 2.1).
 *
 * `excluded` exists so "everything except DIA" does not force the user to
 * enumerate every other chain, and so a chain added to the catalog later is
 * included by default rather than silently missing from a hand written
 * allowlist.
 */
export interface ProfileSupermarketPreferenceView {
  id: string;
  supermarketId: string;
  excluded: boolean;
}

/**
 * One shop the profile does or does not go to (plan 0064, section 1).
 *
 * The finer axis beside {@link ProfileSupermarketPreferenceView}, and the two
 * are not redundant: "not that shop" is about parking, a bad experience, a route
 * home, and "not DIA" is about the brand. A blacklist for the same reason as its
 * sibling, so a shop imported next week is one the user can see rather than one
 * silently missing until they notice.
 *
 * `supermarketLocationId` is an opaque catalog reference, exactly as
 * `supermarketId` is on the chain preference.
 */
export interface ProfileLocationPreferenceView {
  id: string;
  supermarketLocationId: string;
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
  /**
   * The shops this profile has an opinion about (plan 0064). Only the ones it
   * does: absence means included, so this is the exclusions and not a roll call
   * of every shop the user can reach.
   */
  locations: ProfileLocationPreferenceView[];
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
   * The individual shops this profile refuses (plan 0064, section 3).
   *
   * There is no included counterpart, and there is not going to be one: the
   * finer axis is a blacklist, so naming a shop can only ever take it away.
   * Chains still work both ways, which is why `supermarketIds` above has one.
   *
   * It does **not** contribute to `empty`. A profile that has only refused
   * things has still said nothing about where it shops, and "not that DIA" is no
   * more a place than "not DIA" is.
   *
   * Always present, empty when the profile refuses nothing. Plan 0068 declared
   * it optional while this plan was in flight and read absent as none; now that
   * the rows exist, the shop reads take it as it comes.
   */
  excludedSupermarketLocationIds: string[];
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

/**
 * One shop, and whether the profile refuses it (plan 0064).
 *
 * The same shape as its chain sibling, deliberately: this is a second axis and
 * not a second vocabulary. `excluded` defaults to false, which on the finer axis
 * means "delete whatever row is there", because absence and `false` say the same
 * thing and only one of them should be stored.
 */
export interface ProfileLocationPreferenceInput {
  supermarketLocationId: string;
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

/**
 * Where a device says it is (`apps/velista/plans/0058`, section 3.3).
 *
 * No `profileId`: the answer does not depend on a profile and nothing is written
 * to one, so asking for a profile here would suggest the point had been kept
 * against it. The `userId` is present because the route is authenticated and
 * rate limited per caller, not because anything is stored under it.
 */
export interface ResolveProfilePostalCodeRequest {
  userId: string;
  /** ISO 3166-1 alpha-2. Defaults to {@link DEFAULT_POSTAL_CODE_COUNTRY}. */
  country?: string;
  latitude: number;
  longitude: number;
}

/**
 * The code a point resolved to, or none.
 *
 * **Null is an ordinary answer**, not a failure: a point further from every
 * centroid than the configured distance gets "we don't know" rather than a
 * confident wrong code (plan 0060, section 6). The client says so and offers
 * typing instead.
 *
 * It carries no distance and no coordinates. The screen shows the code for
 * confirmation, so a number it would not draw is a number that should not travel.
 */
export interface ResolvedPostalCodeView {
  country: string;
  postalCode: string | null;
}

/**
 * Set or clear what a profile thinks of several shops at once (plan 0064,
 * section 5).
 *
 * **The only way location preferences are written**, and deliberately not a
 * fourth collection on {@link UpdateShoppingProfileRequest} beside `supermarkets`
 * and the other two. Those are replacements, which suits a list the page holds
 * in full; this axis is per shop and a page holds a screenful of a set that can
 * run to hundreds, so a replacement would make one toggle require the client to
 * send every shop it has ever seen, and an incomplete send would silently
 * un exclude the rest.
 *
 * Answers the whole profile, like every other profile write, so a client that
 * toggled three shops has the profile the toggles produced rather than the one
 * it assumed.
 */
export interface SetProfileLocationPreferencesRequest {
  userId: string;
  profileId: string;
  /** Each shop, and whether it is refused. `false` deletes the row. */
  locations: ProfileLocationPreferenceInput[];
}
