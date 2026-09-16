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

    // The four contacts get ids that sort alternately between the two groups,
    // flat, parents, flat, parents. Ordered by membership id alone the answer
    // would split both groups, so the group order test cannot pass by the luck
    // of four random uuids. One random prefix per run keeps them unique.
    const prefix = randomUUID().slice(0, 34);
    const contactId = (n: number) => `${prefix}${String(n).padStart(2, '0')}`;

    const roster: [
      string,
      string,
      string,
      MembershipStatus,
      string | undefined,
    ][] = [
      [zones.flat, users.caller, 'Me', MembershipStatus.APPROVED, undefined],
      [
        zones.flat,
        users.friend,
        'Friend in the flat',
        MembershipStatus.APPROVED,
        contactId(1),
      ],
      [
        zones.flat,
        users.temporary,
        'Temporary',
        MembershipStatus.APPROVED,
        contactId(3),
      ],
      [
        zones.flat,
        users.applicant,
        'Applicant',
        MembershipStatus.PENDING,
        undefined,
      ],
      [zones.parents, users.caller, 'Me', MembershipStatus.APPROVED, undefined],
      [
        zones.parents,
        users.friend,
        'Friend at the parents',
        MembershipStatus.APPROVED,
        contactId(2),
      ],
      [
        zones.parents,
        users.other,
        'Other',
        MembershipStatus.APPROVED,
        contactId(4),
      ],
      // The caller is only waiting to join this one, so it contributes nobody.
      [zones.waiting, users.caller, 'Me', MembershipStatus.PENDING, undefined],
      [
        zones.waiting,
        users.stranger,
        'Stranger',
        MembershipStatus.APPROVED,
        undefined,
      ],
    ];
    const memberships = dataSource.getRepository(ZoneMembership);
    for (const [zoneId, userId, username, status, id] of roster) {
      await memberships.save(
        memberships.create({
          ...(id === undefined ? {} : { id }),
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

  it('answers every member of one group before any member of the next, across pages', async () => {
    // One row a page, which is the page size most likely to split a group, and
    // the boundary every page crosses.
    const zoneOrder: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listing.contacts({
        userId: users.caller,
        limit: 1,
        cursor,
      });
      zoneOrder.push(...page.items.map((row) => row.zoneId));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    expect(zoneOrder).toHaveLength(4);
    // Contiguous: once a group's run ends, it never appears again.
    const runs = zoneOrder.filter((zoneId, at) => zoneOrder[at - 1] !== zoneId);
    expect(runs).toHaveLength(new Set(zoneOrder).size);
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
