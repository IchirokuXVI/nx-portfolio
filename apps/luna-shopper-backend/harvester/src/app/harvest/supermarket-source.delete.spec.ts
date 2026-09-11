import type { ConfigService } from '@nestjs/config';
import { HarvestRunStatus } from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { HarvestRun, SupermarketSource } from '../entities';
import type { HarvestRunStore } from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * Taking a chain's source row away.
 *
 * The row is keyed on the chain, so a source described against the wrong chain
 * cannot be moved onto the right one: the upsert keys on the same column and
 * writes a second row beside the first. Deleting it is the only way back, and
 * until this existed one wrong pick in the back office create panel was
 * permanent.
 */
describe('SupermarketSourceService.delete', () => {
  const CHAIN = '11111111-1111-4111-8111-111111111111';

  function build(options: { active?: boolean; missing?: boolean } = {}) {
    const row = {
      id: 'source-1',
      supermarketId: CHAIN,
      adapterKey: 'mercadona-api',
    } as SupermarketSource;

    const sources = {
      findOne: jest.fn(async () => (options.missing ? null : row)),
      delete: jest.fn(async () => ({ affected: 1 })),
    } as unknown as Repository<SupermarketSource>;

    const admin = {
      requireAdmin: jest.fn(async () => 'owner-1'),
    } as unknown as PlatformAdminService;

    const config = {
      getOrThrow: jest.fn(() => ({
        defaultWorkers: 4,
        defaultMaxRequestsPerSecond: 4,
      })),
    } as unknown as ConfigService;

    const runs = {
      findActiveBySupermarket: jest.fn(async () =>
        options.active
          ? ({ id: 'run-7', status: HarvestRunStatus.RUNNING } as HarvestRun)
          : null
      ),
    } as unknown as HarvestRunStore;

    return {
      row,
      sources,
      runs,
      service: new SupermarketSourceService(sources, admin, config, runs),
    };
  }

  it('deletes the row and answers its id', async () => {
    const harness = build();

    await expect(
      harness.service.delete({ supermarketId: CHAIN } as never)
    ).resolves.toEqual({ id: 'source-1' });
    expect(harness.sources.delete).toHaveBeenCalledWith({ id: 'source-1' });
  });

  it('refuses while a run of that chain is in flight', async () => {
    // The run reads its worker count and its rate from the row while it works,
    // so deleting the row underneath it would leave the run holding settings
    // nothing can answer for. The message names the run, because aborting it is
    // the whole of what the operator has to do first.
    const harness = build({ active: true });

    await expect(
      harness.service.delete({ supermarketId: CHAIN } as never)
    ).rejects.toThrow('run-7');
    expect(harness.sources.delete).not.toHaveBeenCalled();
  });

  it('answers not found for a chain that has no row', async () => {
    const harness = build({ missing: true });

    await expect(
      harness.service.delete({ supermarketId: CHAIN } as never)
    ).rejects.toThrow('no configured source');
    expect(harness.sources.delete).not.toHaveBeenCalled();
  });
});
