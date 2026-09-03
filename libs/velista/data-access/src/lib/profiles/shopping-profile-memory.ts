import { Injectable } from '@angular/core';
import {
  PROFILE_LIMITS,
  type AddPostalCodeRequest,
  type CatalogScope,
  type ChainPreference,
  type ProfileGenerationScope,
  type ProfilePostalCode,
  type ResolvedPostalCode,
  type ShoppingProfile,
  type Supermarket,
  type WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { ShoppingProfileServiceI } from './shopping-profile-service';

/** The chains this fake knows about. Real Spanish names, so the rows read as real. */
const CHAINS: readonly Supermarket[] = [
  { id: 'sm-mercadona', name: { en: 'Mercadona', es: 'Mercadona' } },
  { id: 'sm-deza', name: { en: 'Deza', es: 'Deza' } },
  { id: 'sm-dia', name: { en: 'DIA', es: 'DIA' } },
  { id: 'sm-carrefour', name: { en: 'Carrefour', es: 'Carrefour' } },
];

/**
 * The one postal code this fake claims nobody serves.
 *
 * A specific code rather than a rule, so a spec asserting the uncovered flag names the
 * case it is testing and every other code stays ordinary.
 */
const UNSERVED_POSTAL_CODE = '05631';

/**
 * Which codes this fake considers near which (plan 0058, section 5).
 *
 * A table rather than a rule, for {@link UNSERVED_POSTAL_CODE}'s reason: a spec about
 * the expansion names a code that expands, and every other code adds exactly itself.
 * Real Córdoba codes, so a screen filled in by hand reads as a real place.
 */
const NEARBY: Readonly<Record<string, readonly string[]>> = {
  '14001': ['14002', '14003'],
  '14010': ['14011'],
};

/**
 * Where this fake's device is, and how far it will guess.
 *
 * A point anywhere in Spain's latitudes resolves to one code; anything else answers
 * null, which is the server's "we don't know" rather than a failure. Two cases, both
 * reachable from a spec by choosing a point, and no geometry beyond what that needs.
 */
const DEVICE_POSTAL_CODE = '14001';
const RESOLVABLE_LATITUDES = { min: 35, max: 44 };

/**
 * The caller's shopping profiles, in memory. Asked for by name, never a default.
 *
 * It exists for `AccountMemory`'s two reasons, and it models the three server rules the
 * page's behaviour actually rests on, because a fake that is kinder than the real thing
 * is a fake that lets a bug through:
 *
 * - **The list is never empty.** The first read creates the default profile with a null
 *   name, which is what the page renders as its localized default (backend `0049`
 *   section 1.3). There is no "no profiles yet" state anywhere in this app.
 * - **The last profile cannot be deleted**, answered as a conflict, and deleting the
 *   default promotes the oldest remaining. The page never asks for the first of those,
 *   because with one profile it draws no trash; the fake refuses anyway, so a page that
 *   started drawing one would fail rather than silently work.
 * - **A postal code nobody serves is kept and flagged**, never rejected.
 *
 * The collections are full replacements here as on the wire: an absent one is left
 * alone, a present one becomes exactly what was sent.
 */
// Provided by the app layer, never root: it is listed beside every other fake in this
// library so they are installed in one place rather than two (rule D5).
@Injectable()
export class ShoppingProfileMemory implements ShoppingProfileServiceI {
  private _profiles: ShoppingProfile[] = [];
  private _nextId = 1;
  /** Stored generation scopes, by profile id. Empty until a spec states one. */
  private readonly _scopes = new Map<string, ProfileGenerationScope>();

  /**
   * Derived codes a profile has dismissed, by profile id.
   *
   * Kept beside the profiles rather than on them, because a suppression is not
   * something any view of a profile shows: the row is simply absent, and modelling it
   * as a field would put a flag on this fake that the real one never sends.
   */
  private readonly _suppressed = new Map<string, Set<string>>();

  async listProfiles(): Promise<readonly ShoppingProfile[]> {
    this._ensureDefault();
    return this._profiles.map((profile) => ({ ...profile }));
  }

  /**
   * What a profile draws from (plan 0049, section 3).
   *
   * `ALL` with no sources, because that is what a fresh profile stores on the real
   * server and nothing in this app produces anything else: the generation sheet sends
   * explicit sources per run and never writes a profile's stored scope. So the fake's
   * honest answer is the one that makes the sheet precheck everything, which is what a
   * person who has never narrowed anything means.
   *
   * A spec that wants the narrowed case states it with {@link setGenerationScope},
   * rather than this pretending to remember one nothing ever wrote.
   */
  async readGenerationScope(
    profileId: string
  ): Promise<ProfileGenerationScope | null> {
    this._ensureDefault();

    return this._profiles.some((profile) => profile.id === profileId)
      ? (this._scopes.get(profileId) ?? {
          profileId,
          scope: 'ALL',
          sources: [],
        })
      : null;
  }

  /** State a stored scope, for a spec about the sheet prefilling from one. */
  setGenerationScope(scope: ProfileGenerationScope): void {
    this._scopes.set(scope.profileId, scope);
  }

  async createProfile(
    body: WriteShoppingProfileRequest
  ): Promise<ShoppingProfile> {
    this._ensureDefault();

    if (this._profiles.length >= PROFILE_LIMITS.maxProfiles) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: 'memory',
      });
    }

    // Never the default: a new profile takes its place at the end of the list, and
    // moving the default is its own route.
    const created = this._write(
      {
        id: `profile-${this._nextId++}`,
        name: null,
        isDefault: false,
        position: this._profiles.length,
        minSavingCents: 0,
        postalCodes: [],
        chains: [],
      },
      body
    );

    this._profiles.push(created);
    return { ...created };
  }

  async updateProfile(
    profileId: string,
    body: WriteShoppingProfileRequest
  ): Promise<ShoppingProfile> {
    const index = this._indexOf(profileId);
    const updated = this._write(this._profiles[index], body);
    this._profiles[index] = updated;

    return { ...updated };
  }

  /**
   * Add one code, and with `expandNearby` the ones this fake calls its neighbours.
   *
   * It models the three server rules the screen's behaviour rests on:
   *
   * - **The cap counts the user's own codes only.** Derived rows do not occupy it, and
   *   could not: five codes each pulling in neighbours is a set nobody sized.
   * - **Adding a derived code promotes it**, clearing its suppression, which is also
   *   the way back from having removed one.
   * - **A suppressed neighbour stays away.** Re-adding its parent does not bring it
   *   back, because a recompute that ignored the suppression would put back the row a
   *   person just dismissed.
   */
  async addPostalCode(
    profileId: string,
    body: AddPostalCodeRequest
  ): Promise<ShoppingProfile> {
    const index = this._indexOf(profileId);
    const profile = this._profiles[index];
    const suppressed = this._suppressedOf(profileId);

    const own = profile.postalCodes.filter((code) => code.source !== 'NEARBY');
    const held = own.find((code) => code.postalCode === body.postalCode);

    if (held === undefined && own.length >= PROFILE_LIMITS.maxPostalCodes) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: 'memory',
      });
    }

    // Promoting clears the suppression: the row becomes theirs, and theirs is never
    // a row we are declining to draw.
    suppressed.delete(body.postalCode);

    const existing = profile.postalCodes.find(
      (code) => code.postalCode === body.postalCode
    );
    const parent: ProfilePostalCode = {
      id: existing?.id ?? `${profileId}-pc-${body.postalCode}`,
      postalCode: body.postalCode,
      label: body.label ?? existing?.label ?? null,
      position: existing?.position ?? profile.postalCodes.length,
      source: body.source ?? 'TYPED',
    };

    // **Replaced in place, never moved to the end.** Re-adding a code is how a derived
    // one is promoted, and a chip that jumped across the list when somebody typed a
    // code they already had would be a fake teaching the screen a behaviour the server
    // does not have.
    const kept =
      existing === undefined
        ? [...profile.postalCodes, parent]
        : profile.postalCodes.map((code) =>
            code.postalCode === body.postalCode ? parent : code
          );

    const derived =
      body.expandNearby === true ? (NEARBY[body.postalCode] ?? []) : [];

    const added = derived
      .filter(
        (code) =>
          !suppressed.has(code) &&
          !kept.some((held) => held.postalCode === code)
      )
      .map<ProfilePostalCode>((code, at) => ({
        id: `${profileId}-pc-${code}`,
        postalCode: code,
        label: null,
        position: kept.length + at,
        source: 'NEARBY',
      }));

    this._profiles[index] = {
      ...profile,
      postalCodes: [...kept, ...added],
    };

    return { ...this._profiles[index] };
  }

  /**
   * Remove one code by the code itself.
   *
   * A derived row is **suppressed** rather than deleted, so it stays away; one of the
   * user's own is deleted and takes its neighbours with it, unless another code of
   * theirs also reaches them. Which of the two happens follows from the row's source,
   * which is the server's rule and not the caller's argument.
   */
  async removePostalCode(
    profileId: string,
    postalCode: string
  ): Promise<ShoppingProfile> {
    const index = this._indexOf(profileId);
    const profile = this._profiles[index];
    const row = profile.postalCodes.find(
      (code) => code.postalCode === postalCode
    );

    if (row === undefined) {
      return { ...profile };
    }

    if (row.source === 'NEARBY') {
      this._suppressedOf(profileId).add(postalCode);
    }

    const own = profile.postalCodes.filter(
      (code) => code.source !== 'NEARBY' && code.postalCode !== postalCode
    );
    const stillReached = new Set(
      own.flatMap((code) => NEARBY[code.postalCode] ?? [])
    );

    this._profiles[index] = {
      ...profile,
      postalCodes: profile.postalCodes.filter((code) => {
        if (code.postalCode === postalCode) {
          return false;
        }
        return code.source !== 'NEARBY' || stillReached.has(code.postalCode);
      }),
    };

    return { ...this._profiles[index] };
  }

  /**
   * Where the device is, as a postal code and never as a point.
   *
   * Nothing here stores what it was handed, which is the property the real route has
   * and the fake would otherwise be quietly weaker than.
   */
  async resolvePostalCode(
    latitude: number,
    _longitude: number
  ): Promise<ResolvedPostalCode> {
    const placeable =
      latitude >= RESOLVABLE_LATITUDES.min &&
      latitude <= RESOLVABLE_LATITUDES.max;

    return {
      country: 'es',
      postalCode: placeable ? DEVICE_POSTAL_CODE : null,
    };
  }

  async makeDefault(profileId: string): Promise<ShoppingProfile> {
    const index = this._indexOf(profileId);
    this._profiles = this._profiles.map((profile, at) => ({
      ...profile,
      isDefault: at === index,
    }));

    return { ...this._profiles[index] };
  }

  async deleteProfile(profileId: string): Promise<void> {
    const index = this._indexOf(profileId);

    if (this._profiles.length === 1) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: 'memory',
      });
    }

    const [removed] = this._profiles.splice(index, 1);

    // Deleting the default promotes the oldest remaining, so there is always exactly
    // one and the page never has to invent which profile it is now editing.
    if (removed.isDefault && this._profiles.length > 0) {
      this._profiles[0] = { ...this._profiles[0], isDefault: true };
    }
  }

  async listSupermarkets(): Promise<readonly Supermarket[]> {
    return CHAINS;
  }

  async describeScope(profileId: string): Promise<CatalogScope> {
    const profile = this._profiles[this._indexOf(profileId)];

    return {
      profileId,
      coverage: profile.postalCodes.map((entry) => ({
        postalCode: entry.postalCode,
        served: entry.postalCode !== UNSERVED_POSTAL_CODE,
      })),
      approximate: false,
    };
  }

  /** The lazily created default, which is what makes the list never empty. */
  private _ensureDefault(): void {
    if (this._profiles.length > 0) {
      return;
    }

    this._profiles.push({
      id: `profile-${this._nextId++}`,
      // Null, and not the English words: the server does not know the caller's
      // language, and this fake must not pretend it does either.
      name: null,
      isDefault: true,
      position: 0,
      minSavingCents: 0,
      postalCodes: [],
      chains: [],
    });
  }

  private _indexOf(profileId: string): number {
    const index = this._profiles.findIndex(
      (profile) => profile.id === profileId
    );

    // A profile that is not yours is **not found** rather than forbidden: a profile is
    // private, and telling a stranger that an id exists is telling them something.
    if (index < 0) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
      });
    }

    return index;
  }

  /** The derived codes this profile has dismissed, which stay dismissed. */
  private _suppressedOf(profileId: string): Set<string> {
    const held = this._suppressed.get(profileId);
    if (held !== undefined) {
      return held;
    }

    const created = new Set<string>();
    this._suppressed.set(profileId, created);
    return created;
  }

  /**
   * Applies one write body, treating each collection as a full replacement.
   *
   * The postal codes are not among them any more (plan 0058): they are written a row
   * at a time, and this body cannot state them.
   */
  private _write(
    before: ShoppingProfile,
    body: WriteShoppingProfileRequest
  ): ShoppingProfile {
    const chains: readonly ChainPreference[] =
      body.supermarkets === undefined
        ? before.chains
        : body.supermarkets.map((entry) => ({
            id: `${before.id}-sm-${entry.supermarketId}`,
            supermarketId: entry.supermarketId,
            excluded: entry.excluded === true,
          }));

    return {
      ...before,
      // An empty name is no name rather than a name that is empty, matching the
      // server's own trim: it is what puts the localized default back on screen.
      name:
        body.name === undefined
          ? before.name
          : (body.name?.trim() ?? '') === ''
            ? null
            : (body.name?.trim() ?? null),
      minSavingCents: body.minSavingCents ?? before.minSavingCents,
      chains,
    };
  }
}
