import {
  PRICE_SCOPE_PATTERNS,
  PROFILE_PATTERNS,
  type ProfileScopeSelector,
  type ResolvedScopesView,
} from '@portfolio/luna-shopper/contracts';
import { type RedisService } from '@portfolio/luna-shopper/platform';
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
  excludedSupermarketLocationIds: ['shop-no-parking'],
  empty: false,
};

const EMPTY_PROFILE: ProfileScopeSelector = {
  profileId: 'profile-1',
  postalCodes: [],
  supermarketIds: [],
  excludedSupermarketIds: [],
  excludedSupermarketLocationIds: [],
  empty: true,
};

/**
 * Postal codes given, and every chain that serves them refused. A real profile
 * that resolves to no scopes, which is section 3's third row and the state no
 * error code could ever have expressed.
 */
const REFUSING_PROFILE: ProfileScopeSelector = {
  profileId: 'profile-1',
  postalCodes: ['28001'],
  supermarketIds: [],
  excludedSupermarketIds: ['chain-mercadona'],
  empty: false,
};

/** What catalog answers that profile: nobody left, but somebody was there. */
const REFUSED_EVERYWHERE: ResolvedScopesView = {
  priceScopeIds: [],
  scopes: [],
  coverage: [{ postalCode: '28001', served: true }],
  approximate: false,
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

function makeNats(
  selector: ProfileScopeSelector = FILLED_PROFILE,
  resolved: ResolvedScopesView = RESOLVED
) {
  const send = jest.fn(async (subject: string) => {
    if (subject === PROFILE_PATTERNS.resolveScopes) {
      return selector;
    }
    if (subject === PRICE_SCOPE_PATTERNS.resolve) {
      return resolved;
    }
    throw new Error(`unexpected subject ${subject}`);
  });
  return { send } as unknown as NatsClient & { send: jest.Mock };
}

/**
 * The gateway half of plan 0049, section 2.1: the two round trips and the cache
 * over them. Since plan 0069 there is no error here at all, and the three ways
 * of having no scopes are told apart by `coverage` instead.
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
      excludedSupermarketLocationIds: ['shop-no-parking'],
    });
  });

  it('answers an empty profile with no scopes rather than refusing', async () => {
    const nats = makeNats(EMPTY_PROFILE);
    const { redis } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    const view = await service.describe(USER, {});

    // Section 3's first row: nothing said. No scopes and no coverage, which is
    // what lets a client say "you have not told us where you shop" without an
    // error code to branch on.
    expect(view.priceScopeIds).toEqual([]);
    expect(view.coverage).toEqual([]);
    expect(view.profileId).toBe('profile-1');
    // Not even a round trip to catalog: a selector with nothing positive in it
    // resolves to exactly this, so asking would spend a call to be told what is
    // already known.
    expect(nats.send.mock.calls.map((call) => call[0])).toEqual([
      PROFILE_PATTERNS.resolveScopes,
    ]);
  });

  it('never caches an empty profile', async () => {
    const nats = makeNats(EMPTY_PROFILE);
    const { redis, client } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    await service.forRead(USER, {});

    // The next thing this user does is fill the profile in, and the read after
    // that must not be answered from a minute old "you have said nothing".
    expect(client.hset).not.toHaveBeenCalled();
  });

  it('tells a profile that refused everywhere apart from one that said nothing', async () => {
    const nats = makeNats(REFUSING_PROFILE, REFUSED_EVERYWHERE);
    const { redis } = makeRedis();
    const service = new ScopeResolutionService(nats, redis);

    const view = await service.describe(USER, {});

    // Section 3's third row. Same empty scope set as the row above, and the
    // coverage is what separates them: somebody serves 28001, this caller has
    // simply refused all of them. An error code could never have said that.
    expect(view.priceScopeIds).toEqual([]);
    expect(view.coverage).toEqual([{ postalCode: '28001', served: true }]);
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
  /**
   * The finer axis reaching catalog (plan 0064, section 3). The gateway is the
   * only thing that knows both halves, so a refusal that stops here is a refusal
   * that never happens.
   */
  describe('the shops the caller refuses', () => {
    it('passes them to catalog beside the chains', async () => {
      const nats = makeNats();
      const { redis } = makeRedis();
      const service = new ScopeResolutionService(nats, redis);

      await service.describe(USER, {});

      expect(nats.send).toHaveBeenCalledWith(
        PRICE_SCOPE_PATTERNS.resolve,
        expect.objectContaining({
          excludedSupermarketIds: ['chain-dia'],
          excludedSupermarketLocationIds: ['shop-no-parking'],
        })
      );
    });

    it('sends none for a caller who stated a place rather than a profile', async () => {
      const nats = makeNats();
      const { redis } = makeRedis();
      const service = new ScopeResolutionService(nats, redis);

      await service.describe(USER, { postalCodes: ['28001'] });

      // Nobody named a profile, so there is nothing to have refused.
      expect(nats.send).toHaveBeenCalledWith(
        PRICE_SCOPE_PATTERNS.resolve,
        expect.objectContaining({ excludedSupermarketLocationIds: [] })
      );
    });

    it('hands them to a shop read without climbing the scope ladder', async () => {
      const nats = makeNats();
      const { redis } = makeRedis();
      const service = new ScopeResolutionService(nats, redis);

      const selection = await service.forShops(USER, {});

      expect(selection.excludedSupermarketLocationIds).toEqual([
        'shop-no-parking',
      ]);
      // Core alone (plan 0068, section 2). A shop is a place rather than a
      // price, so which scopes serve the caller is a question this read has no
      // reason to ask.
      expect(nats.send.mock.calls.map((call) => call[0])).toEqual([
        PROFILE_PATTERNS.resolveScopes,
      ]);
    });

    it('answers for a profile that has said nothing', async () => {
      const nats = makeNats(EMPTY_PROFILE);
      const { redis } = makeRedis();
      const service = new ScopeResolutionService(nats, redis);

      const selection = await service.forShops(USER, {});

      // Somebody in the middle of filling their profile in still gets an
      // answer, which is the whole reason this does not go through `describe`.
      expect(selection.excludedSupermarketLocationIds).toEqual([]);
      expect(selection.postalCodes).toEqual([]);
    });
  });
});
