import { toShopSections } from './shop-section-mappers';

/** `GET /v1/catalog/locations/:id/sections` (velista `0120`, backend `0167`). */
describe('toShopSections', () => {
  const FRUIT = {
    id: 'sec-fruit',
    supermarketId: 'sm-1',
    slug: 'fruit',
    name: { en: 'Fruit and vegetables', es: 'Fruta y verdura' },
    position: 3,
    categoryIds: ['cat-fruit', 'cat-vegetables'],
  };
  const BAKERY = {
    id: 'sec-bakery',
    supermarketId: 'sm-1',
    slug: 'bakery',
    name: { en: 'Bakery', es: 'Horno' },
    position: 0,
    categoryIds: [],
  };

  it('reads the sections in the wire’s order, which is the shop’s, not by position', () => {
    const read = toShopSections({
      sections: [FRUIT, BAKERY],
      source: 'LOCATION',
    });

    expect(read).toEqual({
      sections: [
        {
          id: 'sec-fruit',
          supermarketId: 'sm-1',
          slug: 'fruit',
          name: { en: 'Fruit and vegetables', es: 'Fruta y verdura' },
          position: 3,
          categoryIds: ['cat-fruit', 'cat-vegetables'],
        },
        {
          id: 'sec-bakery',
          supermarketId: 'sm-1',
          slug: 'bakery',
          name: { en: 'Bakery', es: 'Horno' },
          position: 0,
          categoryIds: [],
        },
      ],
      source: 'LOCATION',
    });
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
      source: 'CHAIN',
    });

    expect(read?.sections.map((one) => [one.id, one.name])).toEqual([
      ['sec-fruit', { en: 'Fruit and vegetables', es: 'Fruta y verdura' }],
      ['sec-bakery', { en: '', es: 'Horno' }],
    ]);
  });

  it('reads an unknown source as the chain’s, and an empty list as a fact', () => {
    expect(toShopSections({ sections: [], source: 'MARS' })).toEqual({
      sections: [],
      source: 'CHAIN',
    });
  });

  it('is null for a body that is not the shape', () => {
    expect(toShopSections(null)).toBeNull();
    expect(toShopSections({ source: 'CHAIN' })).toBeNull();
    expect(toShopSections([FRUIT])).toBeNull();
  });
});
