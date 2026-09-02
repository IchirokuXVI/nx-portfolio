import type { QueryRunner, Repository } from 'typeorm';
import { ScopeResolverService } from '../../catalog/scope-resolver.service';
import type {
  PriceScope,
  Supermarket,
  SupermarketLocation,
} from '../../entities';
import {
  backfillDerivedPostalCodes,
  DerivedPostalCodes1756500000000,
} from './1756500000000-DerivedPostalCodes';

/**
 * Real Córdoba centroids from the shipped dataset. 14010, 14012 and 14013 share
 * one point in the GeoNames export, which is the tie case; 14014 is 2.4 km
 * north of them.
 */
const CORDOBA = { latitude: 37.8916, longitude: -4.7727 };
const CENTROIDS = [
  { country: 'es', postalCode: '14010', ...CORDOBA },
  { country: 'es', postalCode: '14012', ...CORDOBA },
  { country: 'es', postalCode: '14013', ...CORDOBA },
  { country: 'es', postalCode: '14014', latitude: 37.9133, longitude: -4.7685 },
];

interface Row {
  id: string;
  supermarketId?: string;
  priceScopeId?: string;
  country: string | null;
  postalCode: string | null;
  postalCodeSource: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * A runner over two arrays: the locations the backfill reads and writes, and
 * the centroids it reads. It answers the three statements the backfill makes
 * and applies the UPDATE to the array, so a second run sees what the first one
 * wrote. That is what makes re runnability testable without a database.
 */
function fakeRunner(rows: Row[]) {
  const calls: string[] = [];
  const runner = {
    query: jest.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push(sql.replace(/\s+/g, ' ').trim());

      if (sql.includes('FROM "supermarket_locations"')) {
        return rows.filter(
          (r) =>
            r.postalCode === null && r.latitude !== null && r.longitude !== null
        );
      }
      if (sql.includes('FROM "postal_code_points"')) {
        return CENTROIDS;
      }
      if (sql.startsWith('UPDATE "supermarket_locations"')) {
        const [id, postalCode, country] = (parameters ?? []) as string[];
        const row = rows.find((r) => r.id === id);
        if (row) {
          row.postalCode = postalCode;
          row.postalCodeSource = 'DERIVED';
          row.country = row.country ?? country;
        }
      }
      return [];
    }),
  } as unknown as QueryRunner;
  return { runner, calls, rows };
}

/**
 * The backfill (plan 0061, section 6). Two thirds of every location ever
 * imported has a null postal code, and section 9's criteria are what this file
 * proves: a derived code within the bound, nothing touched that already has a
 * code, null beyond the bound, and a run that can be repeated.
 */
describe('backfillDerivedPostalCodes', () => {
  it('fills a location standing near a centroid, and says the code is derived', async () => {
    // 300 m north east of the shared Córdoba point.
    const rows: Row[] = [
      {
        id: 'near',
        country: null,
        postalCode: null,
        postalCodeSource: null,
        latitude: 37.8936,
        longitude: -4.77,
      },
    ];

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);

    expect(rows[0].postalCode).toBe('14010');
    expect(rows[0].postalCodeSource).toBe('DERIVED');
  });

  it('writes the centroid’s country onto a row that never recorded one', async () => {
    // Every location imported before this plan has a null country, because
    // `import()` hardcoded it. Without this the backfill would be a no op on
    // exactly the rows it exists for.
    const rows: Row[] = [
      {
        id: 'near',
        country: null,
        postalCode: null,
        postalCodeSource: null,
        latitude: 37.8936,
        longitude: -4.77,
      },
    ];

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);

    expect(rows[0].country).toBe('es');
  });

  it('leaves a location beyond the bound with no code and no source', async () => {
    // Halfway to Madrid, where this fixture holds nothing. The shipped dataset
    // does cover that ground, so what this proves is the bound rather than a
    // claim about where Spanish postal codes run out.
    const rows: Row[] = [
      {
        id: 'nowhere',
        country: 'es',
        postalCode: null,
        postalCodeSource: null,
        latitude: 39.0,
        longitude: -4.2,
      },
    ];

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);

    expect(rows[0].postalCode).toBeNull();
    expect(rows[0].postalCodeSource).toBeNull();
  });

  it('never reads or writes a location that already has a postcode', async () => {
    const rows: Row[] = [
      {
        id: 'tagged',
        country: 'es',
        postalCode: '14014',
        postalCodeSource: 'SOURCE',
        ...CORDOBA,
      },
    ];

    const { runner, calls } = fakeRunner(rows);
    await backfillDerivedPostalCodes(runner);

    expect(rows[0].postalCode).toBe('14014');
    expect(rows[0].postalCodeSource).toBe('SOURCE');
    // Nothing to answer, so it stops before it reads the centroid table.
    expect(calls.some((sql) => sql.startsWith('UPDATE'))).toBe(false);
    expect(calls.some((sql) => sql.includes('postal_code_points'))).toBe(false);
  });

  it('is re runnable: the second pass finds nothing left to do', async () => {
    const rows: Row[] = [
      {
        id: 'near',
        country: null,
        postalCode: null,
        postalCodeSource: null,
        latitude: 37.8936,
        longitude: -4.77,
      },
    ];

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);
    const second = fakeRunner(rows);
    await backfillDerivedPostalCodes(second.runner);

    expect(rows[0].postalCode).toBe('14010');
    expect(second.calls.some((sql) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('searches only within a country the row already names', async () => {
    const rows: Row[] = [
      {
        id: 'portuguese',
        country: 'pt',
        postalCode: null,
        postalCodeSource: null,
        latitude: 37.8936,
        longitude: -4.77,
      },
    ];

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);

    // The fixture holds no Portuguese centroid, and a Spanish one 300 m away is
    // not an answer to a question about Portugal.
    expect(rows[0].postalCode).toBeNull();
  });
});

describe('DerivedPostalCodes1756500000000', () => {
  it('adds the column, then labels every code it found as the source’s', async () => {
    const { runner, calls } = fakeRunner([]);

    await new DerivedPostalCodes1756500000000().up(runner);

    expect(calls[0]).toMatch(
      /CREATE TYPE "postal_code_source" AS ENUM \('SOURCE', 'DERIVED', 'MANUAL'\)/
    );
    expect(calls[1]).toMatch(
      /ADD COLUMN "postalCodeSource" "postal_code_source"/
    );
    expect(
      calls.some((sql) =>
        /UPDATE "supermarket_locations" SET "postalCodeSource" = 'SOURCE' WHERE "postalCode" IS NOT NULL/.test(
          sql
        )
      )
    ).toBe(true);
  });

  it('takes the derived codes back down with the column that says they are derived', async () => {
    const { runner, calls } = fakeRunner([]);

    await new DerivedPostalCodes1756500000000().down(runner);

    // Leaving them behind would turn a guess into an indistinguishable fact.
    expect(calls[0]).toMatch(
      /SET "postalCode" = NULL WHERE "postalCodeSource" = 'DERIVED'/
    );
    expect(calls[1]).toMatch(/DROP COLUMN "postalCodeSource"/);
    expect(calls[2]).toMatch(/DROP TYPE "postal_code_source"/);
  });
});

/**
 * Why the backfill is worth running at all (plan 0061, section 2).
 *
 * `ScopeResolverService`'s first rung matches on `postalCode`, so a location
 * with a null one can never reach it and its chain falls to the owner set
 * default, **flagged approximate**. The user has a Mercadona 400 metres away
 * and is shown a price labelled as somebody else's city.
 *
 * This is the exit criterion in section 9 stated as one test: the same world,
 * resolved before and after the backfill, with a fresh resolver each time
 * because a resolution stands for a minute and the cache would otherwise answer
 * the second question with the first one's answer.
 */
describe('a backfilled location and the scope ladder', () => {
  const CHAIN = 'chain-mercadona';
  const STORE_SCOPE = 'scope-store';
  const DEFAULT_SCOPE = 'scope-madrid';

  /** One store in Córdoba with no postcode, and a chain default in Madrid. */
  function world(): Row[] {
    return [
      {
        id: 'store-cordoba',
        supermarketId: CHAIN,
        priceScopeId: STORE_SCOPE,
        country: null,
        postalCode: null,
        postalCodeSource: null,
        latitude: 37.8936,
        longitude: -4.77,
      },
    ];
  }

  function resolver(rows: Row[]) {
    const locations = {
      find: jest.fn(async (options: { where: { postalCode: unknown } }) => {
        const wanted = new Set(
          ((options.where.postalCode as { _value?: unknown })._value ??
            []) as string[]
        );
        return rows.filter((row) => wanted.has(row.postalCode as string));
      }),
    } as unknown as Repository<SupermarketLocation>;

    const scopes = {
      // No NATIONAL scope, so rung two is empty and rung three answers.
      find: jest.fn(async () => []),
    } as unknown as Repository<PriceScope>;

    const chains = {
      find: jest.fn(async () => [
        { id: CHAIN, defaultPriceScopeId: DEFAULT_SCOPE },
      ]),
    } as unknown as Repository<Supermarket>;

    return new ScopeResolverService(locations, scopes, chains);
  }

  it('falls to the approximate rung before the backfill and reaches rung one after', async () => {
    const rows = world();

    const before = await resolver(rows).resolve({
      userId: 'user-1',
      postalCodes: ['14010'],
      supermarketIds: [CHAIN],
    });
    expect(before.approximate).toBe(true);
    expect(before.scopes[0].origin).toBe('CHAIN_DEFAULT');
    expect(before.priceScopeIds).toEqual([DEFAULT_SCOPE]);
    expect(before.coverage).toEqual([{ postalCode: '14010', served: false }]);

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);

    const after = await resolver(rows).resolve({
      userId: 'user-1',
      postalCodes: ['14010'],
      supermarketIds: [CHAIN],
    });
    expect(after.approximate).toBe(false);
    expect(after.scopes[0].origin).toBe('POSTAL_CODE');
    expect(after.priceScopeIds).toEqual([STORE_SCOPE]);
    expect(after.coverage).toEqual([{ postalCode: '14010', served: true }]);
  });

  it('leaves the price scope exactly where it was', async () => {
    // Section 4: deriving a postcode changes what the location says about where
    // it is, not what it prices against.
    const rows = world();

    await backfillDerivedPostalCodes(fakeRunner(rows).runner);

    expect(rows[0].priceScopeId).toBe(STORE_SCOPE);
  });
});
