import type { ProductOffer } from './domain';
import {
  productChoices,
  type ProductChoicePrice,
  type ProductChoicesInput,
} from './product-change';

function offer(price: number | null, unitPrice: number | null): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice,
    unitPriceLabel: null,
    comparablePrice: unitPrice,
    comparableBasis: unitPrice === null ? null : 'LITER',
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope-1',
    piecePrice: null,
  };
}

function priced(price: number, unitPrice: number | null): ProductChoicePrice {
  return { kind: 'priced', offer: offer(price, unitPrice) };
}

function input(
  prices: Record<string, ProductChoicePrice>,
  overrides: Partial<ProductChoicesInput> = {}
): ProductChoicesInput {
  return {
    chosenId: 'milk',
    lineItemIds: [['milk']],
    memberIds: [],
    pickedId: null,
    priceOf: (itemId) => prices[itemId] ?? { kind: 'noPrice' },
    // A count row at one, over one litre packs: the price of one decides.
    line: { quantity: 1, unit: 'UNIT' },
    productOf: () => ({ unit: 'LITER', size: 1, approxWeight: null }),
    ...overrides,
  };
}

const ids = (choices: readonly { itemId: string }[]) =>
  choices.map((choice) => choice.itemId);

describe('productChoices', () => {
  it('puts the product chosen now first, whatever it costs', () => {
    const choices = productChoices(
      input(
        { milk: priced(2, 2), oat: priced(1, 1) },
        { lineItemIds: [['oat', 'milk']] }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'oat']);
    expect(choices[0].chosenNow).toBe(true);
    expect(choices[1].chosenNow).toBe(false);
  });

  it('offers each product once, from the lines and the groups', () => {
    const choices = productChoices(
      input(
        {},
        {
          lineItemIds: [['milk', 'oat']],
          memberIds: ['milk', 'oat', 'soy'],
        }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'oat', 'soy']);
  });

  it('orders the rest by the cost of the row amount, never the price per litre (velista 0183)', () => {
    const choices = productChoices(
      input(
        {
          milk: priced(1, 1),
          six: priced(5.34, 0.89),
          asturiana: priced(1.09, 1.09),
          pascual: priced(1.15, 1.15),
          noUnit: priced(0.5, null),
        },
        { memberIds: ['pascual', 'noUnit', 'asturiana', 'six'] }
      )
    );

    // The six pack is the cheapest litre and the dearest buy for a row of one.
    expect(ids(choices)).toEqual([
      'milk',
      'noUnit',
      'asturiana',
      'pascual',
      'six',
    ]);
  });

  it('puts a product with no price after the priced ones', () => {
    const choices = productChoices(
      input(
        { milk: priced(1, 1), oat: { kind: 'noPrice' }, soy: priced(3, 3) },
        { memberIds: ['oat', 'soy'] }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'soy', 'oat']);
  });

  it('keeps the order it was given for two products at one price', () => {
    const choices = productChoices(
      input(
        { milk: priced(1, 1), b: priced(2, 2), a: priced(2, 2) },
        { memberIds: ['b', 'a'] }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'b', 'a']);
  });

  it('puts what the shop does not sell last, marked, still to be chosen', () => {
    const choices = productChoices(
      input(
        {
          milk: priced(1, 1),
          puleva: { kind: 'notSold' },
          pascual: priced(1.15, 1.15),
        },
        { memberIds: ['puleva', 'pascual'] }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'pascual', 'puleva']);
    expect(choices[2].notSold).toBe(true);
    expect(choices[2].offer).toBeNull();
  });

  it('keeps the product chosen now first when the shop does not sell it', () => {
    const choices = productChoices(
      input(
        { milk: { kind: 'notSold' }, oat: priced(1, 1) },
        { memberIds: ['oat'] }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'oat']);
    expect(choices[0]).toMatchObject({ chosenNow: true, notSold: true });
  });

  it('takes the union of the products of several lines', () => {
    const choices = productChoices(
      input(
        { milk: priced(1, 1), oat: priced(2, 2), soy: priced(3, 3) },
        { lineItemIds: [['milk', 'soy'], ['oat'], ['milk']] }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'oat', 'soy']);
  });

  it('draws a product chosen from the catalog second', () => {
    const choices = productChoices(
      input(
        { milk: priced(1, 1), oat: priced(0.5, 0.5), picked: priced(9, 9) },
        { memberIds: ['oat'], pickedId: 'picked' }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'picked', 'oat']);
  });

  it('draws a picked product once when the lines hold it too', () => {
    const choices = productChoices(
      input({}, { lineItemIds: [['milk', 'oat']], pickedId: 'oat' })
    );

    expect(ids(choices)).toEqual(['milk', 'oat']);
  });

  it('marks a product that costs less than the one chosen now', () => {
    const choices = productChoices(
      input(
        {
          milk: priced(0.92, 0.92),
          six: priced(5.34, 0.89),
          asturiana: priced(1.09, 1.09),
          own: priced(0.85, 0.85),
        },
        { memberIds: ['six', 'asturiana', 'own'] }
      )
    );

    // The six pack is cheaper by the litre and not for this row (velista 0183).
    expect(
      choices.map((choice) => [choice.itemId, choice.cheaper] as const)
    ).toEqual([
      ['milk', false],
      ['own', true],
      ['asturiana', false],
      ['six', false],
    ]);
  });

  it('keeps a product that cannot serve the row unit, after the others, marked (velista 0183)', () => {
    const sizes: Record<string, { unit: string; size: number | null }> = {
      milk: { unit: 'LITER', size: null },
      carton: { unit: 'MILLILITER', size: 1000 },
      eggs: { unit: 'UNIT', size: 6 },
    };
    const choices = productChoices(
      input(
        {
          milk: priced(1.2, 1.2),
          carton: priced(0.9, 0.9),
          eggs: priced(0.1, null),
        },
        {
          memberIds: ['eggs', 'carton'],
          line: { quantity: 1500, unit: 'MILLILITER' },
          productOf: (itemId) => ({ ...sizes[itemId], approxWeight: null }),
        }
      )
    );

    expect(ids(choices)).toEqual(['milk', 'carton', 'eggs']);
    expect(choices.map((choice) => choice.serves)).toEqual([true, true, false]);
    // 1,5 L loose at 1,20 is 1,80; two cartons of a litre are 1,80 too, not less.
    expect(choices.map((choice) => choice.amount?.cents ?? null)).toEqual([
      180,
      180,
      null,
    ]);
    expect(choices.map((choice) => choice.cheaper)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('marks nothing cheaper when the product chosen now has no price', () => {
    const choices = productChoices(
      input(
        { milk: { kind: 'noPrice' }, oat: priced(0.1, 0.1) },
        { memberIds: ['oat'] }
      )
    );

    expect(choices.every((choice) => !choice.cheaper)).toBe(true);
  });

  it('offers the products of the lines when the row has no product chosen', () => {
    const choices = productChoices(
      input(
        { oat: priced(2, 2), soy: priced(1, 1) },
        { chosenId: null, lineItemIds: [['oat', 'soy']] }
      )
    );

    expect(ids(choices)).toEqual(['soy', 'oat']);
    expect(choices.some((choice) => choice.chosenNow)).toBe(false);
  });
});
