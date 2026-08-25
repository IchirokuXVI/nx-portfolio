import { RealtimeEvent, ZoneStatus } from '@portfolio/luna-shopper/contracts';
import type { Zone } from '../entities';
import { ZoneReaperService } from './zone-reaper.service';

function build(zones: Partial<Zone>[]) {
  const zonesRepo = {
    find: jest.fn(async () => zones.map((z) => ({ ...z }))),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const events = { emit: jest.fn() };
  const logger = { log: jest.fn(), error: jest.fn() };
  const configService = {
    getOrThrow: () => ({
      reaper: { enabled: true, graceMs: 1000, intervalMs: 1000, batchSize: 200 },
    }),
  };
  const svc = new ZoneReaperService(
    zonesRepo as never,
    events as never,
    logger as never,
    configService as never
  );
  return { svc, zonesRepo, events };
}

describe('ZoneReaperService.reap', () => {
  it('deletes an abandoned marked zone and emits ZoneDeleted', async () => {
    const { svc, zonesRepo, events } = build([
      { id: 'z1', ownerUserId: null, status: ZoneStatus.MARKED_FOR_DELETION },
    ]);
    await expect(svc.reap()).resolves.toBe(1);
    expect(zonesRepo.delete).toHaveBeenCalledWith({ id: 'z1' });
    expect(events.emit).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      'z1',
      { id: 'z1' }
    );
  });

  it('skips a zone that regained an owner between the query and now', async () => {
    const { svc, zonesRepo, events } = build([
      { id: 'z2', ownerUserId: 'rescuer', status: ZoneStatus.MARKED_FOR_DELETION },
    ]);
    await expect(svc.reap()).resolves.toBe(0);
    expect(zonesRepo.delete).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('returns 0 when nothing is eligible', async () => {
    const { svc, zonesRepo } = build([]);
    await expect(svc.reap()).resolves.toBe(0);
    expect(zonesRepo.delete).not.toHaveBeenCalled();
  });
});
