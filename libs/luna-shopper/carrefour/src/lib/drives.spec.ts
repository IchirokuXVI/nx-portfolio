import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import drivesFixture from './__fixtures__/drives.json';
import { parseDrives, salePointsByShop, type CarrefourDrive } from './drives';
import { parseStoreLocator, type CarrefourStore } from './stores';

/**
 * The drive list and the store finder, as `capture-fixtures` wrote them on
 * 2026-11-06 (plan 0223, section 3).
 */
const STORES = parseStoreLocator(
  readFileSync(join(__dirname, '__fixtures__', 'store-locator.xml'), 'utf8')
).stores;
const DRIVES = parseDrives(drivesFixture);

/** The shop each drive joined, by its sale point. */
function shopOfDrive(
  joined: Map<string, CarrefourDrive>
): Map<string, CarrefourStore> {
  const byRef = new Map(STORES.map((store) => [store.externalRef, store]));
  return new Map(
    [...joined].map(([ref, drive]) => [
      drive.salePointId,
      byRef.get(ref) as CarrefourStore,
    ])
  );
}

describe('parseDrives', () => {
  it('reads every sale point of every group', () => {
    expect(DRIVES).toHaveLength(179);
    expect(DRIVES.find((drive) => drive.salePointId === '005290')).toEqual({
      salePointId: '005290',
      storeId: '800002',
      name: 'Drive Hiper El Pinar',
      latitude: 40.52383,
      longitude: -3.883674,
      postalCode: '28230',
    });
  });

  it('skips an element with no id or no coordinates', () => {
    expect(
      parseDrives({
        groups: [
          {
            name: 'x',
            sale_points: [
              { latitude: '40', longitude: '-3', name: 'no id' },
              { sale_point_id: '1', longitude: '-3', name: 'no latitude' },
              { sale_point_id: 2, latitude: 40, longitude: -3, name: 'kept' },
              'not an object',
            ],
          },
          { name: 'no list' },
        ],
      }).map((drive) => drive.name)
    ).toEqual(['kept']);
    expect(parseDrives(null)).toEqual([]);
    expect(parseDrives({ groups: 'no' })).toEqual([]);
  });
});

describe('salePointsByShop', () => {
  const joined = salePointsByShop(STORES, DRIVES);
  const byDrive = shopOfDrive(joined);

  it('joins the walk sale point 005290 to the El Pinar hypermarket', () => {
    expect(byDrive.get('005290')?.name).toBe('Carrefour El Pinar');
    expect(byDrive.get('005290')?.format).toBe('HIPERMERCADO');
  });

  it('joins only hypermarkets, Markets and BIO shops, never a petrol station', () => {
    expect(joined.size).toBe(178);
    expect(new Set([...byDrive.values()].map((store) => store.format))).toEqual(
      new Set(['HIPERMERCADO', 'MARKET'])
    );
    // The one drive whose nearest record is the petrol station of its own
    // site joins nothing rather than the station.
    expect(
      DRIVES.filter((drive) => !byDrive.has(drive.salePointId)).map(
        (drive) => drive.name
      )
    ).toEqual(['Drive Hiper San Fernando']);
  });

  it('joins nothing to a drive 200 m from every shop', () => {
    const shop = STORES.find((store) => store.name === 'Carrefour El Pinar');
    const far: CarrefourDrive = {
      salePointId: 'far',
      storeId: 'far',
      name: 'A drive in a field',
      // About 200 m north of the hypermarket, and farther from every other.
      latitude: (shop?.latitude ?? 0) + 0.0018,
      longitude: shop?.longitude ?? 0,
      postalCode: null,
    };
    expect(salePointsByShop(STORES, [far]).size).toBe(0);
  });

  describe('at the 150 m limit, against one shop', () => {
    const shop = STORES.find(
      (store) => store.name === 'Carrefour El Pinar'
    ) as CarrefourStore;
    /** A drive due north of the shop, by a latitude offset in degrees. */
    const northOf = (salePointId: string, offset: number): CarrefourDrive => ({
      salePointId,
      storeId: salePointId,
      name: `Drive ${salePointId}`,
      latitude: shop.latitude + offset,
      longitude: shop.longitude,
      postalCode: null,
    });

    it('joins a drive about 140 m away', () => {
      const joined = salePointsByShop([shop], [northOf('near', 0.00126)]);
      expect(joined.get(shop.externalRef)?.salePointId).toBe('near');
    });

    it('joins nothing to a drive about 160 m away', () => {
      expect(salePointsByShop([shop], [northOf('far', 0.00144)]).size).toBe(0);
    });

    it('keeps the nearer of two drives that reach the same shop', () => {
      const nearer = northOf('nearer', 0.0005);
      const farther = northOf('farther', 0.001);
      for (const drives of [
        [nearer, farther],
        [farther, nearer],
      ]) {
        const joined = salePointsByShop([shop], drives);
        expect(joined.size).toBe(1);
        expect(joined.get(shop.externalRef)?.salePointId).toBe('nearer');
      }
    });
  });
});
