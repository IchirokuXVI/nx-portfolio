import {
  HarvestRunStatus,
  HarvestRunWrites,
  PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import type { DelistingReport } from './delisting';
import type { DelistingInput, DelistingService } from './delisting.service';
import { RunExecutor } from './run-executor.service';
import type { DelistingListings } from './run-report.sink';

/**
 * The executor's half of the delisting counter (plan 0220, section 4.4): it
 * runs after the verdict, for a COMPLETED walk only, and it never changes the
 * status of the run.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';

const WHOLE: DelistingListings = {
  whole: [{ key: '4661', scopeId: SCOPE, listed: ['a', 'b'] }],
  notWhole: [{ key: '4804', reason: 'category-404', detail: ['112'] }],
};

function build(counted: () => Promise<DelistingReport>) {
  const calls: DelistingInput[] = [];
  const delisting = {
    count: jest.fn(async (input: DelistingInput) => {
      calls.push(input);
      return counted();
    }),
  } as unknown as DelistingService;
  // Only the counter is read here, so every other dependency is left out
  // rather than faked into something that looks used.
  const executor = new RunExecutor(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    delisting
  );
  const count = (
    over: Partial<{
      status: HarvestRunStatus;
      writes: HarvestRunWrites;
      detailBackfill: boolean;
      listings: DelistingListings;
      config: Record<string, unknown>;
    }> = {}
  ): Promise<DelistingReport> =>
    executor['countDelisting']({
      runId: 'run-1',
      supermarketId: CHAIN,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      status: over.status ?? HarvestRunStatus.COMPLETED,
      writes: over.writes ?? HarvestRunWrites.PRICES_AND_AVAILABILITY,
      detailBackfill: over.detailBackfill ?? false,
      sink: { delistingListings: () => over.listings ?? WHOLE },
      config: over.config,
      copiesOf: () => [],
    });
  return { count, delisting, calls };
}

const COUNTED = {
  counted: true,
  notCountedBecause: null,
} as DelistingReport;

describe('RunExecutor, the delisting counter (plan 0220, section 4.4)', () => {
  it('counts a COMPLETED walk that declared a whole listing, with the threshold of the chain', async () => {
    const { count, calls } = build(async () => COUNTED);

    expect(await count({ config: { delistAfterWalks: 4 } })).toBe(COUNTED);

    expect(calls).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        supermarketId: CHAIN,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        whole: WHOLE.whole,
        notWhole: WHOLE.notWhole,
        threshold: expect.objectContaining({ walks: 4, days: 14 }),
      }),
    ]);
  });

  it.each([[HarvestRunStatus.FAILED], [HarvestRunStatus.ABORTED]])(
    'counts nothing for a %s run, and says so',
    async (status) => {
      const { count, delisting } = build(async () => COUNTED);

      const report = await count({ status });

      expect(delisting.count).not.toHaveBeenCalled();
      expect(report).toMatchObject({
        counted: false,
        notCountedBecause: 'run-not-completed',
        // The scopes that were not whole are still named.
        notWhole: WHOLE.notWhole,
      });
    }
  );

  it('counts nothing for a PRICES run', async () => {
    const { count, delisting } = build(async () => COUNTED);

    const report = await count({ writes: HarvestRunWrites.PRICES });

    expect(delisting.count).not.toHaveBeenCalled();
    expect(report.notCountedBecause).toBe('prices-only');
  });

  it('counts nothing for a detail backfill', async () => {
    const { count, delisting } = build(async () => COUNTED);

    const report = await count({ detailBackfill: true });

    expect(delisting.count).not.toHaveBeenCalled();
    expect(report.notCountedBecause).toBe('detail-backfill');
  });

  it('counts nothing for a walk that declared no whole listing', async () => {
    const { count, delisting } = build(async () => COUNTED);

    const report = await count({ listings: { whole: [], notWhole: [] } });

    expect(delisting.count).not.toHaveBeenCalled();
    expect(report.notCountedBecause).toBe('no-whole-listing');
  });

  it('writes an error of the counter to the report and does not throw', async () => {
    const { count } = build(async () => {
      throw new Error('catalog is down');
    });

    const report = await count();

    // The caller finishes the run with the status it already decided.
    expect(report).toMatchObject({
      counted: true,
      notCountedBecause: null,
      error: 'catalog is down',
    });
  });
});
