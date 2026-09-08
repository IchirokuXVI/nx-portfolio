import { priceToCents, unitPriceLabel } from './price';

describe('priceToCents', () => {
  it('reads the display price the storefront prints', () => {
    expect(priceToCents('7,65 €')).toBe(765);
    expect(priceToCents('1,10 €')).toBe(110);
    expect(priceToCents('0,27 €')).toBe(27);
  });

  it('reads a thousands separator as a separator and not as a decimal', () => {
    expect(priceToCents('1.299,00 €')).toBe(129900);
  });

  it('reads a price the chain printed without decimals', () => {
    // `"3 €"` occurs on the comparison price of a whole number per unit.
    expect(priceToCents('3 €')).toBe(300);
  });

  it('reads one printed decimal as tenths', () => {
    expect(priceToCents('3,5 €')).toBe(350);
  });

  it('gives null and never zero for a card that printed no figure', () => {
    // Some products are priced by weight and print nothing. A zero there is a
    // lie about a real product that a shopper would read as free.
    expect(priceToCents('')).toBeNull();
    expect(priceToCents('   ')).toBeNull();
    expect(priceToCents(undefined)).toBeNull();
    expect(priceToCents(null)).toBeNull();
    expect(priceToCents('Precio por peso')).toBeNull();
  });
});

describe('unitPriceLabel', () => {
  it('builds the label the storefront shows beside the comparison price', () => {
    expect(unitPriceLabel('l')).toBe('€/l');
    expect(unitPriceLabel('kg')).toBe('€/kg');
  });

  it('states no label when the card stated no unit', () => {
    expect(unitPriceLabel(null)).toBeNull();
    expect(unitPriceLabel('  ')).toBeNull();
  });
});
