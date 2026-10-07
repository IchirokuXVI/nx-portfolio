import { catalogOrdersFor } from './catalog-browse';
import { catalogToolsView, type CatalogToolsInput } from './catalog-tools';

const NOTHING: CatalogToolsInput = {
  chainId: null,
  chainName: '',
  chainLogoUrl: null,
  shopChosen: false,
  shopPlace: '',
  category: null,
  postalCode: null,
};

describe('catalogToolsView', () => {
  it('names nothing when nothing is chosen, so the selectors say All', () => {
    expect(catalogToolsView(NOTHING)).toEqual({
      supermarket: { chosen: false, name: '', logoUrl: null, anyShop: false },
      category: { chosen: false, name: '', root: null },
      note: null,
    });
  });

  it('draws a chosen chain with its logo, as any shop of it', () => {
    const view = catalogToolsView({
      ...NOTHING,
      chainId: 'mercadona',
      chainName: 'Mercadona',
      chainLogoUrl: 'https://logos.test/m.png',
    });

    expect(view.supermarket).toEqual({
      chosen: true,
      name: 'Mercadona',
      logoUrl: 'https://logos.test/m.png',
      anyShop: true,
    });
  });

  it('is not any shop once one shop of the chain is chosen', () => {
    const view = catalogToolsView({
      ...NOTHING,
      chainId: 'mercadona',
      chainName: 'Mercadona',
      shopChosen: true,
      shopPlace: 'Calle Mayor 3',
    });

    expect(view.supermarket.anyShop).toBe(false);
  });

  it('shows the leaf alone and keeps the root for the accessible name', () => {
    const view = catalogToolsView({
      ...NOTHING,
      category: { name: 'Coffee', root: 'Drinks' },
    });

    expect(view.category).toEqual({
      chosen: true,
      name: 'Coffee',
      root: 'Drinks',
    });
  });

  it('shows a chosen root by its own name, with no root above it', () => {
    const view = catalogToolsView({
      ...NOTHING,
      category: { name: 'Drinks', root: null },
    });

    expect(view.category).toEqual({ chosen: true, name: 'Drinks', root: null });
  });

  describe('the note on the line that heads the list', () => {
    const all: CatalogToolsInput = {
      ...NOTHING,
      chainId: 'mercadona',
      chainName: 'Mercadona',
      shopChosen: true,
      shopPlace: 'Calle Mayor 3',
      postalCode: '28013',
    };

    it('names the shop first', () => {
      expect(catalogToolsView(all).note).toEqual({
        kind: 'shop',
        shop: 'Calle Mayor 3',
      });
    });

    it('names the chain when no shop is chosen, with the postal code', () => {
      expect(
        catalogToolsView({ ...all, shopChosen: false, shopPlace: '' }).note
      ).toEqual({ kind: 'chain', chain: 'Mercadona', postalCode: '28013' });
    });

    it('names the chain without a postal code for a person who has none', () => {
      expect(
        catalogToolsView({
          ...all,
          shopChosen: false,
          shopPlace: '',
          postalCode: null,
        }).note
      ).toEqual({ kind: 'chain', chain: 'Mercadona', postalCode: null });
    });

    it('says near the postal code with no chain', () => {
      expect(
        catalogToolsView({ ...NOTHING, postalCode: '28013' }).note
      ).toEqual({ kind: 'near', postalCode: '28013' });
    });

    it('says nothing while a chosen shop has no words yet, rather than the chain', () => {
      expect(catalogToolsView({ ...all, shopPlace: '' }).note).toBeNull();
    });

    it('says nothing for a chain whose name has not arrived', () => {
      expect(
        catalogToolsView({
          ...NOTHING,
          chainId: 'mercadona',
          postalCode: null,
        }).note
      ).toBeNull();
    });
  });
});

describe('catalogOrdersFor', () => {
  it('offers the catalog order alone while the field is empty', () => {
    expect(catalogOrdersFor('')).toEqual(['name']);
    expect(catalogOrdersFor('   ')).toEqual(['name']);
  });

  it('puts Best match first while the field has text', () => {
    expect(catalogOrdersFor('leche')).toEqual(['relevance', 'name']);
  });

  it('draws no price order, because the read cannot serve one', () => {
    for (const order of [...catalogOrdersFor(''), ...catalogOrdersFor('a')]) {
      expect(order).not.toMatch(/price/i);
    }
  });
});
