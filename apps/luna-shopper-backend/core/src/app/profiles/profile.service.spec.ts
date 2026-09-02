import type { ConfigService } from '@nestjs/config';
import {
  GenerationScope,
  PROFILE_LIMITS,
  ProfilePostalCodeSource,
  RealtimeEvent,
  type PostalCodeDistanceView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { FindOperator, type DataSource, type Repository } from 'typeorm';
import {
  ProfileGenerationSource,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  type ShoppingProfile,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { PostalCodeClient } from './postal-code.client';
import { ProfileService } from './profile.service';

const USER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

/**
 * What catalog would answer for each code, as `postalCode -> neighbours`,
 * nearest first (plan 0062).
 *
 * The distances are made up and the order is the contract: `nearby` answers
 * nearest first, and the recompute takes the first N of that.
 */
type Neighbourhood = Record<string, string[]>;

/**
 * An in memory stand in for the four repositories, plus the two collaborators
 * plan 0062 added.
 *
 * The invariants that live in the database (the partial unique index that makes
 * the lazy default idempotent, the cascade) are proven against real Postgres in
 * `shopping-profiles.integration.spec.ts`; a double cannot enforce a constraint
 * it does not have. What is left here is the half that lives in the service:
 * which rule fires, what is refused, and what the answer looks like.
 */
function build(
  seed: Partial<ShoppingProfile>[] = [],
  neighbourhood: Neighbourhood = {}
) {
  let profiles = seed.map((row, index) => ({
    id: row.id ?? `profile-${index}`,
    userId: row.userId ?? USER,
    name: row.name ?? null,
    isDefault: row.isDefault ?? false,
    position: row.position ?? index,
    addressText: row.addressText ?? null,
    minSavingCents: row.minSavingCents ?? 0,
    minSavingPercent: row.minSavingPercent ?? null,
    generationScope: row.generationScope ?? GenerationScope.ALL,
    createdAt: row.createdAt ?? new Date(2026, 0, index + 1),
    updatedAt: new Date(),
  })) as ShoppingProfile[];

  let minted = seed.length;

  const matches = (row: ShoppingProfile, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([key, value]) =>
        (row as unknown as Record<string, unknown>)[key] === value
    );

  const profileRepo = {
    find: jest.fn(async (options?: { where?: Record<string, unknown> }) =>
      profiles
        .filter((row) => matches(row, options?.where ?? {}))
        .sort(
          (a, b) =>
            a.position - b.position ||
            a.createdAt.getTime() - b.createdAt.getTime()
        )
    ),
    // `order` is honoured rather than ignored, because one rule depends on it
    // entirely: deleting the default promotes the **oldest** remaining, and a
    // double that answered in array order would pass whichever profile happened
    // to be listed first and prove nothing.
    findOne: jest.fn(
      async (options: {
        where: Record<string, unknown>;
        order?: Record<string, 'ASC' | 'DESC'>;
      }) => {
        const found = profiles.filter((row) => matches(row, options.where));
        for (const [key, direction] of Object.entries(
          options.order ?? {}
        ).reverse()) {
          found.sort((a, b) => {
            const left = (a as unknown as Record<string, unknown>)[key];
            const right = (b as unknown as Record<string, unknown>)[key];
            const order =
              left === right
                ? 0
                : (left as number) < (right as number)
                  ? -1
                  : 1;
            return direction === 'DESC' ? -order : order;
          });
        }
        return found[0] ?? null;
      }
    ),
    findOneOrFail: jest.fn(
      async (options: { where: Record<string, unknown> }) => {
        const row = profiles.find((r) => matches(r, options.where));
        if (!row) {
          throw new Error('not found');
        }
        return row;
      }
    ),
    create: jest.fn((row: Partial<ShoppingProfile>) => ({ ...row })),
    save: jest.fn(async (row: ShoppingProfile) => {
      if (!row.id) {
        row.id = `profile-${minted++}`;
        row.createdAt = new Date(2026, 5, minted);
        row.updatedAt = new Date();
        profiles.push(row);
      }
      return row;
    }),
    update: jest.fn(
      async (
        where: Record<string, unknown>,
        patch: Partial<ShoppingProfile>
      ) => {
        for (const row of profiles.filter((r) => matches(r, where))) {
          Object.assign(row, patch);
        }
        return { affected: 1 };
      }
    ),
    delete: jest.fn(async (where: { id: string }) => {
      profiles = profiles.filter((row) => row.id !== where.id);
      return { affected: 1 };
    }),
  } as unknown as Repository<ShoppingProfile>;

  const childRepo = <T>() =>
    ({
      find: jest.fn(async () => [] as T[]),
      create: jest.fn((row: Partial<T>) => row),
      save: jest.fn(async (rows: T[]) => rows),
      delete: jest.fn(async () => ({ affected: 0 })),
    }) as unknown as Repository<T>;

  /**
   * The postal codes are a real in memory table rather than the empty double the
   * other two children get, because plan 0062's rules are about what a row
   * survives: the recompute deletes, keeps and inserts, and a `find` that always
   * answers empty would let every one of those pass.
   *
   * `In(...)` reaches it as a `FindOperator`, which is why the match is not a
   * plain equality.
   */
  let codes: ProfilePostalCode[] = [];
  let mintedCodes = 0;
  const matchesValue = (actual: unknown, expected: unknown) =>
    expected instanceof FindOperator
      ? (expected.value as unknown[]).includes(actual)
      : actual === expected;
  const postalCodes = {
    find: jest.fn(async (options?: { where?: Record<string, unknown> }) =>
      codes
        .filter((row) =>
          Object.entries(options?.where ?? {}).every(([key, value]) =>
            matchesValue(
              (row as unknown as Record<string, unknown>)[key],
              value
            )
          )
        )
        .sort(
          (a, b) =>
            a.position - b.position ||
            a.createdAt.getTime() - b.createdAt.getTime()
        )
    ),
    create: jest.fn((row: Partial<ProfilePostalCode>) => ({
      label: null,
      position: 0,
      country: 'es',
      source: ProfilePostalCodeSource.TYPED,
      expandNearby: false,
      suppressed: false,
      ...row,
    })),
    save: jest.fn(async (input: ProfilePostalCode | ProfilePostalCode[]) => {
      for (const row of Array.isArray(input) ? input : [input]) {
        if (!row.id) {
          row.id = `code-${mintedCodes++}`;
          row.createdAt = new Date(2026, 0, mintedCodes);
          codes.push(row);
        }
      }
      return input;
    }),
    delete: jest.fn(async (where: Record<string, unknown>) => {
      const before = codes.length;
      codes = codes.filter(
        (row) =>
          !Object.entries(where).every(([key, value]) =>
            matchesValue(
              (row as unknown as Record<string, unknown>)[key],
              value
            )
          )
      );
      return { affected: before - codes.length };
    }),
  } as unknown as Repository<ProfilePostalCode>;

  const supermarkets = childRepo<ProfileSupermarketPreference>();
  const sources = childRepo<ProfileGenerationSource>();

  // Named rather than a fallback: a catch all `getRepository` would hand the
  // postal code writes the profile table and every assertion below would be
  // about the wrong rows.
  const repositoriesByEntity = new Map<unknown, unknown>([
    [ProfilePostalCode, postalCodes],
    [ProfileSupermarketPreference, supermarkets],
    [ProfileGenerationSource, sources],
  ]);
  const manager = {
    getRepository: (entity: unknown) =>
      repositoriesByEntity.get(entity) ?? profileRepo,
  };
  const dataSource = {
    transaction: jest.fn(async (run: (m: typeof manager) => Promise<unknown>) =>
      run(manager)
    ),
    manager,
  } as unknown as DataSource;

  const events = { emitToUsers: jest.fn() } as unknown as CoreEventsPublisher;

  const geography = {
    nearby: jest.fn(async (_country: string, postalCode: string) =>
      (neighbourhood[postalCode] ?? []).map(
        (code, index): PostalCodeDistanceView => ({
          postalCode: code,
          distanceMetres: (index + 1) * 100,
        })
      )
    ),
    announceAdded: jest.fn(),
  } as unknown as PostalCodeClient;

  const config = {
    getOrThrow: () => ({
      nearbyRadius: { defaultMetres: 2000, byCountry: {} },
    }),
  } as unknown as ConfigService;

  const service = new ProfileService(
    dataSource,
    profileRepo,
    postalCodes,
    supermarkets,
    sources,
    events,
    geography,
    config
  );

  return {
    service,
    events,
    geography,
    profileRepo,
    read: () => profiles,
    readCodes: () => codes,
  };
}

/** The codes on a profile, suppressed ones included, in position order. */
function codesOf(
  rows: ProfilePostalCode[],
  profileId = 'p1'
): {
  postalCode: string;
  source: ProfilePostalCodeSource;
  suppressed: boolean;
}[] {
  return rows
    .filter((row) => row.profileId === profileId)
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      postalCode: row.postalCode,
      source: row.source,
      suppressed: row.suppressed,
    }));
}

describe('ProfileService', () => {
  describe('the default profile exists before anybody creates it', () => {
    it('creates one on the first read, unnamed', async () => {
      const { service, read } = build();

      const { profiles } = await service.list({ userId: USER });

      expect(profiles).toHaveLength(1);
      expect(profiles[0].isDefault).toBe(true);
      // Null rather than "My profile": core does not know the caller's locale,
      // and a stored English word in a Spanish account is wrong forever.
      expect(profiles[0].name).toBeNull();
      expect(read()).toHaveLength(1);
    });

    it('creates one when a catalog read resolves for a new account', async () => {
      const { service } = build();

      const selector = await service.resolveScopes({ userId: USER });

      expect(selector.profileId).toBeTruthy();
      // Nothing in it yet, which is what the gateway turns into a read with no
      // scopes: the whole catalog, with no price on any of it (plan 0069).
      expect(selector.empty).toBe(true);
    });

    it('does not create a second one on a later read', async () => {
      const { service, read } = build([{ isDefault: true }]);

      await service.list({ userId: USER });
      await service.list({ userId: USER });

      expect(read()).toHaveLength(1);
    });
  });

  describe('there is always exactly one default', () => {
    it('never gives a newly created profile the flag', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      const created = await service.create({ userId: USER, name: 'Office' });

      expect(created.isDefault).toBe(false);
      expect(created.name).toBe('Office');
    });

    it('clears the old default before setting the new one', async () => {
      const { service, read } = build([
        { id: 'p1', isDefault: true },
        { id: 'p2' },
      ]);

      await service.setDefault({ userId: USER, profileId: 'p2' });

      expect(
        read()
          .filter((row) => row.isDefault)
          .map((row) => row.id)
      ).toEqual(['p2']);
    });

    it('promotes the oldest remaining when the default is deleted', async () => {
      const { service, read } = build([
        { id: 'p1', isDefault: true, createdAt: new Date(2026, 0, 1) },
        { id: 'p3', createdAt: new Date(2026, 0, 9) },
        { id: 'p2', createdAt: new Date(2026, 0, 3) },
      ]);

      await service.delete({ userId: USER, profileId: 'p1' });

      // By creation time and not by position, so the answer does not depend on
      // an ordering the user can rearrange.
      expect(
        read()
          .filter((row) => row.isDefault)
          .map((row) => row.id)
      ).toEqual(['p2']);
    });

    it('refuses to delete the last profile', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      await expect(
        service.delete({ userId: USER, profileId: 'p1' })
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('a profile is private', () => {
    it('answers not found for somebody else’s, never forbidden', async () => {
      const { service } = build([
        { id: 'mine', userId: USER, isDefault: true },
        { id: 'theirs', userId: STRANGER, isDefault: true },
      ]);

      const error = await service
        .update({ userId: USER, profileId: 'theirs', name: 'hijacked' })
        .catch((e: unknown) => e);

      // Forbidden would confirm the id names a real profile, which is itself
      // something a stranger should not learn.
      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('addresses profiles.changed to the owner and nobody else', async () => {
      const { service, events } = build([{ id: 'p1', isDefault: true }]);

      await service.update({ userId: USER, profileId: 'p1', name: 'Home' });

      expect(events.emitToUsers).toHaveBeenCalledWith(
        RealtimeEvent.ProfilesChanged,
        [USER],
        expect.objectContaining({ profiles: expect.any(Array) })
      );
    });
  });

  describe('what it refuses', () => {
    it('caps the number of profiles', async () => {
      const { service } = build(
        Array.from({ length: PROFILE_LIMITS.maxProfiles }, (_, i) => ({
          id: `p${i}`,
          isDefault: i === 0,
        }))
      );

      await expect(service.create({ userId: USER })).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it('caps the postal codes per profile', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      await expect(
        service.update({
          userId: USER,
          profileId: 'p1',
          postalCodes: Array.from(
            { length: PROFILE_LIMITS.maxPostalCodes + 1 },
            (_, i) => ({ postalCode: `2800${i}` })
          ),
        })
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('refuses a name longer than the cap the client truncates at', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      await expect(
        service.update({
          userId: USER,
          profileId: 'p1',
          name: 'x'.repeat(PROFILE_LIMITS.nameMaxLength + 1),
        })
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('turns a blank name into no name rather than an empty one', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      const updated = await service.update({
        userId: USER,
        profileId: 'p1',
        name: '   ',
      });

      expect(updated.name).toBeNull();
    });

    it('refuses a relative floor that is not a percentage', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      await expect(
        service.update({ userId: USER, profileId: 'p1', minSavingPercent: 101 })
      ).rejects.toBeInstanceOf(ValidationException);
    });
  });

  describe('the selector it hands the gateway', () => {
    it('separates the chains listed from the chains refused', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }]);

      // The postal codes and preferences come from the child repositories,
      // which answer empty here; what this proves is the shape and the `empty`
      // rule, which is what the gateway branches on.
      const selector = await service.resolveScopes({ userId: USER });

      expect(selector).toEqual({
        profileId: 'p1',
        postalCodes: [],
        supermarketIds: [],
        excludedSupermarketIds: [],
        empty: true,
      });
    });

    it('resolves the named profile rather than the default when asked', async () => {
      const { service } = build([{ id: 'p1', isDefault: true }, { id: 'p2' }]);

      const selector = await service.resolveScopes({
        userId: USER,
        profileId: 'p2',
      });

      expect(selector.profileId).toBe('p2');
    });

    it('is not found for another user’s profile', async () => {
      const { service } = build([
        { id: 'mine', userId: USER, isDefault: true },
        { id: 'theirs', userId: STRANGER, isDefault: true },
      ]);

      await expect(
        service.resolveScopes({ userId: USER, profileId: 'theirs' })
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * A postal code brings its neighbours (plan 0062).
   *
   * Every test here is about the derived set being a **pure function** of the
   * profile's own state rather than something maintained incrementally, which is
   * section 3's whole argument: the three bugs it names are a shared child, an
   * orphan and a changed radius, and each one has a test below.
   */
  describe('a postal code brings its neighbours', () => {
    const NEIGHBOURS: Neighbourhood = {
      // Two Córdoba codes about two kilometres apart, sharing 14005.
      '14010': ['14004', '14005'],
      '14013': ['14005', '14012'],
      // Nothing near this one, which is the rural case section 4 warns about.
      '14550': [],
    };

    const profile = () => [{ id: 'p1', isDefault: true }];

    it('writes the parent and its neighbours when asked, and only the parent when not', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);

      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14550',
      });

      expect(codesOf(readCodes())).toEqual([
        {
          postalCode: '14010',
          source: ProfilePostalCodeSource.TYPED,
          suppressed: false,
        },
        {
          postalCode: '14550',
          source: ProfilePostalCodeSource.TYPED,
          suppressed: false,
        },
        {
          postalCode: '14004',
          source: ProfilePostalCodeSource.NEARBY,
          suppressed: false,
        },
        {
          postalCode: '14005',
          source: ProfilePostalCodeSource.NEARBY,
          suppressed: false,
        },
      ]);
    });

    it('leaves a neighbour two parents share when one of them goes', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14013',
        expandNearby: true,
      });

      await service.removePostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
      });

      // 14005 was reachable from both. An incremental scheme would delete it
      // with its first parent and leave the second parent unjustified.
      const remaining = codesOf(readCodes()).map((row) => row.postalCode);
      expect(remaining).toContain('14005');
      expect(remaining).not.toContain('14004');
      expect(remaining).not.toContain('14010');
    });

    it('suppresses a derived code rather than deleting it, and an unrelated add does not resurrect it', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });

      await service.removePostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14004',
      });
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14550',
      });

      // Still a row, still suppressed: the recompute the second add triggered
      // put it back in `derived(profile)` and left the user's removal alone.
      expect(
        codesOf(readCodes()).find((row) => row.postalCode === '14004')
      ).toEqual({
        postalCode: '14004',
        source: ProfilePostalCodeSource.NEARBY,
        suppressed: true,
      });
    });

    it('hides a suppressed code from the view and from the scope selector', async () => {
      const { service } = build(profile(), NEIGHBOURS);
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });

      const view = await service.removePostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14004',
      });
      const selector = await service.resolveScopes({ userId: USER });

      expect(view.postalCodes.map((c) => c.postalCode)).toEqual([
        '14010',
        '14005',
      ]);
      expect(selector.postalCodes).toEqual(['14010', '14005']);
    });

    it('deletes a suppressed code once its last parent is gone, leaving nothing behind', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });
      await service.removePostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14004',
      });

      await service.removePostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
      });

      expect(codesOf(readCodes())).toEqual([]);
    });

    it('promotes a suppressed code when the user types it', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });
      await service.removePostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14004',
      });

      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14004',
      });

      // Theirs rather than ours, which is a more honest description of what
      // happened than a derived row with the suppression quietly cleared.
      expect(
        codesOf(readCodes()).find((row) => row.postalCode === '14004')
      ).toEqual({
        postalCode: '14004',
        source: ProfilePostalCodeSource.TYPED,
        suppressed: false,
      });
    });

    it('converges on the same set as a profile built from scratch at a wider radius', async () => {
      const narrow: Neighbourhood = { '14010': ['14004'] };
      const wide: Neighbourhood = { '14010': ['14004', '14005', '14012'] };

      const grown = build(profile(), narrow);
      await grown.service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });
      // The radius is configuration, so this is what changing it looks like from
      // the recompute's side: the same rows, a different answer from catalog.
      (grown.geography.nearby as jest.Mock).mockImplementation(
        async (_c: string, code: string) =>
          (wide[code] ?? []).map((postalCode, index) => ({
            postalCode,
            distanceMetres: (index + 1) * 100,
          }))
      );
      await grown.service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });

      const fresh = build(profile(), wide);
      await fresh.service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });

      expect(codesOf(grown.readCodes())).toEqual(codesOf(fresh.readCodes()));
    });

    it('never derives a code the user already holds', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);

      await service.update({
        userId: USER,
        profileId: 'p1',
        postalCodes: [
          { postalCode: '14010', expandNearby: true },
          { postalCode: '14004' },
        ],
      });

      expect(codesOf(readCodes())).toEqual([
        {
          postalCode: '14010',
          source: ProfilePostalCodeSource.TYPED,
          suppressed: false,
        },
        {
          postalCode: '14004',
          source: ProfilePostalCodeSource.TYPED,
          suppressed: false,
        },
        {
          postalCode: '14005',
          source: ProfilePostalCodeSource.NEARBY,
          suppressed: false,
        },
      ]);
    });

    it('asks catalog once per expanding parent and not at all without one', async () => {
      const { service, geography } = build(profile(), NEIGHBOURS);

      await service.update({
        userId: USER,
        profileId: 'p1',
        postalCodes: [
          { postalCode: '14010', expandNearby: true },
          { postalCode: '14013', expandNearby: true },
          { postalCode: '14550' },
        ],
      });

      expect(
        (geography.nearby as jest.Mock).mock.calls.map((c) => c[1])
      ).toEqual(['14010', '14013']);
    });

    it('announces the codes it wrote, parent and neighbours alike', async () => {
      const { service, geography } = build(profile(), NEIGHBOURS);

      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });

      expect(geography.announceAdded).toHaveBeenCalledWith('es', [
        '14010',
        '14004',
        '14005',
      ]);
    });

    it('counts only the user’s own codes against the cap', async () => {
      const { service } = build(profile(), NEIGHBOURS);
      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14010',
        expandNearby: true,
      });

      // Two derived rows are already on the profile; the cap is about the codes
      // somebody chose, and a set they never sized cannot use one up.
      await expect(
        service.addPostalCode({
          userId: USER,
          profileId: 'p1',
          postalCode: '14013',
        })
      ).resolves.toBeDefined();
    });

    it('refuses a code the caller claims we derived', async () => {
      const { service } = build(profile(), NEIGHBOURS);

      await expect(
        service.addPostalCode({
          userId: USER,
          profileId: 'p1',
          postalCode: '14010',
          source: ProfilePostalCodeSource.NEARBY as never,
        })
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('keeps a code the device resolved as the user’s own', async () => {
      const { service, readCodes } = build(profile(), NEIGHBOURS);

      await service.addPostalCode({
        userId: USER,
        profileId: 'p1',
        postalCode: '14550',
        source: ProfilePostalCodeSource.DEVICE,
      });

      expect(codesOf(readCodes())).toEqual([
        {
          postalCode: '14550',
          source: ProfilePostalCodeSource.DEVICE,
          suppressed: false,
        },
      ]);
    });
  });
});
