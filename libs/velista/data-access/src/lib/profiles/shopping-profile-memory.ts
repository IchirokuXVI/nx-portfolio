import { Injectable } from '@angular/core';
import {
  PROFILE_LIMITS,
  type CatalogScope,
  type ChainPreference,
  type ProfileGenerationScope,
  type ProfilePostalCode,
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
        addressText: null,
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
      addressText: null,
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

  /** Applies one write body, treating each collection as a full replacement. */
  private _write(
    before: ShoppingProfile,
    body: WriteShoppingProfileRequest
  ): ShoppingProfile {
    const postalCodes: readonly ProfilePostalCode[] =
      body.postalCodes === undefined
        ? before.postalCodes
        : body.postalCodes.map((entry, position) => ({
            id: `${before.id}-pc-${position}`,
            postalCode: entry.postalCode,
            label: entry.label ?? null,
            position,
          }));

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
      addressText:
        body.addressText === undefined
          ? before.addressText
          : (body.addressText?.trim() ?? '') === ''
            ? null
            : (body.addressText?.trim() ?? null),
      minSavingCents: body.minSavingCents ?? before.minSavingCents,
      postalCodes,
      chains,
    };
  }
}
