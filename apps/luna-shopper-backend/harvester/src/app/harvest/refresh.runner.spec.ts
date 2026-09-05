import type { ConfigService } from '@nestjs/config';
import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { ItemSourceRef } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { RefreshRunner } from './refresh.runner';
import type { RunContext } from './run-context';

/**
 * The write half of a refresh (plan 0080, section 9): the prices go to
 * `itemPrice.addBatch` with the run's id, the 404s go to a separate
 * availability write with no price on them, and the counters read what the
 * batch answered.
 *
 * The fetch half is the Mercadona client against the network, which is not
 * exercised here; `writePrices` is what changed and what is pinned.
 */
describe('RefreshRunner.writePrices (plan 0080)', () => {
  const RUN = '33333333-3333-4333-8333-333333333333';

  function build() {
    const catalog = {
      addPrices: jest.fn(async () => ({ inserted: 2, confirmed: 1 })),
      setAvailability: jest.fn(async () => ({ updated: 1 })),
    };
    const runner = new RefreshRunner(
      {} as Repository<ItemSourceRef>,
      catalog as unknown as CatalogClient,
      {} as ConfigService
    );
    const context = {
      runId: RUN,
      report: jest.fn(async () => undefined),
    } as unknown as RunContext;
    const write = (
      runner as unknown as {
        writePrices: (
          context: RunContext,
          priceScopeId: string,
          entries: { itemId: string; price?: number }[],
          unavailable: string[]
        ) => Promise<void>;
      }
    ).writePrices.bind(runner);
    return { write, catalog, context };
  }

  it('sends the prices as this run, and the counters map onto the answer', async () => {
    const { write, catalog, context } = build();

    await write(
      context,
      'scope-1',
      [
        { itemId: 'i1', price: 1.19 },
        { itemId: 'i2', price: 2.5 },
        { itemId: 'i3', price: 0.99 },
      ],
      []
    );

    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
    expect(catalog.addPrices).toHaveBeenCalledWith(
      'scope-1',
      [
        { itemId: 'i1', price: 1.19 },
        { itemId: 'i2', price: 2.5 },
        { itemId: 'i3', price: 0.99 },
      ],
      RUN,
      PriceSourceKind.OFFICIAL_API
    );
    // A new row is "the source said something new"; a confirmed row is not.
    expect(context.report).toHaveBeenCalledWith({ updated: 2, unchanged: 1 });
  });

  it('sends availability separately, and a 404 carries no price', async () => {
    const { write, catalog, context } = build();

    await write(context, 'scope-1', [{ itemId: 'i1', price: 1.19 }], ['i9']);

    expect(catalog.setAvailability).toHaveBeenCalledWith('scope-1', [
      { itemId: 'i1', available: true },
      { itemId: 'i9', available: false },
    ]);
    // The unavailable product reaches no price write at all.
    const priced = (catalog.addPrices.mock.calls[0] as unknown[])[1] as {
      itemId: string;
    }[];
    expect(priced.map((entry) => entry.itemId)).toEqual(['i1']);
  });

  it('chunks a large batch so no single message exceeds the payload cap', async () => {
    const { write, catalog, context } = build();
    const entries = Array.from({ length: 450 }, (_, i) => ({
      itemId: `i${i}`,
      price: 1,
    }));

    await write(context, 'scope-1', entries, []);

    expect(catalog.addPrices).toHaveBeenCalledTimes(3);
    expect(catalog.setAvailability).toHaveBeenCalledTimes(3);
  });
});
