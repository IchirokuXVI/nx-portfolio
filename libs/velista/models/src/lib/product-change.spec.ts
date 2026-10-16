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
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope-1',
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

  it('orders the rest by the price for each kilo or litre, then the price', () => {
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

    expect(ids(choices)).toEqual([
      'milk',
      'six',
      'asturiana',
      'pascual',
      'noUnit',
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
        },
        { memberIds: ['six', 'asturiana'] }
      )
    );

    expect(
      choices.map((choice) => [choice.itemId, choice.cheaper] as const)
    ).toEqual([
      ['milk', false],
      ['six', true],
      ['asturiana', false],
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
