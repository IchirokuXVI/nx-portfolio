import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import {
  isDisputed,
  resolveEffectivePrice,
  type PolicyRow,
  type PriceRow,
} from './effective-price';

/**
 * Which price a shopper sees, table driven (plan 0080, section 15): a set of
 * rows, a policy, a clock, and the row and flag expected back.
 *
 * Every case is pure. The rows are what `DISTINCT ON` would have handed the
 * service, the policy is section 3's table unless a case says otherwise, and
 * the clock is a day number so the oscillation table of section 4.1 reads as
 * the plan wrote it.
 */

const SCOPE = 'warehouse-4661';
const NATIONAL = 'national';

/** Section 3, verbatim. */
const POLICIES: PolicyRow[] = [
  {
    sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
    priority: 10,
    maxAgeDays: null,
    enabled: true,
  },
  {
    sourceKind: PriceSourceKind.OFFICIAL_API,
    priority: 20,
    maxAgeDays: 7,
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
  {
    sourceKind: PriceSourceKind.USER_RECEIPT,
    priority: 50,
    maxAgeDays: null,
    enabled: true,
  },
  {
    sourceKind: PriceSourceKind.USER_REPORTED,
    priority: 60,
    maxAgeDays: null,
    enabled: false,
  },
];

/** Day N of the table, at noon. */
function day(n: number): Date {
  return new Date(Date.UTC(2026, 8, n, 12, 0, 0));
}

let counter = 0;
function row(
  overrides: Partial<PriceRow> & { sourceKind: PriceSourceKind }
): PriceRow {
  counter += 1;
  return {
    id: `row-${counter}`,
    priceScopeId: SCOPE,
    price: null,
    unitPrice: null,
    lastObservedAt: day(1),
    validFrom: null,
    validUntil: null,
    overrides: null,
    protectedUntil: null,
    ...overrides,
  };
}

function resolve(rows: PriceRow[], now: Date, policies = POLICIES) {
  return resolveEffectivePrice({ rows, priceScopeId: SCOPE, policies, now });
}

/** The owner's override, typed on day 5 over a crawl that said 1.19. */
function adminRow(
  typedOn: Date,
  price: number,
  overrides: PriceRow['overrides']
) {
  return row({
    sourceKind: PriceSourceKind.ADMIN,
    price,
    lastObservedAt: typedOn,
    overrides,
    protectedUntil: new Date(typedOn.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
}

describe('resolveEffectivePrice (plan 0080, section 4)', () => {
  describe('the oscillation table of section 4.1, as a sequence of days', () => {
    const typed = adminRow(day(5), 1.29, {
      OFFICIAL_API: { price: 1.19, unitPrice: null },
    });

    it('day 5: the owner types 1.29 over a crawl saying 1.19, and 1.29 is shown', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(4),
      });
      const result = resolve([crawl, typed], day(5));
      expect(result.row?.price).toBe(1.29);
      expect(result.stale).toBe(false);
    });

    it('day 6: the crawl moves to 1.35, disagrees with the snapshot, and is shown at once', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.35,
        lastObservedAt: day(6),
      });
      expect(resolve([crawl, typed], day(6)).row?.price).toBe(1.35);
    });

    it('day 7: the crawl repeats 1.35 and nothing flips back', () => {
      // The defect of the owner's rule: "changed since the last run" is false
      // on day 7, and the old rule showed 1.29 again with nothing having
      // changed. The comparison here is against the snapshot, not the previous
      // run.
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.35,
        lastObservedAt: day(7),
      });
      expect(resolve([crawl, typed], day(7)).row?.price).toBe(1.35);
    });

    it('day 8: the crawl returns to 1.19, which the owner already knew, and 1.29 is shown again', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(8),
      });
      expect(resolve([crawl, typed], day(8)).row?.price).toBe(1.29);
    });

    it('day 12: protection is over and the crawl wins at ordinary priority', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(12),
      });
      // Typed at noon on day 5, protected until noon on day 12: a minute later
      // the row competes at priority 40 like any other.
      const afterProtection = new Date(day(12).getTime() + 60_000);
      expect(resolve([crawl, typed], afterProtection).row?.price).toBe(1.19);
    });

    it('the protection window is the next boundary while it runs', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(8),
      });
      const result = resolve([crawl, typed], day(8));
      // The crawl's max age (day 15) is later than the protection end (day 12).
      expect(result.nextBoundaryAt).toEqual(typed.protectedUntil);
    });
  });

  describe('the Lidl case: a source reporting for the first time is new information', () => {
    it('a leaflet arriving on Wednesday displaces the override typed on Monday', () => {
      const typed = adminRow(day(7), 1.29, {
        OFFICIAL_WEB: { price: 1.19, unitPrice: null },
      });
      const web = row({
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        price: 1.19,
        lastObservedAt: day(9),
      });
      const leaflet = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 0.99,
        lastObservedAt: day(9),
        validFrom: day(9),
        validUntil: day(16),
      });
      const result = resolve([typed, web, leaflet], day(9));
      expect(result.row?.sourceKind).toBe(PriceSourceKind.OFFICIAL_LEAFLET);
      expect(result.row?.price).toBe(0.99);
    });

    it('isDisputed: no entry for a kind with a current row is a disagreement', () => {
      const typed = adminRow(day(7), 1.29, {});
      const web = row({
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        price: 1.19,
      });
      expect(isDisputed(typed, [typed, web])).toBe(true);
    });

    it('isDisputed: a kind in the snapshot with no current row any more is ignored', () => {
      const typed = adminRow(day(7), 1.29, {
        OFFICIAL_WEB: { price: 1.19, unitPrice: null },
      });
      expect(isDisputed(typed, [typed])).toBe(false);
    });
  });

  describe('windows', () => {
    it('a leaflet inside its window outranks a fresh crawl', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.35,
        lastObservedAt: day(10),
      });
      const leaflet = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 1.49,
        lastObservedAt: day(8),
        validFrom: day(8),
        validUntil: day(15),
      });
      const result = resolve([crawl, leaflet], day(10));
      expect(result.row?.price).toBe(1.49);
      expect(result.stale).toBe(false);
      // The window end comes before the crawl's max age.
      expect(result.nextBoundaryAt).toEqual(day(15));
    });

    it('an expired leaflet fails on its own and the crawl wins with no special case', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.35,
        lastObservedAt: day(16),
      });
      const leaflet = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 1.49,
        lastObservedAt: day(8),
        validFrom: day(8),
        validUntil: day(15),
      });
      expect(resolve([crawl, leaflet], day(16)).row?.price).toBe(1.35);
    });

    it('a leaflet whose window has not opened is not eligible, and its opening is the boundary', () => {
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.35,
        lastObservedAt: day(10),
      });
      const leaflet = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 1.49,
        lastObservedAt: day(10),
        validFrom: day(12),
        validUntil: day(19),
      });
      const result = resolve([crawl, leaflet], day(10));
      expect(result.row?.price).toBe(1.35);
      expect(result.nextBoundaryAt).toEqual(day(12));
    });
  });

  describe('age', () => {
    it('a seven day old crawl is beaten by a fresher one of lower priority', () => {
      const api = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(1),
      });
      const web = row({
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        price: 1.25,
        lastObservedAt: day(9),
      });
      expect(resolve([api, web], day(10)).row?.price).toBe(1.25);
    });

    it('a chain with only an ADMIN row still shows it at day 30', () => {
      const typed = adminRow(day(1), 2.1, {});
      const result = resolve([typed], day(30));
      expect(result.row?.price).toBe(2.1);
      expect(result.stale).toBe(false);
      // Nothing ahead: no window, no max age, the protection long over.
      expect(result.nextBoundaryAt).toBeNull();
    });

    it('USER_RECEIPT has no max age and is shown unflagged with an August date', () => {
      const receipt = row({
        sourceKind: PriceSourceKind.USER_RECEIPT,
        price: 1.05,
        lastObservedAt: new Date('2026-08-12T00:00:00.000Z'),
      });
      const result = resolve([receipt], new Date('2026-10-01T00:00:00.000Z'));
      expect(result.row?.price).toBe(1.05);
      expect(result.stale).toBe(false);
    });

    it('lastObservedAt plus maxAgeDays is the boundary a plan that counted three would forget', () => {
      const api = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(3),
      });
      expect(resolve([api], day(5)).nextBoundaryAt).toEqual(day(10));
    });
  });

  describe('the stale tier of section 5', () => {
    it('a crawl older than its max age is still shown, flagged', () => {
      const api = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(1),
      });
      const result = resolve([api], day(22));
      expect(result.row?.price).toBe(1.19);
      expect(result.stale).toBe(true);
      expect(result.nextBoundaryAt).toBeNull();
    });

    it('picks an expired leaflet over nothing', () => {
      const leaflet = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 1.49,
        lastObservedAt: day(2),
        validFrom: day(1),
        validUntil: day(8),
      });
      const result = resolve([leaflet], day(20));
      expect(result.row?.id).toBe(leaflet.id);
      expect(result.stale).toBe(true);
    });

    it('never picks a disabled kind, even in the stale tier', () => {
      const reported = row({
        sourceKind: PriceSourceKind.USER_REPORTED,
        price: 0.5,
        lastObservedAt: day(19),
      });
      const api = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(1),
      });
      const result = resolve([reported, api], day(20));
      expect(result.row?.sourceKind).toBe(PriceSourceKind.OFFICIAL_API);
      expect(result.stale).toBe(true);
    });

    it('answers null with no rows at all', () => {
      const result = resolve([], day(1));
      expect(result.row).toBeNull();
      expect(result.stale).toBe(false);
      expect(result.nextBoundaryAt).toBeNull();
    });
  });

  describe('inheritance from the NATIONAL scope (section 6)', () => {
    it('a national row reaches the warehouse scope', () => {
      const national = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        priceScopeId: NATIONAL,
        price: 1.49,
        lastObservedAt: day(5),
        validFrom: day(5),
        validUntil: day(12),
      });
      expect(resolve([national], day(6)).row?.id).toBe(national.id);
    });

    it('a warehouse row of the same kind beats the national one there', () => {
      const national = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        priceScopeId: NATIONAL,
        price: 1.49,
        lastObservedAt: day(5),
      });
      const regional = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        priceScopeId: SCOPE,
        price: 1.39,
        lastObservedAt: day(4),
      });
      // The regional row is older, and recency is not asked: the narrower
      // scope wins before it.
      expect(resolve([national, regional], day(6)).row?.id).toBe(regional.id);
    });

    it('a national leaflet outranks a warehouse crawl, which price alone would get wrong', () => {
      const national = row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        priceScopeId: NATIONAL,
        price: 1.49,
        lastObservedAt: day(5),
      });
      const crawl = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.35,
        lastObservedAt: day(6),
      });
      expect(resolve([national, crawl], day(6)).row?.price).toBe(1.49);
    });
  });

  describe('ties and disabled kinds', () => {
    it('breaks a tie within one priority by the most recent lastObservedAt', () => {
      const older = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.1,
        lastObservedAt: day(8),
      });
      const newer = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.2,
        lastObservedAt: day(9),
        priceScopeId: NATIONAL,
      });
      // Two rows of one kind cannot both be candidates: the narrower scope
      // wins. So a tie is exercised with two kinds given one priority.
      const tied = POLICIES.map((p) =>
        p.sourceKind === PriceSourceKind.OFFICIAL_WEB
          ? { ...p, priority: 20 }
          : p
      );
      const web = row({
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        price: 1.3,
        lastObservedAt: day(9),
      });
      expect(resolve([older, web], day(9), tied).row?.id).toBe(web.id);
      expect(resolve([older, newer], day(9)).row?.id).toBe(older.id);
    });

    it('a disabled kind is never chosen', () => {
      const disabled = POLICIES.map((p) =>
        p.sourceKind === PriceSourceKind.OFFICIAL_API
          ? { ...p, enabled: false }
          : p
      );
      const api = row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.19,
        lastObservedAt: day(9),
      });
      const receipt = row({
        sourceKind: PriceSourceKind.USER_RECEIPT,
        price: 1.05,
        lastObservedAt: day(2),
      });
      expect(resolve([api, receipt], day(9), disabled).row?.id).toBe(
        receipt.id
      );
    });
  });
});
