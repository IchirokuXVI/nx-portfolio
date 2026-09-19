import {
  ListPermission,
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
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ListAccessService } from './list-access.service';

/**
 * `permissionsAmong` answers what `permissionsForMembership` answers (plan 0131,
 * section 2).
 *
 * One is raw SQL over many lists and the other is a repository read over one, so
 * the only honest proof that they agree is running both against a real database
 * and comparing. Two things in particular cannot be proven anywhere else:
 *
 * - **The join is what decides whether a row is staff**, and a wrong one would
 *   hand somebody another zone's derived grant. The grant itself comes from
 *   `ALL_LIST_PERMISSIONS` in both answers, so what is being compared here is
 *   which rows get it.
 * - **A Postgres enum array is cast to `text[]`** to leave the query, and whether
 *   that cast is legal at all is a question only Postgres can answer.
 *
 * Two zones in one call, because the query joins memberships per list and a
 * caller who is staff in one zone and a row holder in another is exactly where a
 * wrong join shows up.
 */
describeIntegration('permissionsAmong (real Postgres)', () => {
  let dataSource: DataSource;
  let access: ListAccessService;

  // Core stores userIds in `uuid` columns even though it never joins on them, so
  // the stand in users need real uuids. Minted per run so parallel runs do not
  // collide.
  const users = {
    staff: randomUUID(),
    admin: randomUUID(),
    rowHolder: randomUUID(),
    noRow: randomUUID(),
    pending: randomUUID(),
    stranger: randomUUID(),
  };
  const ids = { flat: '', office: '', flatList: '', officeList: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const zones = dataSource.getRepository(Zone);
    const memberships = dataSource.getRepository(ZoneMembership);
    const lists = dataSource.getRepository(ShoppingList);
    const rows = dataSource.getRepository(ListAccess);

    access = new ListAccessService(
      lists,
      rows,
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(memberships)
    );

    const seedZone = async (name: string): Promise<string> => {
      const zone = await zones.save(
        zones.create({
          name,
          joinCode: `${name.slice(0, 3).toUpperCase()}${Date.now()}`.slice(
            0,
            16
          ),
          status: ZoneStatus.ACTIVE,
          ownerUserId: users.staff,
          config: {},
        })
      );
      return zone.id;
    };

    ids.flat = await seedZone('Flat');
    ids.office = await seedZone('Office');

    const seedList = async (zoneId: string, name: string): Promise<string> => {
      const list = await lists.save(
        lists.create({ zoneId, name, createdByUserId: users.staff })
      );
      return list.id;
    };

    ids.flatList = await seedList(ids.flat, 'Groceries');
    ids.officeList = await seedList(ids.office, 'Supplies');

    const join = async (
      zoneId: string,
      userId: string,
      role: ZoneRole,
      status = MembershipStatus.APPROVED
    ): Promise<ZoneMembership> =>
      memberships.save(
        memberships.create({
          zoneId,
          userId,
          username: userId.slice(0, 8),
          role,
          status,
        })
      );

    // The owner of both zones, so the derived grant is asked across a join.
    await join(ids.flat, users.staff, ZoneRole.OWNER);
    await join(ids.office, users.staff, ZoneRole.OWNER);
    await join(ids.flat, users.admin, ZoneRole.ADMIN);
    const holder = await join(ids.flat, users.rowHolder, ZoneRole.MEMBER);
    await join(ids.office, users.rowHolder, ZoneRole.MEMBER);
    await join(ids.flat, users.noRow, ZoneRole.MEMBER);
    await join(
      ids.flat,
      users.pending,
      ZoneRole.MEMBER,
      MembershipStatus.PENDING
    );

    // One stored set, on one list of the two the row holder can reach.
    await rows.save(
      rows.create({
        listId: ids.flatList,
        membershipId: holder.id,
        permissions: [ListPermission.READ, ListPermission.WRITE],
      })
    );
  });

  afterAll(async () => {
    const zones = dataSource?.getRepository(Zone);
    // Memberships, lists and access rows all cascade from the zone.
    for (const id of [ids.flat, ids.office]) {
      if (id) {
        await zones.delete({ id });
      }
    }
    await dataSource?.destroy();
  });

  /** Both lists, which is the two zone call the query is written for. */
  function both(): string[] {
    return [ids.flatList, ids.officeList];
  }

  /** The same question asked the one list way, for comparison. */
  async function oneAtATime(
    userId: string
  ): Promise<Map<string, Set<ListPermission>>> {
    const memberships = dataSource.getRepository(ZoneMembership);
    const answer = new Map<string, Set<ListPermission>>();
    for (const listId of both()) {
      const list = await dataSource
        .getRepository(ShoppingList)
        .findOneOrFail({ where: { id: listId } });
      const membership = await memberships.findOne({
        where: {
          zoneId: list.zoneId,
          userId,
          status: MembershipStatus.APPROVED,
        },
      });
      if (!membership) {
        continue;
      }
      answer.set(
        listId,
        await access.permissionsForMembership(listId, membership)
      );
    }
    return answer;
  }

  function sorted(set: Set<ListPermission> | undefined): string[] {
    return [...(set ?? [])].sort();
  }

  it.each([
    ['a zone owner', () => users.staff],
    ['a zone admin', () => users.admin],
    ['a member with a stored set', () => users.rowHolder],
    ['a member with no row', () => users.noRow],
    ['an unapproved member', () => users.pending],
    ['a stranger', () => users.stranger],
  ])('agrees with permissionsForMembership for %s', async (_name, of) => {
    const userId = of();

    const among = await access.permissionsAmong(userId, both());
    const oneByOne = await oneAtATime(userId);

    for (const listId of both()) {
      expect(sorted(among.get(listId))).toEqual(sorted(oneByOne.get(listId)));
    }
  });

  it('gives a zone owner all four on every list of both zones', async () => {
    const among = await access.permissionsAmong(users.staff, both());

    for (const listId of both()) {
      expect(sorted(among.get(listId))).toEqual([
        'DECIDE',
        'MANAGE',
        'READ',
        'WRITE',
      ]);
    }
  });

  it('gives an admin of one zone nothing in the other', async () => {
    const among = await access.permissionsAmong(users.admin, both());

    expect(sorted(among.get(ids.flatList))).toEqual([
      'DECIDE',
      'MANAGE',
      'READ',
      'WRITE',
    ]);
    // Absent rather than empty: no approved membership, so no row at all.
    expect(among.has(ids.officeList)).toBe(false);
  });

  it('reads a stored set back as it was written, and nothing beside it', async () => {
    const among = await access.permissionsAmong(users.rowHolder, both());

    expect(sorted(among.get(ids.flatList))).toEqual(['READ', 'WRITE']);
    // A member of the zone with no row holds nothing on its list, which is an
    // empty set and not an absent one: the membership is there.
    expect(sorted(among.get(ids.officeList))).toEqual([]);
    expect(among.has(ids.officeList)).toBe(true);
  });

  it('answers an unapproved member and a stranger with nothing at all', async () => {
    for (const userId of [users.pending, users.stranger]) {
      const among = await access.permissionsAmong(userId, both());
      expect(among.size).toBe(0);
    }
  });

  it('answers an empty ask without a query', async () => {
    await expect(access.permissionsAmong(users.staff, [])).resolves.toEqual(
      new Map()
    );
  });
});
