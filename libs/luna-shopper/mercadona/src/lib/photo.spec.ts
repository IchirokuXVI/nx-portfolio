import categoryExpanded from './__fixtures__/category-expanded.json';
import cheeseListing from './__fixtures__/category-listing-cheese.json';
import oliveOil from './__fixtures__/product-detail-es.json';
import noEan from './__fixtures__/product-no-ean.json';
import singleRazor from './__fixtures__/product-single-razor.json';
import { normalizeCategoryProducts, normalizeProduct } from './normalize';
import { PHOTO_HOSTS, photoAddress, photoAddressRead } from './photo';

const HOST = 'https://prod-mercadona.imgix.net';

describe('photoAddress', () => {
  it('answers the thumbnail of a detail, as printed', () => {
    // An old capture with no query and a current one with a size. Each is
    // answered as read: no size is added to the first or taken off the second.
    expect(photoAddress(oliveOil)).toBe(`${HOST}/images/4241.jpg`);
    expect(photoAddress(singleRazor)).toBe(
      `${HOST}/images/5ea5ad8adb7a0b54c506d859c5357c36.jpg?fit=crop&h=300&w=300`
    );
  });

  it('answers the thumbnail of a listing row, as printed', () => {
    const raw = cheeseListing.categories[0].products[0];
    expect(raw.thumbnail).toMatch(/\?fit=crop&h=300&w=300$/);
    expect(photoAddress(raw)).toBe(raw.thumbnail);
  });

  it('reads the normalized product and the normalized row alike', () => {
    const product = normalizeProduct(singleRazor);
    expect(product.thumbnail).toBe(singleRazor.thumbnail);
    expect(photoAddress(product)).toBe(singleRazor.thumbnail);

    // The third row of this fixture prints no thumbnail, which is a null and
    // not a refusal.
    const rows = normalizeCategoryProducts(categoryExpanded);
    expect(rows.map(photoAddress)).toEqual([
      `${HOST}/images/7012.jpg`,
      `${HOST}/images/8271.jpg`,
      null,
    ]);
    expect(photoAddressRead(rows[2])).toEqual({ url: null, refused: null });
  });

  it('answers an address for every row of the listing fixture', () => {
    const rows = normalizeCategoryProducts(cheeseListing);
    expect(rows).toHaveLength(38);
    for (const row of rows) {
      expect(photoAddress(row)).toBe(row.thumbnail);
      expect(new URL(row.thumbnail ?? '').host).toBe(PHOTO_HOSTS[0]);
    }
  });

  it('answers null for a product that prints none', () => {
    expect(photoAddress(normalizeProduct(noEan))).toBeNull();
    expect(normalizeProduct(noEan).thumbnail).toBeNull();
    expect(photoAddress({})).toBeNull();
    expect(photoAddress({ thumbnail: null })).toBeNull();
    expect(photoAddress({ thumbnail: '   ' })).toBeNull();
    expect(photoAddress({ thumbnail: 4241 })).toBeNull();
    expect(photoAddress(null)).toBeNull();
    expect(photoAddress(undefined)).toBeNull();
  });

  it('answers null for a foreign host', () => {
    expect(
      photoAddress({ thumbnail: 'https://example.com/images/4241.jpg' })
    ).toBeNull();
    // A host that only contains the allowed one, and the allowed one as a
    // user name or under another port, are all another host.
    expect(
      photoAddress({ thumbnail: `${HOST}.example.com/images/4241.jpg` })
    ).toBeNull();
    expect(
      photoAddress({
        thumbnail: 'https://prod-mercadona.imgix.net@example.com/4241.jpg',
      })
    ).toBeNull();
    expect(
      photoAddress({ thumbnail: `${HOST}:8443/images/4241.jpg` })
    ).toBeNull();
  });

  it('matches the host whatever its case and answers the address verbatim', () => {
    const printed = 'https://PROD-Mercadona.imgix.net/images/4241.jpg';
    expect(photoAddress({ thumbnail: printed })).toBe(printed);
  });

  it('answers null for http', () => {
    expect(
      photoAddress({
        thumbnail: 'http://prod-mercadona.imgix.net/images/4241.jpg',
      })
    ).toBeNull();
  });

  it('answers null for a relative address, which this source never prints', () => {
    expect(photoAddress({ thumbnail: '/images/4241.jpg' })).toBeNull();
    expect(
      photoAddress({ thumbnail: '//prod-mercadona.imgix.net/images/4241.jpg' })
    ).toBeNull();
  });

  it('answers null over 500 characters and keeps one of exactly 500', () => {
    const base = `${HOST}/images/`;
    const fits = `${base}${'a'.repeat(500 - base.length)}`;
    expect(fits).toHaveLength(500);
    expect(photoAddress({ thumbnail: fits })).toBe(fits);
    expect(photoAddress({ thumbnail: `${fits}a` })).toBeNull();
  });
});

describe('photoAddressRead', () => {
  it('tells an address that was refused from one that was never printed', () => {
    expect(photoAddressRead(normalizeProduct(noEan))).toEqual({
      url: null,
      refused: null,
    });
    expect(
      photoAddressRead({ thumbnail: 'https://example.com/4241.jpg' })
    ).toEqual({ url: null, refused: 'https://example.com/4241.jpg' });
    expect(photoAddressRead(oliveOil)).toEqual({
      url: `${HOST}/images/4241.jpg`,
      refused: null,
    });
  });
});
