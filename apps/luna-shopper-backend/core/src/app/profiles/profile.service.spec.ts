import {
  GenerationScope,
  PROFILE_LIMITS,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource, Repository } from 'typeorm';
import type {
  ProfileGenerationSource,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ProfileService } from './profile.service';

const USER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

/**
 * An in memory stand in for the four repositories.
 *
 * The invariants that live in the database (the partial unique index that makes
 * the lazy default idempotent, the cascade) are proven against real Postgres in
 * `shopping-profiles.integration.spec.ts`; a double cannot enforce a constraint
 * it does not have. What is left here is the half that lives in the service:
 * which rule fires, what is refused, and what the answer looks like.
 */
function build(seed: Partial<ShoppingProfile>[] = []) {
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

  const postalCodes = childRepo<ProfilePostalCode>();
  const supermarkets = childRepo<ProfileSupermarketPreference>();
  const sources = childRepo<ProfileGenerationSource>();

  const repositoriesByEntity = new Map<unknown, unknown>();
  const manager = {
    getRepository: (entity: unknown) =>
      repositoriesByEntity.get(entity) ?? profileRepo,
  };
  // Every entity but the profile resolves to a child double; the profile is the
  // fallback above, which keeps the map from having to name imported classes.
  const dataSource = {
    transaction: jest.fn(async (run: (m: typeof manager) => Promise<unknown>) =>
      run(manager)
    ),
    manager,
  } as unknown as DataSource;

  const events = { emitToUsers: jest.fn() } as unknown as CoreEventsPublisher;

  const service = new ProfileService(
    dataSource,
    profileRepo,
    postalCodes,
    supermarkets,
    sources,
    events
  );

  return { service, events, profileRepo, read: () => profiles };
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
      // Nothing in it yet, which is what the gateway turns into
      // CATALOG_SCOPE_REQUIRED rather than into everything.
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
});
