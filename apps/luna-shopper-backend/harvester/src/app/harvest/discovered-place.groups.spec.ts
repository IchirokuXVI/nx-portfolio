import {
  DiscoveredPlaceStatus,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { DiscoveredPlace } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { DiscoveredPlaceService } from './discovered-place.service';
import type { PlatformAdminService } from './platform-admin.service';

const ADMIN = 'owner-1';
const DIA_KEY = 'Q1';

let sequence = 0;

function place(
  name: string | null,
  brandName: string | null = null,
  brandKey: string | null = null
): DiscoveredPlace {
  sequence += 1;
  return {
    id: `place-${sequence}`,
    runId: 'run-1',
    provider: 'OSM',
    externalRef: `node/${sequence}`,
    brandKey,
    brandName,
    name,
    latitude: 37.88,
    longitude: -4.77,
    street: null,
    city: 'Córdoba',
    postalCode: '14011',
    postalCodeSource: null,
    country: 'es',
    website: null,
    openingHours: null,
    tags: {},
    scopeKey: null,
    status: DiscoveredPlaceStatus.NEW,
    supermarketLocationId: null,
    firstSeenAt: new Date('2026-09-23T00:00:00.000Z'),
    lastSeenAt: new Date('2026-09-23T00:00:00.000Z'),
  } as DiscoveredPlace;
}

/**
 * The keyless places OpenStreetMap returned around Córdoba in plan 0150
 * (`responses/03-p1-step4/places-all.json`), plus two Dia shops that carry a
 * brand key. "Ana" is the one place whose brand is Alsara, and it is the place
 * that used to name the whole keyless bucket.
 */
function cordoba(): DiscoveredPlace[] {
  return [
    ...Array.from({ length: 7 }, () => place('Deza')),
    place('Supercash Sector Sur'),
    place('Ana', 'Alsara'),
    place('Alsara'),
    place('Alimentación Manoli'),
    place('Piedra'),
    place('Piedra'),
    place(null),
    place('Dia', 'Dia', DIA_KEY),
    place('Maxi Dia', 'Dia', DIA_KEY),
  ].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

function build(rows: DiscoveredPlace[]) {
  const queryBuilder = {
    orderBy: () => queryBuilder,
    andWhere: () => queryBuilder,
    getMany: async () => rows,
  };
  const places = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  } as unknown as Repository<DiscoveredPlace>;

  const catalog = {
    listSupermarkets: jest.fn(async () => ({
      items: [
        {
          id: 'chain-dia',
          name: { es: 'Dia', en: 'Dia' },
          externalBrandKey: DIA_KEY,
        } as SupermarketView,
      ],
      nextCursor: null,
    })),
  } as unknown as jest.Mocked<CatalogClient>;

  const admin = {
    requireAdmin: jest.fn(async () => ADMIN),
  } as unknown as jest.Mocked<PlatformAdminService>;

  return new DiscoveredPlaceService(places, catalog, admin);
}

/**
 * How the places queue groups what a run found (plan 0154). A brand key still
 * wins; a place with none groups by its brand name, then by its own name.
 */
describe('DiscoveredPlaceService.groups', () => {
  it('puts the DEZA places together and never calls them Alsara', async () => {
    const { groups } = await build(cordoba()).groups({ userId: ADMIN });

    const deza = groups.filter((group) =>
      group.sample.some((sample) => sample.name === 'Deza')
    );
    expect(deza).toHaveLength(1);
    expect(deza[0]).toMatchObject({
      brandKey: null,
      brandName: 'Deza',
      count: 7,
      known: false,
    });
  });

  it('gives Alsara only the places that say Alsara', async () => {
    const { groups } = await build(cordoba()).groups({
      userId: ADMIN,
      sampleSize: 20,
    });

    const alsara = groups.filter((group) => group.brandName === 'Alsara');
    expect(
      alsara.flatMap((group) => group.sample.map((sample) => sample.name))
    ).toEqual(expect.arrayContaining(['Ana', 'Alsara']));
    expect(alsara.reduce((sum, group) => sum + group.count, 0)).toBe(2);
  });

  it('labels a place with neither a brand nor a name as the no brand group', async () => {
    const { groups } = await build(cordoba()).groups({ userId: ADMIN });

    const noBrand = groups.filter((group) => group.brandName === null);
    expect(noBrand).toHaveLength(1);
    expect(noBrand[0]).toMatchObject({ brandKey: null, count: 1 });
    expect(noBrand[0].sample[0].name).toBeNull();
  });

  it('still groups on the brand key first, and matches it to a known chain', async () => {
    const { groups } = await build(cordoba()).groups({ userId: ADMIN });

    const dia = groups.filter((group) => group.brandKey === DIA_KEY);
    expect(dia).toHaveLength(1);
    expect(dia[0]).toMatchObject({
      brandName: 'Dia',
      count: 2,
      known: true,
      supermarketId: 'chain-dia',
    });
  });

  it('folds case and accents in a name', async () => {
    const { groups } = await build([
      place('Deza'),
      place('DEZA'),
      place('Alimentación Manoli'),
      place('Alimentacion Manoli'),
    ]).groups({ userId: ADMIN });

    expect(groups.map((group) => group.count)).toEqual([2, 2]);
  });

  it('keeps every place in exactly one group', async () => {
    const rows = cordoba();
    const { groups } = await build(rows).groups({ userId: ADMIN });

    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(
      rows.length
    );
  });
});
