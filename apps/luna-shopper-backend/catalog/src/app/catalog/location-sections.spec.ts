import type { Repository } from 'typeorm';
import type { SupermarketLocation } from '../entities';
import {
  PRESENT_SECTIONS_SQL,
  presentSectionsOf,
  sectionNamesOf,
  type SqlRunner,
} from './location-sections';
import { NearbyShopsService } from './nearby-shops.service';

/**
 * The batched section names of plan 0170, section 2, over a recording double.
 *
 * What a double can prove is the shape of the call and the grouping of what
 * comes back: one statement for any number of shops, and each shop's rows in
 * the order the statement answered them. That the statement itself applies the
 * rule of `section.forLocation` is `section.integration.spec.ts`'s to prove.
 */
const shopId = (n: number) =>
  `ac700000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const CHAIN = 'ac700000-0000-4000-a000-0000000c4a17';

interface Row {
  locationId: string;
  own: boolean;
  id: string | null;
  supermarketId: string | null;
  slug: string | null;
  name: { es: string } | null;
  position: number | string | null;
}

function section(locationId: string, n: number, own = false): Row {
  return {
    locationId,
    own,
    id: `5ec70000-0000-4000-a000-${String(n).padStart(12, '0')}`,
    supermarketId: CHAIN,
    slug: `s${n}`,
    name: { es: `Pasillo ${n}` },
    // node-postgres answers an int column as a number and a bigint as text.
    position: String(n),
  };
}

function none(locationId: string): Row {
  return {
    locationId,
    own: false,
    id: null,
    supermarketId: null,
    slug: null,
    name: null,
    position: null,
  };
}

function recorder(rows: Row[]) {
  const calls: { sql: string; parameters?: unknown[] }[] = [];
  const runner: SqlRunner = {
    query: async (sql: string, parameters?: unknown[]) => {
      calls.push({ sql, parameters });
      return rows;
    },
  };
  return { runner, calls };
}

describe('presentSectionsOf', () => {
  it('asks once for thirty shops, and groups each shop in the order answered', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => shopId(i));
    const rows = ids.flatMap((id, i) =>
      i === 0
        ? [section(id, 2, true), section(id, 1, true)]
        : i === 1
          ? [none(id)]
          : [section(id, 1)]
    );
    const { runner, calls } = recorder(rows);

    const present = await presentSectionsOf(runner, ids);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe(PRESENT_SECTIONS_SQL);
    expect(calls[0].parameters).toEqual([ids]);
    expect(present.size).toBe(30);
    expect(present.get(ids[0])).toEqual({
      source: 'LOCATION',
      rows: [
        expect.objectContaining({ slug: 's2', position: 2 }),
        expect.objectContaining({ slug: 's1', position: 1 }),
      ],
    });
    expect(present.get(ids[1])).toEqual({ source: 'CHAIN', rows: [] });
    expect(present.get(ids[2])?.source).toBe('CHAIN');
  });

  it('sends no malformed id, no repeat, and nothing at all for no shops', async () => {
    const { runner, calls } = recorder([]);
    await presentSectionsOf(runner, []);
    await presentSectionsOf(runner, ['nope']);
    expect(calls).toHaveLength(0);

    await presentSectionsOf(runner, [
      shopId(1),
      shopId(1).toUpperCase(),
      'nope',
    ]);
    expect(calls).toEqual([
      { sql: PRESENT_SECTIONS_SQL, parameters: [[shopId(1)]] },
    ]);
  });
});

describe('sectionNamesOf', () => {
  it('keys the names by the id as given, empty for a shop with none, absent for no shop', async () => {
    const upper = shopId(1).toUpperCase();
    const { runner } = recorder([section(shopId(1), 7), none(shopId(2))]);

    const names = await sectionNamesOf(runner, [upper, shopId(2), shopId(3)]);

    expect([...names.keys()]).toEqual([upper, shopId(2)]);
    expect(names.get(upper)).toEqual([
      { id: section(shopId(1), 7).id, name: { es: 'Pasillo 7' } },
    ]);
    expect(names.get(shopId(2))).toEqual([]);
  });
});

describe('NearbyShopsService.shopsById', () => {
  it('names thirty shops with one sections statement, not one per shop', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => shopId(i));
    const found = ids.map((id) => ({
      id,
      supermarketId: CHAIN,
      supermarket: {
        id: CHAIN,
        name: { es: 'Cadena' },
        logoUrl: 'https://example.test/logo.svg',
      },
      label: null,
      address: null,
      city: null,
      postalCode: null,
    }));
    const statements: unknown[][] = [];
    const locations = {
      find: async () => found,
      query: async (_sql: string, parameters: unknown[]) => {
        statements.push(parameters);
        return ids.map((id) => section(id, 1));
      },
    } as unknown as Repository<SupermarketLocation>;

    const view = await new NearbyShopsService(locations).shopsById({
      supermarketLocationIds: ids,
      profilePostalCodes: [],
    });

    expect(statements).toHaveLength(1);
    expect(view.shops).toHaveLength(30);
    expect(view.shops[0]).toMatchObject({
      supermarketLogoUrl: 'https://example.test/logo.svg',
      sections: [{ id: section(ids[0], 1).id, name: { es: 'Pasillo 1' } }],
    });
  });
});
