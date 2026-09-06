import { RealtimeEvent, ZoneStatus } from '@portfolio/luna-shopper/contracts';
import { fakeAudit } from '../audit/core-audit.testing';
import { Zone } from '../entities';
import { ZoneReaperService } from './zone-reaper.service';

/**
 * `applicants` are the user ids holding a PENDING membership in the zone under
 * test. They are the one audience the zone room cannot carry the deletion to,
 * which is why the reaper reads them (plan 0030, section 5).
 */
function build(zones: Partial<Zone>[], applicants: string[] = []) {
  const zonesRepo = {
    find: jest.fn(async () => zones.map((z) => ({ ...z }))),
    findOne: jest.fn(async () => (zones[0] ? { ...zones[0] } : null)),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const membershipsRepo = {
    find: jest.fn(async () => applicants.map((userId) => ({ userId }))),
  };
  const events = { emitTo: jest.fn() };
  const logger = { log: jest.fn(), error: jest.fn() };
  const configService = {
    getOrThrow: () => ({
      reaper: {
        enabled: true,
        graceMs: 1000,
        intervalMs: 1000,
        batchSize: 200,
      },
    }),
  };
  const audit = fakeAudit([
    [Zone, { name: 'zones', repository: zonesRepo as never }],
  ]);
  const svc = new ZoneReaperService(
    zonesRepo as never,
    membershipsRepo as never,
    events as never,
    logger as never,
    audit.service,
    configService as never
  );
  return { svc, zonesRepo, membershipsRepo, events, audit };
}

describe('ZoneReaperService.reap', () => {
  it('deletes an abandoned marked zone and emits ZoneDeleted', async () => {
    const { svc, zonesRepo, events } = build([
      { id: 'z1', ownerUserId: null, status: ZoneStatus.MARKED_FOR_DELETION },
    ]);
    await expect(svc.reap()).resolves.toBe(1);
    expect(zonesRepo.delete).toHaveBeenCalledWith({ id: 'z1' });
    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      { zoneId: 'z1' },
      { id: 'z1' }
    );
  });

  it('addresses the deletion to whoever was still waiting to join', async () => {
    const { svc, zonesRepo, membershipsRepo, events } = build(
      [{ id: 'z1', ownerUserId: null, status: ZoneStatus.MARKED_FOR_DELETION }],
      ['applicant-1', 'applicant-2']
    );

    await svc.reap();

    // A PENDING member is refused the zone room, so the room alone would leave
    // their request drawn over a group that no longer exists.
    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      { zoneId: 'z1', userIds: ['applicant-1', 'applicant-2'] },
      { id: 'z1' }
    );
    // Read before the delete: the membership rows cascade with the zone.
    expect(membershipsRepo.find.mock.invocationCallOrder[0]).toBeLessThan(
      zonesRepo.delete.mock.invocationCallOrder[0]
    );
  });

  it('skips a zone that regained an owner between the query and now', async () => {
    const { svc, zonesRepo, events } = build([
      {
        id: 'z2',
        ownerUserId: 'rescuer',
        status: ZoneStatus.MARKED_FOR_DELETION,
      },
    ]);
    await expect(svc.reap()).resolves.toBe(0);
    expect(zonesRepo.delete).not.toHaveBeenCalled();
    expect(events.emitTo).not.toHaveBeenCalled();
  });

  it('returns 0 when nothing is eligible', async () => {
    const { svc, zonesRepo } = build([]);
    await expect(svc.reap()).resolves.toBe(0);
    expect(zonesRepo.delete).not.toHaveBeenCalled();
  });

  it('writes no audit row, because a scheduled run has no actor', async () => {
    const { svc, audit } = build([
      { id: 'z1', ownerUserId: null, status: ZoneStatus.MARKED_FOR_DELETION },
    ]);
    await svc.reap();
    expect(audit.recorded).toEqual([]);
  });
});

describe('ZoneReaperService.deleteZoneAsOperator', () => {
  it('deletes the zone, announces it, and records who did it', async () => {
    const { svc, zonesRepo, events, audit } = build([
      { id: 'z1', name: 'Casa', ownerUserId: 'u1', status: ZoneStatus.ACTIVE },
    ]);

    await expect(svc.deleteZoneAsOperator('z1', 'admin-1')).resolves.toEqual({
      id: 'z1',
    });

    expect(zonesRepo.delete).toHaveBeenCalledWith({ id: 'z1' });
    // The same announcement the scheduled path makes, so a client holding the
    // zone hears about it whichever removed it.
    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      { zoneId: 'z1' },
      { id: 'z1' }
    );
    expect(audit.recorded).toEqual([
      {
        actorId: 'admin-1',
        action: 'DELETE',
        entity: 'zones',
        entityId: 'z1',
        before: {
          name: 'Casa',
          ownerUserId: 'u1',
          status: ZoneStatus.ACTIVE,
        },
        after: null,
      },
    ]);
  });

  it('addresses the deletion to whoever was still waiting to join', async () => {
    const { svc, events } = build(
      [
        {
          id: 'z1',
          name: 'Casa',
          ownerUserId: 'u1',
          status: ZoneStatus.ACTIVE,
        },
      ],
      ['applicant-1']
    );

    await svc.deleteZoneAsOperator('z1', 'admin-1');

    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      { zoneId: 'z1', userIds: ['applicant-1'] },
      { id: 'z1' }
    );
  });

  it('answers 404 for a zone that is already gone', async () => {
    const { svc, zonesRepo, events } = build([]);

    await expect(svc.deleteZoneAsOperator('z1', 'admin-1')).rejects.toThrow(
      'Zone not found'
    );
    expect(zonesRepo.delete).not.toHaveBeenCalled();
    expect(events.emitTo).not.toHaveBeenCalled();
  });
});
