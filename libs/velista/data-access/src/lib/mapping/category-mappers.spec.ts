import { toCategoryNodes, toProductCategories } from './category-mappers';

/** `GET /v1/catalog/categories` (backend `0166`, section 3). */
describe('toCategoryNodes', () => {
  const FROZEN = {
    id: 'c-frozen',
    parentId: null,
    slug: 'frozen-foods-and-ice-cream',
    name: { en: 'Frozen foods and ice cream', es: 'Congelados y helados' },
    position: 9,
    itemCount: 12,
  };
  const ICE_CREAM = {
    id: 'c-ice-cream',
    parentId: 'c-frozen',
    slug: 'ice-creams-and-ice',
    name: { es: 'Helados y hielo' },
    position: 5,
    itemCount: 4,
  };

  it('reads roots and children with their position and count', () => {
    expect(toCategoryNodes({ categories: [FROZEN, ICE_CREAM] })).toEqual([
      FROZEN,
      { ...ICE_CREAM, name: { en: '', es: 'Helados y hielo' } },
    ]);
  });

  it('drops a row it cannot place or name, and keeps the rest', () => {
    const rows = toCategoryNodes({
      categories: [
        { ...FROZEN, id: '' },
        { ...FROZEN, slug: null },
        { ...FROZEN, name: {} },
        { ...FROZEN, parentId: 7 },
        ICE_CREAM,
      ],
    });

    expect(rows?.map((row) => row.id)).toEqual(['c-ice-cream']);
  });

  it('defaults a missing position to zero and a bad count to none', () => {
    const [row] =
      toCategoryNodes({
        categories: [{ ...FROZEN, position: 'first', itemCount: -3 }],
      }) ?? [];

    expect(row?.position).toBe(0);
    expect(row?.itemCount).toBe(0);
  });

  it('answers null for a body that is not the tree, and an empty tree for none', () => {
    expect(toCategoryNodes(null)).toBeNull();
    expect(toCategoryNodes({ items: [] })).toBeNull();
    expect(toCategoryNodes({ categories: [] })).toEqual([]);
  });
});

describe('toProductCategories', () => {
  it('reads nothing that is not a list', () => {
    expect(toProductCategories('milk')).toEqual([]);
    expect(toProductCategories(undefined)).toEqual([]);
  });
});
