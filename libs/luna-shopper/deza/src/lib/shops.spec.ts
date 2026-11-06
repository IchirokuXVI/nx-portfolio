import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseShopDirectory, parseShopPage, readShopCode } from './shops';
import type { DezaDirectoryEntry, DezaShopPage } from './types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const CENTROS = fixture('centros.html');
const directory = parseShopDirectory(CENTROS);
const shops = directory.entries.filter((entry) =>
  entry.linkText?.startsWith('Ver Tienda')
);
const byTitle = (title: string): DezaDirectoryEntry => {
  const entry = directory.entries.find(
    (candidate) => candidate.title === title
  );
  if (!entry) {
    throw new Error(`No pin titled ${title}`);
  }
  return entry;
};

/**
 * DEZA's own shop list (plan 0222, section 2), read from the pages captured
 * by `capture-fixtures`. Nothing here reaches a network.
 */
describe('parseShopDirectory', () => {
  it('reads the 13 pins of the map, 10 of them shops', () => {
    expect(directory.entries).toHaveLength(13);
    expect(directory.withoutCoordinates).toEqual([]);
    expect(shops).toHaveLength(10);
    expect(shops.every((entry) => entry.shopPageUrl !== null)).toBe(true);
  });

  it('reads the 8 category codes and no code from the parent category', () => {
    const codes = directory.entries
      .map((entry) => entry.categoryCode)
      .filter((code): code is string => code !== null)
      .sort();
    expect(codes).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'Z1']);
    expect(byTitle('SuperCash (Las Quemadas)').categoryCode).toBeNull();
  });

  it('reads a pin with no category at all, and still its shop page', () => {
    expect(byTitle('SuperCash (Sector Sur)')).toMatchObject({
      categoryCode: null,
      shopPageUrl: 'https://www.dezacalidad.es/centros/supercash-sector-sur/',
      linkText: 'Ver Tienda',
      phone: null,
    });
  });

  it('reads the pin of a shop with its coordinates, address and phone', () => {
    expect(byTitle('Tienda 1')).toEqual({
      postId: '32',
      title: 'Tienda 1',
      latitude: 37.89082,
      longitude: -4.761648,
      mapAddress: 'Avenida de Jesús Rescatado, 15',
      phone: '957 076 802',
      shopPageUrl:
        'https://www.dezacalidad.es/centros/avda-de-jesus-rescatado/',
      linkText: 'Ver Tienda',
      categoryCode: 'T1',
    });
  });

  it('takes the Zoco shop page and not the perfumery or the salon beside it', () => {
    expect(byTitle('Zoco')).toMatchObject({
      categoryCode: 'Z1',
      shopPageUrl:
        'https://www.dezacalidad.es/centros/centro-comercial-zoco-calle-jose-maria-martorell/',
      linkText: 'Ver Tienda',
    });
  });

  it('names the warehouses and the bakery by their own link text', () => {
    const others = directory.entries
      .filter((entry) => !entry.linkText?.startsWith('Ver Tienda'))
      .map((entry) => entry.title)
      .sort();
    expect(others).toEqual(['Almacén 1', 'Almacén 2', 'Pan Obrador']);
  });

  it('reads the Centros menu titles by URL', () => {
    expect(
      directory.menuTitles.get(
        'https://www.dezacalidad.es/centros/avda-de-jesus-rescatado/'
      )
    ).toBe('Avda Jesús Rescatado');
    expect(
      directory.menuTitles.get(
        'https://www.dezacalidad.es/centros/pol-ind-las-quemadas/'
      )
    ).toBe('SuperCash Las Quemadas');
    for (const shop of shops) {
      expect(directory.menuTitles.has(shop.shopPageUrl as string)).toBe(true);
    }
  });

  it('refuses a page with no markers array, naming the page', () => {
    const changed = CENTROS.split('markers : ').join('pins : ');
    expect(() => parseShopDirectory(changed, '/centros/')).toThrow(
      /\/centros\/.*markers/
    );
  });

  it('skips and counts a pin with no number in a coordinate', () => {
    const broken = CENTROS.replace('"latitude":"37.89082"', '"latitude":""');
    const read = parseShopDirectory(broken);
    expect(read.entries).toHaveLength(12);
    expect(read.withoutCoordinates).toEqual(['Tienda 1']);
  });
});

describe('parseShopPage', () => {
  it('reads T1: street, postal code, city, phone and the photo code', () => {
    expect(parseShopPage(fixture('shop-t1.html'))).toEqual({
      title: 'Avda Jesús Rescatado',
      street: 'Avda. Jesús Rescatado, 15',
      postalCode: '14010',
      city: 'Córdoba',
      phone: '957 076 802',
      photoCode: 'T1',
    });
  });

  it('reads C2, whose code only the photo names', () => {
    expect(parseShopPage(fixture('shop-c2.html'))).toEqual({
      title: 'SuperCash Sector Sur',
      street:
        'Calle Libertador Sucre, 38, esq. Libertador José Joaquín Da Silva Xavier',
      postalCode: '14013',
      city: 'Córdoba',
      phone: '957 760 689',
      photoCode: 'C2',
    });
  });

  it('reads Z1, whose street is two lines', () => {
    expect(parseShopPage(fixture('shop-z1.html'))).toEqual({
      title: 'Zoco Centro Comercial, Calle José María Martorell',
      street: 'Centro comercial Zoco Plaza de los Califas s/n',
      postalCode: '14005',
      city: 'Córdoba',
      phone: '957 456 125',
      photoCode: 'Z1',
    });
  });

  it('answers every field null for a page with no datos-centro', () => {
    const page = parseShopPage(
      fixture('shop-t1.html').split('id="datos-centro"').join('id="other"')
    );
    expect(page).toMatchObject({
      street: null,
      postalCode: null,
      city: null,
      phone: null,
      photoCode: null,
    });
  });
});

describe('readShopCode', () => {
  const entry = (categoryCode: string | null): DezaDirectoryEntry => ({
    ...byTitle('Tienda 1'),
    categoryCode,
  });
  const page = (photoCode: string | null): DezaShopPage => ({
    title: 'x',
    street: null,
    postalCode: null,
    city: null,
    phone: null,
    photoCode,
  });

  it.each([
    ['T1', 'T1', { code: 'T1', basis: 'BOTH' }],
    ['T1', null, { code: 'T1', basis: 'MAP' }],
    [null, 'C2', { code: 'C2', basis: 'PHOTO' }],
    ['T1', 'T2', { code: null, reason: 'CODES_DISAGREE' }],
    [null, null, { code: null, reason: 'NO_CODE' }],
  ])('map %s and photo %s give %j', (map, photo, outcome) => {
    expect(readShopCode(entry(map), page(photo))).toEqual(outcome);
  });

  it('reads the map alone when no page was read', () => {
    expect(readShopCode(entry('Z1'), null)).toEqual({
      code: 'Z1',
      basis: 'MAP',
    });
  });

  it('reads every shop of the fixtures with both signals agreeing', () => {
    for (const [title, file, code] of [
      ['Tienda 1', 'shop-t1.html', 'T1'],
      ['Zoco', 'shop-z1.html', 'Z1'],
    ] as const) {
      expect(
        readShopCode(byTitle(title), parseShopPage(fixture(file)))
      ).toEqual({ code, basis: 'BOTH' });
    }
    expect(
      readShopCode(
        byTitle('SuperCash (Sector Sur)'),
        parseShopPage(fixture('shop-c2.html'))
      )
    ).toEqual({ code: 'C2', basis: 'PHOTO' });
  });
});
