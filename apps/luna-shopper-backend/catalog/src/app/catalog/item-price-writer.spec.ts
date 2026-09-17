import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import type { PolicyRow, PriceRow } from './effective-price';
import { snapshotOf } from './item-price-writer';

/**
 * What an `ADMIN` write records it overrode (plan 0080, section 4.2), taken
 * from the narrowest eligible automated row per kind (plan 0117, section 4).
 */
describe('snapshotOf (plan 0117, section 4)', () => {
  const STORE = 'store';
  const WAREHOUSE = 'warehouse-4661';
  const REGION = 'region';
  const NOW = new Date('2026-09-20T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  const POLICIES: PolicyRow[] = [
    {
      sourceKind: PriceSourceKind.OFFICIAL_API,
      priority: 20,
      maxAgeDays: 14,
      enabled: true,
    },
    {
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      priority: 30,
      maxAgeDays: 7,
      enabled: true,
    },
    {
      sourceKind: PriceSourceKind.ADMIN,
      priority: 40,
      maxAgeDays: null,
      enabled: true,
    },
  ];

  const PRIORITIES = new Map([
    [STORE, 100],
    [WAREHOUSE, 200],
    [REGION, 300],
  ]);

  function row(
    id: string,
    priceScopeId: string,
    price: number,
    daysAgo: number,
    sourceKind = PriceSourceKind.OFFICIAL_API
  ): PriceRow {
    return {
      id,
      priceScopeId,
      sourceKind,
      price,
      unitPrice: null,
      lastObservedAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      validFrom: null,
      validUntil: null,
      overrides: null,
      protectedUntil: null,
    };
  }

  function snapshot(rows: PriceRow[]) {
    return snapshotOf(rows, {
      priceScopeId: STORE,
      scopePriorities: PRIORITIES,
      policies: POLICIES,
      now: NOW,
    });
  }

  it('takes the narrower of two tiers by priority, whatever order the rows came in', () => {
    // The region's row first, as a scope uuid order might hand it over.
    const region = row('r', REGION, 1.25, 2);
    const warehouse = row('w', WAREHOUSE, 1.19, 3);

    expect(snapshot([region, warehouse])).toEqual({
      OFFICIAL_API: { price: 1.19, unitPrice: null },
    });
    expect(snapshot([warehouse, region])).toEqual({
      OFFICIAL_API: { price: 1.19, unitPrice: null },
    });
  });

  it('takes the wider tier when the narrower row is past its max age', () => {
    const warehouse = row('w', WAREHOUSE, 1.19, 19);
    const region = row('r', REGION, 1.25, 2);

    expect(snapshot([warehouse, region])).toEqual({
      OFFICIAL_API: { price: 1.25, unitPrice: null },
    });
  });

  it('records nothing for a kind with no eligible row, and never an ADMIN row', () => {
    const staleWeb = row(
      'web',
      WAREHOUSE,
      1.3,
      9,
      PriceSourceKind.OFFICIAL_WEB
    );
    const typed = row('a', STORE, 1.29, 1, PriceSourceKind.ADMIN);

    expect(snapshot([staleWeb, typed])).toEqual({});
  });
});
