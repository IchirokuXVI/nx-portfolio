import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { ConflictException } from '@portfolio/luna-shopper/platform';
import { QueryFailedError } from 'typeorm';
import type { Zone, ZoneMembership } from '../entities';
import { ZoneService } from './zone.service';

/**
 * Creating a group announces it to the creator (plan 0030, section 4.2).
 *
 * The event is the odd one out in this service and the two things that make it
 * odd are what this spec holds: it carries **no zone**, because the room of a
 * zone one second old contains nobody, not even the tab that asked for it; and
 * it is addressed to a person, which is the whole reason plan 0030 exists.
 */

const ZONE = {
  id: 'z1',
  name: 'Flat 3B',
  joinCode: 'ABCD1234',
  status: ZoneStatus.ACTIVE,
  ownerUserId: 'u1',
  config: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as Zone;

/**
 * A data source whose `transaction` runs the callback against repositories that
 * save whatever they are given, which is all `create` asks of the database.
 */
function makeService(failWith?: unknown) {
  const repository = {
    create: (row: Partial<Zone | ZoneMembership>) => row,
    save: jest.fn(async (row: Partial<Zone>) => ({ ...ZONE, ...row })),
  };
  const dataSource = {
    transaction: jest.fn(
      async (run: (manager: unknown) => Promise<unknown>) => {
        if (failWith) {
          throw failWith;
        }
        return run({ getRepository: () => repository });
      }
    ),
  };
  const events = { emit: jest.fn(), emitTo: jest.fn(), emitToUsers: jest.fn() };
  const svc = new ZoneService(
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    events as never,
    {} as never
  );
  return { svc, events, repository };
}

describe('ZoneService.create (plan 0030, section 4.2)', () => {
  it('addresses the new zone to its creator and to no zone room', async () => {
    const { svc, events } = makeService();

    const view = await svc.create({
      userId: 'u1',
      username: 'Vela',
      name: 'Flat 3B',
    });

    expect(events.emitToUsers).toHaveBeenCalledWith(
      RealtimeEvent.ZoneCreated,
      ['u1'],
      view
    );
    // Not `emit`, which is the zone-scoped door: routing this to `zone:z1`
    // would send it to a room whose only possible occupant has not subscribed.
    expect(events.emit).not.toHaveBeenCalled();
    expect(events.emitTo).not.toHaveBeenCalled();
  });

  it('sends the view the endpoint returns, not a summary composed for the event', async () => {
    const { svc, events } = makeService();

    const view = await svc.create({
      userId: 'u1',
      username: 'Vela',
      name: 'Flat 3B',
    });

    // The receiving tab identifies the zone from this and asks for the rest
    // (velista 0021, section 4.1); composing a full summary here would mean
    // running the counts query for a zone with one member and no lists.
    const [, , payload] = events.emitToUsers.mock.calls[0];
    expect(payload).toBe(view);
    expect(payload).toMatchObject({ id: 'z1', name: 'Flat 3B' });
  });

  it('creates the creator as an approved owner in the same transaction', async () => {
    const { svc, repository } = makeService();

    await svc.create({ userId: 'u1', username: 'Vela', name: 'Flat 3B' });

    const membership = repository.save.mock.calls[1][0] as ZoneMembership;
    expect(membership).toMatchObject({
      userId: 'u1',
      username: 'Vela',
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    });
  });

  it('announces nothing when the zone was never created', async () => {
    const clash = new QueryFailedError('insert', [], {
      code: '23505',
    } as never);
    const { svc, events } = makeService(clash);

    await expect(
      svc.create({ userId: 'u1', username: 'Vela', name: 'Flat 3B' })
    ).rejects.toBeInstanceOf(ConflictException);

    expect(events.emitToUsers).not.toHaveBeenCalled();
  });
});
