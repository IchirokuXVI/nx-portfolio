import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseListing } from './listing';
import { PHOTO_HOSTS, photoAddress, photoAddressRead } from './photo';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));

const raw = fixture('listing-page-1.json');
const page = parseListing(raw);

describe('photoAddress', () => {
  it('makes the path a row prints absolute against the shop', () => {
    const row = page.rows[0];
    expect(row.image).toBe('/product_images/130617P4/130617P4_ISO_0_ES.jpg');
    expect(photoAddress(row)).toBe(
      'https://www.dia.es/product_images/130617P4/130617P4_ISO_0_ES.jpg'
    );
  });

  it('reads the raw row and the parsed row alike', () => {
    const rawRows = raw['plp_items'] as { image?: unknown }[];
    expect(rawRows.map(photoAddress)).toEqual(page.rows.map(photoAddress));
  });

  it('answers what the page itself prints as the absolute address, for every row', () => {
    // `product_marking` is the schema.org block of the same page, and it
    // prints each row's photo with its host. It is evidence here and is not
    // what a run reads.
    const marking = raw['product_marking'] as {
      itemListElement: { item: { image: string } }[];
    };
    const printed = marking.itemListElement.map((entry) => entry.item.image);
    expect(printed).toHaveLength(page.rows.length);
    expect(page.rows.map(photoAddress)).toEqual(printed);
    for (const address of printed) {
      expect(new URL(address).host).toBe(PHOTO_HOSTS[0]);
    }
  });

  it('leaves an address that is already absolute as it is', () => {
    const printed = 'https://www.dia.es/product_images/65/65_ISO_0_ES.jpg?v=2';
    expect(photoAddress({ image: printed })).toBe(printed);
  });

  it('adds the slash a path was printed without', () => {
    expect(photoAddress({ image: 'product_images/65/65_ISO_0_ES.jpg' })).toBe(
      'https://www.dia.es/product_images/65/65_ISO_0_ES.jpg'
    );
  });

  it('answers null for a row that prints none', () => {
    expect(photoAddress({})).toBeNull();
    expect(photoAddress({ image: null })).toBeNull();
    expect(photoAddress({ image: '  ' })).toBeNull();
    expect(photoAddress({ image: 65 })).toBeNull();
    expect(photoAddress(null)).toBeNull();
    expect(photoAddress(undefined)).toBeNull();
  });

  it('answers null for a foreign host', () => {
    expect(
      photoAddress({ image: 'https://example.com/product_images/65.jpg' })
    ).toBeNull();
    expect(
      photoAddress({ image: 'https://www.dia.es.example.com/65.jpg' })
    ).toBeNull();
    expect(
      photoAddress({ image: 'https://www.dia.es@example.com/65.jpg' })
    ).toBeNull();
    expect(
      photoAddress({ image: 'https://www.dia.es:8443/65.jpg' })
    ).toBeNull();
    // An address with a host and no scheme is not a path on the shop.
    expect(photoAddress({ image: '//example.com/65.jpg' })).toBeNull();
  });

  it('matches the host whatever its case and answers the address verbatim', () => {
    const printed = 'https://WWW.DIA.es/product_images/65/65_ISO_0_ES.jpg';
    expect(photoAddress({ image: printed })).toBe(printed);
  });

  it('answers null for http', () => {
    expect(
      photoAddress({ image: 'http://www.dia.es/product_images/65.jpg' })
    ).toBeNull();
  });

  it('answers null over 500 characters, counted once the address is absolute', () => {
    const origin = 'https://www.dia.es';
    const path = `/product_images/${'a'.repeat(500 - origin.length - 16)}`;
    expect(`${origin}${path}`).toHaveLength(500);
    expect(photoAddress({ image: path })).toBe(`${origin}${path}`);
    expect(photoAddress({ image: `${path}a` })).toBeNull();
  });
});

describe('photoAddressRead', () => {
  it('tells an address that was refused from one that was never printed', () => {
    expect(photoAddressRead({ image: null })).toEqual({
      url: null,
      refused: null,
    });
    expect(photoAddressRead({ image: '//example.com/65.jpg' })).toEqual({
      url: null,
      refused: '//example.com/65.jpg',
    });
    expect(photoAddressRead(page.rows[0])).toEqual({
      url: 'https://www.dia.es/product_images/130617P4/130617P4_ISO_0_ES.jpg',
      refused: null,
    });
  });
});
