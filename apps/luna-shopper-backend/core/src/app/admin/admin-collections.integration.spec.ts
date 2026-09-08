import {
  LineApprovalStatus,
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { CORE_MIGRATIONS } from '../db/migrations';
import {
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { AdminListService } from './admin-list.service';
import { AdminZoneService } from './admin-zone.service';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * The two collections that read across their parent (admin plan 0017).
 *
 * Against real Postgres, because what the plan asks for is a claim about
 * **order and paging**: the rows come back grouped by the zone or the list they
 * belong to, and walking the whole set with the cursor visits each row exactly
 * once. Both are properties of a row comparison and an `ORDER BY` that a fake
 * repository cannot have an opinion about. The scoped read is asserted beside
 * the unscoped one, because the plan's promise is that naming a parent leaves
 * the read exactly as it was.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own core data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration
 */
const SCHEMA = 'plan0017_admin_collections_test';

/** An `admin_users.id` from auth's database, which core never resolves. */
const OPERATOR = '33333333-3333-4333-8333-333333333333';
/** A `users.id`. Core references people by opaque id and stores no auth data. */
const MEMBER = '44444444-4444-4444-8444-444444444444';

const CREDENTIAL = { userId: OPERATOR, adminToken: 'stub' };

/** A uuid no row was ever seeded with, so a read of it is a real 404. */
const NOWHERE = '55555555-5555-4555-8555-555555555555';

/**
 * The parents a page visited, in the order it visited them, each named once.
 *
 * "Grouped by parent" is the claim, and this is what makes it checkable: a
 * parent that appears twice in this list had a row of another parent in the
 * middle of it. Which parent comes first is a uuid comparison and therefore not
 * something the fixture can predict, so it is not asserted.
 */
function groupsOf(parents: readonly string[]): string[] {
  return parents.filter((parent, at) => parent !== parents[at - 1]);
}

describeIntegration('the admin collections that read across a parent', () => {
  let dataSource: DataSource;
  let zoneService: AdminZoneService;
  let listService: AdminListService;
  let zones: Repository<Zone>;
  let memberships: Repository<ZoneMembership>;
  let lists: Repository<ShoppingList>;
  let lines: Repository<ListLine>;

  beforeAll(async () => {
    const url = requiredEnv('CORE_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CORE_ENTITIES,
      migrations: CORE_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    zones = dataSource.getRepository(Zone);
    memberships = dataSource.getRepository(ZoneMembership);
    lists = dataSource.getRepository(ShoppingList);
    lines = dataSource.getRepository(ListLine);

    // The gate has its own specs and needs a keypair. Here it stands for a
    // request that already carried a live operator token, so what is under test
    // is the read rather than the signature check.
    const gate = {
      requireAdmin: jest.fn(async () => OPERATOR),
    } as unknown as CorePlatformAdminService;

    zoneService = new AdminZoneService(
      zones,
      memberships,
      lists,
      gate,
      {} as never,
      {} as never,
      {} as never
    );
    listService = new AdminListService(
      lists,
      lines,
      dataSource.getRepository(GeneratedList),
      dataSource.getRepository(GeneratedListLine),
      dataSource.getRepository(GeneratedListLineOrigin),
      gate,
      {} as never,
      {} as never
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let seq = 0;

  beforeEach(async () => {
    // Children before parents: neither cascade is worth relying on for a
    // fixture reset.
    for (const repository of [lines, memberships, lists, zones]) {
      await repository.createQueryBuilder().delete().execute();
    }
    seq = 0;
  });

  async function newZone(): Promise<Zone> {
    seq += 1;
    return zones.save(
      zones.create({
        name: `Flat ${seq}`,
        joinCode: `CODE${String(seq).padStart(3, '0')}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: MEMBER,
        config: {},
        markedForDeletionAt: null,
      })
    );
  }

  /**
   * A membership joined at a stated moment, so the order is not a coin toss.
   *
   * The moment is written afterwards rather than passed to `save`, because
   * `createdAt` is a `@CreateDateColumn` and TypeORM writes its own value for
   * one on every insert whatever the caller supplied.
   */
  async function newMember(zone: Zone, joinedAt: string, name: string) {
    const row = await memberships.save(
      memberships.create({
        zoneId: zone.id,
        // One person holds at most one membership per zone, which
        // `uq_membership_zone_user` enforces, so every row here is somebody
        // else.
        userId: randomUUID(),
        username: name,
        role: ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      })
    );
    await memberships
      .createQueryBuilder()
      .update()
      .set({ createdAt: new Date(joinedAt) })
      .where('id = :id', { id: row.id })
      .execute();
    return row;
  }

  async function newList(zone: Zone): Promise<ShoppingList> {
    seq += 1;
    return lists.save(
      lists.create({
        zoneId: zone.id,
        name: `Weekly shop ${seq}`,
        createdByUserId: MEMBER,
      })
    );
  }

  async function newLine(list: ShoppingList, position: number, what: string) {
    return lines.save(
      lines.create({
        listId: list.id,
        content: what,
        quantity: 1,
        position,
        approvalStatus: LineApprovalStatus.APPROVED,
        createdByUserId: MEMBER,
      })
    );
  }

  /** Every row the collection answers, walked one page at a time. */
  async function walkMemberships(zoneId?: string, limit = 2) {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await zoneService.listMemberships({
        ...CREDENTIAL,
        zoneId,
        cursor,
        limit,
      });
      seen.push(...page.items.map((row) => row.membershipId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return seen;
  }

  async function walkLines(listId?: string, limit = 2) {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listService.listLines({
        ...CREDENTIAL,
        listId,
        cursor,
        limit,
      });
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return seen;
  }

  describe('memberships', () => {
    /**
     * The whole point of the plan: an operator who does not know the household
     * still gets a list, and every row on it says which household it is.
     */
    it('lists every zone when none is named, grouped by zone', async () => {
      const first = await newZone();
      const second = await newZone();
      await newMember(first, '2026-01-02T10:00:00.000Z', 'rosa');
      await newMember(second, '2026-01-01T10:00:00.000Z', 'marc');
      await newMember(first, '2026-01-03T10:00:00.000Z', 'ana');

      const page = await zoneService.listMemberships({
        ...CREDENTIAL,
        limit: 50,
      });

      // Grouped by zone: each household's rows are together, whichever
      // household the uuid comparison puts first.
      expect(groupsOf(page.items.map((row) => row.zoneId))).toHaveLength(2);
      // Oldest first inside a household, which is the order the zone detail
      // read uses. `marc` joined before everybody and is not first here.
      expect(
        page.items
          .filter((row) => row.zoneId === first.id)
          .map((row) => row.username)
      ).toEqual(['rosa', 'ana']);
      // Every row names the household it belongs to, which is what makes a
      // cross zone listing readable.
      const names = new Map([
        [first.id, first.name],
        [second.id, second.name],
      ]);
      for (const row of page.items) {
        expect(row.zoneName).toBe(names.get(row.zoneId));
      }
    });

    /** A cursor that repeated or skipped a row is the failure worth catching. */
    it('visits every row exactly once when paged across zones', async () => {
      const first = await newZone();
      const second = await newZone();
      const written: string[] = [];
      for (let n = 0; n < 3; n += 1) {
        const day = String(n + 1).padStart(2, '0');
        written.push(
          (await newMember(first, `2026-01-${day}T10:00:00.000Z`, `a${n}`)).id
        );
        written.push(
          (await newMember(second, `2026-01-${day}T10:00:00.000Z`, `b${n}`)).id
        );
      }

      const walked = await walkMemberships(undefined, 2);

      expect(walked).toHaveLength(written.length);
      expect(new Set(walked).size).toBe(written.length);
      expect(new Set(walked)).toEqual(new Set(written));
    });

    /** Naming the zone leaves the read as it was: one zone, oldest first. */
    it('is unchanged when a zone is named', async () => {
      const first = await newZone();
      const second = await newZone();
      const mine = [
        (await newMember(first, '2026-01-03T10:00:00.000Z', 'ana')).id,
        (await newMember(first, '2026-01-01T10:00:00.000Z', 'rosa')).id,
      ];
      await newMember(second, '2026-01-02T10:00:00.000Z', 'marc');

      const page = await zoneService.listMemberships({
        ...CREDENTIAL,
        zoneId: first.id,
        limit: 50,
      });

      expect(page.items.map((row) => row.username)).toEqual(['rosa', 'ana']);
      expect(await walkMemberships(first.id, 1)).toEqual([mine[1], mine[0]]);
    });

    it('answers 404 for a zone that is not there, and lists when none is named', async () => {
      const zone = await newZone();
      await newMember(zone, '2026-01-01T10:00:00.000Z', 'rosa');

      await expect(
        zoneService.listMemberships({ ...CREDENTIAL, zoneId: NOWHERE })
      ).rejects.toBeDefined();

      const page = await zoneService.listMemberships({ ...CREDENTIAL });
      expect(page.items).toHaveLength(1);
    });
  });

  describe('list lines', () => {
    /**
     * A `position` is a place inside one list, so ordering by it alone would
     * interleave two lists into an order that means nothing.
     */
    it('lists every list when none is named, grouped by list', async () => {
      const zone = await newZone();
      const first = await newList(zone);
      const second = await newList(zone);
      await newLine(first, 2, 'milk');
      await newLine(second, 1, 'bread');
      await newLine(first, 1, 'eggs');

      const page = await listService.listLines({ ...CREDENTIAL, limit: 50 });

      expect(groupsOf(page.items.map((row) => row.listId))).toHaveLength(2);
      // The household's own order inside a list, which is what `position`
      // means and the only order it means anything in.
      expect(
        page.items
          .filter((row) => row.listId === first.id)
          .map((row) => row.content)
      ).toEqual(['eggs', 'milk']);
      const names = new Map([
        [first.id, first.name],
        [second.id, second.name],
      ]);
      for (const row of page.items) {
        expect(row.listName).toBe(names.get(row.listId));
      }
    });

    it('visits every row exactly once when paged across lists', async () => {
      const zone = await newZone();
      const first = await newList(zone);
      const second = await newList(zone);
      const written: string[] = [];
      for (let n = 0; n < 3; n += 1) {
        written.push((await newLine(first, n, `a${n}`)).id);
        written.push((await newLine(second, n, `b${n}`)).id);
      }

      const walked = await walkLines(undefined, 2);

      expect(walked).toHaveLength(written.length);
      expect(new Set(walked)).toEqual(new Set(written));
    });

    it('is unchanged when a list is named', async () => {
      const zone = await newZone();
      const first = await newList(zone);
      const second = await newList(zone);
      const mine = [
        (await newLine(first, 2, 'milk')).id,
        (await newLine(first, 1, 'eggs')).id,
      ];
      await newLine(second, 1, 'bread');

      const page = await listService.listLines({
        ...CREDENTIAL,
        listId: first.id,
        limit: 50,
      });

      expect(page.items.map((row) => row.content)).toEqual(['eggs', 'milk']);
      expect(await walkLines(first.id, 1)).toEqual([mine[1], mine[0]]);
    });

    it('answers 404 for a list that is not there, and lists when none is named', async () => {
      const zone = await newZone();
      const list = await newList(zone);
      await newLine(list, 1, 'milk');

      await expect(
        listService.listLines({ ...CREDENTIAL, listId: NOWHERE })
      ).rejects.toBeDefined();

      const page = await listService.listLines({ ...CREDENTIAL });
      expect(page.items).toHaveLength(1);
    });
  });
});
