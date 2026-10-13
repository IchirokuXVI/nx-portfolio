import { SettlementOutcome } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { itemSnapshotColumn, paidColumns } from './settlement-paid';

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

describe('itemSnapshotColumn: what a product was called (plan 0202)', () => {
  const snapshot = {
    name: { en: 'Whole milk', es: 'Leche entera' },
    brand: 'Hacendado',
    unitSize: 1,
    packCount: 6,
    defaultUnit: 'LITER' as never,
  };

  it('copies the five fields, and nothing else of the product', () => {
    expect(
      itemSnapshotColumn({ ...snapshot, sku: 'smuggled' } as never)
    ).toEqual(snapshot);
  });

  it('copies the name and does not keep the object it was given', () => {
    const copied = itemSnapshotColumn(snapshot);
    expect(copied?.name).toEqual(snapshot.name);
    expect(copied?.name).not.toBe(snapshot.name);
  });

  it('keeps the nulls of a product with no brand and no size', () => {
    const bare = { ...snapshot, brand: null, unitSize: null, packCount: null };
    expect(itemSnapshotColumn(bare)).toEqual(bare);
  });

  it('answers null when the gateway sent none', () => {
    expect(itemSnapshotColumn(undefined)).toBeNull();
    expect(itemSnapshotColumn(null)).toBeNull();
  });

  it.each([
    ['a name that is a string', { ...snapshot, name: 'Milk' }],
    ['a name with a value that is not text', { ...snapshot, name: { en: 1 } }],
    ['no name', { ...snapshot, name: null }],
    ['a brand that is a number', { ...snapshot, brand: 7 }],
    ['a size that is text', { ...snapshot, unitSize: '1' }],
    ['a pack count that is not whole', { ...snapshot, packCount: 1.5 }],
    ['no unit', { ...snapshot, defaultUnit: undefined }],
    ['an array', [snapshot]],
  ])('refuses %s', (_what, malformed) => {
    expect(() => itemSnapshotColumn(malformed as never)).toThrow(
      ValidationException
    );
  });
});
