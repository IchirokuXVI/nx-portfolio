import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLocations, storeRef } from './stores';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const list = parseLocations(fixture('stores.html'));

/** A locator answer holding exactly these infowindows, in the plugin's shape. */
function answer(
  records: Array<{ lat: string; lng: string; infowindow: string }>
): string {
  return `<script>var locations = ${JSON.stringify({
    center: { lat: '37.2547', lng: '-7.2044' },
    locations: records,
  })};</script>`;
}

function window(name: string, street: string, locality: string): string {
  return (
    `<div class="store-infowindow"><div><h3>${name}</h3><p> ${street}<br/>\r\n` +
    ` ${locality} </p>\r\n<div><b>Horario:</b> <br/>09:00 a 21:00<br/>` +
    '<div class="wpsl-distance">1 km</div></div>'
  );
}

describe('parseLocations', () => {
  it('reads every record, and keeps 366 shops after dropping two', () => {
    expect(list.recordsRead).toBe(368);
    expect(list.stores).toHaveLength(366);
    expect(list.dropped).toHaveLength(2);
  });

  it('drops the Cash Lepe records as another banner, by name', () => {
    expect(list.dropped.map((record) => record.reason)).toEqual([
      'OTHER_BANNER',
      'OTHER_BANNER',
    ]);
    expect(
      list.dropped.every((record) => /^Cash Lepe/.test(record.name ?? ''))
    ).toBe(true);
  });

  it('gives every shop a unique externalRef', () => {
    const refs = new Set(list.stores.map((store) => store.externalRef));
    expect(refs.size).toBe(list.stores.length);
  });

  it('reads the street, town, province, postal code and hours, accents decoded', () => {
    expect(list.stores[0]).toMatchObject({
      name: 'Supermercados El Jamón',
      street: 'Calle Juan de Lepe 15',
      city: 'Lepe',
      province: 'Huelva',
      postalCode: '21440',
      externalRef: '21440:calle juan de lepe 15',
      openingHours: 'De Lunes a Sábado: 09:00 a 14:30 y de 17:30 a 21:30',
    });
    expect(typeof list.stores[0].latitude).toBe('number');
  });

  it('keeps a name the plugin broke over two lines', () => {
    const [store] = parseLocations(
      answer([
        {
          lat: '37.25',
          lng: '-7.20',
          infowindow: window(
            'Supermercados <br/> El Jamón',
            'Avda. de Andalucía, 9',
            'Lepe, Huelva Spain 21440'
          ),
        },
      ])
    ).stores;
    expect(store.name).toBe('Supermercados El Jamón');
    expect(store.externalRef).toBe('21440:avda de andalucia 9');
  });

  it('drops and names a record with no postal code', () => {
    const read = parseLocations(
      answer([
        {
          lat: '37.25',
          lng: '-7.20',
          infowindow: window(
            'Supermercados El Jamón',
            'Calle Mayor 1',
            'Lepe, Huelva Spain'
          ),
        },
      ])
    );
    expect(read.stores).toEqual([]);
    expect(read.dropped).toEqual([
      {
        reason: 'NO_POSTAL_CODE',
        name: 'Supermercados El Jamón',
        street: 'Calle Mayor 1',
        city: 'Lepe',
        postalCode: null,
      },
    ]);
  });

  it('drops a second record for the same shop as a duplicate', () => {
    const record = {
      lat: '37.25',
      lng: '-7.20',
      infowindow: window(
        'Supermercados El Jamón',
        'Calle Mayor 1',
        'Lepe, Huelva Spain 21440'
      ),
    };
    const read = parseLocations(answer([record, { ...record, lat: '37.26' }]));
    expect(read.stores).toHaveLength(1);
    expect(read.dropped.map((dropped) => dropped.reason)).toEqual([
      'DUPLICATE',
    ]);
  });

  it('throws on an answer with no locations object', () => {
    expect(() => parseLocations('<p>nothing here</p>')).toThrow(/locations/);
  });
});

describe('storeRef', () => {
  it('ignores accents, case and punctuation, never the coordinates', () => {
    expect(storeRef('21440', 'Avda. Diputación,  54')).toBe(
      storeRef('21440', 'avda diputacion 54')
    );
  });
});
