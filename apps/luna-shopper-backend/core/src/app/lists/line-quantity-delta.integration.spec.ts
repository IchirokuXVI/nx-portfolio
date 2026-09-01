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
import { DataSource } from 'typeorm';
import {
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * The two claims of plan 0040 that only Postgres can settle.
 *
 * **Two concurrent additions to one line both land** (section 2). This is the
 * test the quantity route exists for, and it cannot be written honestly against a
 * mocked repository: what is being asserted is that the row was locked, and a
 * mock has no row and no lock. Before this route there was no way to add units
 * except to read, compute and write, and the second writer between those two
 * steps won outright with nothing logged and nothing errored, so the failure
 * surfaced in the shop as milk that was not on the list.
 *
 * **A batch that fails partway writes nothing at all** (section 6.1). All or
 * nothing is a property of the transaction, so the rollback is Postgres's to
 * perform and this is where it can be observed.
 */
describeIntegration('the quantity delta and the batch (real Postgres)', () => {
  let dataSource: DataSource;
  let lines: LineService;

  // Core stores userIds in `uuid` columns even though it never joins on them, so
  // the stand in users need real uuids rather than readable labels. Ids are minted
  // fresh per run so parallel runs do not collide.
  const ids = { zone: '', list: '', owner: randomUUID() };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const membershipRepo = dataSource.getRepository(ZoneMembership);
    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      // The access table stays empty: the caller is a zone OWNER, whose four
      // permissions are derived from the role and never stored (plan 0036, 2.4).
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(membershipRepo)
    );

    lines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(LineSettlement),
      listAccess,
      { emit: jest.fn() } as never
    );

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Delta Zone',
        joinCode: `DLT${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    ids.zone = zone.id;

    await membershipRepo.save(
      membershipRepo.create({
        zoneId: zone.id,
        userId: ids.owner,
        username: 'Owner',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );

    const list = await dataSource.getRepository(ShoppingList).save(
      dataSource.getRepository(ShoppingList).create({
        zoneId: zone.id,
        name: 'Groceries',
        createdByUserId: ids.owner,
      })
    );
    ids.list = list.id;
  });

  afterAll(async () => {
    if (ids.zone) {
      // Memberships, lists, access rows and lines all cascade from the zone.
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(ListLine).delete({ listId: ids.list });
  });

  /** One `PENDING` line, which is what every case here starts from. */
  async function seedLine(quantity: number): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    return repo.save(
      repo.create({
        listId: ids.list,
        content: 'Milk',
        quantity,
        position: 1,
        approvalStatus: LineApprovalStatus.PENDING,
        createdByUserId: ids.owner,
        version: 1,
      })
    );
  }

  /**
   * Holds the row locked while both writers arrive, then lets go.
   *
   * Two calls fired at once overlap only if the scheduler happens to interleave
   * them, and on a fast local database it usually does not: the first finishes
   * before the second starts, both land, and the test passes whether or not the
   * service locks anything. Taking the lock here first makes the overlap a
   * property of the test rather than of the machine it runs on, so the assertion
   * below is a detector instead of a coin toss.
   */
  async function whileTheRowIsHeld<T>(
    lineId: string,
    run: () => Promise<T>
  ): Promise<T> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM list_lines WHERE id = $1 FOR UPDATE', [
      lineId,
    ]);

    const running = run();
    // Long enough for both writers to reach the row and queue behind this lock.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await runner.commitTransaction();
    await runner.release();
    return running;
  }

  it('lands both of two concurrent additions to one line', async () => {
    const line = await seedLine(1);

    await whileTheRowIsHeld(line.id, () =>
      Promise.all([
        lines.addQuantity({ userId: ids.owner, lineId: line.id, delta: 1 }),
        lines.addQuantity({ userId: ids.owner, lineId: line.id, delta: 1 }),
      ])
    );

    // Three, not two. Two people talking to the bot in one household, or one
    // tapping the stepper while the other speaks, and the read-compute-write this
    // route replaces would have dropped one of them: both would have read one,
    // both would have written two, and nothing would have errored or logged.
    const after = await dataSource
      .getRepository(ListLine)
      .findOneByOrFail({ id: line.id });
    expect(after.quantity).toBe(3);
    // And each write is a version of its own, so neither overwrote the other's.
    expect(after.version).toBe(3);
  });

  it('lands ten concurrent additions', async () => {
    const line = await seedLine(1);

    await whileTheRowIsHeld(line.id, () =>
      Promise.all(
        Array.from({ length: 10 }, () =>
          lines.addQuantity({ userId: ids.owner, lineId: line.id, delta: 2 })
        )
      )
    );

    const after = await dataSource
      .getRepository(ListLine)
      .findOneByOrFail({ id: line.id });
    expect(after.quantity).toBe(21);
  });

  it('writes a batch in request order on consecutive positions', async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      content: `item ${index}`,
    }));

    const views = await lines.addMany({
      userId: ids.owner,
      listId: ids.list,
      items,
    });

    expect(views.map((view) => view.content)).toEqual(
      items.map((item) => item.content)
    );
    const stored = await dataSource
      .getRepository(ListLine)
      .find({ where: { listId: ids.list }, order: { position: 'ASC' } });
    expect(stored.map((row) => row.content)).toEqual(
      items.map((item) => item.content)
    );
    expect(stored.map((row) => row.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('writes nothing at all when one item of a batch is refused', async () => {
    // The refusal comes from inside the transaction, on the fifth item, which is
    // the case a per item result array would have had to describe. It cannot
    // arise through the gateway, where every item is validated at the edge, and
    // that is exactly why the response is all or nothing (section 6.1).
    await expect(
      lines.addMany({
        userId: ids.owner,
        listId: ids.list,
        items: [
          { content: 'one' },
          { content: 'two' },
          { content: 'three' },
          { content: 'four' },
          { content: 'five', quantity: -1 },
        ],
      })
    ).rejects.toThrow(/at least 0/);

    expect(
      await dataSource.getRepository(ListLine).count({
        where: { listId: ids.list },
      })
    ).toBe(0);
  });
});
