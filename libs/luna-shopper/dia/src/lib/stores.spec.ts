import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  candidatesNear,
  distanceMetres,
  isTemporarilyClosed,
  parseStoreDetail,
  parseStoreFile,
  parseStoreFileUrl,
} from './stores';
import type { DiaStoreRecord } from './types';

const bytes = (name: string): Buffer =>
  readFileSync(join(__dirname, '__fixtures__', name));
const json = (name: string): unknown =>
  JSON.parse(bytes(name).toString('utf8'));

const file = parseStoreFile(bytes('stores.json.gz'));

/** The centroid GeoNames gives 28004, where the fixture's normal shop sits. */
const MADRID_28004 = { latitude: 40.4238, longitude: -3.6996 };

describe('parseStoreFileUrl', () => {
  it('reads the current file from the hidden gz input of the page', () => {
    const url = parseStoreFileUrl(
      bytes('store-finder.html').toString('utf8'),
      'https://www.dia.es'
    );
    expect(url).toMatch(
      /^https:\/\/www\.dia\.es\/clubdia\/ES\/tiendas\.v\d+\.json\.gz$/
    );
  });

  it('accepts a bare file name and a path, and never a hard coded version', () => {
    expect(
      parseStoreFileUrl(
        '<input type="hidden" id="gz" value="tiendas.v9.json.gz">',
        'https://www.dia.es'
      )
    ).toBe('https://www.dia.es/clubdia/ES/tiendas.v9.json.gz');
    expect(
      parseStoreFileUrl(
        "<input value='/x/tiendas.v9.json.gz' id='gz'/>",
        'https://www.dia.es'
      )
    ).toBe('https://www.dia.es/x/tiendas.v9.json.gz');
  });

  it('answers null for a page with no such input', () => {
    expect(parseStoreFileUrl('<html></html>', 'https://www.dia.es')).toBeNull();
  });
});

describe('parseStoreFile', () => {
  it('unpacks the gzip file and reads every record', () => {
    expect(file.total).toBeGreaterThan(3000);
    expect(
      file.stores.length + file.clarelDropped + file.unreadable.length
    ).toBe(file.total);
  });

  it('drops the Clarel records and counts them', () => {
    expect(file.clarelDropped).toBeGreaterThan(700);
    expect(file.stores.length).toBeGreaterThan(2300);
    expect(file.stores.every((store) => store.tipoTienda === 0)).toBe(true);
  });

  it('reads posicionX as the latitude and posicionY as the longitude', () => {
    const crevillent = file.stores.find((store) => store.idTienda === '1443');
    expect(crevillent).toEqual({
      idTienda: '1443',
      codigoTienda: '1443',
      tipoTienda: 0,
      provinceCode: '03',
      latitude: 38.246076,
      longitude: -0.800414,
    });
  });

  it('keeps idTienda and codigoTienda apart, because they differ', () => {
    const hub = file.stores.find((store) => store.codigoTienda === '13835');
    expect(hub?.idTienda).toBe('1003554');
  });

  it('reads the same records from a file packed twice and from plain text', () => {
    const plain = JSON.stringify([
      {
        tipoTienda: 0,
        codigoProvincia: 8,
        codigoTienda: 959,
        idTienda: 1003553,
        posicionX: '41.3',
        posicionY: '2.1',
      },
      { tipoTienda: 1, codigoProvincia: 8, codigoTienda: 1, idTienda: 1 },
      { tipoTienda: 0, codigoProvincia: 8, codigoTienda: 2, idTienda: 2 },
    ]);
    const expected = {
      stores: [
        {
          idTienda: '1003553',
          codigoTienda: '959',
          tipoTienda: 0,
          provinceCode: '08',
          latitude: 41.3,
          longitude: 2.1,
        },
      ],
      total: 3,
      clarelDropped: 1,
      // A DIA record with no coordinates is named, never reported as a place.
      unreadable: ['2'],
    };
    expect(parseStoreFile(plain)).toEqual(expected);
    expect(parseStoreFile(gzipSync(gzipSync(plain)))).toEqual(expected);
  });

  it('refuses a file that is not a list', () => {
    expect(() => parseStoreFile('{}')).toThrow(/not a list/);
  });
});

describe('parseStoreDetail', () => {
  it('reads the address, postal code, town, phone and hours of a shop', () => {
    expect(parseStoreDetail(json('store-detail-normal.json'))).toMatchObject({
      storeCode: '14126',
      street: 'CL. CHURRUCA 2 C/V BARCELO 2',
      postalCode: '28004',
      city: 'Madrid',
      phone: '626048859',
      hours: { '1': '08:30 - 22:00', '7': '10:00 - 22:00' },
      homeDelivery: true,
      reopensOn: null,
    });
  });

  it('keeps the leaflet, the fresh counters and the holidays verbatim', () => {
    const detail = parseStoreDetail(json('store-detail-leaflet.json'));
    expect(detail?.postalCode).toBe('03330');
    expect(detail?.fresh).toContain('Venta de pollo');
    expect(JSON.parse(detail?.leaflet ?? '{}')).toEqual({
      folletoId: expect.any(Number),
      documentoFolletoId: expect.any(Number),
      validezFolleto2: expect.any(String),
    });
    expect(JSON.parse(detail?.holidays ?? '{}')).toEqual({
      festivosTienda: expect.any(Array),
      horariosAperturaFestivo: expect.any(Array),
    });
    expect(detail?.homeDelivery).toBe(false);
  });

  it('reads no leaflet and no fresh counters for a shop that has none', () => {
    const hub = parseStoreDetail(json('store-detail-hub.json'));
    expect(hub?.leaflet).toBeNull();
    expect(hub?.fresh).toBeNull();
  });

  it('answers null for an answer that names no shop', () => {
    expect(parseStoreDetail({})).toBeNull();
    expect(parseStoreDetail(null)).toBeNull();
  });
});

describe('isTemporarilyClosed', () => {
  const hub = parseStoreDetail(json('store-detail-hub.json'));
  const normal = parseStoreDetail(json('store-detail-normal.json'));

  it('drops a hub, whose fechaApertura is in the future', () => {
    expect(hub?.reopensOn).toBe('2026-12-31');
    expect(hub && isTemporarilyClosed(hub, new Date('2026-10-02'))).toBe(true);
  });

  it('keeps the same shop once the date has passed', () => {
    expect(hub && isTemporarilyClosed(hub, new Date('2027-01-01'))).toBe(false);
    expect(hub && isTemporarilyClosed(hub, new Date('2026-12-31'))).toBe(false);
  });

  it('keeps a shop that states no reopening date', () => {
    expect(normal && isTemporarilyClosed(normal, new Date('2026-10-02'))).toBe(
      false
    );
  });
});

describe('candidatesNear', () => {
  const shop = (overrides: Partial<DiaStoreRecord>): DiaStoreRecord => ({
    idTienda: '1',
    codigoTienda: '1',
    tipoTienda: 0,
    provinceCode: '28',
    latitude: MADRID_28004.latitude,
    longitude: MADRID_28004.longitude,
    ...overrides,
  });

  it('keeps the shops of the province inside the radius, and no other', () => {
    const near = shop({ idTienda: 'near' });
    // About 1.1 km north.
    const inside = shop({ idTienda: 'inside', latitude: 40.4338 });
    // About 11 km north.
    const outside = shop({ idTienda: 'outside', latitude: 40.5238 });
    // On the centroid, and in another province.
    const otherProvince = shop({ idTienda: 'other', provinceCode: '45' });
    expect(
      candidatesNear(
        [near, inside, outside, otherProvince],
        '28004',
        MADRID_28004,
        5_000
      ).map((store) => store.idTienda)
    ).toEqual(['near', 'inside']);
  });

  it('finds the fixture shop of 28004 among the candidates of that code', () => {
    const candidates = candidatesNear(file.stores, '28004', MADRID_28004);
    expect(candidates.some((store) => store.codigoTienda === '14126')).toBe(
      true
    );
    // A candidate list, not the country: the radius and the province narrow it.
    expect(candidates.length).toBeLessThan(200);
    expect(candidates.every((store) => store.provinceCode === '28')).toBe(true);
  });

  it('keeps a candidate only: the exact postal code is the detail’s to say', () => {
    // 14126 sits on 28004. A request for 28005 has it as a candidate too, and
    // only its detail can say it is not a shop of 28005.
    const candidates = candidatesNear(file.stores, '28005', MADRID_28004);
    const detail = parseStoreDetail(json('store-detail-normal.json'));
    expect(candidates.some((store) => store.codigoTienda === '14126')).toBe(
      true
    );
    expect(detail?.postalCode).not.toBe('28005');
  });

  it('measures a degree of latitude as about 111 km', () => {
    expect(
      distanceMetres(
        { latitude: 40, longitude: -3 },
        { latitude: 41, longitude: -3 }
      )
    ).toBeCloseTo(111_195, -2);
  });
});
