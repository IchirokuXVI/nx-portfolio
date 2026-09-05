import { SourceEntryStatus } from '@portfolio/luna-shopper/contracts';
import { In } from 'typeorm';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { SourceEntryRevert } from './source-entry-revert.service';

/**
 * The harvester's half of a revert (plan 0086, section 8).
 *
 * The interesting part is what it does **not** delete, so the criteria are what
 * this pins: both run columns, and only the two undecided statuses.
 */

const RUN = '33333333-3333-4333-8333-333333333333';

function build() {
  const entryDelete = jest.fn(async () => ({ affected: 9 }));
  const priceDelete = jest.fn(async () => ({ affected: 12 }));
  const service = new SourceEntryRevert(
    { delete: entryDelete } as unknown as Repository<SourceCatalogEntry>,
    { delete: priceDelete } as unknown as Repository<SourceEntryPrice>
  );
  return { service, entryDelete, priceDelete };
}

describe('SourceEntryRevert (plan 0086, section 8)', () => {
  it("deletes the run's price observations by its own id", async () => {
    const { service, priceDelete } = build();

    const result = await service.revert(RUN);

    // They are the run's claims, and an accept after the revert must not write
    // them again.
    expect(priceDelete).toHaveBeenCalledWith({ runId: RUN });
    expect(result.prices).toBe(12);
  });

  it('deletes only the rows this run created and no later run has seen', async () => {
    const { service, entryDelete } = build();

    const result = await service.revert(RUN);

    // Both columns. A row this run created and a later run observed again is a
    // real product a later run stands behind, and deleting it would take the
    // later run's observation with it.
    expect(entryDelete).toHaveBeenCalledWith({
      firstRunId: RUN,
      lastRunId: RUN,
      status: In([SourceEntryStatus.CANDIDATE, SourceEntryStatus.UNRESOLVED]),
    });
    expect(result.entries).toBe(9);
  });

  it('leaves ACTIVE and REJECTED rows alone, whatever run created them', async () => {
    const { service, entryDelete } = build();

    await service.revert(RUN);

    const criteria = entryDelete.mock.calls[0][0] as {
      status: { _value: SourceEntryStatus[] };
    };
    // A person decided on those two, and a revert takes back what a run wrote,
    // not what a person did.
    expect(criteria.status._value).not.toContain(SourceEntryStatus.ACTIVE);
    expect(criteria.status._value).not.toContain(SourceEntryStatus.REJECTED);
  });
});
