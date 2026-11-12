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
        from: 2,
        to: 3,
        unit: 'UNIT',
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
      },
    ]);
  });

  it('caps the raise as the server caps it', () => {
    const rows = addChoiceRows(
      { lines: [{ ...CHOICE.lines[0], quantity: LINE_QUANTITY_MAX }] },
      facts
    );

    expect(rows[0].to).toBe(LINE_QUANTITY_MAX);
  });

  it('takes each row up one step of its own unit: 0 to 25 g, 0 to 25 ml, 0 to 1 (velista 0185)', () => {
    const rows = addChoiceRows(
      {
        lines: [
          { ...CHOICE.lines[0], lineId: 'g', quantity: 0, unit: 'GRAM' },
          { ...CHOICE.lines[0], lineId: 'ml', quantity: 0, unit: 'MILLILITER' },
          { ...CHOICE.lines[0], lineId: 'u', quantity: 0, unit: 'UNIT' },
        ],
      },
      facts
    );

    expect(rows.map(({ from, to, unit }) => ({ from, to, unit }))).toEqual([
      { from: 0, to: 25, unit: 'GRAM' },
      { from: 0, to: 25, unit: 'MILLILITER' },
      { from: 0, to: 1, unit: 'UNIT' },
    ]);
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

  it('does not meet a line at zero, a turned down line, a partial set or nothing', () => {
    expect(addMayMeetProduct(held, ['bread'])).toBe(false);
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
