import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GenerationScope,
  PROFILE_LIMITS,
  RealtimeEvent,
  type CreateShoppingProfileRequest,
  type ListShoppingProfilesRequest,
  type ProfileGenerationSourceInput,
  type ProfilePostalCodeInput,
  type ProfileScopeSelector,
  type ProfileSupermarketPreferenceInput,
  type ResolveProfileScopesRequest,
  type ShoppingProfileIdRequest,
  type ShoppingProfileListResult,
  type ShoppingProfileView,
  type UpdateShoppingProfileRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import {
  ProfileGenerationSource,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toShoppingProfileView } from './profile.mappers';

/** Postgres unique-violation, raised by the partial index on `isDefault`. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * One sentence for every way a profile fails to resolve (plan 0049, section
 * 1.3). A profile that never existed and one belonging to somebody else must be
 * indistinguishable: answering "forbidden" for the second would confirm that the
 * id names a real profile, and a profile is private (section 5).
 */
const NO_SUCH_PROFILE = 'Shopping profile not found';

/**
 * Shopping profiles (plan 0049), owned by core and keyed by an opaque `userId`.
 *
 * ## The invariants, and where each one lives
 *
 * - **Exactly one default per user.** Half in the database, as the partial
 *   unique index on `("userId") WHERE "isDefault"`, and half here, as the
 *   transactions that clear before they set. The index is the half that makes
 *   {@link ensureProfiles} idempotent under two concurrent first reads.
 * - **Every user has a profile without creating one.** The first read or
 *   resolution that finds none creates it, with `name` null and nothing else
 *   set.
 * - **The last profile cannot be deleted**, and deleting the default promotes
 *   the oldest remaining. Together with the two above, there is never a user
 *   with no profile and never one with two defaults.
 * - **A profile that is not the caller's is not found.** Every read takes the
 *   `userId` from the request the gateway resolved from a verified token, and
 *   every lookup filters on it.
 *
 * ## What it deliberately does not do
 *
 * It does not resolve a postal code to anything. The scopes belong to catalog
 * and move without telling us (section 1.1), so this service answers what the
 * user said and catalog answers what it means today.
 *
 * It does not check that a `supermarketId` names a real chain either. The
 * reference is opaque across a service boundary, exactly like `ListLineItem`'s
 * `itemId`, and a preference naming a chain that has since been deleted is
 * dropped by the resolver rather than blocking the save.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ShoppingProfile)
    private readonly profiles: Repository<ShoppingProfile>,
    @InjectRepository(ProfilePostalCode)
    private readonly postalCodes: Repository<ProfilePostalCode>,
    @InjectRepository(ProfileSupermarketPreference)
    private readonly supermarkets: Repository<ProfileSupermarketPreference>,
    @InjectRepository(ProfileGenerationSource)
    private readonly sources: Repository<ProfileGenerationSource>,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Every profile the caller has, creating the default one on the first call
   * (plan 0049, section 1.3).
   */
  async list(
    req: ListShoppingProfilesRequest
  ): Promise<ShoppingProfileListResult> {
    const rows = await this.ensureProfiles(req.userId);
    return { profiles: await this.viewsFor(rows) };
  }

  async create(
    req: CreateShoppingProfileRequest
  ): Promise<ShoppingProfileView> {
    const existing = await this.ensureProfiles(req.userId);
    if (existing.length >= PROFILE_LIMITS.maxProfiles) {
      throw new ConflictException(
        `You can keep at most ${PROFILE_LIMITS.maxProfiles} shopping profiles`
      );
    }

    const postalCodes = this.checkPostalCodes(req.postalCodes);
    const supermarkets = this.checkSupermarkets(req.supermarkets);
    const sources = this.checkSources(req.generationSources);

    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ShoppingProfile);
      const profile = await repo.save(
        repo.create({
          userId: req.userId,
          name: this.checkName(req.name),
          // Never the default on creation. `ensureProfiles` above guarantees a
          // default already exists, so a new profile taking the flag would
          // silently move it; moving it is `setDefault`, on purpose.
          isDefault: false,
          position: existing.length,
          addressText: this.checkAddress(req.addressText),
          minSavingCents: this.checkSavingCents(req.minSavingCents) ?? 0,
          minSavingPercent: this.checkSavingPercent(req.minSavingPercent),
          generationScope: req.generationScope ?? GenerationScope.ALL,
        })
      );
      await this.writeChildren(manager, profile.id, {
        postalCodes,
        supermarkets,
        sources,
      });
      return profile;
    });

    await this.announce(req.userId);
    return this.viewFor(created);
  }

  /**
   * Edit a profile (plan 0049, section 6).
   *
   * The three collections are **full replacements**: an absent one is left
   * alone, a present one becomes exactly what was sent, and an empty array
   * clears it. Replacing rather than patching is why there is one subject here
   * instead of six, and it is what the page does anyway: it holds the whole list
   * and saves it.
   */
  async update(
    req: UpdateShoppingProfileRequest
  ): Promise<ShoppingProfileView> {
    const profile = await this.load(req.userId, req.profileId);

    const postalCodes =
      req.postalCodes === undefined
        ? undefined
        : this.checkPostalCodes(req.postalCodes);
    const supermarkets =
      req.supermarkets === undefined
        ? undefined
        : this.checkSupermarkets(req.supermarkets);
    const sources =
      req.generationSources === undefined
        ? undefined
        : this.checkSources(req.generationSources);

    const saved = await this.dataSource.transaction(async (manager) => {
      if (req.name !== undefined) {
        profile.name = this.checkName(req.name);
      }
      if (req.addressText !== undefined) {
        profile.addressText = this.checkAddress(req.addressText);
      }
      if (req.minSavingCents !== undefined) {
        profile.minSavingCents = this.checkSavingCents(req.minSavingCents) ?? 0;
      }
      if (req.minSavingPercent !== undefined) {
        profile.minSavingPercent = this.checkSavingPercent(
          req.minSavingPercent
        );
      }
      if (req.generationScope !== undefined) {
        profile.generationScope = req.generationScope;
      }
      const row = await manager.getRepository(ShoppingProfile).save(profile);
      await this.writeChildren(manager, row.id, {
        postalCodes,
        supermarkets,
        sources,
      });
      return row;
    });

    await this.announce(req.userId);
    return this.viewFor(saved);
  }

  /**
   * Move the default (plan 0049, section 1.3).
   *
   * Clear then set, in one transaction and in that order, because the partial
   * unique index would refuse the second statement if the first had not run.
   * Setting the default on the profile that already holds it is a no op that
   * still answers, which is what makes the route safe to retry.
   */
  async setDefault(
    req: ShoppingProfileIdRequest
  ): Promise<ShoppingProfileView> {
    const profile = await this.load(req.userId, req.profileId);

    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ShoppingProfile);
      await repo.update(
        { userId: req.userId, isDefault: true },
        {
          isDefault: false,
        }
      );
      await repo.update({ id: profile.id }, { isDefault: true });
      return repo.findOneOrFail({ where: { id: profile.id } });
    });

    await this.announce(req.userId);
    return this.viewFor(saved);
  }

  /**
   * Delete a profile (plan 0049, section 1.3).
   *
   * Two rules, both here: the **last** profile cannot be deleted, because a user
   * with no profile is a user no catalog read can resolve for; and deleting the
   * default **promotes the oldest remaining**, chosen by creation time rather
   * than by position so that the answer does not depend on an ordering the user
   * can rearrange. The children go with it through the cascade.
   */
  async delete(req: ShoppingProfileIdRequest): Promise<{ id: string }> {
    const profile = await this.load(req.userId, req.profileId);
    const all = await this.profiles.find({ where: { userId: req.userId } });
    if (all.length <= 1) {
      throw new ConflictException(
        'Your last shopping profile cannot be deleted'
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ShoppingProfile);
      await repo.delete({ id: profile.id });
      if (!profile.isDefault) {
        return;
      }
      const heir = await repo.findOne({
        where: { userId: req.userId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      if (heir) {
        await repo.update({ id: heir.id }, { isDefault: true });
      }
    });

    await this.announce(req.userId);
    return { id: profile.id };
  }

  /**
   * What the caller said about where they shop (plan 0049, section 2.1).
   *
   * The gateway's call before a catalog read. With no `profileId` it is the
   * default, created on the spot if there is none, so a read from a brand new
   * account resolves rather than failing on a missing row.
   *
   * It answers a selector and not a scope set, which is the whole point of the
   * split: catalog owns the scopes, and it is catalog that turns "28001" into
   * whichever warehouse serves it this week.
   */
  async resolveScopes(
    req: ResolveProfileScopesRequest
  ): Promise<ProfileScopeSelector> {
    const profile = req.profileId
      ? await this.load(req.userId, req.profileId)
      : await this.defaultProfile(req.userId);

    const [postalCodes, preferences] = await Promise.all([
      this.postalCodes.find({
        where: { profileId: profile.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.supermarkets.find({ where: { profileId: profile.id } }),
    ]);

    const supermarketIds = preferences
      .filter((row) => !row.excluded)
      .map((row) => row.supermarketId);
    const excludedSupermarketIds = preferences
      .filter((row) => row.excluded)
      .map((row) => row.supermarketId);

    return {
      profileId: profile.id,
      postalCodes: postalCodes.map((row) => row.postalCode),
      supermarketIds,
      excludedSupermarketIds,
      // A profile holding only exclusions is empty too: "not DIA" is not a place
      // to shop from, and section 3 answers it the same way as saying nothing.
      empty: postalCodes.length === 0 && supermarketIds.length === 0,
    };
  }

  /**
   * Which zones and lists a generation run should draw from (plan 0049, section
   * 1; consumed by plan 0050, section 2).
   *
   * The counterpart of {@link resolveScopes} for the other half of a profile.
   * That one answers where the caller shops, this one answers what they shop
   * for, and both follow the same rule: with no `profileId` it is the default
   * profile, created on the spot if the user has none, so a run from a brand new
   * account resolves rather than failing on a missing row.
   *
   * A scope of `ALL` answers **no sources at all**, and that is the honest
   * answer rather than an empty one: "every list I can reach" is a question only
   * the caller's access can answer, and access lives in the list tables rather
   * than here. Plan 0050 expands it, which keeps the one definition of a
   * writable list in the module that owns lists.
   */
  async resolveGenerationSources(req: ResolveProfileScopesRequest): Promise<{
    profileId: string;
    scope: GenerationScope;
    sources: { zoneId: string; listId: string | null }[];
  }> {
    const profile = req.profileId
      ? await this.load(req.userId, req.profileId)
      : await this.defaultProfile(req.userId);

    if (profile.generationScope !== GenerationScope.SELECTED) {
      return {
        profileId: profile.id,
        scope: profile.generationScope,
        sources: [],
      };
    }

    const rows = await this.sources.find({
      where: { profileId: profile.id },
      order: { createdAt: 'ASC' },
    });
    return {
      profileId: profile.id,
      scope: profile.generationScope,
      sources: rows.map((row) => ({ zoneId: row.zoneId, listId: row.listId })),
    };
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * The caller's profiles, creating the default when there are none.
   *
   * Idempotent under concurrency, and the concurrency is real: the profile page
   * and a catalog read can both be the first thing a new account does. Two
   * racing inserts both set `isDefault`, the partial unique index refuses the
   * second, and the loser re reads rather than retrying, because by then the
   * winner's row is exactly the row it wanted.
   */
  private async ensureProfiles(userId: string): Promise<ShoppingProfile[]> {
    const rows = await this.readProfiles(userId);
    if (rows.length > 0) {
      return rows;
    }

    try {
      await this.profiles.save(
        this.profiles.create({
          userId,
          name: null,
          isDefault: true,
          position: 0,
        })
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    return this.readProfiles(userId);
  }

  private readProfiles(userId: string): Promise<ShoppingProfile[]> {
    return this.profiles.find({
      where: { userId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  /** The default profile, created if the user has none. */
  private async defaultProfile(userId: string): Promise<ShoppingProfile> {
    const rows = await this.ensureProfiles(userId);
    const chosen = rows.find((row) => row.isDefault) ?? rows[0];
    if (!chosen) {
      // Unreachable: `ensureProfiles` either finds rows or creates one, and the
      // only way past both is a delete landing between the two statements, which
      // the "last profile cannot be deleted" rule forbids. Thrown rather than
      // asserted so the impossible case is an error and not an undefined read.
      throw new NotFoundException(NO_SUCH_PROFILE);
    }
    return chosen;
  }

  /** One profile of this caller's, or not found. Never forbidden (section 1.3). */
  private async load(
    userId: string,
    profileId: string
  ): Promise<ShoppingProfile> {
    const row = await this.profiles.findOne({
      where: { id: profileId, userId },
    });
    if (!row) {
      throw new NotFoundException(NO_SUCH_PROFILE);
    }
    return row;
  }

  private async viewFor(row: ShoppingProfile): Promise<ShoppingProfileView> {
    const [view] = await this.viewsFor([row]);
    return view;
  }

  /** Every child of these profiles in three queries, whatever the page size. */
  private async viewsFor(
    rows: ShoppingProfile[]
  ): Promise<ShoppingProfileView[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const [postalCodes, supermarkets, sources] = await Promise.all([
      this.postalCodes.find({
        where: { profileId: In(ids) },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.supermarkets.find({
        where: { profileId: In(ids) },
        order: { createdAt: 'ASC' },
      }),
      this.sources.find({
        where: { profileId: In(ids) },
        order: { createdAt: 'ASC' },
      }),
    ]);

    return rows.map((row) =>
      toShoppingProfileView(row, {
        postalCodes: postalCodes.filter((c) => c.profileId === row.id),
        supermarkets: supermarkets.filter((s) => s.profileId === row.id),
        generationSources: sources.filter((s) => s.profileId === row.id),
      })
    );
  }

  // --- Writing ---------------------------------------------------------------

  /** Replace whichever of the three collections the request stated. */
  private async writeChildren(
    manager: DataSource['manager'],
    profileId: string,
    next: {
      postalCodes?: ProfilePostalCodeInput[];
      supermarkets?: ProfileSupermarketPreferenceInput[];
      sources?: ProfileGenerationSourceInput[];
    }
  ): Promise<void> {
    if (next.postalCodes) {
      const repo = manager.getRepository(ProfilePostalCode);
      await repo.delete({ profileId });
      await repo.save(
        next.postalCodes.map((input, index) =>
          repo.create({
            profileId,
            postalCode: input.postalCode,
            label: input.label ?? null,
            position: index,
          })
        )
      );
    }
    if (next.supermarkets) {
      const repo = manager.getRepository(ProfileSupermarketPreference);
      await repo.delete({ profileId });
      await repo.save(
        next.supermarkets.map((input) =>
          repo.create({
            profileId,
            supermarketId: input.supermarketId,
            excluded: input.excluded ?? false,
          })
        )
      );
    }
    if (next.sources) {
      const repo = manager.getRepository(ProfileGenerationSource);
      await repo.delete({ profileId });
      await repo.save(
        next.sources.map((input) =>
          repo.create({
            profileId,
            zoneId: input.zoneId,
            listId: input.listId ?? null,
          })
        )
      );
    }
  }

  /**
   * Tell the caller's own sessions, and nobody else's (plan 0049, section 6).
   *
   * The whole list rather than the profile that moved, because every rule this
   * event propagates is about the set: which one is default, how many are left,
   * and what a deleted one was replaced by. It doubles as the gateway's cache
   * invalidation signal, which is why it fires on a rename too.
   */
  private async announce(userId: string): Promise<void> {
    const profiles = await this.viewsFor(await this.readProfiles(userId));
    this.events.emitToUsers(RealtimeEvent.ProfilesChanged, [userId], {
      profiles,
    });
  }

  // --- Validation ------------------------------------------------------------

  /** Trimmed, capped, and an empty name is no name rather than an empty one. */
  private checkName(name: string | null | undefined): string | null {
    if (name === null || name === undefined) {
      return null;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (trimmed.length > PROFILE_LIMITS.nameMaxLength) {
      throw new ValidationException('That profile name is too long', {
        details: { name: `at most ${PROFILE_LIMITS.nameMaxLength} characters` },
      });
    }
    return trimmed;
  }

  private checkAddress(address: string | null | undefined): string | null {
    if (address === null || address === undefined) {
      return null;
    }
    const trimmed = address.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (trimmed.length > PROFILE_LIMITS.addressMaxLength) {
      throw new ValidationException('That address is too long', {
        details: {
          addressText: `at most ${PROFILE_LIMITS.addressMaxLength} characters`,
        },
      });
    }
    return trimmed;
  }

  private checkSavingCents(cents: number | undefined): number | undefined {
    if (cents === undefined) {
      return undefined;
    }
    if (!Number.isInteger(cents) || cents < 0) {
      throw new ValidationException(
        'The saving threshold must be a whole number of cents',
        {
          details: { minSavingCents: 'a whole number of cents, zero or more' },
        }
      );
    }
    return cents;
  }

  private checkSavingPercent(
    percent: number | null | undefined
  ): number | null {
    if (percent === null || percent === undefined) {
      return null;
    }
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new ValidationException(
        'The relative saving floor must be a percentage',
        {
          details: { minSavingPercent: 'a whole percentage between 0 and 100' },
        }
      );
    }
    return percent;
  }

  /**
   * The postal codes, trimmed, capped and deduplicated.
   *
   * Trimmed and **not otherwise normalized**: section 1.1 says the code is
   * stored as it was typed, and a chain that answers on `28001` is the one that
   * decides what a code looks like. Duplicates are dropped rather than refused,
   * because the unique index would turn a client sending the same code twice
   * into a 500 and the user's intent is unambiguous either way.
   */
  private checkPostalCodes(
    inputs: ProfilePostalCodeInput[] | undefined
  ): ProfilePostalCodeInput[] {
    const rows: ProfilePostalCodeInput[] = [];
    const seen = new Set<string>();
    for (const input of inputs ?? []) {
      const code = input.postalCode.trim();
      if (code.length === 0) {
        throw new ValidationException('A postal code cannot be blank', {
          details: { postalCodes: 'each entry needs a code' },
        });
      }
      if (code.length > PROFILE_LIMITS.postalCodeMaxLength) {
        throw new ValidationException('That postal code is too long', {
          details: {
            postalCodes: `at most ${PROFILE_LIMITS.postalCodeMaxLength} characters`,
          },
        });
      }
      if (seen.has(code)) {
        continue;
      }
      seen.add(code);
      const label = input.label?.trim();
      rows.push({
        postalCode: code,
        label: label ? label.slice(0, PROFILE_LIMITS.labelMaxLength) : null,
      });
    }
    if (rows.length > PROFILE_LIMITS.maxPostalCodes) {
      throw new ValidationException(
        `A profile can hold at most ${PROFILE_LIMITS.maxPostalCodes} postal codes`,
        { details: { postalCodes: `at most ${PROFILE_LIMITS.maxPostalCodes}` } }
      );
    }
    return rows;
  }

  /** Deduplicated on the chain, last statement winning: it is a set of chains. */
  private checkSupermarkets(
    inputs: ProfileSupermarketPreferenceInput[] | undefined
  ): ProfileSupermarketPreferenceInput[] {
    const byChain = new Map<string, ProfileSupermarketPreferenceInput>();
    for (const input of inputs ?? []) {
      byChain.set(input.supermarketId, {
        supermarketId: input.supermarketId,
        excluded: input.excluded ?? false,
      });
    }
    if (byChain.size > PROFILE_LIMITS.maxSupermarketPreferences) {
      throw new ValidationException('Too many supermarket preferences', {
        details: {
          supermarkets: `at most ${PROFILE_LIMITS.maxSupermarketPreferences}`,
        },
      });
    }
    return [...byChain.values()];
  }

  private checkSources(
    inputs: ProfileGenerationSourceInput[] | undefined
  ): ProfileGenerationSourceInput[] {
    const byKey = new Map<string, ProfileGenerationSourceInput>();
    for (const input of inputs ?? []) {
      const listId = input.listId ?? null;
      byKey.set(`${input.zoneId}:${listId ?? ''}`, {
        zoneId: input.zoneId,
        listId,
      });
    }
    if (byKey.size > PROFILE_LIMITS.maxGenerationSources) {
      throw new ValidationException('Too many generation sources', {
        details: {
          generationSources: `at most ${PROFILE_LIMITS.maxGenerationSources}`,
        },
      });
    }
    return [...byKey.values()];
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as { driverError?: { code?: string } }).driverError?.code ===
      PG_UNIQUE_VIOLATION
  );
}
