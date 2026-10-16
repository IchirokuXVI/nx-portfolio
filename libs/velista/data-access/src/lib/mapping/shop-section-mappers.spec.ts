import { toShopSections } from './shop-section-mappers';

/** `GET /v1/catalog/locations/:id/sections` (velista `0120`, backend `0200`). */
describe('toShopSections', () => {
  const FRUIT = {
    id: 'sec-fruit',
    supermarketLocationId: 'loc-1',
    slug: 'fruit',
    name: { en: 'Fruit and vegetables', es: 'Fruta y verdura' },
    position: 3,
    categoryIds: ['cat-fruits', 'cat-vegetables'],
  };
  const BAKERY = {
    id: 'sec-bakery',
    supermarketLocationId: 'loc-1',
    slug: 'bakery',
    name: { en: 'Bakery', es: 'Horno' },
    position: 0,
    categoryIds: [],
  };

  it('reads the sections in the wire’s order, which is the shop’s, not by position', () => {
    const read = toShopSections({ sections: [FRUIT, BAKERY] });

    expect(read).toEqual([
      {
        id: 'sec-fruit',
        slug: 'fruit',
        name: { en: 'Fruit and vegetables', es: 'Fruta y verdura' },
        position: 3,
        categoryIds: ['cat-fruits', 'cat-vegetables'],
      },
      {
        id: 'sec-bakery',
        slug: 'bakery',
        name: { en: 'Bakery', es: 'Horno' },
        position: 0,
        categoryIds: [],
      },
    ]);
  });

  it('drops a section with no id or no readable name, and a repeated one', () => {
    const read = toShopSections({
      sections: [
        FRUIT,
        { ...BAKERY, id: '' },
        { ...BAKERY, name: { en: '', es: '' } },
        FRUIT,
        { ...BAKERY, name: { es: 'Horno' } },
      ],
    });

    expect(read?.map((one) => [one.id, one.name])).toEqual([
      ['sec-fruit', { en: 'Fruit and vegetables', es: 'Fruta y verdura' }],
      ['sec-bakery', { en: '', es: 'Horno' }],
    ]);
  });

  it('reads an empty list as a fact: a shop with no sections of its own has none', () => {
    expect(toShopSections({ sections: [] })).toEqual([]);
  });

  it('keeps nothing of a source or a chain an older answer still carries', () => {
    const read = toShopSections({
      sections: [{ ...BAKERY, supermarketId: 'sm-1' }],
      source: 'CHAIN',
    });

    expect(read).toEqual([
      {
        id: 'sec-bakery',
        slug: 'bakery',
        name: { en: 'Bakery', es: 'Horno' },
        position: 0,
        categoryIds: [],
      },
    ]);
  });

  it('is null for a body that is not the shape', () => {
    expect(toShopSections(null)).toBeNull();
    expect(toShopSections({})).toBeNull();
    expect(toShopSections([FRUIT])).toBeNull();
  });
});
