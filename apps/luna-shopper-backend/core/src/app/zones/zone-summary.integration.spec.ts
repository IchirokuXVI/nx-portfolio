import {
  LineApprovalStatus,
  LineStatus,
  ListRole,
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CORE_ENTITIES,
  ListAccess,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { MemberListingService } from './member-listing.service';
import { ZoneAuthzService } from './zone-authz.service';
import { ZoneCountsService } from './zone-counts.service';
import { ZoneService } from './zone.service';

/**
 * The zone summary against real Postgres (plan 0017, section 11).
 *
 * The counts are Postgres's answer, so this is the only place they can be proven.
 * Two things in particular cannot be tested honestly anywhere else:
 *
 * - that `listCount` and the `lists` preview never disagree, which is the guard
 *   on section 3.2 and must be a real test rather than a comment;
 * - that the partial index on pending memberships really serves the first
 *   requester lookup, since a predicate that does not match the query is exactly
 *   the failure a mocked repository cannot see.
 */
describeIntegration('zone summary (real Postgres)', () => {
  let dataSource: DataSource;
  let zones: ZoneService;
  let members: MemberListingService;

  // One zone per run, with ids minted fresh so parallel runs do not collide.
  // Core stores userIds in `uuid` columns even though it never joins on them,
  // so the stand in users need real uuids rather than readable labels.
  const ids = {
    zone: '',
    owner: randomUUID(),
    admin: randomUUID(),
    reader: randomUUID(),
    stranger: randomUUID(),
    applicant: randomUUID(),
    laterApplicant: randomUUID(),
  };
  let joinCode = '';
  let ownerMembershipId = '';
  let readerMembershipId = '';
  let groceriesId = '';
  let hardwareId = '';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const membershipRepo = dataSource.getRepository(ZoneMembership);
    const authz = new ZoneAuthzService(membershipRepo);
    const events = { emit: jest.fn() };
    const counts = new ZoneCountsService(membershipRepo, events as never);
    zones = new ZoneService(
      dataSource,
      dataSource.getRepository(Zone),
      membershipRepo,
      authz,
      counts,
      events as never
    );
    members = new MemberListingService(membershipRepo, authz);

    await seed();
  });

  afterAll(async () => {
    if (ids.zone) {
      // Memberships, lists, access rows and lines all cascade from the zone.
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  /**
   * A zone with: an owner, an admin, a reader granted access to one list only,
   * a stranger with no list access at all, and two applicants a minute apart.
   * Two lists, "Groceries" (newer) and "Hardware", with lines across both state
   * machines.
   */
  async function seed(): Promise<void> {
    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Summary Zone',
        joinCode: `SUM${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    ids.zone = zone.id;
    joinCode = zone.joinCode;

    const membershipRepo = dataSource.getRepository(ZoneMembership);
    const make = (
      userId: string,
      username: string,
      role: ZoneRole,
      status: MembershipStatus,
      createdAt?: Date
    ) =>
      membershipRepo.save(
        membershipRepo.create({
          zoneId: zone.id,
          userId,
          username,
          role,
          status,
          ...(createdAt ? { createdAt } : {}),
        })
      );

    const owner = await make(
      ids.owner,
      'Owner',
      ZoneRole.OWNER,
      MembershipStatus.APPROVED
    );
    ownerMembershipId = owner.id;
    await make(ids.admin, 'Admin', ZoneRole.ADMIN, MembershipStatus.APPROVED);
    const reader = await make(
      ids.reader,
      'Reader',
      ZoneRole.MEMBER,
      MembershipStatus.APPROVED
    );
    readerMembershipId = reader.id;
    await make(
      ids.stranger,
      'Stranger',
      ZoneRole.MEMBER,
      MembershipStatus.APPROVED
    );
    // Two applicants, oldest first, so `firstPendingRequesterName` has an order
    // to respect rather than a single obvious answer.
    await make(
      ids.applicant,
      'Ines',
      ZoneRole.MEMBER,
      MembershipStatus.PENDING,
      new Date('2026-01-01T00:00:00.000Z')
    );
    await make(
      ids.laterApplicant,
      'Zoe',
      ZoneRole.MEMBER,
      MembershipStatus.PENDING,
      new Date('2026-01-02T00:00:00.000Z')
    );

    const listRepo = dataSource.getRepository(ShoppingList);
    const hardware = await listRepo.save(
      listRepo.create({
        zoneId: zone.id,
        name: 'Hardware',
        createdByUserId: ids.owner,
      })
    );
    hardwareId = hardware.id;
    const groceries = await listRepo.save(
      listRepo.create({
        zoneId: zone.id,
        name: 'Groceries',
        createdByUserId: ids.owner,
      })
    );
    groceriesId = groceries.id;
    // Groceries is the more recently touched list, so it heads the preview.
    await listRepo.update(
      { id: hardware.id },
      { updatedAt: new Date('2026-01-01T00:00:00.000Z') }
    );
    await listRepo.update(
      { id: groceries.id },
      { updatedAt: new Date('2026-06-01T00:00:00.000Z') }
    );

    // The reader can open Groceries and nothing else.
    const accessRepo = dataSource.getRepository(ListAccess);
    await accessRepo.save(
      accessRepo.create({
        listId: groceries.id,
        membershipId: reader.id,
        role: ListRole.READER,
      })
    );

    // 3 lines on Groceries: 2 READY (one of them still awaiting approval, to
    // prove readyCount ignores approvalStatus), 1 PENDING.
    const lineRepo = dataSource.getRepository(ListLine);
    await lineRepo.save([
      lineRepo.create({
        listId: groceries.id,
        content: 'Milk',
        quantity: 1,
        position: 1,
        approvalStatus: LineApprovalStatus.APPROVED,
        status: LineStatus.READY,
        createdByUserId: ids.owner,
      }),
      lineRepo.create({
        listId: groceries.id,
        content: 'Bread',
        quantity: 1,
        position: 2,
        approvalStatus: LineApprovalStatus.PENDING,
        status: LineStatus.READY,
        createdByUserId: ids.owner,
      }),
      lineRepo.create({
        listId: groceries.id,
        content: 'Eggs',
        quantity: 1,
        position: 3,
        approvalStatus: LineApprovalStatus.APPROVED,
        status: LineStatus.PENDING,
        createdByUserId: ids.owner,
      }),
    ]);
  }

  /** The naive answer, which the indexed query must agree with exactly. */
  async function naive(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await dataSource.query(sql, params);
    return Number(rows[0]['count']);
  }

  it('matches a naive count(*) for members and pending requests', async () => {
    const view = await zones.get({ userId: ids.owner, zoneId: ids.zone });

    expect(view.counts.memberCount).toBe(
      await naive(
        `SELECT count(*) FROM "zone_memberships" WHERE "zoneId" = $1 AND "status" = 'APPROVED'`,
        [ids.zone]
      )
    );
    expect(view.counts.pendingRequestCount).toBe(
      await naive(
        `SELECT count(*) FROM "zone_memberships" WHERE "zoneId" = $1 AND "status" = 'PENDING'`,
        [ids.zone]
      )
    );
  });

  it('names the oldest pending requester, and moves on when they are approved', async () => {
    const before = await zones.get({ userId: ids.owner, zoneId: ids.zone });
    expect(before.counts.firstPendingRequesterName).toBe('Ines');

    const repo = dataSource.getRepository(ZoneMembership);
    await repo.update(
      { zoneId: ids.zone, userId: ids.applicant },
      { status: MembershipStatus.APPROVED }
    );
    try {
      const after = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      // Approving the first requester makes the answer the second requester,
      // which no membership event's payload carries.
      expect(after.counts.firstPendingRequesterName).toBe('Zoe');
      expect(after.counts.pendingRequestCount).toBe(1);
    } finally {
      await repo.update(
        { zoneId: ids.zone, userId: ids.applicant },
        { status: MembershipStatus.PENDING }
      );
    }
  });

  it('is null, not zero, once nobody is waiting', async () => {
    const repo = dataSource.getRepository(ZoneMembership);
    await repo.update(
      { zoneId: ids.zone, status: MembershipStatus.PENDING },
      { status: MembershipStatus.KICKED }
    );
    try {
      const view = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      expect(view.counts.pendingRequestCount).toBe(0);
      expect(view.counts.firstPendingRequesterName).toBeNull();
    } finally {
      await repo.update(
        { zoneId: ids.zone, status: MembershipStatus.KICKED },
        { status: MembershipStatus.PENDING }
      );
    }
  });

  describe('access filtering (plan 0017, section 3.2)', () => {
    it('gives two members of one zone different counts and different previews', async () => {
      const asOwner = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      const asReader = await zones.get({
        userId: ids.reader,
        zoneId: ids.zone,
      });
      const asStranger = await zones.get({
        userId: ids.stranger,
        zoneId: ids.zone,
      });

      expect(asOwner.counts.listCount).toBe(2);
      expect(asReader.counts.listCount).toBe(1);
      expect(asStranger.counts.listCount).toBe(0);

      expect(asReader.lists.map((l) => l.id)).toEqual([groceriesId]);
      expect(asStranger.lists).toEqual([]);

      // The reader's single list is exactly the one they hold an access row
      // for, so the filter is the ListAccess table and not a coincidence.
      const granted = await dataSource.query(
        `SELECT "listId" FROM "list_access" WHERE "membershipId" = $1`,
        [readerMembershipId]
      );
      expect(granted.map((r: { listId: string }) => r.listId)).toEqual([
        groceriesId,
      ]);
    });

    it('lets a manager see a list they hold no access row for', async () => {
      const rows = await dataSource.query(
        `SELECT count(*) FROM "list_access" WHERE "listId" = $1 AND "membershipId" = $2`,
        [hardwareId, ownerMembershipId]
      );
      // The owner has no ListAccess row for Hardware...
      expect(Number(rows[0]['count'])).toBe(0);

      const asAdmin = await zones.get({ userId: ids.admin, zoneId: ids.zone });
      // ...and an admin has none for either, yet both govern the zone.
      expect(asAdmin.counts.listCount).toBe(2);
      expect(asAdmin.lists.map((l) => l.id).sort()).toEqual(
        [groceriesId, hardwareId].sort()
      );
    });

    it('never lets the count and the preview disagree', async () => {
      // The guard on section 3.2: a card reading "3 lists" above a preview
      // showing one is a bug in the user's eyes, whoever is looking.
      for (const userId of [
        ids.owner,
        ids.admin,
        ids.reader,
        ids.stranger,
        ids.applicant,
      ]) {
        const view = await zones.get({ userId, zoneId: ids.zone });
        expect(view.lists.length).toBe(Math.min(view.counts.listCount, 3));
        for (const preview of view.lists) {
          const readable = await naive(
            `SELECT count(*) FROM "shopping_lists" WHERE id = $1 AND "zoneId" = $2`,
            [preview.id, ids.zone]
          );
          expect(readable).toBe(1);
        }
      }
    });
  });

  describe('the preview (plan 0017, section 3.3)', () => {
    it('orders by updatedAt descending', async () => {
      const view = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      expect(view.lists.map((l) => l.id)).toEqual([groceriesId, hardwareId]);
    });

    it('caps at three however many lists the zone holds', async () => {
      const listRepo = dataSource.getRepository(ShoppingList);
      const extras = await listRepo.save(
        ['Extra A', 'Extra B', 'Extra C'].map((name) =>
          listRepo.create({
            zoneId: ids.zone,
            name,
            createdByUserId: ids.owner,
          })
        )
      );
      try {
        const view = await zones.get({ userId: ids.owner, zoneId: ids.zone });
        expect(view.counts.listCount).toBe(5);
        // A preview is a preview: the number grows, the array does not.
        expect(view.lists).toHaveLength(3);
      } finally {
        await listRepo.delete(extras.map((l) => l.id));
      }
    });

    it('counts lines, and counts READY without looking at approvalStatus', async () => {
      const view = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      const groceries = view.lists.find((l) => l.id === groceriesId);

      expect(groceries?.lineCount).toBe(3);
      // Two READY lines, one of which is still awaiting approval.
      expect(groceries?.readyCount).toBe(2);
      expect(groceries?.readyCount).toBe(
        await naive(
          `SELECT count(*) FROM "list_lines" WHERE "listId" = $1 AND "status" = 'READY'`,
          [groceriesId]
        )
      );
    });

    it('is empty for a list with no lines', async () => {
      const view = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      const hardware = view.lists.find((l) => l.id === hardwareId);
      expect(hardware).toEqual({
        id: hardwareId,
        name: 'Hardware',
        lineCount: 0,
        readyCount: 0,
      });
    });
  });

  describe('governance gating (plan 0017, section 6)', () => {
    it('fills the fields for an owner and an admin', async () => {
      for (const userId of [ids.owner, ids.admin]) {
        const view = await zones.get({ userId, zoneId: ids.zone });
        expect(view.counts.pendingRequestCount).toBe(2);
        expect(view.counts.firstPendingRequesterName).toBe('Ines');
      }
    });

    it('withholds them from a plain member and from an applicant', async () => {
      for (const userId of [ids.reader, ids.stranger, ids.applicant]) {
        const view = await zones.get({ userId, zoneId: ids.zone });
        expect(view.counts.pendingRequestCount).toBeNull();
        expect(view.counts.firstPendingRequesterName).toBeNull();
      }
    });

    it('shows a pending applicant the zone, with no lists at all', async () => {
      const view = await zones.get({
        userId: ids.applicant,
        zoneId: ids.zone,
      });
      expect(view.myStatus).toBe(MembershipStatus.PENDING);
      expect(view.name).toBe('Summary Zone');
      // No membership through which to hold list access.
      expect(view.counts.listCount).toBe(0);
      expect(view.lists).toEqual([]);
    });
  });

  describe('listMine (plan 0017, section 4.4)', () => {
    it.each(['recent', 'name', 'joined'])(
      'returns the zone with its summary under the %s order',
      async (order) => {
        const page = await zones.listMine({ userId: ids.owner, order });
        const mine = page.items.find((z) => z.id === ids.zone);

        expect(mine).toBeDefined();
        expect(mine?.counts.memberCount).toBe(4);
        expect(mine?.counts.listCount).toBe(2);
        expect(mine?.lists).toHaveLength(2);
      }
    );

    it.each(['recent', 'name', 'joined'])(
      'pages consistently under the %s order after the getRawAndEntities change',
      async (order) => {
        const all = await zones.listMine({ userId: ids.owner, order });
        const first = await zones.listMine({
          userId: ids.owner,
          order,
          limit: 1,
        });

        expect(first.items).toHaveLength(1);
        expect(first.items[0].id).toBe(all.items[0].id);

        if (all.items.length > 1) {
          expect(first.nextCursor).not.toBeNull();
          const second = await zones.listMine({
            userId: ids.owner,
            order,
            limit: 1,
            cursor: first.nextCursor as string,
          });
          // Same order, no repeats and no skips.
          expect(second.items[0].id).toBe(all.items[1].id);
        } else {
          expect(first.nextCursor).toBeNull();
        }
      }
    );

    it('serializes ISO 8601 timestamps that move after a mutation', async () => {
      const before = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      expect(before.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

      await zones.update({
        userId: ids.owner,
        zoneId: ids.zone,
        name: 'Summary Zone',
      });
      const after = await zones.get({ userId: ids.owner, zoneId: ids.zone });

      expect(after.createdAt).toBe(before.createdAt);
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before.updatedAt).getTime()
      );
    });
  });

  describe('zone.countsMine (plan 0017, section 3.5)', () => {
    it('splits owned, joined and pending, and excludes pending from total', async () => {
      const owner = await zones.countsMine({ userId: ids.owner });
      expect(owner.owned).toBeGreaterThanOrEqual(1);
      expect(owner.total).toBe(owner.owned + owner.joined);

      const applicant = await zones.countsMine({ userId: ids.applicant });
      expect(applicant.pending).toBe(1);
      // A zone merely asked for is not one of the caller's zones.
      expect(applicant.total).toBe(0);

      const reader = await zones.countsMine({ userId: ids.reader });
      expect(reader.joined).toBe(1);
      expect(reader.owned).toBe(0);
      expect(reader.total).toBe(1);
    });
  });

  describe('membership.list (plan 0017, section 5)', () => {
    it('orders by role as OWNER, ADMIN, MEMBER', async () => {
      const page = await members.list({
        userId: ids.owner,
        zoneId: ids.zone,
        order: 'role',
      });
      const roles = page.items.map((m) => m.role);
      // Postgres orders a native enum by declaration order; this is the test
      // that catches someone reordering ZoneRole.
      expect(roles[0]).toBe(ZoneRole.OWNER);
      expect(roles[1]).toBe(ZoneRole.ADMIN);
      expect(roles.slice(2).every((r) => r === ZoneRole.MEMBER)).toBe(true);
    });

    it('opens the pending queue with the person the summary names', async () => {
      const summary = await zones.get({ userId: ids.owner, zoneId: ids.zone });
      const page = await members.list({
        userId: ids.owner,
        zoneId: ids.zone,
        order: 'joined',
        statuses: [MembershipStatus.PENDING],
      });

      expect(page.items[0].username).toBe(
        summary.counts.firstPendingRequesterName
      );
    });

    it('pages stably across all three orders', async () => {
      for (const order of ['joined', 'name', 'role']) {
        const all = await members.list({
          userId: ids.owner,
          zoneId: ids.zone,
          order,
        });
        const first = await members.list({
          userId: ids.owner,
          zoneId: ids.zone,
          order,
          limit: 2,
        });
        const second = await members.list({
          userId: ids.owner,
          zoneId: ids.zone,
          order,
          limit: 2,
          cursor: first.nextCursor as string,
        });

        const paged = [...first.items, ...second.items].map((m) => m.id);
        expect(paged).toEqual(
          all.items.slice(0, paged.length).map((m) => m.id)
        );
        expect(new Set(paged).size).toBe(paged.length);
      }
    });
  });

  describe('the owner name (plan 0024, section 2)', () => {
    /**
     * This one has to be here rather than in the mocked suite. The subquery
     * reaches Postgres through a raw `addSelect`, where TypeORM does not rewrite
     * `alias.property`, so an unquoted `zoneId` would arrive as `zoneid` and
     * fail at runtime with "column does not exist" (section 2.3). A mocked
     * repository never runs the SQL and so never sees it.
     */
    it('names the owner through both get and listMine', async () => {
      const view = await zones.get({ userId: ids.reader, zoneId: ids.zone });
      expect(view.ownerUsername).toBe('Owner');

      const page = await zones.listMine({ userId: ids.reader });
      expect(page.items.find((z) => z.id === ids.zone)?.ownerUsername).toBe(
        'Owner'
      );
    });

    it('names the approver to a pending applicant, with no governance counts', async () => {
      // The combination the waiting card needs: "Waiting for Owner to let you
      // in", and still nothing about who else is queued behind them.
      const view = await zones.get({ userId: ids.applicant, zoneId: ids.zone });

      expect(view.myStatus).toBe(MembershipStatus.PENDING);
      expect(view.ownerUsername).toBe('Owner');
      expect(view.counts.pendingRequestCount).toBeNull();
      expect(view.counts.firstPendingRequesterName).toBeNull();
    });

    it('is null for a zone that lost its owner', async () => {
      // The shape plan 0011 leaves behind when an owner deletes their account:
      // no ownerUserId, no OWNER membership, an admin still in the room.
      const admin = randomUUID();
      const zoneRepo = dataSource.getRepository(Zone);
      const orphan = await zoneRepo.save(
        zoneRepo.create({
          name: 'Orphaned Zone',
          joinCode: `ORP${Date.now()}`.slice(0, 16),
          status: ZoneStatus.MARKED_FOR_DELETION,
          ownerUserId: null,
          config: {},
        })
      );
      try {
        const membershipRepo = dataSource.getRepository(ZoneMembership);
        await membershipRepo.save(
          membershipRepo.create({
            zoneId: orphan.id,
            userId: admin,
            username: 'Admin',
            role: ZoneRole.ADMIN,
            status: MembershipStatus.APPROVED,
          })
        );

        const view = await zones.get({ userId: admin, zoneId: orphan.id });
        expect(view.ownerUsername).toBeNull();
        // The card's name free string is the correct rendering here, and the
        // rest of the summary still answers.
        expect(view.counts.memberCount).toBe(1);
      } finally {
        await zoneRepo.delete({ id: orphan.id });
      }
    });

    it('ignores an owner whose membership is not approved', async () => {
      const repo = dataSource.getRepository(ZoneMembership);
      await repo.update(
        { zoneId: ids.zone, userId: ids.owner },
        { status: MembershipStatus.KICKED }
      );
      try {
        const view = await zones.get({ userId: ids.reader, zoneId: ids.zone });
        expect(view.ownerUsername).toBeNull();
      } finally {
        await repo.update(
          { zoneId: ids.zone, userId: ids.owner },
          { status: MembershipStatus.APPROVED }
        );
      }
    });
  });

  describe('zone.getByCode (plan 0024, section 1)', () => {
    it('resolves an active code to its name and approved member count', async () => {
      const view = await zones.getByCode({ joinCode });

      expect(view).toEqual({ name: 'Summary Zone', memberCount: 4 });
      expect(view.memberCount).toBe(
        await naive(
          `SELECT count(*) FROM "zone_memberships" WHERE "zoneId" = $1 AND "status" = 'APPROVED'`,
          [ids.zone]
        )
      );
    });

    it('refuses an archived zone and an unknown code identically', async () => {
      const zoneRepo = dataSource.getRepository(Zone);
      await zoneRepo.update(
        { id: ids.zone },
        { status: ZoneStatus.MARKED_FOR_DELETION }
      );
      try {
        const archived = await zones
          .getByCode({ joinCode })
          .catch((error: Error) => error.message);
        const unknown = await zones
          .getByCode({ joinCode: 'NEVEREXISTED' })
          .catch((error: Error) => error.message);

        // A code that used to work must look exactly like one that never did.
        expect(archived).toBe(unknown);
      } finally {
        await zoneRepo.update({ id: ids.zone }, { status: ZoneStatus.ACTIVE });
      }
    });

    it('does not count a pending applicant as a member', async () => {
      // Two applicants are waiting on this zone throughout the suite, and the
      // number a join sheet shows must be the people actually in the group.
      const view = await zones.getByCode({ joinCode });
      const everyone = await naive(
        `SELECT count(*) FROM "zone_memberships" WHERE "zoneId" = $1`,
        [ids.zone]
      );
      expect(view.memberCount).toBeLessThan(everyone);
    });
  });

  describe('the count indexes (plan 0017, section 4.3)', () => {
    it('exist, with the partial predicate the pending lookup needs', async () => {
      const rows = await dataSource.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`
      );
      const byName = new Map<string, string>(
        rows.map((r: { indexname: string; indexdef: string }) => [
          r.indexname,
          r.indexdef,
        ])
      );

      for (const name of [
        'ix_memberships_zone_status',
        'ix_memberships_user_status',
        'ix_memberships_zone_pending_created',
        'ix_lines_list_status',
        'ix_lists_zone_updated',
      ]) {
        expect(byName.has(name)).toBe(true);
      }
      // The prefixes the new indexes replace are gone rather than maintained
      // on every write for no read.
      for (const dropped of [
        'ix_membership_user',
        'ix_lines_list',
        'ix_lists_zone',
      ]) {
        expect(byName.has(dropped)).toBe(false);
      }
      // A partial index whose predicate does not match the query is exactly the
      // failure this suite exists to catch.
      expect(byName.get('ix_memberships_zone_pending_created')).toContain(
        `'PENDING'`
      );
    });

    /**
     * Statistics and a visibility map, without which the plans below are not
     * reproducible.
     *
     * A freshly inserted table has neither, so every index whose leading column
     * is `zoneId` costs the planner the same and it picks between them
     * arbitrarily. That is not hypothetical: plan 0018 added
     * `ix_membership_zone_username` on `("zoneId", username)`, which leads with
     * the same column as `ix_memberships_zone_status`, and the member counts
     * plan started coming back naming the username index for no reason a reader
     * could see. Analyzing gives the planner the row counts to tell them apart,
     * and vacuuming sets the visibility map that makes an index only scan
     * possible, which is how the covering index wins on merit rather than on a
     * tie break.
     */
    beforeAll(async () => {
      await dataSource.query('VACUUM ANALYZE "zone_memberships"');
      await dataSource.query('VACUUM ANALYZE "shopping_lists"');
    });

    /**
     * The planner picks a sequential scan on a table this small however good the
     * index is, so asking it what it WOULD do is the only assertion here that
     * means anything. With `enable_seqscan` off Postgres still falls back to a
     * sequential scan when no index can serve the query, so seeing the index
     * named in the plan really does prove its predicate matches, which is the
     * failure plan 0017 section 11 asks this suite to catch.
     */
    async function planFor(sql: string, params: unknown[]): Promise<string> {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.query('SET enable_seqscan = off');
        const plan = await runner.query(`EXPLAIN ${sql}`, params);
        return plan
          .map((r: Record<string, string>) => Object.values(r)[0])
          .join('\n');
      } finally {
        await runner.query('SET enable_seqscan = on');
        await runner.release();
      }
    }

    it('backs the first pending requester lookup with the partial index', async () => {
      const text = await planFor(
        `SELECT m3.username FROM "zone_memberships" m3
         WHERE m3."zoneId" = $1 AND m3.status = 'PENDING'
         ORDER BY m3."createdAt" ASC, m3.id ASC LIMIT 1`,
        [ids.zone]
      );
      expect(text).toContain('ix_memberships_zone_pending_created');
    });

    it('backs the member and pending counts with their index', async () => {
      const text = await planFor(
        `SELECT
           count(*) FILTER (WHERE m2.status = 'APPROVED'),
           count(*) FILTER (WHERE m2.status = 'PENDING')
         FROM "zone_memberships" m2 WHERE m2."zoneId" = $1`,
        [ids.zone]
      );
      expect(text).toContain('ix_memberships_zone_status');
      // Index ONLY, which is the whole reason this index and not the one on
      // `("zoneId", username)`: both can find the zone's rows, and only this
      // one carries the `status` the counts filter on, so the heap is never
      // touched. An index scan here would mean the index stopped covering.
      expect(text).toContain(
        'Index Only Scan using ix_memberships_zone_status'
      );
    });

    it('backs the preview ordering with the zone/updatedAt index', async () => {
      const text = await planFor(
        `SELECT sl.id FROM "shopping_lists" sl WHERE sl."zoneId" = $1
         ORDER BY sl."updatedAt" DESC, sl.id DESC LIMIT 3`,
        [ids.zone]
      );
      expect(text).toContain('ix_lists_zone_updated');
    });
  });
});
