import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHOTO_HOSTS, photoAddress, photoAddressRead } from './photo';
import { parseProductPage } from './product';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const PRINTED =
  'https://www.supermercadoseljamon.com/documents/10180/892067/11087283_G.jpg';

describe('photoAddress', () => {
  const product = parseProductPage(fixture('product.html'));

  it('answers the image of the JSON-LD, as printed', () => {
    expect(product?.image).toBe(PRINTED);
    expect(photoAddress(product)).toBe(PRINTED);
    expect(new URL(PRINTED).host).toBe(PHOTO_HOSTS[0]);
  });

  it('answers null for a product that prints none', () => {
    expect(photoAddress({})).toBeNull();
    expect(photoAddress({ image: null })).toBeNull();
    expect(photoAddress({ image: '  ' })).toBeNull();
    expect(photoAddress({ image: ['a.jpg'] })).toBeNull();
    // A page with no JSON-LD is read as no product at all.
    expect(photoAddress(parseProductPage('<html></html>'))).toBeNull();
    expect(photoAddress(undefined)).toBeNull();
  });

  it('answers null for a foreign host', () => {
    expect(
      photoAddress({ image: 'https://example.com/documents/11087283_G.jpg' })
    ).toBeNull();
    // The shop's host with no `www` is another host: the list is exact.
    expect(
      photoAddress({
        image: 'https://supermercadoseljamon.com/documents/11087283_G.jpg',
      })
    ).toBeNull();
    expect(
      photoAddress({
        image: 'https://www.supermercadoseljamon.com@example.com/a.jpg',
      })
    ).toBeNull();
    expect(
      photoAddress({ image: 'https://www.supermercadoseljamon.com:8443/a.jpg' })
    ).toBeNull();
  });

  it('matches the host whatever its case and answers the address verbatim', () => {
    const printed = 'https://WWW.SupermercadosElJamon.com/documents/a_G.jpg';
    expect(photoAddress({ image: printed })).toBe(printed);
  });

  it('answers null for http', () => {
    expect(
      photoAddress({ image: PRINTED.replace('https://', 'http://') })
    ).toBeNull();
  });

  it('answers null for a relative address, which the JSON-LD never prints', () => {
    expect(
      photoAddress({ image: '/documents/10180/892067/11087283_G.jpg' })
    ).toBeNull();
    expect(
      photoAddress({ image: '//www.supermercadoseljamon.com/a_G.jpg' })
    ).toBeNull();
  });

  it('answers null over 500 characters and keeps one of exactly 500', () => {
    const base = 'https://www.supermercadoseljamon.com/documents/';
    const fits = `${base}${'a'.repeat(500 - base.length)}`;
    expect(fits).toHaveLength(500);
    expect(photoAddress({ image: fits })).toBe(fits);
    expect(photoAddress({ image: `${fits}a` })).toBeNull();
  });
});

describe('photoAddressRead', () => {
  it('tells an address that was refused from one that was never printed', () => {
    expect(photoAddressRead({ image: null })).toEqual({
      url: null,
      refused: null,
    });
    expect(photoAddressRead({ image: '/documents/a_G.jpg' })).toEqual({
      url: null,
      refused: '/documents/a_G.jpg',
    });
    expect(photoAddressRead({ image: PRINTED })).toEqual({
      url: PRINTED,
      refused: null,
    });
  });
});
