import { brandKey } from '@portfolio/luna-shopper/contracts/brand-key';
import { capitalizeBrand } from './brand-capitalization';

describe('capitalizeBrand', () => {
  it.each([
    ['HACENDADO', 'Hacendado'],
    ['hacendado', 'Hacendado'],
    ['MAHOU 5 ESTRELLAS', 'Mahou 5 Estrellas'],
    ['COCA-COLA ZERO', 'Coca-Cola Zero'],
    ["DON'T", "Don't"],
    ['ÁGUILA ñandú', 'Águila Ñandú'],
    ['el  pozo', 'El  Pozo'],
    ['+PROTEÍNAS', '+Proteínas'],
    ['7UP', '7up'],
    ['EL POZO/ALIMENTACIÓN', 'El Pozo/Alimentación'],
    ['', ''],
  ])('writes %p as %p', (name, expected) => {
    expect(capitalizeBrand(name)).toBe(expected);
  });

  it('never changes the key a name makes', () => {
    for (const name of ['HACENDADO', 'Coca-cola ZERO', 'ÁGUILA ñandú']) {
      expect(brandKey(capitalizeBrand(name))).toBe(brandKey(name));
    }
  });
});
