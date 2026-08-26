import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { ZoneMembership } from '../entities';
import { MembershipService } from './membership.service';
import { ZoneAuthzService } from './zone-authz.service';

const ZONE = 'z1';

const member = (
  overrides: Partial<ZoneMembership>
): Partial<ZoneMembership> => ({
  zoneId: ZONE,
  username: 'Swift Sail',
  role: ZoneRole.MEMBER,
  status: MembershipStatus.APPROVED,
  ...overrides,
});

/**
 * A real {@link ZoneAuthzService} over a repository double, so the spec exercises
 * the authorization the service actually delegates to rather than a stub of it.
 */
function build(rows: Partial<ZoneMembership>[]) {
  const store = rows.map((r) => ({ ...r }));
  const memberships = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<ZoneMembership> }) =>
        store.find((r) =>
          Object.entries(where).every(
            ([key, value]) => r[key as keyof ZoneMembership] === value
          )
        ) ?? null
    ),
    save: jest.fn(async (row: ZoneMembership) => row),
  };
  const events = { emit: jest.fn() };
  const authz = new ZoneAuthzService(memberships as never);
  const service = new MembershipService(
    memberships as never,
    authz,
    events as never
  );
  return { service, events, memberships };
}

const rename = (userId: string, membershipId: string, username = 'Mamá') => ({
  userId,
  zoneId: ZONE,
  membershipId,
  username,
});

describe('MembershipService.setUsername (plan 0018, section 5)', () => {
  it('lets a member rename themselves', async () => {
    const { service, events } = build([member({ id: 'm1', userId: 'u1' })]);

    const view = await service.setUsername(rename('u1', 'm1'));

    expect(view.username).toBe('Mamá');
    expect(events.emit).toHaveBeenCalledWith(
      RealtimeEvent.MemberUsernameChanged,
      ZONE,
      expect.objectContaining({ username: 'Mamá' })
    );
  });

  it('lets a member still awaiting approval set the name admins will see', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'u1', status: MembershipStatus.PENDING }),
    ]);

    await expect(
      service.setUsername(rename('u1', 'm1'))
    ).resolves.toMatchObject({ username: 'Mamá' });
  });

  it('lets an admin rename another member', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'admin', role: ZoneRole.ADMIN }),
      member({ id: 'm2', userId: 'u2' }),
    ]);

    await expect(
      service.setUsername(rename('admin', 'm2'))
    ).resolves.toMatchObject({ id: 'm2', username: 'Mamá' });
  });

  it('stops an admin from renaming the owner', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'admin', role: ZoneRole.ADMIN }),
      member({ id: 'm2', userId: 'owner', role: ZoneRole.OWNER }),
    ]);

    await expect(
      service.setUsername(rename('admin', 'm2'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the owner rename anyone, themselves included', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'owner', role: ZoneRole.OWNER }),
      member({ id: 'm2', userId: 'u2' }),
    ]);

    await expect(
      service.setUsername(rename('owner', 'm2'))
    ).resolves.toMatchObject({ id: 'm2' });
    await expect(
      service.setUsername(rename('owner', 'm1'))
    ).resolves.toMatchObject({ id: 'm1' });
  });

  it('stops a plain member from renaming anyone else', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'u1' }),
      member({ id: 'm2', userId: 'u2' }),
    ]);

    await expect(
      service.setUsername(rename('u1', 'm2'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([MembershipStatus.KICKED, MembershipStatus.BANNED])(
    'lets nobody rename a %s membership',
    async (status) => {
      const { service } = build([
        member({ id: 'm1', userId: 'owner', role: ZoneRole.OWNER }),
        member({ id: 'm2', userId: 'u2', status }),
      ]);

      await expect(
        service.setUsername(rename('owner', 'm2'))
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  );

  it('refuses a caller who is not in the zone at all', async () => {
    const { service } = build([member({ id: 'm1', userId: 'u1' })]);

    await expect(
      service.setUsername(rename('stranger', 'm1'))
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a membership that belongs to another zone', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'owner', role: ZoneRole.OWNER }),
    ]);

    await expect(
      service.setUsername(rename('owner', 'unknown'))
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies the shared username validation', async () => {
    const { service } = build([member({ id: 'm1', userId: 'u1' })]);

    await expect(
      service.setUsername(rename('u1', 'm1', 'former member 1a2b3c4d'))
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('allows two members of one zone to share a name (plan 0018, section 2)', async () => {
    const { service } = build([
      member({ id: 'm1', userId: 'u1', username: 'Vela' }),
      member({ id: 'm2', userId: 'u2', username: 'Timón' }),
    ]);

    await expect(
      service.setUsername(rename('u2', 'm2', 'Vela'))
    ).resolves.toMatchObject({ username: 'Vela' });
  });
});
