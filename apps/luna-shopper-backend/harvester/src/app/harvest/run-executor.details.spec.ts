import {
  HarvestDetailFetch,
  HarvestRunWrites,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry } from '../entities';
import { RunExecutor, readDetails, readWrites } from './run-executor.service';

/**
 * The executor's half of a walk that fetches only new details (plan 0119,
 * sections 2 and 4): what the chain already knows, loaded before the walk, and
 * the stored settings read back.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';

function build(rows: Array<{ externalId: string; ean: string | null }>) {
  const entries = {
    find: jest.fn(async () => rows as SourceCatalogEntry[]),
  } as unknown as Repository<SourceCatalogEntry>;
  // Only the chain's rows are read, so every other dependency is left out
  // rather than faked into something that looks used.
  const executor = new RunExecutor(
    entries,
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
    undefined as never
  );
  const known = (details: HarvestDetailFetch, detailBackfill = false) =>
    executor['knownProducts'](CHAIN, details, detailBackfill);
  return { known, entries };
}

describe('RunExecutor, what a walk already knows (plan 0119)', () => {
  const rows = [
    { externalId: '4241', ean: '8480000135636' },
    { externalId: '7012', ean: null },
    { externalId: '9001', ean: '8480000900107' },
  ];

  it('knows only the products whose row carries an EAN', async () => {
    const { known, entries } = build(rows);

    const answer = await known(HarvestDetailFetch.NEW);

    expect(answer.knownExternalIds).toEqual(new Set(['4241', '9001']));
    // A row with no EAN has its detail fetched again, which is how last
    // week's failed detail is retried.
    expect(answer.externalIdsWithoutEan).toEqual(new Set(['7012']));
    expect(entries.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { supermarketId: CHAIN } })
    );
  });

  it('knows nothing, and reads nothing, for ALL', async () => {
    const { known, entries } = build(rows);

    const answer = await known(HarvestDetailFetch.ALL);

    expect(answer.knownExternalIds.size).toBe(0);
    expect(answer.externalIdsWithoutEan.size).toBe(0);
    expect(entries.find).not.toHaveBeenCalled();
  });

  it('knows nothing for a backfill, which is not a walk', async () => {
    const { known, entries } = build(rows);

    const answer = await known(HarvestDetailFetch.NEW, true);

    expect(answer.knownExternalIds.size).toBe(0);
    expect(entries.find).not.toHaveBeenCalled();
  });
});

describe('RunExecutor, the stored settings read back (plan 0119)', () => {
  it('reads a stored writes, and anything else as both', () => {
    expect(readWrites(HarvestRunWrites.PRICES)).toBe(HarvestRunWrites.PRICES);
    expect(readWrites(undefined)).toBe(
      HarvestRunWrites.PRICES_AND_AVAILABILITY
    );
    expect(readWrites('SOMETHING')).toBe(
      HarvestRunWrites.PRICES_AND_AVAILABILITY
    );
  });

  it('reads a run stored before details existed as ALL, which is what it did', () => {
    expect(readDetails(HarvestDetailFetch.NEW)).toBe(HarvestDetailFetch.NEW);
    expect(readDetails(undefined)).toBe(HarvestDetailFetch.ALL);
    expect(readDetails('NEW ')).toBe(HarvestDetailFetch.ALL);
  });
});
