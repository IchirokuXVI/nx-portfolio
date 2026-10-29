import {
  addChoiceName,
  addChoiceRows,
  addMayMeetLine,
  type AddChoice,
} from './add-choice';
import type { CatalogItem } from './domain';
import { LINE_QUANTITY_MAX } from './limits';

const MILK: CatalogItem = {
  id: 'item-a',
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
};

const CHOICE: AddChoice = {
  lines: [
    {
      lineId: 'line-a',
      content: 'Leche entera',
      named: false,
      quantity: 2,
      itemIds: ['item-a'],
      productGroupId: null,
      approvalStatus: 'APPROVED',
    },
    {
      lineId: 'line-b',
      content: 'Leche entera',
      named: true,
      quantity: 0,
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
    expect(addChoiceRows(CHOICE, 1, facts)).toEqual([
      {
        lineId: 'line-a',
        // Not named: the product's name in the reader's language (velista 0144).
        name: 'Whole milk',
        product: 'Hacendado · 1 L',
        imageUrl: 'https://img/milk.jpg',
        from: 2,
        to: 3,
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
      },
    ]);
  });

  it('adds the composer’s quantity, capped as the server caps a raise', () => {
    const rows = addChoiceRows(
      { lines: [{ ...CHOICE.lines[0], quantity: LINE_QUANTITY_MAX - 1 }] },
      5,
      facts
    );

    expect(rows[0].to).toBe(LINE_QUANTITY_MAX);
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
