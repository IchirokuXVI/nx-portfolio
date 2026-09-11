import {
  DEFAULT_SCOPE_PRIORITY,
  PriceScopeKind,
} from '@portfolio/luna-shopper/contracts';
import type { EntityManager, Repository } from 'typeorm';
import type { PriceScope, Supermarket, SupermarketLocation } from '../entities';
import type { LocationScopeService, ScopeInStack } from './location-scopes';
import { ScopeResolverService } from './scope-resolver.service';

const CALLER = 'user-1';

/** Chains, so a supermarket id in a failure message is readable. */
const MERCADONA = 'chain-mercadona';
const LIDL = 'chain-lidl';
const DIA = 'chain-dia';

/**
 * A shop in the world, and the scopes it sells at.
 *
 * `priceScopeId` is the one entry shorthand every test written before plan
 * 0105 used, and it still means what it meant: a stack of one. A test about
 * the stack states `priceScopeIds` instead.
 */
interface WorldLocation extends Partial<SupermarketLocation> {
  priceScopeId?: string;
  priceScopeIds?: string[];
}

interface World {
  locations: WorldLocation[];
  scopes: Partial<PriceScope>[];
  chains: Partial<Supermarket>[];
}

/**
 * The three repositories, answering from plain arrays. `In(...)` is a TypeORM
 * value object rather than a list, so each double reads the ids back out of it:
 * matching what the service asked for is the whole job of these fakes.
 */
function build(input: World) {
  const world = withIds(input);
  const idsOf = (value: unknown): string[] => {
    const operator = value as { _value?: unknown };
    const raw = operator?._value ?? value;
    return Array.isArray(raw) ? (raw as string[]) : [raw as string];
  };

  const locations = {
    find: jest.fn(async (options: { where: { postalCode: unknown } }) => {
      const wanted = new Set(idsOf(options.where.postalCode));
      return world.locations.filter((row) =>
        wanted.has(row.postalCode as string)
      );
    }),
  } as unknown as Repository<SupermarketLocation>;

  const scopes = {
    find: jest.fn(
      async (options: {
        where: { supermarketId?: unknown; kind?: unknown; id?: unknown };
      }) => {
        // Rung three looks scopes up by id, to report their priority; rung two
        // looks the chain's NATIONAL up by chain and kind.
        if (options.where.id !== undefined) {
          const wanted = new Set(idsOf(options.where.id));
          return world.scopes.filter((row) => wanted.has(row.id as string));
        }
        const wanted = new Set(idsOf(options.where.supermarketId));
        return world.scopes.filter(
          (row) =>
            wanted.has(row.supermarketId as string) &&
            row.kind === options.where.kind
        );
      }
    ),
  } as unknown as Repository<PriceScope>;

  const chains = {
    find: jest.fn(async (options: { where: { id: unknown } }) => {
      const wanted = new Set(idsOf(options.where.id));
      return world.chains.filter((row) => wanted.has(row.id as string));
    }),
  } as unknown as Repository<Supermarket>;

  /**
   * The stacks, ranked the way the real one ranks them: ascending priority,
   * then the scope id, so a test asserting an order is asserting the rule and
   * not the order it happened to list the scopes in.
   *
   * A scope the world does not describe takes the default for the kind the
   * stack position implies, which keeps every pre-0105 test, where a shop has
   * one scope and its priority decides nothing, saying exactly what it said.
   */
  const priorityOf = (priceScopeId: string, index: number): number => {
    const declared = world.scopes.find((row) => row.id === priceScopeId);
    if (declared?.priority !== undefined) {
      return declared.priority;
    }
    return index === 0
      ? DEFAULT_SCOPE_PRIORITY.STORE
      : DEFAULT_SCOPE_PRIORITY.NATIONAL;
  };

  const stacks = {
    stacksFor: jest.fn(
      async (_manager: EntityManager, ids: readonly string[]) => {
        const wanted = new Set(ids);
        const answer = new Map<string, ScopeInStack[]>();
        for (const row of world.locations) {
          if (!wanted.has(row.id as string)) {
            continue;
          }
          const stack = (
            row.priceScopeIds ?? (row.priceScopeId ? [row.priceScopeId] : [])
          ).map((priceScopeId, index) => ({
            priceScopeId,
            priority: priorityOf(priceScopeId, index),
          }));
          stack.sort(
            (a, b) =>
              a.priority - b.priority ||
              a.priceScopeId.localeCompare(b.priceScopeId)
          );
          answer.set(row.id as string, stack);
        }
        return answer;
      }
    ),
  } as unknown as LocationScopeService;

  return new ScopeResolverService(locations, scopes, chains, stacks);
}

/**
 * Every shop needs an id, because the stack is keyed on it. Filled in here
 * rather than in each test, which is about the scopes and not the shops.
 */
function withIds(world: World): World {
  return {
    ...world,
    locations: world.locations.map((row, index) => ({
      id: `shop-${index}`,
      ...row,
    })),
  };
}

/**
 * The resolver (plan 0049, sections 1.1, 3.1 and 5).
 *
 * Every rule this file proves is a rule about *which* scopes come back and
 * *why*, so the doubles answer from arrays and the assertions are on the reasons
 * rather than on the SQL. What the SQL does with the ids afterwards is plan
 * 0048's search, tested where it lives.
 */
describe('ScopeResolverService', () => {
  it('resolves a postal code to the scopes of the stores that sit in it', async () => {
    const resolver = build({
      locations: [
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-warehouse-4661',
          postalCode: '28001',
        },
      ],
      scopes: [],
      chains: [],
    });

    const resolved = await resolver.resolve({
      userId: CALLER,
      postalCodes: ['28001'],
    });

    expect(resolved.priceScopeIds).toEqual(['scope-warehouse-4661']);
    expect(resolved.scopes[0]).toMatchObject({
      supermarketId: MERCADONA,
      postalCode: '28001',
      origin: 'POSTAL_CODE',
      approximate: false,
    });
    expect(resolved.approximate).toBe(false);
  });

  it('names one scope once, however many of its stores serve the caller', async () => {
    // The case the whole scope concept exists for: a chain prices per warehouse,
    // so twelve stores in one city are one price and must be one entry.
    const resolver = build({
      locations: [
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-a',
          postalCode: '28001',
        },
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-a',
          postalCode: '28001',
        },
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-a',
          postalCode: '28002',
        },
      ],
      scopes: [],
      chains: [],
    });

    const resolved = await resolver.resolve({
      userId: CALLER,
      postalCodes: ['28001', '28002'],
    });

    expect(resolved.priceScopeIds).toEqual(['scope-a']);
  });

  it('takes the union of several postal codes, saying which produced each scope', async () => {
    const resolver = build({
      locations: [
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-madrid',
          postalCode: '28001',
        },
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-sevilla',
          postalCode: '41001',
        },
      ],
      scopes: [],
      chains: [],
    });

    const resolved = await resolver.resolve({
      userId: CALLER,
      postalCodes: ['28001', '41001'],
    });

    expect(resolved.priceScopeIds.sort()).toEqual([
      'scope-madrid',
      'scope-sevilla',
    ]);
    // Two stops in two towns is not the same suggestion as two stops on one
    // street, and only the user can judge that (section 5).
    expect(
      resolved.scopes.map((scope) => [scope.priceScopeId, scope.postalCode])
    ).toEqual([
      ['scope-madrid', '28001'],
      ['scope-sevilla', '41001'],
    ]);
  });

  it('accepts a postal code no chain serves, and flags it rather than refusing it', async () => {
    const resolver = build({
      locations: [
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-a',
          postalCode: '28001',
        },
      ],
      scopes: [],
      chains: [],
    });

    const resolved = await resolver.resolve({
      userId: CALLER,
      postalCodes: ['28001', '99999'],
    });

    expect(resolved.coverage).toEqual([
      { postalCode: '28001', served: true },
      { postalCode: '99999', served: false },
    ]);
    expect(resolved.priceScopeIds).toEqual(['scope-a']);
  });

  it('resolves a place nobody serves to no scopes at all', async () => {
    const resolver = build({ locations: [], scopes: [], chains: [] });

    const resolved = await resolver.resolve({
      userId: CALLER,
      postalCodes: ['99999'],
    });

    // Not an error: coverage is a property of our data, not of the address. The
    // empty set is what makes the search answer an explicable empty page.
    expect(resolved.priceScopeIds).toEqual([]);
    expect(resolved.coverage).toEqual([{ postalCode: '99999', served: false }]);
  });

  describe('the chain preference is a filter, not a second address', () => {
    it('drops an excluded chain and keeps the rest', async () => {
      const resolver = build({
        locations: [
          {
            supermarketId: MERCADONA,
            priceScopeId: 'scope-m',
            postalCode: '28001',
          },
          { supermarketId: DIA, priceScopeId: 'scope-d', postalCode: '28001' },
        ],
        scopes: [],
        chains: [],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketIds: [DIA],
      });

      expect(resolved.priceScopeIds).toEqual(['scope-m']);
    });

    it('restricts to the chains that were listed, when any were', async () => {
      const resolver = build({
        locations: [
          {
            supermarketId: MERCADONA,
            priceScopeId: 'scope-m',
            postalCode: '28001',
          },
          { supermarketId: DIA, priceScopeId: 'scope-d', postalCode: '28001' },
        ],
        scopes: [],
        chains: [],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        supermarketIds: [DIA],
      });

      expect(resolved.priceScopeIds).toEqual(['scope-d']);
    });

    it('lets an exclusion win over the same chain being listed', async () => {
      const resolver = build({
        locations: [
          { supermarketId: DIA, priceScopeId: 'scope-d', postalCode: '28001' },
        ],
        scopes: [],
        chains: [],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        supermarketIds: [DIA],
        excludedSupermarketIds: [DIA],
      });

      expect(resolved.priceScopeIds).toEqual([]);
    });
  });

  describe('a chain named with no location climbs the ladder (section 3.1)', () => {
    it('prefers the chain scopes that serve the caller postal codes', async () => {
      const resolver = build({
        locations: [
          {
            supermarketId: LIDL,
            priceScopeId: 'scope-local',
            postalCode: '28001',
          },
        ],
        scopes: [
          {
            id: 'scope-national',
            supermarketId: LIDL,
            kind: PriceScopeKind.NATIONAL,
          },
        ],
        chains: [{ id: LIDL, defaultPriceScopeId: 'scope-fallback' }],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        supermarketIds: [LIDL],
      });

      expect(resolved.priceScopeIds).toEqual(['scope-local']);
    });

    it('falls to the national scope when the chain reaches none of them', async () => {
      const resolver = build({
        locations: [],
        scopes: [
          {
            id: 'scope-national',
            supermarketId: LIDL,
            kind: PriceScopeKind.NATIONAL,
            priority: DEFAULT_SCOPE_PRIORITY.NATIONAL,
          },
        ],
        chains: [{ id: LIDL, defaultPriceScopeId: 'scope-fallback' }],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        supermarketIds: [LIDL],
      });

      expect(resolved.scopes).toEqual([
        {
          priceScopeId: 'scope-national',
          supermarketId: LIDL,
          postalCode: null,
          origin: 'NATIONAL',
          // A chain that prices nationally has no location to be asked about,
          // so this is exact rather than approximate.
          approximate: false,
          // A fallback for a missing shop rather than a tier of a stack (plan
          // 0105, section 5), so there is no shop to name and it is the entry
          // a scoped read quotes.
          supermarketLocationId: null,
          priority: DEFAULT_SCOPE_PRIORITY.NATIONAL,
          quoted: true,
        },
      ]);
      expect(resolved.approximate).toBe(false);
    });

    it('falls to the owner set default last, and says the answer is approximate', async () => {
      const resolver = build({
        locations: [],
        scopes: [
          {
            id: 'scope-madrid',
            supermarketId: MERCADONA,
            kind: PriceScopeKind.REGION,
            priority: DEFAULT_SCOPE_PRIORITY.REGION,
          },
        ],
        chains: [{ id: MERCADONA, defaultPriceScopeId: 'scope-madrid' }],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        supermarketIds: [MERCADONA],
      });

      expect(resolved.scopes).toEqual([
        {
          priceScopeId: 'scope-madrid',
          supermarketId: MERCADONA,
          postalCode: null,
          origin: 'CHAIN_DEFAULT',
          approximate: true,
          supermarketLocationId: null,
          priority: DEFAULT_SCOPE_PRIORITY.REGION,
          quoted: true,
        },
      ]);
      // What lets the client say "prices shown for Madrid" instead of implying
      // the number is the caller's.
      expect(resolved.approximate).toBe(true);
    });

    it('contributes nothing for a default naming a scope that is gone', async () => {
      // Rung three loads the scope since plan 0105, because the answer carries
      // its priority. Dropping a dangling default is the point rather than the
      // cost: the id used to come back on its own, so a read against it found
      // no prices while `approximate` promised a real price somewhere else.
      const resolver = build({
        locations: [],
        scopes: [],
        chains: [{ id: MERCADONA, defaultPriceScopeId: 'scope-deleted' }],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        supermarketIds: [MERCADONA],
      });

      expect(resolved.priceScopeIds).toEqual([]);
      expect(resolved.approximate).toBe(false);
    });

    it('contributes nothing for a chain that falls off the end of the ladder', async () => {
      const resolver = build({
        locations: [],
        scopes: [],
        chains: [{ id: MERCADONA, defaultPriceScopeId: null }],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        supermarketIds: [MERCADONA],
      });

      // The honest answer: no price for it anywhere the caller can reach. It is
      // never an average across the chain's scopes, which would be a price that
      // exists in no store.
      expect(resolved.priceScopeIds).toEqual([]);
    });

    it('prefers an exact reason over an approximate one for the same scope', async () => {
      const resolver = build({
        locations: [
          {
            supermarketId: MERCADONA,
            priceScopeId: 'shared',
            postalCode: '28001',
          },
        ],
        scopes: [],
        chains: [
          { id: MERCADONA, defaultPriceScopeId: 'shared' },
          { id: DIA, defaultPriceScopeId: 'shared' },
        ],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        supermarketIds: [MERCADONA, DIA],
      });

      expect(resolved.priceScopeIds).toEqual(['shared']);
      expect(resolved.scopes[0].origin).toBe('POSTAL_CODE');
      expect(resolved.approximate).toBe(false);
    });
  });

  it('serves a repeated question from the cache rather than the database', async () => {
    const world: World = {
      locations: [
        {
          supermarketId: MERCADONA,
          priceScopeId: 'scope-a',
          postalCode: '28001',
        },
      ],
      scopes: [],
      chains: [],
    };
    const resolver = build(world);
    const request = { userId: CALLER, postalCodes: ['28001'] };

    const first = await resolver.resolve(request);
    // The same question asked a different way: the key is order independent, so
    // a client that reorders its parameters still shares one entry.
    const second = await resolver.resolve({
      userId: 'somebody-else',
      postalCodes: ['28001'],
    });

    expect(second).toEqual(first);
    // The resolution is public reference data, so it is cached per question and
    // not per caller. Two people in one street resolve to one answer.
    expect(second).toBe(first);
  });
  /**
   * The finer axis (plan 0064, section 3). Rung one is the only rung it touches:
   * rungs two and three are about a chain with no shop here, so there is no shop
   * there to have refused.
   */
  describe('the shop preference narrows rung one', () => {
    const MERCADONA_NORTH = 'shop-mercadona-north';
    const MERCADONA_SOUTH = 'shop-mercadona-south';

    const twoMercadonas = {
      locations: [
        {
          id: MERCADONA_NORTH,
          supermarketId: MERCADONA,
          priceScopeId: 'scope-north',
          postalCode: '28001',
        },
        {
          id: MERCADONA_SOUTH,
          supermarketId: MERCADONA,
          priceScopeId: 'scope-south',
          postalCode: '28001',
        },
      ],
      scopes: [],
      chains: [],
    };

    it('drops an excluded shop and keeps its neighbour', async () => {
      const resolver = build(twoMercadonas);

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketLocationIds: [MERCADONA_NORTH],
      });

      expect(resolved.priceScopeIds).toEqual(['scope-south']);
    });

    it('leaves a chain with no prices when every one of its shops is refused', async () => {
      const resolver = build(twoMercadonas);

      // The point of the whole plan: without this a caller could refuse every
      // Mercadona near them and still be quoted Mercadona's local price.
      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketLocationIds: [MERCADONA_NORTH, MERCADONA_SOUTH],
      });

      expect(resolved.priceScopeIds).toEqual([]);
    });

    it('still reports the postal code as served, because coverage is about our data', async () => {
      const resolver = build(twoMercadonas);

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketLocationIds: [MERCADONA_NORTH, MERCADONA_SOUTH],
      });

      // Somebody who refused every shop near them has not discovered that
      // nobody serves their street. They said they will not go, and their own
      // client is the one thing that already knows it.
      expect(resolved.coverage).toEqual([
        { postalCode: '28001', served: true },
      ]);
    });

    it('never re admits a shop of a chain the caller excluded', async () => {
      const resolver = build(twoMercadonas);

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketIds: [MERCADONA],
        // Saying nothing about these two shops does not bring them back: the
        // coarser axis wins, which is section 2.1's precedence.
        excludedSupermarketLocationIds: [],
      });

      expect(resolved.priceScopeIds).toEqual([]);
    });

    it('does not reach rungs two and three, which have no shop to refuse', async () => {
      const resolver = build({
        locations: [],
        scopes: [
          {
            id: 'scope-national',
            supermarketId: LIDL,
            kind: PriceScopeKind.NATIONAL,
          },
        ],
        chains: [],
      });

      const resolved = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        supermarketIds: [LIDL],
        excludedSupermarketLocationIds: ['shop-lidl-anywhere'],
      });

      expect(resolved.priceScopeIds).toEqual(['scope-national']);
    });

    it('answers two callers refusing different shops differently', async () => {
      const resolver = build(twoMercadonas);

      const north = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketLocationIds: [MERCADONA_NORTH],
      });
      const south = await resolver.resolve({
        userId: CALLER,
        postalCodes: ['28001'],
        excludedSupermarketLocationIds: [MERCADONA_SOUTH],
      });

      // The refusals are part of the cache key. Two profiles in one postal code
      // refusing different shops are two different questions, and one answering
      // from the other's entry is the bug that key prevents.
      expect(north.priceScopeIds).toEqual(['scope-south']);
      expect(south.priceScopeIds).toEqual(['scope-north']);
    });
  });
});

/**
 * A shop that holds several scopes (plan 0105, section 5).
 *
 * The two halves of the answer say different things and this is the file that
 * pins the difference: `scopes` is everything reached, so the stack is
 * visible, and `priceScopeIds` is what a scoped read is handed, so a shop is
 * never compared against its own wider tiers.
 */
describe('ScopeResolverService and a shop stack', () => {
  const STORE = 'scope-store';
  const REGION = 'scope-region';
  const NATIONAL = 'scope-national';

  /** One Mercadona in 28001, priced by shop, by region and nationally. */
  function stacked() {
    return build({
      locations: [
        {
          id: 'shop-madrid',
          supermarketId: MERCADONA,
          // Listed widest first on purpose: the ranking is the priorities,
          // not the order somebody wrote them in.
          priceScopeIds: [NATIONAL, REGION, STORE],
          postalCode: '28001',
        },
      ],
      scopes: [
        {
          id: STORE,
          supermarketId: MERCADONA,
          kind: PriceScopeKind.STORE,
          priority: DEFAULT_SCOPE_PRIORITY.STORE,
        },
        {
          id: REGION,
          supermarketId: MERCADONA,
          kind: PriceScopeKind.REGION,
          priority: DEFAULT_SCOPE_PRIORITY.REGION,
        },
        {
          id: NATIONAL,
          supermarketId: MERCADONA,
          kind: PriceScopeKind.NATIONAL,
          priority: DEFAULT_SCOPE_PRIORITY.NATIONAL,
        },
      ],
      chains: [],
    });
  }

  it('reports the whole stack, most specific first, with its priorities', async () => {
    const resolved = await stacked().resolve({
      userId: CALLER,
      postalCodes: ['28001'],
    });

    expect(
      resolved.scopes.map((scope) => [scope.priceScopeId, scope.priority])
    ).toEqual([
      [STORE, DEFAULT_SCOPE_PRIORITY.STORE],
      [REGION, DEFAULT_SCOPE_PRIORITY.REGION],
      [NATIONAL, DEFAULT_SCOPE_PRIORITY.NATIONAL],
    ]);
    expect(
      resolved.scopes.every(
        (scope) => scope.supermarketLocationId === 'shop-madrid'
      )
    ).toBe(true);
  });

  it('hands a scoped read only the tier the shop is quoted from', async () => {
    // The rule D4 depends on. With all three ids in this list, a cheaper
    // national fallback would beat the regional price the shop charges, and
    // the shopper would be quoted a number no till will ring up.
    const resolved = await stacked().resolve({
      userId: CALLER,
      postalCodes: ['28001'],
    });

    expect(resolved.priceScopeIds).toEqual([STORE]);
    expect(resolved.scopes.filter((scope) => scope.quoted)).toHaveLength(1);
  });

  it('quotes one shop from a tier that is another shop wider one', async () => {
    // Two shops of one chain: one has a scope of its own, the other is
    // priced by the region both sit in. The region is one entry, and it is
    // quoted, because the second shop is quoted from it.
    const resolver = build({
      locations: [
        {
          id: 'shop-with-own-price',
          supermarketId: MERCADONA,
          priceScopeIds: [STORE, REGION],
          postalCode: '28001',
        },
        {
          id: 'shop-on-the-region',
          supermarketId: MERCADONA,
          priceScopeIds: [REGION],
          postalCode: '28001',
        },
      ],
      scopes: [
        {
          id: STORE,
          supermarketId: MERCADONA,
          kind: PriceScopeKind.STORE,
          priority: DEFAULT_SCOPE_PRIORITY.STORE,
        },
        {
          id: REGION,
          supermarketId: MERCADONA,
          kind: PriceScopeKind.REGION,
          priority: DEFAULT_SCOPE_PRIORITY.REGION,
        },
      ],
      chains: [],
    });

    const resolved = await resolver.resolve({
      userId: CALLER,
      postalCodes: ['28001'],
    });

    expect([...resolved.priceScopeIds].sort()).toEqual([REGION, STORE].sort());
    expect(resolved.scopes).toHaveLength(2);
  });

  it('resolves a caller who refused every shop to nothing', async () => {
    const resolved = await stacked().resolve({
      userId: CALLER,
      postalCodes: ['28001'],
      excludedSupermarketLocationIds: ['shop-madrid'],
    });

    expect(resolved.priceScopeIds).toEqual([]);
    expect(resolved.scopes).toEqual([]);
    // Coverage is a property of our data, not of what they will not walk to.
    expect(resolved.coverage).toEqual([{ postalCode: '28001', served: true }]);
  });
});
