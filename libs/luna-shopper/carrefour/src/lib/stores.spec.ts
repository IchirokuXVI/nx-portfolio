import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeXmlAttribute,
  parseStoreLocator,
  type CarrefourStoreList,
} from './stores';

/**
 * The store finder's document as `capture-fixtures` wrote it on 2026-11-06,
 * verbatim (plan 0223, section 2). The plan measured 1,974 records on
 * 2026-10-22; the counts below are the captured ones.
 */
const XML = readFileSync(
  join(__dirname, '__fixtures__', 'store-locator.xml'),
  'utf8'
);

const countBy = <T>(items: readonly T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((counts, item) => {
    counts[key(item)] = (counts[key(item)] ?? 0) + 1;
    return counts;
  }, {});

describe('parseStoreLocator', () => {
  let list: CarrefourStoreList;

  beforeAll(() => {
    list = parseStoreLocator(XML);
  });

  it('reads every record, and each one is a shop or a dropped record', () => {
    expect(list.recordsRead).toBe(1976);
    expect(list.stores.length + list.dropped.length).toBe(list.recordsRead);
  });

  it('counts each grocery format', () => {
    expect(countBy(list.stores, (store) => store.format)).toEqual({
      HIPERMERCADO: 204,
      MARKET: 161,
      EXPRESS: 835,
      EXPRESS_CEPSA: 384,
      BIO: 2,
    });
  });

  it('names the reason for every record it drops', () => {
    expect(countBy(list.dropped, (record) => record.reason)).toEqual({
      NOT_GROCERY: 377,
      OUTSIDE_SPAIN: 11,
      NO_REFERENCE: 1,
      BAD_POSTAL_CODE: 1,
    });
    // Travel agencies, petrol stations and outlets are not grocery.
    expect(
      countBy(
        list.dropped.filter((record) => record.reason === 'NOT_GROCERY'),
        (record) => record.category
      )
    ).toEqual({
      'Agencia de Viajes': 214,
      'Estación de Servicio': 147,
      'Hipermercado Outlet': 16,
    });
  });

  it('drops the 11 Andorran shops, whose country attribute says es', () => {
    const andorra = list.dropped.filter(
      (record) => record.reason === 'OUTSIDE_SPAIN'
    );
    expect(andorra).toHaveLength(11);
    expect(XML.match(/postal="AD\d+\s*"[^>]*country="es"/g)).toHaveLength(11);
  });

  it('trims a trailing space from a postal code', () => {
    expect(XML).toContain('postal="10450 "');
    const shop = list.stores.find(
      (store) => store.externalRef === 'tcm:5-17300'
    );
    expect(shop?.postalCode).toBe('10450');
  });

  it('drops the Express CEPSA record that carries no tcm', () => {
    expect(
      list.dropped.filter((record) => record.reason === 'NO_REFERENCE')
    ).toEqual([
      {
        name: 'Carrefour Express CEPSA Moraira',
        category: 'Supermercado Carrefour Express CEPSA',
        reason: 'NO_REFERENCE',
      },
    ]);
  });

  it('gives every shop a distinct external reference', () => {
    const refs = list.stores.map((store) => store.externalRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('decodes an entity in an attribute', () => {
    expect(XML).toContain('name="Carrefour Market Platja d&#39;Aro"');
    const shop = list.stores.find(
      (store) => store.externalRef === 'tcm:5-4082'
    );
    expect(shop?.name).toBe("Carrefour Market Platja d'Aro");
    expect(decodeXmlAttribute('a &amp; b &lt;&gt; &quot;&apos; &#x41;')).toBe(
      `a & b <> "' A`
    );
  });

  it('reads the fields of one hypermarket', () => {
    expect(
      list.stores.find((store) => store.externalRef === 'tcm:5-3850')
    ).toEqual({
      externalRef: 'tcm:5-3850',
      format: 'HIPERMERCADO',
      category: 'Hipermercado',
      name: 'Carrefour Actur Zaragoza',
      latitude: 41.67581,
      longitude: -0.88995,
      // `address2` is blank, so the street is `address` alone.
      street: 'Calle María Zambrano, 71',
      city: 'Zaragoza',
      province: 'Zaragoza',
      postalCode: '50018',
      phone: '602438643',
      web: '/tiendas-carrefour/hipermercados/carrefour/actur_zaragoza.aspx',
      hours: ['de 09:00 a 22:00', 'de 09:00 a 22:00'],
      features: expect.arrayContaining([
        'Carrefour Drive',
        'Entrega a domicilio',
      ]),
      codsa: '0083',
      codat: '004I',
    });
  });

  it('joins address2 to the street, and drops a record with no coordinates', () => {
    const parsed = parseStoreLocator(
      '<markers>' +
        '<marker name="A" lat="40.1" lng="-3.2" category="Hipermercado" ' +
        'address="Calle Uno, 1" address2="Local 4" postal="28001" tcm="tcm:1" />' +
        '<marker name="B" lat="" lng="-3.2" category="Hipermercado" ' +
        'address="Calle Dos" postal="28001" tcm="tcm:2" />' +
        '</markers>'
    );
    expect(parsed.stores.map((store) => store.street)).toEqual([
      'Calle Uno, 1 Local 4',
    ]);
    expect(parsed.dropped).toEqual([
      { name: 'B', category: 'Hipermercado', reason: 'BAD_COORDINATES' },
    ]);
  });
});
