import {
  MembershipStatus,
  RealtimeEvent,
  UsernamePropagation,
  ZoneRole,
  type UserUsernameChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { ZoneMembership } from '../entities';
import { UsernamePropagationService } from './username-propagation.service';

/**
 * The rows a real UPDATE ... RETURNING would give back for a given WHERE, so the
 * spec exercises the same filtering the SQL does without a database.
 */
function makeQueryBuilder(rows: Partial<ZoneMembership>[]) {
  const state: {
    username?: string;
    statuses?: MembershipStatus[];
    allZones?: boolean;
    oldUsername?: string;
    userId?: string;
  } = {};
  const qb = {
    update: jest.fn(() => qb),
    set: jest.fn((values: { username: string }) => {
      state.username = values.username;
      return qb;
    }),
    where: jest.fn((_sql: string, params: { userId: string }) => {
      state.userId = params.userId;
      return qb;
    }),
    andWhere: jest.fn(
      (
        _sql: string,
        params: {
          statuses?: MembershipStatus[];
          allZones?: boolean;
          oldUsername?: string;
        }
      ) => {
        Object.assign(state, params);
        return qb;
      }
    ),
    returning: jest.fn(() => qb),
    execute: jest.fn(async () => ({
      raw: rows
        .filter((r) => r.userId === state.userId)
        .filter((r) => state.statuses?.includes(r.status as MembershipStatus))
        .filter((r) => state.allZones || r.username === state.oldUsername)
        .map((r) => ({ ...r, username: state.username })),
    })),
  };
  return qb;
}

function build(rows: Partial<ZoneMembership>[], firstSeen = true) {
  const qb = makeQueryBuilder(rows);
  const memberships = { createQueryBuilder: jest.fn(() => qb) };
  const events = { emit: jest.fn() };
  const store = { firstSeen: jest.fn(async () => firstSeen) };
  const service = new UsernamePropagationService(
    memberships as never,
    events as never,
    store as never
  );
  return { service, memberships, events, store, qb };
}

const event = (
  overrides: Partial<UserUsernameChangedEvent> = {}
): UserUsernameChangedEvent => ({
  eventId: 'e1',
  userId: 'u1',
  oldUsername: 'Swift Sail',
  newUsername: 'Vela Rápida',
  propagation: UsernamePropagation.GLOBAL_ONLY,
  ...overrides,
});

const membership = (
  overrides: Partial<ZoneMembership> = {}
): Partial<ZoneMembership> => ({
  id: 'm1',
  zoneId: 'z1',
  userId: 'u1',
  username: 'Swift Sail',
  role: ZoneRole.MEMBER,
  status: MembershipStatus.APPROVED,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

describe('UsernamePropagationService (plan 0018, section 4.4)', () => {
  it('GLOBAL_ONLY touches no membership at all', async () => {
    const { service, memberships, events } = build([membership()]);

    await service.handleUsernameChanged(event());

    expect(memberships.createQueryBuilder).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('MATCHING_ZONES renames only the zones that held the old name', async () => {
    const rows = [
      membership({ id: 'm1', zoneId: 'z1', username: 'Swift Sail' }),
      membership({ id: 'm2', zoneId: 'z2', username: 'Mamá' }),
    ];
    const { service, events } = build(rows);

    await service.handleUsernameChanged(
      event({ propagation: UsernamePropagation.MATCHING_ZONES })
    );

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      RealtimeEvent.MemberUsernameChanged,
      'z1',
      expect.objectContaining({ username: 'Vela Rápida' })
    );
  });

  it('MATCHING_ZONES is case sensitive: a differently cased name is left alone', async () => {
    const { service, events } = build([
      membership({ id: 'm1', zoneId: 'z1', username: 'swift sail' }),
    ]);

    await service.handleUsernameChanged(
      event({ propagation: UsernamePropagation.MATCHING_ZONES })
    );

    // Recorded in section 4.1 as a decision, not an accident of the SQL: the
    // member who typed a different string chose a different name.
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('ALL_ZONES renames every eligible membership, one event per zone room', async () => {
    const { service, events } = build([
      membership({ id: 'm1', zoneId: 'z1', username: 'Swift Sail' }),
      membership({ id: 'm2', zoneId: 'z2', username: 'Mamá' }),
      membership({ id: 'm3', zoneId: 'z3', username: 'Capitana' }),
    ]);

    await service.handleUsernameChanged(
      event({ propagation: UsernamePropagation.ALL_ZONES })
    );

    expect(events.emit).toHaveBeenCalledTimes(3);
    expect(events.emit.mock.calls.map((c) => c[1])).toEqual(['z1', 'z2', 'z3']);
  });

  it.each([UsernamePropagation.MATCHING_ZONES, UsernamePropagation.ALL_ZONES])(
    '%s skips KICKED and BANNED memberships',
    async (propagation) => {
      const { service, events } = build([
        membership({ id: 'm1', zoneId: 'z1', status: MembershipStatus.KICKED }),
        membership({ id: 'm2', zoneId: 'z2', status: MembershipStatus.BANNED }),
        membership({
          id: 'm3',
          zoneId: 'z3',
          status: MembershipStatus.PENDING,
        }),
      ]);

      await service.handleUsernameChanged(event({ propagation }));

      // A banned member rewriting the name on their tombstone is a way back in
      // unrecognised (section 4.2).
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit.mock.calls[0][1]).toBe('z3');
    }
  );

  it('is idempotent: a redelivery updates nothing and emits nothing', async () => {
    const { service, memberships, events } = build(
      [membership({ username: 'Swift Sail' })],
      false
    );

    await service.handleUsernameChanged(
      event({ propagation: UsernamePropagation.ALL_ZONES })
    );

    expect(memberships.createQueryBuilder).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('dedupes on the event id, not on the pair of names', async () => {
    const { service, store } = build([membership()]);
    await service.handleUsernameChanged(event({ eventId: 'abc' }));
    expect(store.firstSeen).toHaveBeenCalledWith('user.usernameChanged:abc');
  });
});
