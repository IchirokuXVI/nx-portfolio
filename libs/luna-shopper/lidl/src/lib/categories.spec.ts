import { CATEGORY_LEAF_SLUGS } from './category-leaves';
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
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      'Mundos de necesidad/Comida y cerca de la comida/Frutas y hortalizas/Fruta',
      'fruit',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Pescado y marisco',
      'other-seafood',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Carne y aves/Embutidos y fiambres',
      'cured-ham-and-sausages',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Queso',
      'cheese',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Leche y nata',
      'milk',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Panadería/Pasteles',
      'pastries-and-cakes',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Dulces y aperitivos/Aperitivos salados',
      'salty-snacks',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Café, té y cacao',
      'coffee-tea-and-cocoa',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Presupuesto/Papel higiénico',
      'paper-and-wipes',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Presupuesto/Detergentes y cuidado de la ropa',
      'laundry',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Productos de droguería y cuidado personal/Cuidado del cabello',
      'hair',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Bebidas/Refrescos',
      'soft-drinks',
    ],
    [
      'Mundos de necesidad/Vino, cerveza y licores/Cerveza y sidra',
      'beer',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Platos precocinados/Platos preparados refrigerados',
      'prepared-dishes',
    ],
    [
      'Mundos de necesidad/Comida y cerca de la comida/Artículos para mascotas/Comida para gatos',
      'cats',
    ],
  ];

  it.each(cases)('files %s', (path, expected) => {
    expect(resolveCategory(categoryPathOf(path))).toBe(expected);
  });

  it('reaches a mapped parent through a node nobody mapped', () => {
    // `Congelados varios` has no entry of its own, and it is frozen food
    // because its parent is. That climb is what keeps the table short.
    expect(
      resolveCategory(
        categoryPathOf(
          'Mundos de necesidad/Comida y cerca de la comida/Alimentos congelados/Congelados varios'
        )
      )
    ).toBe('other-frozen');
    expect(
      resolveCategory(
        categoryPathOf(
          'Mundos de necesidad/Comida y cerca de la comida/Alimentos congelados/Helado'
        )
      )
    ).toBe('ice-cream');
  });

  it('falls back rather than guessing when LIDL files a product wrongly', () => {
    // Eight of one week's 153 grocery products carry this path and one carries
    // the second. Both are real products in a real shop, and neither path says
    // what aisle they are in, so they reach the admin queue as null.
    expect(
      resolveCategory(
        categoryPathOf('Mundos de necesidad/Vivir y amueblar/Decoración')
      )
    ).toBeNull();
    expect(
      resolveCategory(
        categoryPathOf('Mundos de necesidad/Deporte y ocio/Suministros para mascotas')
      )
    ).toBeNull();
    expect(resolveCategory([])).toBeNull();
  });

  it('resolves every node the table names', () => {
    for (const [name, expected] of LIDL_CATEGORY_MAP) {
      expect(resolveCategory(['Mundos de necesidad', name])).toBe(expected);
    }
  });

  it('answers nothing that is not a leaf, so a typo in the table fails here', () => {
    const unknown = LIDL_CATEGORY_MAP.map(([, slug]) => slug).filter(
      (slug) => !CATEGORY_LEAF_SLUGS.has(slug)
    );
    expect(unknown).toEqual([]);
  });
});
