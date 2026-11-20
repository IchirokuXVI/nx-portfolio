import { rewritesAt, rowUnitOf } from './basket-product-change.service';
import type { BasketRow } from './basket-row-resolver';

/**
 * Which buys a change of product rewrites, by unit (plan 0246 M7). The write
 * itself is covered by `basket-product-change.integration.spec.ts`; these are
 * the two pure rules it asks.
 */
describe('a change of product rewrites the buys of the row unit (plan 0246 M7)', () => {
  const rowIn = (unit: 'UNIT' | 'GRAM') =>
    ({ entries: [{ unit }] }) as unknown as Pick<BasketRow, 'entries'>;

  it('prices a rewrite in the unit of the row, and in UNIT for a row with no entry', () => {
    expect(rowUnitOf(rowIn('GRAM'))).toBe('GRAM');
    expect(rowUnitOf({ entries: [] } as unknown as BasketRow)).toBe('UNIT');
  });

  it('rewrites a buy in the row unit, and leaves a buy in another unit as it is', () => {
    // A buy of 2 pieces made before the line moved to grams: the gateway
    // priced one kilo, which is not the price of one of those pieces.
    expect(rewritesAt({ unit: 'GRAM' }, 'GRAM')).toBe(true);
    expect(rewritesAt({ unit: 'UNIT' }, 'GRAM')).toBe(false);
    expect(rewritesAt({ unit: 'GRAM' }, 'UNIT')).toBe(false);
  });

  it('reads a buy written before plan 0246 as UNIT', () => {
    expect(
      rewritesAt({ unit: null } as unknown as { unit: 'UNIT' }, 'UNIT')
    ).toBe(true);
  });
});
