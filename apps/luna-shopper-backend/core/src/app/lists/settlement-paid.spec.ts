import { SettlementOutcome } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { paidColumns } from './settlement-paid';

/**
 * The chain a settle records beside its shop (plan 0163, section 5).
 *
 * The chain travels with the shop and never without it, and a settle made in
 * "any shop" mode records neither. `ck_line_settlements_location_scope` holds
 * the same rule in the database; this is the refusal a caller meets first.
 */

const SCOPE = 'b4e2c6a8-1f37-4d95-8a0b-2c6e4f9a1d73';
const SHOP = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';
const CHAIN = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';

const paid = {
  priceScopeId: SCOPE,
  supermarketLocationId: SHOP,
  supermarketId: CHAIN,
  pricePaidCents: 129,
  pricePaidCurrency: 'EUR',
};

describe('paidColumns: the shop and its chain (plan 0163)', () => {
  it('writes the shop and its chain together', () => {
    expect(paidColumns(paid, SettlementOutcome.BOUGHT)).toEqual({
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
      supermarketId: CHAIN,
      pricePaidCents: 129,
      pricePaidCurrency: 'EUR',
    });
  });

  it('keeps the shop and its chain on a close, which drops the price', () => {
    expect(paidColumns(paid, SettlementOutcome.NOT_AVAILABLE)).toMatchObject({
      supermarketLocationId: SHOP,
      supermarketId: CHAIN,
      pricePaidCents: null,
    });
  });

  it('writes neither in any shop mode, and keeps the scope', () => {
    expect(
      paidColumns(
        { ...paid, supermarketLocationId: null, supermarketId: null },
        SettlementOutcome.BOUGHT
      )
    ).toMatchObject({
      priceScopeId: SCOPE,
      supermarketLocationId: null,
      supermarketId: null,
    });
  });

  it('reads an absent chain as none, for a message from an older gateway', () => {
    const { supermarketId: _dropped, ...older } = paid;

    expect(paidColumns(older, SettlementOutcome.BOUGHT).supermarketId).toBe(
      null
    );
  });

  it('refuses a chain with no shop', () => {
    expect(() =>
      paidColumns(
        { ...paid, supermarketLocationId: null },
        SettlementOutcome.BOUGHT
      )
    ).toThrow(ValidationException);
  });

  it('refuses a chain that is not an id', () => {
    expect(() =>
      paidColumns(
        { ...paid, supermarketId: 'mercadona' },
        SettlementOutcome.BOUGHT
      )
    ).toThrow(ValidationException);
  });

  it('writes all five as null when nothing was paid', () => {
    expect(paidColumns(undefined, SettlementOutcome.BOUGHT)).toEqual({
      priceScopeId: null,
      supermarketLocationId: null,
      supermarketId: null,
      pricePaidCents: null,
      pricePaidCurrency: null,
    });
  });
});
