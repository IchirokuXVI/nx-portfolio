import listingPage from './__fixtures__/listing-page.json';
import { readCards } from './listing';
import { PHOTO_HOSTS, photoAddress, photoAddressRead } from './photo';
import { readListing } from './state';

const listing = readListing(listingPage as unknown as Record<string, unknown>);

const DESKTOP =
  'https://static.carrefour.es/hd_350x_/img_pim_food/189537_00_1.jpg';
const MOBILE =
  'https://static.carrefour.es/hd_280x_/img_pim_food/189537_00_1.jpg';

describe('photoAddress', () => {
  it('answers the desktop image of a card, as printed', () => {
    const card = listing.cards[0];
    expect(card.images?.desktop).toBe(DESKTOP);
    expect(photoAddress(card)).toBe(DESKTOP);
  });

  it('reads the card and the product read from it alike, for every card', () => {
    const products = readCards(listing.cards, ['Bebidas']);
    expect(products).toHaveLength(24);
    expect(products.map(photoAddress)).toEqual(listing.cards.map(photoAddress));
    for (const product of products) {
      const address = photoAddress(product);
      expect(address).toBe(product.images?.desktop);
      expect(new URL(address ?? '').host).toBe(PHOTO_HOSTS[0]);
    }
  });

  it('answers the mobile image of a card that prints no desktop one', () => {
    expect(photoAddress({ images: { mobile: MOBILE } })).toBe(MOBILE);
    expect(photoAddress({ images: { desktop: '', mobile: MOBILE } })).toBe(
      MOBILE
    );
    expect(photoAddress({ images: { desktop: DESKTOP, mobile: MOBILE } })).toBe(
      DESKTOP
    );
  });

  it('does not fall through to mobile when the desktop one is refused', () => {
    expect(
      photoAddressRead({
        images: { desktop: 'https://example.com/a.jpg', mobile: MOBILE },
      })
    ).toEqual({ url: null, refused: 'https://example.com/a.jpg' });
  });

  it('answers null for a card that prints none', () => {
    expect(photoAddress({})).toBeNull();
    expect(photoAddress({ images: null })).toBeNull();
    expect(photoAddress({ images: {} })).toBeNull();
    expect(photoAddress({ images: [DESKTOP] })).toBeNull();
    expect(photoAddress({ images: DESKTOP })).toBeNull();
    expect(
      photoAddress(readCards([{ product_id: '1', name: 'Agua' }], [])[0])
    ).toBeNull();
    expect(photoAddress(undefined)).toBeNull();
  });

  it('answers null for a foreign host', () => {
    expect(
      photoAddress({ images: { desktop: 'https://example.com/a.jpg' } })
    ).toBeNull();
    // The storefront's own host is not where a photo is served from.
    expect(
      photoAddress({ images: { desktop: 'https://www.carrefour.es/a.jpg' } })
    ).toBeNull();
    expect(
      photoAddress({
        images: { desktop: 'https://static.carrefour.es@example.com/a.jpg' },
      })
    ).toBeNull();
    expect(
      photoAddress({
        images: { desktop: 'https://static.carrefour.es:8443/a.jpg' },
      })
    ).toBeNull();
  });

  it('matches the host whatever its case and answers the address verbatim', () => {
    const printed = 'https://Static.Carrefour.ES/hd_350x_/img_pim_food/1.jpg';
    expect(photoAddress({ images: { desktop: printed } })).toBe(printed);
  });

  it('answers null for http', () => {
    expect(
      photoAddress({
        images: { desktop: DESKTOP.replace('https://', 'http://') },
      })
    ).toBeNull();
  });

  it('answers null for a relative address, which a card never prints', () => {
    expect(
      photoAddress({ images: { desktop: '/hd_350x_/img_pim_food/1.jpg' } })
    ).toBeNull();
    expect(
      photoAddress({ images: { desktop: '//static.carrefour.es/1.jpg' } })
    ).toBeNull();
  });

  it('answers null over 500 characters and keeps one of exactly 500', () => {
    const base = 'https://static.carrefour.es/hd_350x_/';
    const fits = `${base}${'a'.repeat(500 - base.length)}`;
    expect(fits).toHaveLength(500);
    expect(photoAddress({ images: { desktop: fits } })).toBe(fits);
    expect(photoAddress({ images: { desktop: `${fits}a` } })).toBeNull();
  });
});

describe('photoAddressRead', () => {
  it('tells an address that was refused from one that was never printed', () => {
    expect(photoAddressRead({ images: {} })).toEqual({
      url: null,
      refused: null,
    });
    expect(photoAddressRead(listing.cards[0])).toEqual({
      url: DESKTOP,
      refused: null,
    });
  });
});
