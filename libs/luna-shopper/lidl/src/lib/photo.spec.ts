import searchPage from './__fixtures__/search-page.json';
import { normalizeListPage, normalizeProduct } from './normalize';
import { PHOTO_HOSTS, photoAddress, photoAddressRead } from './photo';

const page = normalizeListPage(searchPage);

const FIRST =
  'https://www.lidl.es/assets/gcpdecd1bd9768046698465d4e0a882ebf5.png';
const SECOND =
  'https://www.lidl.es/assets/gcpa6ae9d31fb0947fe8fbbd32474e6c71d.png';

describe('photoAddress', () => {
  it('answers the image of an index row, as printed', () => {
    const data = searchPage.items[0].gridbox.data;
    expect(data.image).toBe(FIRST);
    expect(data.imageList).toEqual([FIRST, SECOND]);
    expect(photoAddress(data)).toBe(FIRST);
  });

  it('reads the raw row and the normalized row alike, for every row', () => {
    expect(page.rows).toHaveLength(5);
    expect(page.rows.map(photoAddress)).toEqual(
      searchPage.items.map((item) => photoAddress(item.gridbox.data))
    );
    for (const row of page.rows) {
      expect(photoAddress(row)).toBe(row.image);
      expect(new URL(row.image ?? '').host).toBe(PHOTO_HOSTS[0]);
    }
  });

  it('carries the fields of the row onto the product read from its page', () => {
    // The product page states neither field, so the product answers what the
    // index row it was reached from printed.
    const row = page.rows[0];
    const product = normalizeProduct(
      {},
      { row, observedAt: new Date('2026-09-06T12:00:00Z') }
    );
    expect(product?.image).toBe(FIRST);
    expect(product?.imageList).toEqual([FIRST, SECOND]);
    expect(photoAddress(product)).toBe(FIRST);
  });

  it('answers the first entry of the list for a row that prints no image', () => {
    expect(photoAddress({ imageList: [SECOND, FIRST] })).toBe(SECOND);
    expect(photoAddress({ image: null, imageList: [SECOND] })).toBe(SECOND);
    expect(photoAddress({ image: '', imageList: [SECOND] })).toBe(SECOND);
  });

  it('does not fall through to the list when the image is refused', () => {
    expect(
      photoAddressRead({
        image: 'https://example.com/a.png',
        imageList: [SECOND],
      })
    ).toEqual({ url: null, refused: 'https://example.com/a.png' });
  });

  it('answers null for a row that prints none', () => {
    expect(photoAddress({})).toBeNull();
    expect(photoAddress({ image: null, imageList: [] })).toBeNull();
    expect(photoAddress({ imageList: [null, SECOND] })).toBeNull();
    expect(photoAddress({ imageList: SECOND })).toBeNull();
    expect(photoAddress({ image: 7 })).toBeNull();
    expect(photoAddress(null)).toBeNull();
    expect(photoAddress(undefined)).toBeNull();
  });

  it('answers null for a foreign host', () => {
    expect(photoAddress({ image: 'https://example.com/a.png' })).toBeNull();
    // The host of another country's shop is another host: the list is exact.
    expect(
      photoAddress({ image: 'https://www.lidl.de/assets/a.png' })
    ).toBeNull();
    expect(
      photoAddress({ image: 'https://www.lidl.es@example.com/a.png' })
    ).toBeNull();
    expect(
      photoAddress({ image: 'https://www.lidl.es:8443/assets/a.png' })
    ).toBeNull();
  });

  it('matches the host whatever its case and answers the address verbatim', () => {
    const printed = 'https://WWW.Lidl.es/assets/a.png';
    expect(photoAddress({ image: printed })).toBe(printed);
  });

  it('answers null for http', () => {
    expect(
      photoAddress({ image: FIRST.replace('https://', 'http://') })
    ).toBeNull();
  });

  it('answers null for a relative address, which the index never prints', () => {
    expect(photoAddress({ image: '/assets/a.png' })).toBeNull();
    expect(photoAddress({ image: '//www.lidl.es/assets/a.png' })).toBeNull();
  });

  it('answers null over 500 characters and keeps one of exactly 500', () => {
    const base = 'https://www.lidl.es/assets/';
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
    expect(photoAddressRead(page.rows[0])).toEqual({
      url: FIRST,
      refused: null,
    });
  });
});
