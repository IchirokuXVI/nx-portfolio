import { ItemCategory } from '@portfolio/luna-shopper/contracts';
import {
  categoryPathOf,
  isGroceryCategory,
  LIDL_CATEGORY_MAP,
  resolveCategory,
} from './categories';

/**
 * The need world paths below were all printed by the live assortment on
 * 2026-09-06, including the ones LIDL files wrongly (plan 0089, section 5).
 */
describe('isGroceryCategory', () => {
  it('keeps what a supermarket sells', () => {
    expect(isGroceryCategory('Food')).toBe(true);
    expect(isGroceryCategory('F+V')).toBe(true);
  });

  it('drops the bazar, the plants and the online shop', () => {
    expect(isGroceryCategory('NonFood')).toBe(false);
    expect(isGroceryCategory('P+F')).toBe(false);
    expect(isGroceryCategory('Categorías/Moda/Moda femenina')).toBe(false);
    expect(isGroceryCategory(null)).toBe(false);
    expect(isGroceryCategory('')).toBe(false);
  });
});

describe('categoryPathOf', () => {
  it('splits the printed path, root first', () => {
    expect(
      categoryPathOf(
        'Mundos de necesidad/Comida y cerca de la comida/Frutas y hortalizas/Fruta'
      )
    ).toEqual([
      'Mundos de necesidad',
      'Comida y cerca de la comida',
      'Frutas y hortalizas',
      'Fruta',
    ]);
  });

  it('is empty when the product carries no path', () => {
    expect(categoryPathOf(null)).toEqual([]);
    expect(categoryPathOf('')).toEqual([]);
  });
});

describe('resolveCategory', () => {
  const cases: ReadonlyArray<readonly [string, ItemCategory]> = [
    [
      'Mundos de necesidad/Comida y cerca de la comida/Frutas y hortalizas/Fruta',
      ItemCategory.PRODUCE,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Pescado y marisco',
      ItemCategory.SEAFOOD,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Carne y aves/Embutidos y fiambres',
      ItemCategory.MEAT,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Queso',
      ItemCategory.DAIRY,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Panadería/Pasteles',
      ItemCategory.BAKERY,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Dulces y aperitivos/Aperitivos salados',
      ItemCategory.SNACKS,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Café, té y cacao',
      ItemCategory.PANTRY,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Presupuesto/Papel higiénico',
      ItemCategory.HOUSEHOLD,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Productos de droguería y cuidado personal/Cuidado del cabello',
      ItemCategory.PERSONAL_CARE,
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Bebidas/Refrescos',
      ItemCategory.BEVERAGES,
    ],
    [
      'Mundos de necesidad/Vino, cerveza y licores/Cerveza y sidra',
      ItemCategory.BEVERAGES,
    ],
  ];

  it.each(cases)('files %s', (path, expected) => {
    expect(resolveCategory(categoryPathOf(path))).toBe(expected);
  });

  it('reaches a mapped parent through a leaf nobody mapped', () => {
    // `Helado` has no entry of its own, and it is frozen food because its
    // parent is. That climb is what keeps the table at twenty rows.
    expect(
      resolveCategory(
        categoryPathOf(
          'Mundos de necesidad/Comida y cerca de la comida/Alimentos congelados/Helado'
        )
      )
    ).toBe(ItemCategory.FROZEN);
  });

  it('falls back rather than guessing when LIDL files a product wrongly', () => {
    // Eight of one week's 153 grocery products carry this path and one carries
    // the second. Both are real products in a real shop, and neither path says
    // what aisle they are in, so they reach the admin queue as OTHER.
    expect(
      resolveCategory(
        categoryPathOf('Mundos de necesidad/Vivir y amueblar/Decoración')
      )
    ).toBe(ItemCategory.OTHER);
    expect(
      resolveCategory(
        categoryPathOf('Mundos de necesidad/Deporte y ocio/Suministros para mascotas')
      )
    ).toBe(ItemCategory.OTHER);
    expect(resolveCategory([])).toBe(ItemCategory.OTHER);
  });

  it('resolves every node the table names', () => {
    for (const [name, expected] of LIDL_CATEGORY_MAP) {
      expect(resolveCategory(['Mundos de necesidad', name])).toBe(expected);
    }
  });
});
