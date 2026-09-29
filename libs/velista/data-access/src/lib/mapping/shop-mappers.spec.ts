import { toBasketShop } from './basket-mappers';
import { toCatalogLocation } from './catalog-browse-mappers';
import { toShop, toShopChainSummary } from './shop-mappers';
import { toShopSectionNames } from './shop-section-mappers';

const SECTIONS = [
  { id: 'sec-fruit', name: { en: 'Fruit and veg', es: 'Frutería' } },
  { id: 'sec-butcher', name: { en: 'Butcher', es: 'Carnicería' } },
];

/**
 * What a picker row needs from the wire (velista `0124`, backend `0170`): the
 * chain's logo and the shop's section names, on every view a row is built from.
 * Rule D4: each read from `unknown`, and each degrades to nothing on its own.
 */
describe('shop mappers, the logo and the sections', () => {
  describe('toShopSectionNames', () => {
    it('keeps the shop’s order, and drops an unnamed or repeated section', () => {
      expect(
        toShopSectionNames([
          SECTIONS[1],
          { id: '', name: { en: 'No id', es: 'Sin id' } },
          { id: 'sec-blank', name: { en: '', es: '' } },
          SECTIONS[0],
          { ...SECTIONS[1], name: { en: 'Again', es: 'Otra' } },
        ])
      ).toEqual([SECTIONS[1], SECTIONS[0]]);
    });

    it('reads anything that is not a list as no sections, which draws no line', () => {
      expect(toShopSectionNames(undefined)).toEqual([]);
      expect(toShopSectionNames({ sections: SECTIONS })).toEqual([]);
    });
  });

  it('toBasketShop reads `supermarketLogoUrl` and the sections', () => {
    const shop = toBasketShop({
      id: 'loc-1',
      supermarketId: 'chain-m',
      supermarketName: { en: 'Mercadona', es: 'Mercadona' },
      supermarketLogoUrl: 'https://example.com/m.png',
      label: null,
      address: 'Calle Mayor 3',
      city: 'Córdoba',
      postalCode: '14001',
      sections: SECTIONS,
    });

    expect(shop?.logoUrl).toBe('https://example.com/m.png');
    expect(shop?.sections).toEqual(SECTIONS);
  });

  it('toBasketShop draws the initial and no sections from a server older than both', () => {
    const shop = toBasketShop({
      id: 'loc-1',
      supermarketName: { en: 'Mercadona', es: 'Mercadona' },
    });

    expect(shop?.logoUrl).toBeNull();
    expect(shop?.sections).toEqual([]);
  });

  it('toShop takes the logo from the chain and the sections from the shop', () => {
    const shop = toShop({
      location: {
        id: 'loc-1',
        supermarketId: 'chain-m',
        label: null,
        address: 'Calle Mayor 3',
        city: 'Córdoba',
        postalCode: '14001',
        sections: SECTIONS,
      },
      supermarket: {
        id: 'chain-m',
        name: { en: 'Mercadona', es: 'Mercadona' },
        logoUrl: 'https://example.com/m.png',
      },
    });

    expect(shop?.logoUrl).toBe('https://example.com/m.png');
    expect(shop?.sections).toEqual(SECTIONS);
  });

  it('toShopChainSummary reads the logo, and null when there is none', () => {
    const base = {
      supermarketId: 'chain-m',
      name: { en: 'Mercadona', es: 'Mercadona' },
      locations: 3,
    };

    expect(
      toShopChainSummary({ ...base, logoUrl: 'https://example.com/m.png' })
        ?.logoUrl
    ).toBe('https://example.com/m.png');
    expect(toShopChainSummary(base)?.logoUrl).toBeNull();
  });

  it('toCatalogLocation names one shop, and refuses one with no chain', () => {
    expect(
      toCatalogLocation({
        id: 'loc-1',
        supermarketId: 'chain-m',
        label: { en: 'Tejares', es: 'Tejares' },
        address: 'Ronda de los Tejares 32',
        city: 'Córdoba',
      })
    ).toEqual({
      id: 'loc-1',
      supermarketId: 'chain-m',
      label: { en: 'Tejares', es: 'Tejares' },
      address: 'Ronda de los Tejares 32',
      city: 'Córdoba',
    });
    expect(toCatalogLocation({ id: 'loc-1' })).toBeNull();
  });
});
