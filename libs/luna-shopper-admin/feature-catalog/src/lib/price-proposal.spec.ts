import { checkObservedAt, proposeUnitPrice } from './price-proposal';

describe('the proposed unit price', () => {
  it('quotes grams per kilogram and millilitres per litre', () => {
    expect(proposeUnitPrice(1.2, 500, 'GRAM')).toEqual({
      unitPrice: '2.40',
      label: '1 kg',
    });
    expect(proposeUnitPrice(1.5, 750, 'MILLILITER')).toEqual({
      unitPrice: '2.00',
      label: '1 L',
    });
  });

  it('keeps the four decimals the column holds', () => {
    expect(proposeUnitPrice(1, 3, 'UNIT')).toEqual({
      unitPrice: '0.3333',
      label: '1 ud',
    });
  });

  it('proposes nothing without a size, a price or a known unit', () => {
    expect(proposeUnitPrice(1, null, 'LITER')).toBeNull();
    expect(proposeUnitPrice(1, 0, 'LITER')).toBeNull();
    expect(proposeUnitPrice(0, 1, 'LITER')).toBeNull();
    expect(proposeUnitPrice(1, 1, 'FURLONG')).toBeNull();
  });
});

describe('the observed date window', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');

  it('takes an empty date, which the server reads as now', () => {
    expect(checkObservedAt('', now)).toBeNull();
    expect(checkObservedAt(null, now)).toBeNull();
  });

  it('takes the last 30 days and refuses either side of them', () => {
    expect(checkObservedAt('2026-09-01T12:00:00.000Z', now)).toBeNull();
    expect(checkObservedAt('2026-08-24T11:00:00.000Z', now)).toBe(
      'catalog.prices.observedAtTooOld'
    );
    expect(checkObservedAt('2026-09-24T13:00:00.000Z', now)).toBe(
      'catalog.prices.observedAtFuture'
    );
  });
});
