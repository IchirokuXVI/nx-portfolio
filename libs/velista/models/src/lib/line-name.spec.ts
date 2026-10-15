import {
  foldName,
  lineName,
  lineNameChange,
  lineNameRefused,
  type LineNameSource,
} from './line-name';
import type { LocalizedName } from './shopping-profile';

const TOMATO: LocalizedName = { en: 'Fried tomato', es: 'Tomate frito' };
const MILK: LocalizedName = { en: '', es: 'Leche semidesnatada' };

const NAMES = new Map<string, LocalizedName>([
  ['tomato', TOMATO],
  ['milk', MILK],
  ['blank', { en: '', es: '' }],
]);

const nameOf = (itemId: string): LocalizedName | null =>
  NAMES.get(itemId) ?? null;

function line(overrides: Partial<LineNameSource> = {}): LineNameSource {
  return {
    content: 'Tomate frito',
    named: false,
    itemIds: ['tomato'],
    favoriteItemId: null,
    ...overrides,
  };
}

describe('lineName', () => {
  it('draws the content of a named line', () => {
    const name = lineName(
      line({ content: 'Tomate', named: true }),
      nameOf,
      'es'
    );
    expect(name).toEqual({
      text: 'Tomate',
      own: true,
      itemId: 'tomato',
      productName: 'Tomate frito',
      field: 'Tomate',
      settled: true,
    });
  });

  it('draws a line with no product by its content, as named', () => {
    const name = lineName(
      line({ content: 'Algo para cenar', named: true, itemIds: [] }),
      nameOf,
      'en'
    );
    expect(name.text).toBe('Algo para cenar');
    expect(name.own).toBe(true);
    expect(name.itemId).toBeNull();
    expect(name.field).toBe('Algo para cenar');
  });

  it('draws the product name of a line that is not named, in the reader language', () => {
    const name = lineName(line(), nameOf, 'en');
    expect(name.text).toBe('Fried tomato');
    expect(name.own).toBe(false);
    expect(name.field).toBe('');
  });

  it('draws the content while the product name is not loaded', () => {
    const name = lineName(
      line({ content: 'Pan', itemIds: ['unknown'] }),
      nameOf,
      'es'
    );
    expect(name.text).toBe('Pan');
    expect(name.own).toBe(false);
    expect(name.productName).toBeNull();
    expect(name.settled).toBe(false);
  });

  it('draws the favourite when the line holds it', () => {
    const name = lineName(
      line({ itemIds: ['tomato', 'milk'], favoriteItemId: 'milk' }),
      nameOf,
      'es'
    );
    expect(name.itemId).toBe('milk');
    expect(name.text).toBe('Leche semidesnatada');
  });

  it('draws the first product when the favourite is not on the line', () => {
    const name = lineName(
      line({ itemIds: ['tomato', 'milk'], favoriteItemId: 'gone' }),
      nameOf,
      'es'
    );
    expect(name.itemId).toBe('tomato');
  });

  it('falls back to the other language for a product named in one', () => {
    const name = lineName(line({ itemIds: ['milk'] }), nameOf, 'en');
    expect(name.text).toBe('Leche semidesnatada');
  });

  describe('a line the old app named after its product', () => {
    it('is not named when its content is the product name', () => {
      const name = lineName(
        line({ content: 'Tomate frito', named: true }),
        nameOf,
        'en'
      );
      expect(name.own).toBe(false);
      expect(name.text).toBe('Fried tomato');
      expect(name.field).toBe('');
    });

    it('folds accents, case and spaces', () => {
      const name = lineName(
        line({ content: '  TOMÁTE   Fríto ', named: true }),
        nameOf,
        'es'
      );
      expect(name.own).toBe(false);
    });

    it('matches the name in a second language', () => {
      const name = lineName(
        line({ content: 'fried tomato', named: true }),
        nameOf,
        'es'
      );
      expect(name.own).toBe(false);
      expect(name.text).toBe('Tomate frito');
    });

    it('matches any of its products, not only the one it shows', () => {
      const name = lineName(
        line({
          content: 'Leche semidesnatada',
          named: true,
          itemIds: ['tomato', 'milk'],
        }),
        nameOf,
        'en'
      );
      expect(name.own).toBe(false);
      expect(name.text).toBe('Fried tomato');
    });

    it('stays named for a name that is only close', () => {
      const name = lineName(
        line({ content: 'Tomate frito casero', named: true }),
        nameOf,
        'es'
      );
      expect(name.own).toBe(true);
      expect(name.text).toBe('Tomate frito casero');
    });

    it('skips a name that is empty, in every language', () => {
      const name = lineName(
        line({ content: '', named: true, itemIds: ['blank', 'milk'] }),
        nameOf,
        'en'
      );
      expect(name.own).toBe(true);

      const spaces = lineName(
        line({ content: '   ', named: true, itemIds: ['milk'] }),
        nameOf,
        'en'
      );
      expect(spaces.own).toBe(true);
    });

    it('stays named while its products are not loaded', () => {
      const name = lineName(
        line({ content: 'Tomate frito', named: true, itemIds: ['unknown'] }),
        nameOf,
        'es'
      );
      expect(name.own).toBe(true);
      expect(name.settled).toBe(false);
    });
  });
});

describe('lineNameChange', () => {
  it('sends the typed text', () => {
    const source = line({ content: 'Tomate', named: true });
    expect(
      lineNameChange(source, lineName(source, nameOf, 'es'), ' Salsa ')
    ).toEqual({ content: 'Salsa' });
  });

  it('sends nothing for the name the line has', () => {
    const source = line({ content: 'Tomate', named: true });
    expect(
      lineNameChange(source, lineName(source, nameOf, 'es'), 'Tomate ')
    ).toBeNull();
  });

  it('names a line that was not named', () => {
    const source = line();
    expect(
      lineNameChange(source, lineName(source, nameOf, 'es'), 'Tomate')
    ).toEqual({ content: 'Tomate' });
  });

  it('takes the name away with the product name, in the reader language', () => {
    const source = line({ content: 'Tomate', named: true });
    expect(
      lineNameChange(source, lineName(source, nameOf, 'en'), '  ')
    ).toEqual({ named: false, content: 'Fried tomato' });
  });

  it('takes the name away with no content while the product name is not loaded', () => {
    const source = line({ content: 'Tomate', named: true, itemIds: ['x'] });
    expect(lineNameChange(source, lineName(source, nameOf, 'en'), '')).toEqual({
      named: false,
    });
  });

  it('sends nothing for an empty field on a line that is not named', () => {
    const source = line();
    expect(
      lineNameChange(source, lineName(source, nameOf, 'en'), '')
    ).toBeNull();
  });

  it('sends nothing for an empty field on a line with no product', () => {
    const source = line({ content: 'Pan', named: true, itemIds: [] });
    expect(
      lineNameChange(source, lineName(source, nameOf, 'en'), '')
    ).toBeNull();
    expect(lineNameRefused(source, '')).toBe(true);
    expect(lineNameRefused(line(), '')).toBe(false);
  });
});

describe('foldName', () => {
  it('folds accents, case and spaces', () => {
    expect(foldName('  Ñandú   DE  Campo ')).toBe('nandu de campo');
  });
});
