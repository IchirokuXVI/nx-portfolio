import { PHOTO_HOSTS as CARREFOUR } from '@portfolio/luna-shopper/carrefour';
import { PHOTO_HOSTS as DIA } from '@portfolio/luna-shopper/dia';
import { PHOTO_HOSTS as ELJAMON } from '@portfolio/luna-shopper/eljamon';
import { PHOTO_HOSTS as LIDL } from '@portfolio/luna-shopper/lidl';
import { PHOTO_HOSTS as MERCADONA } from '@portfolio/luna-shopper/mercadona';
import { documentPhotoOf } from './document-photo';

/**
 * The photo a document states, through the host rule of the importing chain's
 * own adapter library (plan 0198, section 2).
 */
describe('documentPhotoOf', () => {
  const ADAPTERS: [string, readonly string[]][] = [
    ['mercadona-api', MERCADONA],
    ['dia-api', DIA],
    ['eljamon-web', ELJAMON],
    ['carrefour-web', CARREFOUR],
    ['lidl-api', LIDL],
  ];

  it.each(ADAPTERS)(
    'keeps an address on a host of %s, verbatim',
    (adapterKey, hosts) => {
      const address = `https://${hosts[0]}/images/1.jpg?fit=crop&h=300`;
      expect(documentPhotoOf(address, adapterKey, '1')).toBe(address);
    }
  );

  it.each(ADAPTERS)(
    'leaves the stored address for a host outside the list of %s',
    (adapterKey) => {
      expect(
        documentPhotoOf('https://example.com/1.jpg', adapterKey, '1')
      ).toBeUndefined();
    }
  );

  it('refuses an address on another chain host, because the list is the importing chain', () => {
    const mercadona = `https://${MERCADONA[0]}/images/1.jpg`;
    expect(documentPhotoOf(mercadona, 'lidl-api', '1')).toBeUndefined();
  });

  it('refuses http, and a path the DIA walk would have made absolute', () => {
    expect(
      documentPhotoOf(`http://${MERCADONA[0]}/1.jpg`, 'mercadona-api', '1')
    ).toBeUndefined();
    expect(
      documentPhotoOf('/product_images/65/65_ISO_0_ES.jpg', 'dia-api', '1')
    ).toBeUndefined();
  });

  it('takes no address for an adapter that reads no photo, or for no adapter', () => {
    const address = `https://${MERCADONA[0]}/images/1.jpg`;
    expect(documentPhotoOf(address, 'deza-web', '1')).toBeUndefined();
    expect(documentPhotoOf(address, null, '1')).toBeUndefined();
  });

  it('passes an absent address and a stated null through', () => {
    expect(documentPhotoOf(undefined, 'mercadona-api', '1')).toBeUndefined();
    expect(documentPhotoOf(null, 'mercadona-api', '1')).toBeNull();
    expect(documentPhotoOf(null, null, '1')).toBeNull();
  });
});
