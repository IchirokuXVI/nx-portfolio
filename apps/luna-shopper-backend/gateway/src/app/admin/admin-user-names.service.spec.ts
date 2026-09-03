import {
  ADMIN_USER_PATTERNS,
  ZoneStatus,
  type AdminZonePage,
  type AdminZoneView,
} from '@portfolio/luna-shopper/contracts';
import type { NatsClient } from '../messaging/nats-client';
import type { CurrentAdmin } from './admin-jwt.strategy';
import { AdminUserNamesService } from './admin-user-names.service';

/**
 * The join that does not exist (plan 0074, section 3), and the rule that matters
 * most about it: **a decoration that fails must never fail the listing.**
 *
 * Zones are in core's database and users are in auth's, so a zone listing that
 * shows an owner's name is two calls joined here. Every way the second call can
 * go wrong has the same correct outcome, and section 7 asks for it by name: an
 * unresolvable id renders as the id and the request still answers.
 */
const ADMIN: CurrentAdmin = { adminId: 'a1', token: 'operator-token' };

function zone(over: Partial<AdminZoneView>): AdminZoneView {
  return {
    id: 'z1',
    name: 'Flat',
    status: ZoneStatus.ACTIVE,
    ownerUserId: 'u-owner',
    memberCount: 2,
    listCount: 1,
    markedForDeletionAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

function page(items: AdminZoneView[]): AdminZonePage {
  return { items, nextCursor: null };
}

function makeService(send: jest.Mock) {
  return {
    service: new AdminUserNamesService({ send } as unknown as NatsClient),
    send,
  };
}

describe('AdminUserNamesService', () => {
  it('attaches the owner name from auth to each row', async () => {
    const { service } = makeService(
      jest.fn(async () => ({
        users: [{ userId: 'u-owner', username: 'Vela', displayName: null }],
      }))
    );

    const decorated = await service.decorateZones(
      ADMIN,
      page([zone({ ownerUserId: 'u-owner' })])
    );

    expect(decorated.items[0].ownerName).toBe('Vela');
  });

  it('renders the id when auth does not know it, and still answers', async () => {
    // A reaped user, or one deleted between the two calls. Auth answers with
    // only the ids it found, so the id is simply absent rather than an error.
    const { service } = makeService(jest.fn(async () => ({ users: [] })));

    const decorated = await service.decorateZones(
      ADMIN,
      page([zone({ ownerUserId: 'u-gone' })])
    );

    expect(decorated.items[0].ownerName).toBe('u-gone');
  });

  it('renders the ids when the call to auth fails outright', async () => {
    // The listing has already succeeded at this point. A NATS timeout, an auth
    // service restarting, or a token that expired between the two calls all mean
    // "we could not label the rows", never "the page is unavailable".
    const { service } = makeService(
      jest.fn(async () => {
        throw new Error('nats timeout');
      })
    );

    const decorated = await service.decorateZones(
      ADMIN,
      page([
        zone({ id: 'z1', ownerUserId: 'u1' }),
        zone({ id: 'z2', ownerUserId: 'u2' }),
      ])
    );

    expect(decorated.items.map((row) => row.ownerName)).toEqual(['u1', 'u2']);
  });

  it('leaves an ownerless zone with no name rather than an id', async () => {
    // A zone whose owner deleted their account is ownerless by plan 0011, which
    // is a deliberate state and not a missing name.
    const { service, send } = makeService(jest.fn());

    const decorated = await service.decorateZones(
      ADMIN,
      page([zone({ ownerUserId: null })])
    );

    expect(decorated.items[0].ownerName).toBeNull();
    // ...and no call is made at all: asking auth about `null` is a request that
    // could only fail.
    expect(send).not.toHaveBeenCalled();
  });

  it('asks once for a page, with each id only once', async () => {
    const send = jest.fn(async () => ({ users: [] }));
    const { service } = makeService(send);

    await service.decorateZones(
      ADMIN,
      page([
        zone({ id: 'z1', ownerUserId: 'u1' }),
        zone({ id: 'z2', ownerUserId: 'u1' }),
        zone({ id: 'z3', ownerUserId: 'u2' }),
      ])
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ADMIN_USER_PATTERNS.resolveMany, {
      userId: 'a1',
      adminToken: 'operator-token',
      userIds: ['u1', 'u2'],
    });
  });

  it('preserves the page cursor, which the decoration has no business changing', async () => {
    const { service } = makeService(jest.fn(async () => ({ users: [] })));

    const decorated = await service.decorateZones(ADMIN, {
      items: [zone({})],
      nextCursor: 'opaque-cursor',
    });

    expect(decorated.nextCursor).toBe('opaque-cursor');
  });
});
