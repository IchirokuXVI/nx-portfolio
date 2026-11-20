import {
  addChoiceName,
  addChoiceRows,
  addMayMeetLine,
  addMayMeetProduct,
  type AddChoice,
} from './add-choice';
import type { CatalogItem } from './domain';
import { LINE_QUANTITY_MAX } from './limits';

const MILK: CatalogItem = {
  id: 'item-a',
  quantityStep: null,
  name: { es: 'Leche entera', en: 'Whole milk' },
  brand: 'Hacendado',
  size: 1,
  unit: 'LITER',
  productGroupId: null,
  categories: [],
  offer: null,
  unitBasis: null,
  chainPrices: [],
  imageUrl: 'https://img/milk.jpg',
  packCount: null,
  approxWeight: null,
};

const CHOICE: AddChoice = {
  lines: [
    {
      lineId: 'line-a',
      content: 'Leche entera',
      named: false,
      quantity: 2,
      unit: 'UNIT',
      itemIds: ['item-a'],
      productGroupId: null,
      approvalStatus: 'APPROVED',
      outcome: 'alreadyOnList',
      resultingQuantity: 2,
    },
    {
      lineId: 'line-b',
      content: 'Leche entera',
      named: true,
      quantity: 0,
      unit: 'UNIT',
      itemIds: ['item-missing'],
      productGroupId: null,
      approvalStatus: 'APPROVED',
      outcome: 'raised',
      resultingQuantity: 1,
    },
  ],
};

/** Velista `0170`, target 5: the rows of the question, and target 3's prediction. */
describe('addChoiceRows', () => {
  const facts = {
    itemOf: (itemId: string) => (itemId === MILK.id ? MILK : null),
    favoriteOf: () => null,
    locale: 'en',
    brandSizeOf: (item: CatalogItem) => `${item.brand} · 1 L`,
  };

  it('draws each line as its row would, in the refusal’s order', () => {
    expect(addChoiceRows(CHOICE, facts)).toEqual([
      {
        lineId: 'line-a',
        // Not named: the product's name in the reader's language (velista 0144).
        name: 'Whole milk',
        product: 'Hacendado · 1 L',
        imageUrl: 'https://img/milk.jpg',
        // Already on the list: a choice shows it and leaves it as it is (the
        // owner's ruling of 2026-11-16).
        from: 2,
        to: 2,
        unit: 'UNIT',
        outcome: 'alreadyOnList',
      },
      {
        lineId: 'line-b',
        name: 'Leche entera',
        // A product not loaded yet has no product line, and no picture.
        product: null,
        imageUrl: null,
        // A bought line counts, from 0 (D2).
        from: 0,
        to: 1,
        unit: 'UNIT',
        outcome: 'raised',
      },
    ]);
  });

  it('caps the raise as the server caps it', () => {
    const rows = addChoiceRows(
      {
        lines: [
          {
            ...CHOICE.lines[1],
            resultingQuantity: LINE_QUANTITY_MAX + 5,
          },
        ],
      },
      facts
    );

    expect(rows[0].to).toBe(LINE_QUANTITY_MAX);
  });

  it('takes a row at zero to the amount the server names, in its own unit (the ruling of 2026-11-16)', () => {
    const rows = addChoiceRows(
      {
        lines: [
          {
            ...CHOICE.lines[1],
            lineId: 'g',
            unit: 'GRAM',
            resultingQuantity: 25,
          },
          {
            ...CHOICE.lines[1],
            lineId: 'ml',
            unit: 'MILLILITER',
            resultingQuantity: 250,
          },
          {
            ...CHOICE.lines[1],
            lineId: 'u',
            unit: 'UNIT',
            resultingQuantity: 1,
          },
        ],
      },
      facts
    );

    expect(
      rows.map(({ from, to, unit, outcome }) => ({ from, to, unit, outcome }))
    ).toEqual([
      { from: 0, to: 25, unit: 'GRAM', outcome: 'raised' },
      { from: 0, to: 250, unit: 'MILLILITER', outcome: 'raised' },
      { from: 0, to: 1, unit: 'UNIT', outcome: 'raised' },
    ]);
  });

  it('leaves a line already on the list at its amount, whatever it would be raised to', () => {
    const rows = addChoiceRows(
      {
        lines: [
          {
            ...CHOICE.lines[0],
            quantity: 750,
            unit: 'GRAM',
            resultingQuantity: 775,
          },
        ],
      },
      facts
    );

    expect(rows[0]).toMatchObject({
      from: 750,
      to: 750,
      outcome: 'alreadyOnList',
    });
  });
});

describe('addMayMeetLine', () => {
  const held = [
    { content: 'Leche  Entera', approvalStatus: 'APPROVED' as const },
    { content: 'Pan', approvalStatus: 'REJECTED' as const },
  ];

  it('meets a loaded line of the same name as the server folds it', () => {
    expect(addMayMeetLine(held, ' leche éntera ')).toBe(true);
  });

  it('ignores a turned down line, another name, and empty words', () => {
    expect(addMayMeetLine(held, 'Pan')).toBe(false);
    expect(addMayMeetLine(held, 'Leche')).toBe(false);
    expect(addMayMeetLine(held, '   ')).toBe(false);
  });
});

describe('addMayMeetProduct (velista 0185, decision I)', () => {
  const held = [
    {
      itemIds: ['bananas', 'apples'],
      quantity: 750,
      approvalStatus: 'APPROVED' as const,
    },
    { itemIds: ['bread'], quantity: 0, approvalStatus: 'APPROVED' as const },
    { itemIds: ['milk'], quantity: 2, approvalStatus: 'REJECTED' as const },
  ];

  it('meets a wanted line that holds every product, also among others', () => {
    expect(addMayMeetProduct(held, ['bananas'])).toBe(true);
    expect(addMayMeetProduct(held, ['apples', 'bananas'])).toBe(true);
  });

  it('meets a line kept at zero, which the add raises in place of a new row', () => {
    expect(addMayMeetProduct(held, ['bread'])).toBe(true);
  });

  it('does not meet a turned down line, a partial set or nothing', () => {
    expect(addMayMeetProduct(held, ['milk'])).toBe(false);
    expect(addMayMeetProduct(held, ['bananas', 'pears'])).toBe(false);
    expect(addMayMeetProduct(held, [])).toBe(false);
  });
});

describe('addChoiceName', () => {
  it('says the first line as it is stored, not the words as typed', () => {
    expect(addChoiceName(CHOICE, 'leche ENTERA')).toBe('Leche entera');
  });

  it('falls back to the typed words for a line that holds none', () => {
    expect(
      addChoiceName(
        { lines: [{ ...CHOICE.lines[0], content: '  ' }] },
        'leche entera'
      )
    ).toBe('leche entera');
  });
});
