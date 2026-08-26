import { MembershipStatus, ZoneRole } from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { ZoneMembership } from '../entities';
import { MemberListingService } from './member-listing.service';
import type { ZoneAuthzService } from './zone-authz.service';

/**
 * The member read surface (plan 0017, sections 5 and 6): who may ask, in what
 * order the answer comes back, and what a non default status filter costs.
 */

interface Captured {
  orderBy: [string, string][];
  andWhere: [string, Record<string, unknown>][];
  take?: number;
}

function makeQb(rows: ZoneMembership[]) {
  const captured: Captured = { orderBy: [], andWhere: [] };
  const qb: Record<string, unknown> = {};
  qb['where'] = jest.fn(() => qb);
  qb['andWhere'] = jest.fn((sql: string, params: Record<string, unknown>) => {
    captured.andWhere.push([sql, params ?? {}]);
    return qb;
  });
  qb['take'] = jest.fn((n: number) => {
    captured.take = n;
    return qb;
  });
  qb['orderBy'] = jest.fn((col: string, dir: string) => {
    captured.orderBy = [[col, dir]];
    return qb;
  });
  qb['addOrderBy'] = jest.fn((col: string, dir: string) => {
    captured.orderBy.push([col, dir]);
    return qb;
  });
  qb['getMany'] = jest.fn(async () => rows);
  return { qb, captured };
}

function member(overrides: Partial<ZoneMembership> = {}): ZoneMembership {
  return {
    id: 'm1',
    zoneId: 'z1',
    userId: 'u1',
    username: 'Ines',
    role: ZoneRole.MEMBER,
    status: MembershipStatus.APPROVED,
    approvedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as ZoneMembership;
}

function build(viewerRole: ZoneRole, rows: ZoneMembership[] = [member()]) {
  const { qb, captured } = makeQb(rows);
  const repo = { createQueryBuilder: jest.fn(() => qb) };
  const authz = {
    requireApproved: jest.fn(async () =>
      member({ role: viewerRole, userId: 'viewer' })
    ),
  } as unknown as ZoneAuthzService;
  return {
    svc: new MemberListingService(repo as never, authz),
    captured,
    authz,
  };
}

describe('MemberListingService.list', () => {
  it('defaults to the approved roster for any approved member', async () => {
    const { svc, captured } = build(ZoneRole.MEMBER);

    const page = await svc.list({ userId: 'viewer', zoneId: 'z1' });

    const statuses = captured.andWhere.find(([sql]) =>
      sql.includes('m.status IN')
    );
    expect(statuses?.[1]['statuses']).toEqual([MembershipStatus.APPROVED]);
    expect(page.items[0].username).toBe('Ines');
    expect(page.nextCursor).toBeNull();
  });

  it('serializes the timestamps every view now carries (section 7)', async () => {
    const { svc } = build(ZoneRole.MEMBER);
    const page = await svc.list({ userId: 'viewer', zoneId: 'z1' });
    expect(page.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(page.items[0].updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it.each([
    MembershipStatus.PENDING,
    MembershipStatus.KICKED,
    MembershipStatus.BANNED,
  ])('refuses a %s filter for a plain member', async (status) => {
    const { svc } = build(ZoneRole.MEMBER);
    // A silent empty page would read as "nobody is waiting", which is the worse
    // failure, so this must be a refusal rather than a filter.
    await expect(
      svc.list({ userId: 'viewer', zoneId: 'z1', statuses: [status] })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([ZoneRole.OWNER, ZoneRole.ADMIN])(
    'allows a %s to read the pending queue',
    async (role) => {
      const { svc, captured } = build(role);
      await expect(
        svc.list({
          userId: 'viewer',
          zoneId: 'z1',
          statuses: [MembershipStatus.PENDING],
        })
      ).resolves.toBeDefined();
      const statuses = captured.andWhere.find(([sql]) =>
        sql.includes('m.status IN')
      );
      expect(statuses?.[1]['statuses']).toEqual([MembershipStatus.PENDING]);
    }
  );

  it('refuses a mixed filter that smuggles a governance status in', async () => {
    const { svc } = build(ZoneRole.MEMBER);
    await expect(
      svc.list({
        userId: 'viewer',
        zoneId: 'z1',
        statuses: [MembershipStatus.APPROVED, MembershipStatus.PENDING],
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('orders `joined` ascending, so the pending queue opens with the oldest', async () => {
    // The summary names the oldest requester in `firstPendingRequesterName`, and
    // tapping through must show that person at the top, not mid page.
    const { svc, captured } = build(ZoneRole.OWNER);
    await svc.list({
      userId: 'viewer',
      zoneId: 'z1',
      order: 'joined',
      statuses: [MembershipStatus.PENDING],
    });
    expect(captured.orderBy).toEqual([
      ['m.createdAt', 'ASC'],
      ['m.id', 'ASC'],
    ]);
  });

  it('orders `role` by the enum, not alphabetically', async () => {
    const { svc, captured } = build(ZoneRole.OWNER);
    await svc.list({ userId: 'viewer', zoneId: 'z1', order: 'role' });
    expect(captured.orderBy[0]).toEqual(['m.role', 'ASC']);
    expect(captured.orderBy).toContainEqual(['m.createdAt', 'ASC']);
    expect(captured.orderBy).toContainEqual(['m.id', 'ASC']);
  });

  it('orders `name` by username', async () => {
    const { svc, captured } = build(ZoneRole.OWNER);
    await svc.list({ userId: 'viewer', zoneId: 'z1', order: 'name' });
    expect(captured.orderBy).toEqual([
      ['m.username', 'ASC'],
      ['m.id', 'ASC'],
    ]);
  });

  it('falls back to `joined` for an unknown order', async () => {
    const { svc, captured } = build(ZoneRole.OWNER);
    await svc.list({ userId: 'viewer', zoneId: 'z1', order: 'nonsense' });
    expect(captured.orderBy[0]).toEqual(['m.createdAt', 'ASC']);
  });

  it('pages by fetching one row past the limit and emitting a cursor', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      member({ id: `m${i}`, username: `member-${i}` })
    );
    const { qb, captured } = makeQb(rows);
    const repo = { createQueryBuilder: jest.fn(() => qb) };
    const authz = {
      requireApproved: jest.fn(async () => member({ role: ZoneRole.OWNER })),
    } as unknown as ZoneAuthzService;
    const svc = new MemberListingService(repo as never, authz);

    const page = await svc.list({ userId: 'viewer', zoneId: 'z1', limit: 2 });

    expect(captured.take).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    // The cursor round-trips into the next query's keyset predicate.
    const second = makeQb([]);
    const svc2 = new MemberListingService(
      { createQueryBuilder: jest.fn(() => second.qb) } as never,
      authz
    );
    await svc2.list({
      userId: 'viewer',
      zoneId: 'z1',
      limit: 2,
      cursor: page.nextCursor as string,
    });
    expect(
      second.captured.andWhere.some(([sql]) => sql.includes('m."createdAt"'))
    ).toBe(true);
  });

  /**
   * The cursor names the boundary row and lets Postgres read its own sort key
   * back, rather than carrying a copy of that key. Carrying a copy is what
   * every other cursor here does, and it is subtly wrong for a timestamp:
   * `timestamptz` keeps microseconds, a JS `Date` only milliseconds, so the
   * copy lands just below the row's real value and an ascending keyset hands
   * the boundary row back at the top of the next page.
   */
  describe('the cursor names the boundary row', () => {
    function repage(order: string) {
      const authz = {
        requireApproved: jest.fn(async () => member({ role: ZoneRole.OWNER })),
      } as unknown as ZoneAuthzService;
      const rows = [
        member({ id: 'a', role: ZoneRole.OWNER, username: 'Ann' }),
        member({ id: 'b', role: ZoneRole.ADMIN, username: 'Bea' }),
      ];
      const first = makeQb(rows);
      const svc1 = new MemberListingService(
        { createQueryBuilder: jest.fn(() => first.qb) } as never,
        authz
      );
      const second = makeQb([]);
      const svc2 = new MemberListingService(
        { createQueryBuilder: jest.fn(() => second.qb) } as never,
        authz
      );
      return { svc1, svc2, second, order };
    }

    it.each(['joined', 'name', 'role'])(
      'carries only the order and the id under the %s order',
      async (order) => {
        const { svc1 } = repage(order);
        const page = await svc1.list({
          userId: 'viewer',
          zoneId: 'z1',
          order,
          limit: 1,
        });

        const decoded = JSON.parse(
          Buffer.from(page.nextCursor as string, 'base64url').toString('utf8')
        );
        // No copy of the sort value, so nothing can be copied imprecisely.
        expect(decoded).toEqual({ order, id: 'a' });
      }
    );

    it.each([
      ['joined', 'b."createdAt", b.id'],
      ['name', 'b.username, b.id'],
      ['role', 'b.role, b."createdAt", b.id'],
    ])('reads the %s sort key back from the row', async (order, columns) => {
      const { svc1, svc2, second } = repage(order);
      const page = await svc1.list({
        userId: 'viewer',
        zoneId: 'z1',
        order,
        limit: 1,
      });
      await svc2.list({
        userId: 'viewer',
        zoneId: 'z1',
        order,
        limit: 1,
        cursor: page.nextCursor as string,
      });

      const keyset = second.captured.andWhere.find(([sql]) => sql.includes('>'));
      expect(keyset?.[0]).toContain(columns);
      expect(keyset?.[1]['cid']).toBe('a');
      // The enum is never compared as text: alphabetically ADMIN precedes
      // OWNER, which is a different order from the one the ORDER BY uses.
      expect(keyset?.[0]).not.toContain('::text');
    });
  });
});

describe('ZoneRole declaration order (plan 0017, section 5)', () => {
  it('is OWNER, ADMIN, MEMBER, which is what the `role` ordering rests on', () => {
    // Postgres orders a native enum by declaration order, so `ORDER BY role`
    // only means "owner first" while this holds. Reordering the enum without
    // a migration would silently reorder every member listing.
    expect(Object.values(ZoneRole)).toEqual([
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
      ZoneRole.MEMBER,
    ]);
  });
});
