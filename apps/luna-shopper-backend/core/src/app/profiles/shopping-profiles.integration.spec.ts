import type { ConfigService } from '@nestjs/config';
import {
  GenerationScope,
  ProfilePostalCodeSource,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CORE_ENTITIES,
  ProfileGenerationSource,
  ProfileLocationPreference,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { PostalCodeClient } from './postal-code.client';
import { ProfileService } from './profile.service';

/**
 * Shopping profiles against real Postgres (plan 0049, section 9).
 *
 * Three of this plan's rules are the database's and can only be proven here:
 *
 * - **the migrations ran**, creating five tables and, crucially, the partial
 *   unique index that the rest depends on;
 * - **the lazy default is idempotent under concurrency**, which is the exit
 *   criterion phrased as "it survives being listed twice concurrently". A mocked
 *   repository has no constraint to lose the race against, so it can only ever
 *   prove that the code path exists;
 * - **the children cascade** when a profile is deleted.
 *
 * Runs only with `LUNA_INTEGRATION=1` against the compose stack's core database,
 * after `nx run luna-shopper-backend-core:migration:run`.
 */
describeIntegration('shopping profiles (real Postgres)', () => {
  let dataSource: DataSource;
  let profiles: ProfileService;

  const events = {
    emitToUsers: jest.fn(),
    emit: jest.fn(),
    emitTo: jest.fn(),
  } as unknown as CoreEventsPublisher;

  /**
   * Catalog is not up here, and the neighbours it would answer are not what this
   * file proves: the geography is arithmetic over a shipped table and is covered
   * by `postal-code.service.spec.ts`. What this stub lets through is the half
   * that is the database's — the columns, the enum type, the unique index the
   * promotion in section 3.2 leans on, and the cascade.
   */
  const neighbours = new Map<string, string[]>();
  const geography = {
    nearby: jest.fn(async (_country: string, postalCode: string) =>
      (neighbours.get(postalCode) ?? []).map((code, index) => ({
        postalCode: code,
        distanceMetres: (index + 1) * 100,
      }))
    ),
    announceAdded: jest.fn(),
  } as unknown as PostalCodeClient;

  const config = {
    getOrThrow: () => ({
      nearbyRadius: { defaultMetres: 2000, byCountry: {} },
    }),
  } as unknown as ConfigService;

  /** A fresh user per test, so parallel runs and reruns never collide. */
  const newUser = () => randomUUID();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    profiles = new ProfileService(
      dataSource,
      dataSource.getRepository(ShoppingProfile),
      dataSource.getRepository(ProfilePostalCode),
      dataSource.getRepository(ProfileSupermarketPreference),
      dataSource.getRepository(ProfileLocationPreference),
      dataSource.getRepository(ProfileGenerationSource),
      events,
      geography,
      config
    );
  });

  beforeEach(() => {
    neighbours.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('has the five tables the migrations create', async () => {
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(
      rows.map((r: { table_name: string }) => r.table_name)
    );
    for (const table of [
      'shopping_profiles',
      'profile_postal_codes',
      'profile_supermarket_preferences',
      // Plan 0064's, beside the chain preferences rather than instead of them.
      'profile_location_preferences',
      'profile_generation_sources',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('enforces one default per user with a partial unique index', async () => {
    const indexes = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'shopping_profiles'
         AND indexname = 'uq_shopping_profiles_default'`
    );
    expect(indexes).toHaveLength(1);
    // Partial and unique, both of them load bearing: unique is the invariant,
    // and the predicate is what lets a user hold nine non default profiles.
    expect(indexes[0].indexdef).toMatch(/UNIQUE/i);
    expect(indexes[0].indexdef).toMatch(/WHERE "isDefault"/i);
  });

  it('constrains "the whole zone" as tightly as one list within it', async () => {
    // Two partial indexes rather than one over three columns, because Postgres
    // treats nulls as distinct and `(profile, zone, null)` would otherwise be
    // insertable twice.
    const indexes = await dataSource.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'profile_generation_sources'`
    );
    const names = new Set(
      indexes.map((row: { indexname: string }) => row.indexname)
    );
    expect(names.has('uq_profile_generation_source_list')).toBe(true);
    expect(names.has('uq_profile_generation_source_zone')).toBe(true);
  });

  it('creates the default profile on a first read, unnamed', async () => {
    const userId = newUser();

    const { profiles: rows } = await profiles.list({ userId });

    expect(rows).toHaveLength(1);
    expect(rows[0].isDefault).toBe(true);
    expect(rows[0].name).toBeNull();
    expect(rows[0].generationScope).toBe(GenerationScope.ALL);
    expect(rows[0].minSavingCents).toBe(0);
  });

  it('creates exactly one when two reads race', async () => {
    const userId = newUser();

    // The exit criterion: "it survives being listed twice concurrently". Both
    // calls find no profile, both insert one with isDefault set, and the partial
    // unique index refuses the loser, which re reads instead of retrying.
    const [first, second] = await Promise.all([
      profiles.list({ userId }),
      profiles.list({ userId }),
    ]);

    expect(first.profiles).toHaveLength(1);
    expect(second.profiles).toHaveLength(1);
    expect(first.profiles[0].id).toBe(second.profiles[0].id);

    const stored = await dataSource
      .getRepository(ShoppingProfile)
      .count({ where: { userId } });
    expect(stored).toBe(1);
  });

  it('survives a resolution racing a listing on a brand new account', async () => {
    const userId = newUser();

    const [selector, listed] = await Promise.all([
      profiles.resolveScopes({ userId }),
      profiles.list({ userId }),
    ]);

    expect(selector.profileId).toBe(listed.profiles[0].id);
    expect(selector.empty).toBe(true);
  });

  it('stores a postal code exactly as it was typed, and reads it back', async () => {
    const userId = newUser();
    const { profiles: rows } = await profiles.list({ userId });

    const saved = await profiles.update({
      userId,
      profileId: rows[0].id,
      name: '  Home  ',
      addressText: 'Calle Mayor 12',
      minSavingCents: 150,
      minSavingPercent: 5,
      postalCodes: [
        { postalCode: '28001', label: 'home' },
        // Accepted and flagged, never rejected: coverage is a property of our
        // data, not of the user's address (section 5).
        { postalCode: '99999', label: null },
      ],
      supermarkets: [{ supermarketId: randomUUID(), excluded: true }],
    });

    expect(saved.name).toBe('Home');
    expect(saved.postalCodes.map((row) => row.postalCode)).toEqual([
      '28001',
      '99999',
    ]);
    expect(saved.postalCodes.map((row) => row.position)).toEqual([0, 1]);
    expect(saved.minSavingCents).toBe(150);
    expect(saved.minSavingPercent).toBe(5);

    const selector = await profiles.resolveScopes({ userId });
    expect(selector.postalCodes).toEqual(['28001', '99999']);
    expect(selector.supermarketIds).toEqual([]);
    expect(selector.excludedSupermarketIds).toHaveLength(1);
    // A profile holding only exclusions would be empty; this one has codes.
    expect(selector.empty).toBe(false);
  });

  it('replaces a collection rather than appending to it', async () => {
    const userId = newUser();
    const { profiles: rows } = await profiles.list({ userId });

    await profiles.update({
      userId,
      profileId: rows[0].id,
      postalCodes: [{ postalCode: '28001' }],
    });
    const replaced = await profiles.update({
      userId,
      profileId: rows[0].id,
      postalCodes: [{ postalCode: '41001' }],
    });

    expect(replaced.postalCodes.map((row) => row.postalCode)).toEqual([
      '41001',
    ]);

    const cleared = await profiles.update({
      userId,
      profileId: rows[0].id,
      postalCodes: [],
    });
    expect(cleared.postalCodes).toEqual([]);
  });

  it('deletes a profile’s children with it', async () => {
    const userId = newUser();
    const { profiles: rows } = await profiles.list({ userId });
    const extra = await profiles.create({
      userId,
      name: 'Office',
      postalCodes: [{ postalCode: '41001' }],
      generationSources: [{ zoneId: randomUUID(), listId: null }],
    });
    await profiles.setLocationPreferences({
      userId,
      profileId: extra.id,
      locations: [{ supermarketLocationId: randomUUID(), excluded: true }],
    });

    await profiles.delete({ userId, profileId: extra.id });

    const orphans = await dataSource
      .getRepository(ProfilePostalCode)
      .count({ where: { profileId: extra.id } });
    const sources = await dataSource
      .getRepository(ProfileGenerationSource)
      .count({ where: { profileId: extra.id } });
    // Plan 0064's exit criterion, and only a real database can answer it: the
    // cascade is a foreign key rather than anything the service does.
    const shops = await dataSource
      .getRepository(ProfileLocationPreference)
      .count({ where: { profileId: extra.id } });
    expect(orphans).toBe(0);
    expect(sources).toBe(0);
    expect(shops).toBe(0);
    // And the default is untouched, because it was not the one deleted.
    const left = await profiles.list({ userId });
    expect(left.profiles.map((row) => row.id)).toEqual([rows[0].id]);
    expect(left.profiles[0].isDefault).toBe(true);
  });

  it('moves the default, and promotes when the default is deleted', async () => {
    const userId = newUser();
    const { profiles: rows } = await profiles.list({ userId });
    const second = await profiles.create({ userId, name: 'Office' });
    const third = await profiles.create({ userId, name: 'August' });

    const moved = await profiles.setDefault({
      userId,
      profileId: third.id,
    });
    expect(moved.isDefault).toBe(true);
    const afterMove = await profiles.list({ userId });
    expect(afterMove.profiles.filter((row) => row.isDefault)).toHaveLength(1);

    await profiles.delete({ userId, profileId: third.id });
    const afterDelete = await profiles.list({ userId });
    // The oldest remaining, which is the one created first.
    expect(afterDelete.profiles.find((row) => row.isDefault)?.id).toBe(
      rows[0].id
    );
    expect(afterDelete.profiles.map((row) => row.id).sort()).toEqual(
      [rows[0].id, second.id].sort()
    );
  });

  it('refuses to delete the last profile, whatever else was deleted first', async () => {
    const userId = newUser();
    const { profiles: rows } = await profiles.list({ userId });

    await expect(
      profiles.delete({ userId, profileId: rows[0].id })
    ).rejects.toThrow();

    const left = await profiles.list({ userId });
    expect(left.profiles).toHaveLength(1);
  });

  it('does not show one user another user’s profile', async () => {
    const owner = newUser();
    const stranger = newUser();
    const { profiles: mine } = await profiles.list({ userId: owner });

    await expect(
      profiles.resolveScopes({ userId: stranger, profileId: mine[0].id })
    ).rejects.toThrow();

    const theirs = await profiles.list({ userId: stranger });
    expect(theirs.profiles.map((row) => row.id)).not.toContain(mine[0].id);
  });

  /**
   * The database's half of plan 0062: the four columns, the enum type, and the
   * unique index that turns "type a code we already derived" from a failed insert
   * into a promotion. The recompute's arithmetic is unit tested; what needs real
   * Postgres is that the constraint it relies on is the one that is actually
   * there.
   */
  describe('a postal code brings its neighbours (plan 0062)', () => {
    it('gave every existing row a source of TYPED and the flags off', async () => {
      const columns = await dataSource.query(
        `SELECT column_name, column_default, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'profile_postal_codes'
            AND column_name IN ('country', 'source', 'expandNearby', 'suppressed')`
      );
      expect(columns).toHaveLength(4);
      for (const column of columns as { is_nullable: string }[]) {
        expect(column.is_nullable).toBe('NO');
      }
      const source = (
        columns as { column_name: string; column_default: string }[]
      ).find((c) => c.column_name === 'source');
      expect(source?.column_default).toContain('TYPED');
    });

    it('keeps the unique index that makes typing a derived code a promotion', async () => {
      const indexes = await dataSource.query(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'profile_postal_codes'
            AND indexname = 'uq_profile_postal_code'`
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0].indexdef).toMatch(/UNIQUE/i);
    });

    it('writes the parent and its neighbours, then promotes one that is typed', async () => {
      const userId = newUser();
      const { profiles: rows } = await profiles.list({ userId });
      neighbours.set('14010', ['14004', '14005']);

      const widened = await profiles.addPostalCode({
        userId,
        profileId: rows[0].id,
        postalCode: '14010',
        expandNearby: true,
      });
      expect(
        widened.postalCodes.map((row) => [row.postalCode, row.source])
      ).toEqual([
        ['14010', ProfilePostalCodeSource.TYPED],
        ['14004', ProfilePostalCodeSource.NEARBY],
        ['14005', ProfilePostalCodeSource.NEARBY],
      ]);

      // The insert would fail on `uq_profile_postal_code`, so this is the case
      // section 3.2 says cannot be overlooked.
      const promoted = await profiles.addPostalCode({
        userId,
        profileId: rows[0].id,
        postalCode: '14004',
      });
      expect(
        promoted.postalCodes.find((row) => row.postalCode === '14004')?.source
      ).toBe(ProfilePostalCodeSource.TYPED);
    });

    it('suppresses a derived code and deletes it once its parent is gone', async () => {
      const userId = newUser();
      const { profiles: rows } = await profiles.list({ userId });
      neighbours.set('14010', ['14004']);
      await profiles.addPostalCode({
        userId,
        profileId: rows[0].id,
        postalCode: '14010',
        expandNearby: true,
      });

      const suppressed = await profiles.removePostalCode({
        userId,
        profileId: rows[0].id,
        postalCode: '14004',
      });
      expect(suppressed.postalCodes.map((row) => row.postalCode)).toEqual([
        '14010',
      ]);
      // Absent from the view and still a row, which is what stops the next
      // recompute putting it back on screen.
      const stored = await dataSource
        .getRepository(ProfilePostalCode)
        .find({ where: { profileId: rows[0].id } });
      expect(stored.map((row) => row.postalCode).sort()).toEqual([
        '14004',
        '14010',
      ]);

      const emptied = await profiles.removePostalCode({
        userId,
        profileId: rows[0].id,
        postalCode: '14010',
      });
      expect(emptied.postalCodes).toEqual([]);
      const left = await dataSource
        .getRepository(ProfilePostalCode)
        .find({ where: { profileId: rows[0].id } });
      expect(left).toEqual([]);
    });
  });
});
