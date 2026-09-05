import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DEFAULT_POSTAL_CODE_COUNTRY,
  GenerationScope,
  PROFILE_LIMITS,
  ProfilePostalCodeSource,
  RealtimeEvent,
  type AddProfilePostalCodeRequest,
  type CreateShoppingProfileRequest,
  type ListShoppingProfilesRequest,
  type PostalCodeDistanceView,
  type ProfileGenerationSourceInput,
  type ProfileLocationPreferenceInput,
  type ProfilePostalCodeInput,
  type ProfileScopeSelector,
  type ProfileSupermarketPreferenceInput,
  type RemoveProfilePostalCodeRequest,
  type ResolvedPostalCodeView,
  type ResolveProfilePostalCodeRequest,
  type ResolveProfileScopesRequest,
  type SetProfileLocationPreferencesRequest,
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
import type { CoreConfig } from '../config/app-config';
import { radiusFor } from '../config/nearby-radius';
import {
  ProfileGenerationSource,
  ProfileLocationPreference,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  codeKey,
  derivedPostalCodes,
  expandingParents,
  type PostalCodeRef,
} from './derived-postal-codes';
import { PostalCodeClient } from './postal-code.client';
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
  /** How far a code reaches for its neighbours, per country (plan 0062, section 4). */
  private readonly nearbyRadius: CoreConfig['nearbyRadius'];

  /** How far a device may be from the code it is placed in (velista plan 0058). */
  private readonly locationMaxDistanceMetres: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ShoppingProfile)
    private readonly profiles: Repository<ShoppingProfile>,
    @InjectRepository(ProfilePostalCode)
    private readonly postalCodes: Repository<ProfilePostalCode>,
    @InjectRepository(ProfileSupermarketPreference)
    private readonly supermarkets: Repository<ProfileSupermarketPreference>,
    @InjectRepository(ProfileLocationPreference)
    private readonly locations: Repository<ProfileLocationPreference>,
    @InjectRepository(ProfileGenerationSource)
    private readonly sources: Repository<ProfileGenerationSource>,
    private readonly events: CoreEventsPublisher,
    private readonly geography: PostalCodeClient,
    config: ConfigService
  ) {
    const core = config.getOrThrow<CoreConfig>('core');
    this.nearbyRadius = core.nearbyRadius;
    this.locationMaxDistanceMetres = core.locationMaxDistanceMetres;
  }

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

    const { profile: created, added } = await this.dataSource.transaction(
      async (manager) => {
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
        const added = await this.writeChildren(manager, profile.id, {
          postalCodes,
          supermarkets,
          sources,
        });
        return { profile, added };
      }
    );

    this.announceCodes(added);
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

    const { profile: saved, added } = await this.dataSource.transaction(
      async (manager) => {
        if (req.name !== undefined) {
          profile.name = this.checkName(req.name);
        }
        if (req.addressText !== undefined) {
          profile.addressText = this.checkAddress(req.addressText);
        }
        if (req.minSavingCents !== undefined) {
          profile.minSavingCents =
            this.checkSavingCents(req.minSavingCents) ?? 0;
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
        const added = await this.writeChildren(manager, row.id, {
          postalCodes,
          supermarkets,
          sources,
        });
        return { profile: row, added };
      }
    );

    this.announceCodes(added);
    await this.announce(req.userId);
    return this.viewFor(saved);
  }

  /**
   * Add one postal code, optionally with its neighbours (plan 0062, section 2).
   *
   * A row at a time, beside the replacement collection on {@link update}, and the
   * one a client that renders derived rows has to use. The replacement states the
   * profile's **own** codes, so a page that read a profile with derived rows and
   * sent the whole list back would promote every one of them to the user's; that
   * is not what rendering a list and saving it means, and this is the surface that
   * does not make it possible.
   *
   * A code the profile already holds is not an error. Typing one that is already
   * derived **promotes** it (section 3.2): the row becomes the user's, its
   * suppression clears, and `expandNearby` takes whatever the request asked for.
   * That is also the way back from having suppressed a neighbour, and it returns
   * as theirs rather than as ours, which is a more honest description of what
   * happened.
   */
  async addPostalCode(
    req: AddProfilePostalCodeRequest
  ): Promise<ShoppingProfileView> {
    const profile = await this.load(req.userId, req.profileId);
    const [input] = this.checkPostalCodes([
      {
        postalCode: req.postalCode,
        label: req.label,
        country: req.country,
        source: req.source,
        expandNearby: req.expandNearby,
      },
    ]);

    const added = await this.dataSource.transaction(async (manager) => {
      const before = await this.readCodes(manager, profile.id);
      const own = before.filter(
        (row) => row.source !== ProfilePostalCodeSource.NEARBY
      );
      const existing = own.find((row) => row.postalCode === input.postalCode);
      if (!existing && own.length >= PROFILE_LIMITS.maxPostalCodes) {
        throw new ConflictException(
          `A profile can hold at most ${PROFILE_LIMITS.maxPostalCodes} postal codes`
        );
      }

      const repo = manager.getRepository(ProfilePostalCode);
      const row =
        before.find((r) => r.postalCode === input.postalCode) ??
        repo.create({
          profileId: profile.id,
          postalCode: input.postalCode,
          position: own.length,
        });
      row.label = input.label ?? row.label ?? null;
      row.country = input.country ?? DEFAULT_POSTAL_CODE_COUNTRY;
      row.source = input.source ?? ProfilePostalCodeSource.TYPED;
      row.expandNearby = input.expandNearby ?? false;
      row.suppressed = false;
      await repo.save(row);

      return this.recomputeDerived(manager, profile.id, before);
    });

    this.announceCodes(added);
    await this.announce(req.userId);
    return this.viewFor(profile);
  }

  /**
   * Remove one postal code (plan 0062, sections 2 and 3.1).
   *
   * **Whether it deletes or suppresses follows from the row's own source**, which
   * the server knows and the client should not have to. A `TYPED` or `DEVICE` row
   * is deleted and the recompute prunes whatever it was justifying. A `NEARBY`
   * row is suppressed instead, because a pure recompute would put a deleted one
   * straight back and the user would remove it forever.
   *
   * Removing a code the profile does not hold answers rather than failing: the
   * caller wanted it gone, and it is.
   */
  async removePostalCode(
    req: RemoveProfilePostalCodeRequest
  ): Promise<ShoppingProfileView> {
    const profile = await this.load(req.userId, req.profileId);
    const postalCode = req.postalCode.trim();

    const added = await this.dataSource.transaction(async (manager) => {
      const before = await this.readCodes(manager, profile.id);
      const row = before.find((r) => r.postalCode === postalCode);
      if (!row) {
        return [];
      }
      const repo = manager.getRepository(ProfilePostalCode);
      if (row.source === ProfilePostalCodeSource.NEARBY) {
        row.suppressed = true;
        await repo.save(row);
      } else {
        await repo.delete({ id: row.id });
      }
      // A removal can still leave a code behind: deleting a code of the user's
      // own that another parent also reaches puts it back as a `NEARBY` row. It
      // was on the profile before and it is on the profile after, so the diff
      // announces nothing, which is the right answer rather than a lucky one.
      return this.recomputeDerived(manager, profile.id, before);
    });

    this.announceCodes(added);
    await this.announce(req.userId);
    return this.viewFor(profile);
  }

  /**
   * Which postal code a device's point is in (`apps/velista/plans/0058`,
   * section 3).
   *
   * **The one profile message that writes nothing.** It touches no row, names no
   * profile and emits no event: the coordinates arrive, catalog answers a code
   * from the table it ships, and the answer goes back. Nothing keeps the point,
   * which is the whole of section 3.3 and the reason the screen may promise
   * before the browser's prompt that we keep the code and not the position.
   *
   * It is authenticated all the same, and that is not a contradiction. Signing in
   * is what stops this being a public geocoder (plan 0060, section 7); it is not a
   * claim that the caller's account is involved in the answer.
   *
   * **Null is an answer.** A point further from every centroid than the configured
   * distance is "we don't know" rather than the nearest code anyway, because the
   * table holds centroids and not boundaries and the caller is about to show what
   * comes back to a person as a fact about where they live.
   */
  async resolvePostalCode(
    req: ResolveProfilePostalCodeRequest
  ): Promise<ResolvedPostalCodeView> {
    const country = this.checkCountry(req.country);
    const postalCode = await this.geography.nearest(
      country,
      req.latitude,
      req.longitude,
      this.locationMaxDistanceMetres
    );

    return { country, postalCode };
  }

  /**
   * Say what this profile thinks of several shops at once (plan 0064, section
   * 5).
   *
   * **A partial write, and the one place this axis parts company with the chain
   * preferences on {@link update}.** Those are a replacement, which suits a list
   * the page holds in full; a profile's shops run to hundreds and a screen holds
   * a screenful, so replacing would make one toggle require the client to send
   * every shop it has ever seen and an incomplete send would silently un exclude
   * the rest. Shops this call does not name keep whatever they had.
   *
   * **Set and clear are the same call.** Absence means included, so a row saying
   * `excluded: false` and no row at all describe the same profile; switching a
   * shop back on therefore deletes its row rather than storing a fact worth
   * nothing. The unique index makes the write idempotent under a retry.
   *
   * It does not check that a `supermarketLocationId` names a real shop, for the
   * same reason the chain preference does not check its chain: the reference is
   * opaque across a service boundary, and a preference naming a shop catalog has
   * since deleted is ignored by the resolver rather than blocking the save.
   */
  async setLocationPreferences(
    req: SetProfileLocationPreferencesRequest
  ): Promise<ShoppingProfileView> {
    const profile = await this.load(req.userId, req.profileId);
    const stated = this.checkLocations(req.locations);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProfileLocationPreference);
      const existing = await repo.find({ where: { profileId: profile.id } });

      const cleared = stated
        .filter((input) => !input.excluded)
        .map((input) => input.supermarketLocationId);
      const gone = existing.filter((row) =>
        cleared.includes(row.supermarketLocationId)
      );
      if (gone.length > 0) {
        await repo.delete({ id: In(gone.map((row) => row.id)) });
      }

      const excluded = stated.filter((input) => input.excluded);
      if (excluded.length === 0) {
        return;
      }

      // The cap counts what the profile would hold afterwards rather than what
      // this request states: a client toggling one more shop on a profile that
      // is already at the limit is the case the cap exists for, and counting
      // only the request would never see it.
      const kept = existing.filter(
        (row) => !gone.some((row2) => row2.id === row.id)
      );
      const added = excluded.filter(
        (input) =>
          !kept.some(
            (row) => row.supermarketLocationId === input.supermarketLocationId
          )
      );
      if (kept.length + added.length > PROFILE_LIMITS.maxLocationPreferences) {
        throw new ConflictException(
          `A profile can hold at most ${PROFILE_LIMITS.maxLocationPreferences} shop preferences`
        );
      }

      await repo.save(
        excluded.map((input) => {
          const row =
            kept.find(
              (r) => r.supermarketLocationId === input.supermarketLocationId
            ) ??
            repo.create({
              profileId: profile.id,
              supermarketLocationId: input.supermarketLocationId,
            });
          row.excluded = true;
          return row;
        })
      );
    });

    await this.announce(req.userId);
    return this.viewFor(profile);
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

    const [postalCodes, preferences, locations] = await Promise.all([
      // Suppressed rows are not places this person shops (plan 0062, section
      // 3.1), so they are absent here exactly as they are absent from the view.
      this.postalCodes.find({
        where: { profileId: profile.id, suppressed: false },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.supermarkets.find({ where: { profileId: profile.id } }),
      this.locations.find({ where: { profileId: profile.id, excluded: true } }),
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
      // The finer axis (plan 0064, section 3). Only the refusals travel: there
      // is no included counterpart, because a blacklist can only take away.
      excludedSupermarketLocationIds: locations.map(
        (row) => row.supermarketLocationId
      ),
      // A profile holding only exclusions is empty too: "not DIA" is not a place
      // to shop from, and section 3 answers it the same way as saying nothing.
      // Refusing one shop is no more a place than refusing a brand, so the
      // finer axis does not enter into this either.
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

  /**
   * The profile a run is priced against, resolved once when the run is composed
   * (plan 0078, section 3).
   *
   * The same two step ladder {@link resolveGenerationSources} starts with, and
   * deliberately only those two steps: a named profile is loaded through
   * {@link load}, so a stranger's id is refused before anything is written and
   * a profile the caller does not own can never price a run; otherwise it is
   * the caller's default, which `ensureProfiles` creates for an account that
   * has none. So the answer is never null for a run composed after that plan.
   *
   * It stops short of the source resolution below because pricing does not read
   * a profile's sources. Plan 0050 section 2 still lets an explicit `sources`
   * request short circuit them, and this call leaves that order untouched.
   */
  async pricingProfileId(
    userId: string,
    profileId?: string | null
  ): Promise<string> {
    const profile = profileId
      ? await this.load(userId, profileId)
      : await this.defaultProfile(userId);
    return profile.id;
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

  /** Every child of these profiles in four queries, whatever the page size. */
  private async viewsFor(
    rows: ShoppingProfile[]
  ): Promise<ShoppingProfileView[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const [postalCodes, supermarkets, locations, sources] = await Promise.all([
      // A suppressed code is absent rather than present with a flag (plan 0062,
      // section 6): no client has a reason to render one, and an absent row
      // cannot be shown by accident.
      this.postalCodes.find({
        where: { profileId: In(ids), suppressed: false },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.supermarkets.find({
        where: { profileId: In(ids) },
        order: { createdAt: 'ASC' },
      }),
      // Every row, excluded or not. A row saying `false` is one this service
      // would have deleted, so in practice these are the exclusions; reading
      // them unfiltered keeps the view a description of the table rather than an
      // interpretation of it (plan 0064, section 1).
      this.locations.find({
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
        locations: locations.filter((l) => l.profileId === row.id),
        generationSources: sources.filter((s) => s.profileId === row.id),
      })
    );
  }

  // --- Writing ---------------------------------------------------------------

  /**
   * Replace whichever of the three collections the request stated, and answer
   * the postal codes that were not on this profile before.
   *
   * `postalCodes` is **the profile's own codes** and not every row it holds (plan
   * 0062). The derived ones are ours: the client never states them, a client that
   * omitted them would lose nothing, and a client that echoed them back would
   * promote them. After the user's half is written the derived half is recomputed
   * from scratch, in this same transaction.
   */
  private async writeChildren(
    manager: DataSource['manager'],
    profileId: string,
    next: {
      postalCodes?: ProfilePostalCodeInput[];
      supermarkets?: ProfileSupermarketPreferenceInput[];
      sources?: ProfileGenerationSourceInput[];
    }
  ): Promise<PostalCodeRef[]> {
    let added: PostalCodeRef[] = [];
    if (next.postalCodes) {
      const repo = manager.getRepository(ProfilePostalCode);
      const before = await this.readCodes(manager, profileId);

      // Only the user's own rows are replaced. A derived row the request does
      // not mention is left to the recompute, which is the only thing that gets
      // to decide whether it still belongs.
      const stated = new Set(next.postalCodes.map((i) => i.postalCode));
      const gone = before.filter(
        (row) =>
          row.source !== ProfilePostalCodeSource.NEARBY &&
          !stated.has(row.postalCode)
      );
      if (gone.length > 0) {
        await repo.delete({ id: In(gone.map((row) => row.id)) });
      }

      const rows = next.postalCodes.map((input, index) => {
        // Naming a code that is already derived promotes it (section 3.2): the
        // unique index means the insert would otherwise simply fail, and
        // promotion is the honest reading of somebody typing a code we guessed.
        const row =
          before.find((r) => r.postalCode === input.postalCode) ??
          repo.create({ profileId, postalCode: input.postalCode });
        row.label = input.label ?? null;
        row.country = input.country ?? DEFAULT_POSTAL_CODE_COUNTRY;
        row.source = input.source ?? ProfilePostalCodeSource.TYPED;
        row.expandNearby = input.expandNearby ?? false;
        row.suppressed = false;
        row.position = index;
        return row;
      });
      if (rows.length > 0) {
        await repo.save(rows);
      }

      added = await this.recomputeDerived(manager, profileId, before);
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
    return added;
  }

  /** Every postal code row on a profile, suppressed ones included. */
  private readCodes(
    manager: DataSource['manager'],
    profileId: string
  ): Promise<ProfilePostalCode[]> {
    return manager.getRepository(ProfilePostalCode).find({
      where: { profileId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Make the derived rows equal `derived(profile)` again (plan 0062, section 3).
   *
   * Run after **any** write to a profile's postal codes, in the same transaction,
   * and computed in full rather than edited: a shared neighbour, an orphan and a
   * changed radius are all bugs an incremental scheme has and this does not, and
   * `derived-postal-codes.ts` carries the reasoning.
   *
   * Three properties worth keeping when this is edited:
   *
   * - **Suppression survives it.** A derived row the user removed is still a
   *   derived row; it keeps its flag and disappears from every read. Erasing it
   *   here would put the code back on the next unrelated add, and the user would
   *   remove it forever (section 3.1).
   * - **A suppressed row whose last justifying parent went away is deleted**,
   *   like any other derived row that left the set. Nothing accumulates.
   * - **One lookup per expanding parent and no more.** It is a local query in
   *   catalog over a table shipped with the image, so the cost is a broker round
   *   trip rather than a third party, but the count is still the thing that grows
   *   with what the user asked for.
   *
   * Answers the codes that were not on the profile in `before`, which is what
   * section 5 announces.
   */
  private async recomputeDerived(
    manager: DataSource['manager'],
    profileId: string,
    before: readonly ProfilePostalCode[]
  ): Promise<PostalCodeRef[]> {
    const repo = manager.getRepository(ProfilePostalCode);
    const rows = await this.readCodes(manager, profileId);

    const neighbours = new Map<string, PostalCodeDistanceView[]>();
    for (const parent of expandingParents(rows)) {
      neighbours.set(
        codeKey(parent),
        await this.geography.nearby(
          parent.country,
          parent.postalCode,
          radiusFor(this.nearbyRadius, parent.country)
        )
      );
    }

    const wanted = derivedPostalCodes(
      rows,
      neighbours,
      PROFILE_LIMITS.maxNearbyPerPostalCode
    );
    const wantedKeys = new Set(wanted.map(codeKey));

    const derivedRows = rows.filter(
      (row) => row.source === ProfilePostalCodeSource.NEARBY
    );
    const stale = derivedRows.filter((row) => !wantedKeys.has(codeKey(row)));
    if (stale.length > 0) {
      await repo.delete({ id: In(stale.map((row) => row.id)) });
    }

    const kept = new Map(derivedRows.map((row) => [codeKey(row), row]));
    let position = rows.filter(
      (row) => row.source !== ProfilePostalCodeSource.NEARBY
    ).length;
    const write = wanted.map((ref) => {
      const row =
        kept.get(codeKey(ref)) ??
        repo.create({
          profileId,
          postalCode: ref.postalCode,
          country: ref.country,
          label: null,
          source: ProfilePostalCodeSource.NEARBY,
          // A derived code never expands further, or the set would be a
          // transitive closure walking the country two kilometres at a time.
          expandNearby: false,
          suppressed: false,
        });
      row.position = position++;
      return row;
    });
    if (write.length > 0) {
      await repo.save(write);
    }

    const known = new Set(before.map(codeKey));
    const own = rows
      .filter((row) => row.source !== ProfilePostalCodeSource.NEARBY)
      .map((row) => ({ country: row.country, postalCode: row.postalCode }));
    const added = new Map<string, PostalCodeRef>();
    for (const ref of [...own, ...wanted]) {
      const key = codeKey(ref);
      if (!known.has(key)) {
        added.set(key, ref);
      }
    }
    return [...added.values()];
  }

  /**
   * Say which codes arrived, and never wait for the answer (plan 0062, section
   * 5).
   *
   * Outside the transaction and after it, so a broker that is slow or down costs
   * the profile save nothing. Grouped by country because a discovery run is asked
   * about a place, and "postal code 08001" without one names two.
   */
  private announceCodes(added: readonly PostalCodeRef[]): void {
    const byCountry = new Map<string, string[]>();
    for (const ref of added) {
      const codes = byCountry.get(ref.country) ?? [];
      codes.push(ref.postalCode);
      byCountry.set(ref.country, codes);
    }
    for (const [country, codes] of byCountry) {
      this.geography.announceAdded(country, codes);
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
   *
   * **`NEARBY` is refused rather than ignored** (plan 0062, section 2). It is not
   * a thing the user says, it is a thing we concluded, and a request that states
   * it has misunderstood the model badly enough that quietly rewriting it to
   * `TYPED` would hide the mistake rather than fix it. The cap counts these rows
   * and only these rows: they are the user's own codes, and the derived ones are
   * a set nobody sized.
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
      if (
        input.source !== undefined &&
        input.source !== ProfilePostalCodeSource.TYPED &&
        input.source !== ProfilePostalCodeSource.DEVICE
      ) {
        throw new ValidationException(
          'A nearby postal code is one we worked out, not one you can add',
          { details: { postalCodes: 'source must be TYPED or DEVICE' } }
        );
      }
      if (seen.has(code)) {
        continue;
      }
      seen.add(code);
      const label = input.label?.trim();
      rows.push({
        postalCode: code,
        label: label ? label.slice(0, PROFILE_LIMITS.labelMaxLength) : null,
        country: this.checkCountry(input.country),
        source: input.source ?? ProfilePostalCodeSource.TYPED,
        expandNearby: input.expandNearby ?? false,
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

  /**
   * Two letters, lowercase, or the one country we ship (plan 0062, section 1).
   *
   * Lowercased rather than refused for case, because the centroid table stores
   * `es` and a client sending `ES` means the same country. A country we hold no
   * centroids for is not refused either: it costs the user their neighbours and
   * nothing else, and telling somebody their country does not exist because our
   * dataset stops at the Pyrenees would be a worse answer than an empty
   * expansion.
   */
  private checkCountry(country: string | undefined): string {
    const value = (country ?? DEFAULT_POSTAL_CODE_COUNTRY).trim().toLowerCase();
    if (value.length !== 2) {
      throw new ValidationException('That is not a country code', {
        details: { country: 'two letters, ISO 3166-1 alpha-2' },
      });
    }
    return value;
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

  /**
   * Deduplicated on the shop, last statement winning: it is a set of shops, and
   * a client that toggled the same row twice before saving means the second one.
   *
   * No cap here, unlike its chain sibling: the request states a delta rather
   * than the whole set, so the number that matters is what the profile ends up
   * holding, which only the write can know (plan 0064, section 5).
   */
  private checkLocations(
    inputs: ProfileLocationPreferenceInput[] | undefined
  ): Required<ProfileLocationPreferenceInput>[] {
    const byLocation = new Map<
      string,
      Required<ProfileLocationPreferenceInput>
    >();
    for (const input of inputs ?? []) {
      const id = input.supermarketLocationId?.trim();
      if (!id) {
        throw new ValidationException('A shop preference needs a shop', {
          details: { locations: 'each entry needs a supermarketLocationId' },
        });
      }
      byLocation.set(id, {
        supermarketLocationId: id,
        excluded: input.excluded ?? false,
      });
    }
    return [...byLocation.values()];
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
