import {
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
  type ContactView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { CORE_ENTITIES, Zone, ZoneMembership } from '../entities';
import { MemberListingService } from './member-listing.service';

/**
 * The caller's contacts, against real Postgres (plan 0114, section 2).
 *
 * The rule is a self join over memberships, so the database is the only honest
 * judge of it: both sides approved, the caller left out, and a group the caller
 * is only waiting to join contributing nobody. The paging is the other half,
 * because the answer is flat and unbounded and a keyset cursor over it must hand
 * back every row exactly once.
 */
describeIntegration('the caller’s contacts (real Postgres)', () => {
  let dataSource: DataSource;
  let listing: MemberListingService;

  const users = {
    caller: randomUUID(),
    friend: randomUUID(),
    // A temporary account is a membership like any other in core, which knows
    // nothing of account kinds. It is named here so the rule is visible.
    temporary: randomUUID(),
    applicant: randomUUID(),
    other: randomUUID(),
    stranger: randomUUID(),
  };
  const zones = { flat: '', parents: '', waiting: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    listing = new MemberListingService(
      dataSource.getRepository(ZoneMembership),
      // Contacts ask no zone question of their own.
      undefined as never
    );

    const zoneRepo = dataSource.getRepository(Zone);
    for (const key of ['flat', 'parents', 'waiting'] as const) {
      zones[key] = (
        await zoneRepo.save(
          zoneRepo.create({
            name: key,
            joinCode: randomUUID().replace(/-/g, '').slice(0, 12),
            status: ZoneStatus.ACTIVE,
            ownerUserId: users.caller,
            config: {},
          })
        )
      ).id;
    }

    const roster: [string, string, string, MembershipStatus][] = [
      [zones.flat, users.caller, 'Me', MembershipStatus.APPROVED],
      [
        zones.flat,
        users.friend,
        'Friend in the flat',
        MembershipStatus.APPROVED,
      ],
      [zones.flat, users.temporary, 'Temporary', MembershipStatus.APPROVED],
      [zones.flat, users.applicant, 'Applicant', MembershipStatus.PENDING],
      [zones.parents, users.caller, 'Me', MembershipStatus.APPROVED],
      [
        zones.parents,
        users.friend,
        'Friend at the parents',
        MembershipStatus.APPROVED,
      ],
      [zones.parents, users.other, 'Other', MembershipStatus.APPROVED],
      // The caller is only waiting to join this one, so it contributes nobody.
      [zones.waiting, users.caller, 'Me', MembershipStatus.PENDING],
      [zones.waiting, users.stranger, 'Stranger', MembershipStatus.APPROVED],
    ];
    const memberships = dataSource.getRepository(ZoneMembership);
    for (const [zoneId, userId, username, status] of roster) {
      await memberships.save(
        memberships.create({
          zoneId,
          userId,
          username,
          role: ZoneRole.MEMBER,
          status,
        })
      );
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      const ids = Object.values(zones).filter(Boolean);
      if (ids.length > 0) {
        // Memberships cascade from the zone.
        await dataSource.getRepository(Zone).delete({ id: In(ids) });
      }
      await dataSource.destroy();
    }
  });

  it('answers approved memberships of approved groups, a row per group, every row once across pages', async () => {
    const seen: ContactView[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listing.contacts({
        userId: users.caller,
        limit: 2,
        cursor,
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    const sort = (rows: ContactView[]) =>
      [...rows].sort((a, b) => a.username.localeCompare(b.username));
    expect(sort(seen)).toEqual(
      sort([
        {
          userId: users.friend,
          zoneId: zones.flat,
          username: 'Friend in the flat',
        },
        { userId: users.temporary, zoneId: zones.flat, username: 'Temporary' },
        {
          userId: users.friend,
          zoneId: zones.parents,
          username: 'Friend at the parents',
        },
        { userId: users.other, zoneId: zones.parents, username: 'Other' },
      ])
    );
    // Four rows at two a page is two pages, and the second says it is the last.
    expect(pages).toBe(2);
    expect(seen.map((row) => row.userId)).not.toContain(users.caller);
  });

  it('starts from the first page for a cursor that names no membership', async () => {
    const first = await listing.contacts({ userId: users.caller, limit: 100 });
    const garbage = await listing.contacts({
      userId: users.caller,
      limit: 100,
      cursor: 'not a cursor',
    });

    expect(garbage.items).toEqual(first.items);
    expect(first.nextCursor).toBeNull();
  });

  it('answers nobody for a person in no approved group', async () => {
    await expect(
      listing.contacts({ userId: users.applicant })
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
});
