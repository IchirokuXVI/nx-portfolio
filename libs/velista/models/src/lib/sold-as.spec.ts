import { amountOfOne, priceWordsText, soldAs, soldAsOf } from './sold-as';

describe('soldAs', () => {
  it('names a kilo piece: by the kilo, no size, a weight', () => {
    expect(soldAs('KILOGRAM', null, 1560)).toBe('KILO_PIECE');
  });

  it('names a product sold by the kilo: by the kilo, no size, no weight', () => {
    expect(soldAs('KILOGRAM', null, null)).toBe('BY_THE_KILO');
    expect(soldAs('KILOGRAM', null, 0)).toBe('BY_THE_KILO');
  });

  it('names a fixed pack', () => {
    expect(soldAs('LITER', 1, null)).toBe('PACK');
    expect(soldAs('KILOGRAM', 0.25, null)).toBe('PACK');
  });

  it('names a piece priced as one a pack: its price is the piece', () => {
    expect(soldAs('UNIT', null, 580)).toBe('PACK');
  });

  it('names a pack for every unit that is not a kilo', () => {
    expect(soldAs('GRAM', 250, null)).toBe('PACK');
    expect(soldAs('GRAM', null, 395)).toBe('PACK');
    expect(soldAs(null, null, 1560)).toBe('PACK');
    expect(soldAs('FURLONG', null, null)).toBe('PACK');
  });
});

describe('amountOfOne', () => {
  const cheese = { price: 13.42, piecePrice: 20.94 };

  it('answers the piece price of a kilo piece', () => {
    expect(amountOfOne(cheese, 'KILO_PIECE')).toBe(20.94);
  });

  it('answers null for a kilo piece with a price and no piece price', () => {
    expect(
      amountOfOne({ price: 13.42, piecePrice: null }, 'KILO_PIECE')
    ).toBeNull();
  });

  it('answers the price of every other kind', () => {
    expect(amountOfOne(cheese, 'BY_THE_KILO')).toBe(13.42);
    expect(amountOfOne({ price: 6.5, piecePrice: null }, 'PACK')).toBe(6.5);
  });

  it('answers null with no offer or no price', () => {
    expect(amountOfOne(null, 'PACK')).toBeNull();
    expect(amountOfOne({ price: null, piecePrice: null }, 'PACK')).toBeNull();
  });
});

describe('soldAsOf', () => {
  it('answers soldAs of the product when there is one', () => {
    const cheese = { unit: 'KILOGRAM', size: null, approxWeight: 1560 };
    const apples = { unit: 'KILOGRAM', size: null, approxWeight: null };
    const milk = { unit: 'LITER', size: 1, approxWeight: null };
    expect(soldAsOf({ piecePrice: 20.94 }, cheese)).toBe('KILO_PIECE');
    expect(soldAsOf({ piecePrice: null }, cheese)).toBe('KILO_PIECE');
    expect(soldAsOf({ piecePrice: null }, apples)).toBe('BY_THE_KILO');
    expect(soldAsOf(null, milk)).toBe('PACK');
  });

  it('answers a kilo piece with no product when the offer has a piece price', () => {
    expect(soldAsOf({ piecePrice: 20.94 }, null)).toBe('KILO_PIECE');
  });

  it('answers a pack with no product and no piece price', () => {
    expect(soldAsOf({ piecePrice: null }, null)).toBe('PACK');
    expect(soldAsOf(null, null)).toBe('PACK');
  });
});

describe('priceWordsText', () => {
  it('joins the amount and what it is per with a space', () => {
    expect(priceWordsText({ amount: '13,42 €', per: '/ kg' })).toBe(
      '13,42 € / kg'
    );
  });

  it('answers the amount alone with nothing it is per', () => {
    expect(priceWordsText({ amount: '20,94 €', per: null })).toBe('20,94 €');
  });
});
