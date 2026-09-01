import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { PriceScope, Supermarket, SupermarketLocation } from '../entities';
import { ScopeResolverService } from './scope-resolver.service';

const CALLER = 'user-1';

/** Chains, so a supermarket id in a failure message is readable. */
const MERCADONA = 'chain-mercadona';
const LIDL = 'chain-lidl';
const DIA = 'chain-dia';

interface World {
  locations: Partial<SupermarketLocation>[];
  scopes: Partial<PriceScope>[];
  chains: Partial<Supermarket>[];
}

/**
 * The three repositories, answering from plain arrays. `In(...)` is a TypeORM
 * value object rather than a list, so each double reads the ids back out of it:
 * matching what the service asked for is the whole job of these fakes.
 */
function build(world: World) {
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
      async (options: { where: { supermarketId: unknown; kind: unknown } }) => {
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

  return new ScopeResolverService(locations, scopes, chains);
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
        },
      ]);
      expect(resolved.approximate).toBe(false);
    });

    it('falls to the owner set default last, and says the answer is approximate', async () => {
      const resolver = build({
        locations: [],
        scopes: [],
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
        },
      ]);
      // What lets the client say "prices shown for Madrid" instead of implying
      // the number is the caller's.
      expect(resolved.approximate).toBe(true);
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
});
