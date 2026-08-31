import {
  PRICE_SCOPE_PATTERNS,
  PROFILE_PATTERNS,
  type ProfileScopeSelector,
  type ResolvedScopesView,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  isDomainException,
  type RedisService,
} from '@portfolio/luna-shopper/platform';
import type { NatsClient } from '../messaging/nats-client';
import {
  ScopeResolutionService,
  userScopeKey,
} from './scope-resolution.service';

const USER = 'user-1';

const FILLED_PROFILE: ProfileScopeSelector = {
  profileId: 'profile-1',
  postalCodes: ['28001'],
  supermarketIds: [],
  excludedSupermarketIds: ['chain-dia'],
  empty: false,
};

const EMPTY_PROFILE: ProfileScopeSelector = {
  profileId: 'profile-1',
  postalCodes: [],
  supermarketIds: [],
  excludedSupermarketIds: [],
  empty: true,
};

const RESOLVED: ResolvedScopesView = {
  priceScopeIds: ['scope-a'],
  scopes: [
    {
      priceScopeId: 'scope-a',
      supermarketId: 'chain-mercadona',
      postalCode: '28001',
      origin: 'POSTAL_CODE',
      approximate: false,
    },
  ],
  coverage: [{ postalCode: '28001', served: true }],
  approximate: false,
};

/**
 * A Redis double that behaves like the one command shape this service uses: a
 * hash per user, with a TTL on the key. `tryCommand` is the degrading wrapper
 * plan 0028 section 5 defines, so the double runs the operation and returns
 * undefined when it is told Redis is down.
 */
function makeRedis(options: { down?: boolean } = {}) {
  const store = new Map<string, Map<string, string>>();
  const client = {
    hget: jest.fn(
      async (key: string, field: string) => store.get(key)?.get(field) ?? null
    ),
    hset: jest.fn(async (key: string, field: string, value: string) => {
      const hash = store.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      store.set(key, hash);
      return 1;
    }),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const redis = {
    tryCommand: jest.fn(async (operation: (c: typeof client) => unknown) =>
      options.down ? undefined : operation(client)
    ),
  } as unknown as RedisService;
  return { redis, client, store };
}

function makeNats(selector: ProfileScopeSelector = FILLED_PROFILE) {
  const send = jest.fn(async (subject: string) => {
    if (subject === PROFILE_PATTERNS.resolveScopes) {
      return selector;
    }
    if (subject === PRICE_SCOPE_PATTERNS.resolve) {
      return RESOLVED;
    }
    throw new Error(`unexpected subject ${subject}`);
  });
  return { send } as unknown as NatsClient & { send: jest.Mock };
}

/**
 * The gateway half of plan 0049, section 2.1: the two round trips, the cache
 * over them, and the one error that is not a failure.
 */
describe('ScopeResolutionService', () => {
  it('passes explicit scopes straight through, resolving nothing', async () => {
    const nats = makeNats();
    const { redis } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    const ids = await service.forRead(USER, { priceScopeIds: ['scope-x'] });

    expect(ids).toEqual(['scope-x']);
    // A caller who named the warehouses has said everything there is to say;
    // asking core what their profile holds would be work for nobody.
    expect(nats.send).not.toHaveBeenCalled();
  });

  it('resolves a stated place through catalog without asking core', async () => {
    const nats = makeNats();
    const { redis } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    const view = await service.describe(USER, { postalCodes: ['28001'] });

    expect(view.priceScopeIds).toEqual(['scope-a']);
    expect(view.explicit).toBe(true);
    expect(view.profileId).toBeNull();
    expect(nats.send).toHaveBeenCalledTimes(1);
    expect(nats.send).toHaveBeenCalledWith(
      PRICE_SCOPE_PATTERNS.resolve,
      expect.objectContaining({ postalCodes: ['28001'] })
    );
  });

  it('asks core for the default profile, then catalog what it means', async () => {
    const nats = makeNats();
    const { redis } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    const view = await service.describe(USER, {});

    expect(view.priceScopeIds).toEqual(['scope-a']);
    expect(view.profileId).toBe('profile-1');
    expect(view.explicit).toBe(false);
    // The order matters: core says what the user typed, catalog says what it
    // means today. Neither learns the other's domain.
    expect(nats.send.mock.calls.map((call) => call[0])).toEqual([
      PROFILE_PATTERNS.resolveScopes,
      PRICE_SCOPE_PATTERNS.resolve,
    ]);
    // The exclusions travel with the selector: they are what makes "everything
    // except DIA" work without listing every other chain.
    expect(nats.send).toHaveBeenLastCalledWith(PRICE_SCOPE_PATTERNS.resolve, {
      userId: USER,
      postalCodes: ['28001'],
      supermarketIds: [],
      excludedSupermarketIds: ['chain-dia'],
    });
  });

  it('refuses an empty profile with catalog_scope_required, and never caches it', async () => {
    const nats = makeNats(EMPTY_PROFILE);
    const { redis, client } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    const error = await service.forRead(USER, {}).catch((e: unknown) => e);

    expect(isDomainException(error)).toBe(true);
    expect(isDomainException(error) && error.code).toBe(
      ERROR_CODES.CATALOG_SCOPE_REQUIRED
    );
    // Neither everything nor an empty page: the client renders this as an
    // onboarding step, so the next read after the user fills the profile in
    // must not be answered from a minute old "you have said nothing".
    expect(client.hset).not.toHaveBeenCalled();
  });

  it('answers a second read from the cache', async () => {
    const nats = makeNats();
    const { redis } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    await service.forRead(USER, {});
    const before = (nats.send as jest.Mock).mock.calls.length;
    const ids = await service.forRead(USER, {});

    expect(ids).toEqual(['scope-a']);
    expect((nats.send as jest.Mock).mock.calls.length).toBe(before);
  });

  it('keeps one profile answer apart from another', async () => {
    const nats = makeNats();
    const { redis, store } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    await service.forRead(USER, {});
    await service.forRead(USER, { profileId: 'profile-2' });

    expect([...(store.get(userScopeKey(USER))?.keys() ?? [])]).toEqual([
      'default',
      'profile-2',
    ]);
  });

  it('forgets a user whole when their profiles change', async () => {
    const nats = makeNats();
    const { redis, store } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    await service.forRead(USER, {});
    await service.invalidate(USER);

    // One DEL on a key whose name is known from the userId alone, which is why
    // the entries are fields of one hash rather than keys of their own.
    expect(store.has(userScopeKey(USER))).toBe(false);
    await service.forRead(USER, {});
    expect((nats.send as jest.Mock).mock.calls.length).toBe(4);
  });

  it('degrades to the origin when Redis is down', async () => {
    const nats = makeNats();
    const { redis } = makeRedis({ down: true });
    const service = new ScopeResolutionService(nats, redis);

    const first = await service.forRead(USER, {});
    const second = await service.forRead(USER, {});

    // Two extra round trips, never a wrong answer (plan 0028, section 5).
    expect(first).toEqual(['scope-a']);
    expect(second).toEqual(['scope-a']);
    expect((nats.send as jest.Mock).mock.calls.length).toBe(4);
  });

  it('treats an unreadable cache entry as a miss', async () => {
    const nats = makeNats();
    const { redis, store } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);
    store.set(userScopeKey(USER), new Map([['default', 'not json']]));

    const ids = await service.forRead(USER, {});

    expect(ids).toEqual(['scope-a']);
  });
});
