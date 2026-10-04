import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryAvailability } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';

/**
 * The offer with no price when catalog refuses a call (plan 0182).
 *
 * Which rows are owed an offer is a query, proved against Postgres in
 * `source-entry-availability.integration.spec.ts`. What is proved here is the
 * batching: a batch that fails does not stop the batches after it, and what
 * was written is kept.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

/** `count` products the run's query answers, in the order it answers them. */
function products(count: number): { itemId: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: `item-${index}`,
  }));
}

function build(
  rows: { itemId: string }[],
  options: {
    /** The first product of every batch catalog refuses. */
    refuses?: string[];
    chainIsAway?: boolean;
  } = {}
) {
  const setAvailability = jest.fn(
    async (_scope: string, entries: { itemId: string }[]) => {
      if (options.refuses?.includes(entries[0].itemId)) {
        throw new Error('catalog is away');
      }
      return { updated: entries.length };
    }
  );
  const catalog = {
    getSupermarket: jest.fn(async () => {
      if (options.chainIsAway) {
        throw new Error('catalog is away');
      }
      return { id: CHAIN, defaultPriceScopeId: SCOPE };
    }),
    setAvailability,
    setLocationAvailability: jest.fn(async () => ({
      written: 0,
      skipped: 0,
      conflicts: [],
    })),
  } as unknown as CatalogClient;
  const claims = {
    query: jest.fn(async (sql: string) =>
      // The run's offer query answers the products. The claims query of a
      // bind answers none.
      sql.includes('SELECT DISTINCT e."itemId"') ? rows : []
    ),
  } as unknown as Repository<SourceEntryAvailability>;
  return {
    writer: new SourceEntryAvailabilityWriter(claims, catalog),
    setAvailability,
  };
}

describe('the offer with no price, when catalog refuses a call (plan 0182)', () => {
  it('sends the batches after a failed one, counts its products, and keeps what was written', async () => {
    // Three calls: 500, 500 and 100. The second fails.
    const { writer, setAvailability } = build(products(1100), {
      refuses: ['item-500'],
    });

    const sent = await writer.writePricelessOffersForRun(RUN, CHAIN);

    expect(setAvailability).toHaveBeenCalledTimes(3);
    expect(
      setAvailability.mock.calls.map(([, entries]) => entries.length)
    ).toEqual([500, 500, 100]);
    expect(
      setAvailability.mock.calls.every(
        (call) =>
          (call as unknown as [string, unknown, { onlyIfMissing: boolean }])[2]
            .onlyIfMissing
      )
    ).toBe(true);
    expect(sent).toEqual({ written: 600, failed: 500 });
  });

  it('counts every product as failed, and does not throw, when the chain cannot be read', async () => {
    const { writer, setAvailability } = build(products(3), {
      chainIsAway: true,
    });

    const sent = await writer.writePricelessOffersForRun(RUN, CHAIN);

    expect(sent).toEqual({ written: 0, failed: 3 });
    expect(setAvailability).not.toHaveBeenCalled();
  });

  it('answers zeros for a run that owes no offer, and asks catalog nothing', async () => {
    const { writer, setAvailability } = build([]);

    expect(await writer.writePricelessOffersForRun(RUN, CHAIN)).toEqual({
      written: 0,
      failed: 0,
    });
    expect(setAvailability).not.toHaveBeenCalled();
  });

  it('still answers a bind with the write that failed, as a price or a claim does', async () => {
    // The run counts a failure. A bind is a request, and it answers with it.
    const { writer } = build([], { refuses: ['item-bound'] });
    const row = {
      id: 'e-1',
      supermarketId: CHAIN,
      itemId: 'item-bound',
      prices: [],
    } as unknown as SourceCatalogEntry;

    await expect(writer.writeForEntries([row])).rejects.toThrow(
      'catalog is away'
    );
  });
});
