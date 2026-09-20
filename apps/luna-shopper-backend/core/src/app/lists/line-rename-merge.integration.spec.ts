import {
  BasketKind,
  GeneratedListStatus,
  LINE_ITEM_SET_MAX,
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import {
  BasketTripRow,
  CORE_ENTITIES,
  GeneratedList,
  LineComment,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { itemSetHash } from './item-set-hash';
import { LineChangeRecorder } from './changes/line-change.recorder';
import { LineMergeService } from './line-merge.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * A renamed line joins the line of that name (plan 0112, section 9).
 *
 * Against Postgres, because what is asserted is mostly rows that moved between
 * tables under a lock: comments, settlements and a finished trip's rows that
 * cascade on delete and are lost if the merge forgets one, a unique key on the
 * trip rows that a careless move violates, and two renames that only stay one
 * line because the list row was held. A mocked repository has none of those.
 */
describeIntegration('a rename that collides merges (real Postgres)', () => {
  let dataSource: DataSource;
  let lines: LineService;
  const emit = jest.fn();

  // Core stores user ids in `uuid` columns, so the stand ins are real uuids,
  // minted per run so parallel runs do not collide.
  const ids = {
    zone: '',
    list: '',
    autoList: '',
    owner: randomUUID(),
    writer: randomUUID(),
    decider: randomUUID(),
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const memberships = dataSource.getRepository(ZoneMembership);
    lines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ListLineGroupRemoval),
      dataSource.getRepository(LineSettlement),
      new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(memberships)
      ),
      fakeLineClaims().service,
      { emit } as never,
      new CoreAuditService(dataSource),
      new LineMergeService(new LineChangeRecorder()),
      // The **real** recorder: what a merge writes down is a fact about a
      // database, and this suite has one (plan 0138, section 13, test 4).
      new LineChangeRecorder()
    );

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Rename Zone',
        joinCode: `RNM${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    ids.zone = zone.id;

    const lists = dataSource.getRepository(ShoppingList);
    ids.list = (
      await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Groceries',
          createdByUserId: ids.owner,
        })
      )
    ).id;
    ids.autoList = (
      await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Approves itself',
          createdByUserId: ids.owner,
          autoApproveLines: true,
        })
      )
    ).id;

    // The owner holds every permission by role. The writer holds WRITE and not
    // DECIDE, which is the caller section 2's approval refusal is about, and the
    // decider holds both.
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: ids.owner,
        username: 'Owner',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    for (const [userId, username, permissions] of [
      [ids.writer, 'Writer', [ListPermission.READ, ListPermission.WRITE]],
      [
        ids.decider,
        'Decider',
        [ListPermission.READ, ListPermission.WRITE, ListPermission.DECIDE],
      ],
    ] as const) {
      const membership = await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId,
          username,
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
      for (const listId of [ids.list, ids.autoList]) {
        await dataSource.getRepository(ListAccess).save(
          dataSource.getRepository(ListAccess).create({
            listId,
            membershipId: membership.id,
            permissions: [...permissions],
          })
        );
      }
    }
  });

  afterAll(async () => {
    if (ids.zone) {
      await dataSource
        .getRepository(GeneratedList)
        .delete({ ownerUserId: ids.owner });
      // Memberships, lists, access rows and lines all cascade from the zone.
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    emit.mockReset();
    await dataSource
      .getRepository(GeneratedList)
      .delete({ ownerUserId: ids.owner });
    await dataSource.getRepository(ListLine).delete({ listId: ids.list });
    await dataSource.getRepository(ListLine).delete({ listId: ids.autoList });
  });

  async function seedLine(seed: {
    content: string;
    position: number;
    quantity?: number;
    approvalStatus?: LineApprovalStatus;
    listId?: string;
  }): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    const approved = seed.approvalStatus === LineApprovalStatus.APPROVED;
    return repo.save(
      repo.create({
        listId: seed.listId ?? ids.list,
        content: seed.content,
        quantity: seed.quantity ?? 1,
        position: seed.position,
        approvalStatus: seed.approvalStatus ?? LineApprovalStatus.PENDING,
        createdByUserId: ids.owner,
        approvedByUserId: approved ? ids.owner : null,
        version: 1,
      })
    );
  }

  async function seedItems(lineId: string, itemIds: string[]): Promise<void> {
    await dataSource.getRepository(ListLineItem).insert(
      itemIds.map((itemId, position) => ({
        lineId,
        itemId,
        position,
        source: LineItemSource.USER,
      }))
    );
  }

  async function itemsOf(lineId: string): Promise<string[]> {
    const rows = await dataSource.getRepository(ListLineItem).find({
      where: { lineId },
      order: { position: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => row.itemId);
  }

  function rename(
    line: ListLine,
    content: string,
    options: { userId?: string; confirmMerge?: boolean } = {}
  ) {
    return lines.update({
      userId: options.userId ?? ids.owner,
      lineId: line.id,
      content,
      confirmMerge: options.confirmMerge,
    });
  }

  async function stored(listId = ids.list): Promise<ListLine[]> {
    return dataSource
      .getRepository(ListLine)
      .find({ where: { listId }, order: { position: 'ASC', id: 'ASC' } });
  }

  /** Holds the list row while both renames arrive (see the delta spec). */
  async function whileTheListIsHeld<T>(run: () => Promise<T>): Promise<T> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(
      'SELECT id FROM shopping_lists WHERE id = $1 FOR UPDATE',
      [ids.list]
    );
    const running = run();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await runner.commitTransaction();
    await runner.release();
    return running;
  }

  it('renames to a free name and changes nothing else (case 1)', async () => {
    const milk = await seedLine({ content: 'Milk', position: 1, quantity: 2 });

    const view = await rename(milk, 'Oat milk');

    expect(view.id).toBe(milk.id);
    expect(view.content).toBe('Oat milk');
    expect(view.quantity).toBe(2);
    expect(view.version).toBe(2);
    expect('absorbedLineId' in view).toBe(false);
    expect(emit.mock.calls.map((call) => call[0])).toEqual([
      RealtimeEvent.LineUpdated,
    ]);
  });

  it('refuses a taken name without confirmMerge, naming the other line, and writes nothing (case 2)', async () => {
    const milk = await seedLine({ content: 'Milk', position: 1, quantity: 2 });
    const bread = await seedLine({ content: 'Bread', position: 2 });

    await expect(rename(bread, 'milk')).rejects.toMatchObject({
      code: 'line_merge_required',
      details: { otherLineId: milk.id, otherContent: 'Milk', otherQuantity: 2 },
    });

    const after = await stored();
    expect(
      after.map((line) => [line.content, line.quantity, line.version])
    ).toEqual([
      ['Milk', 2, 1],
      ['Bread', 1, 1],
    ]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps the earlier line with the summed quantity, and announces the delete first (cases 3, 4 and 12)', async () => {
    const milk = await seedLine({ content: 'Milk', position: 1, quantity: 2 });
    const bread = await seedLine({ content: 'Bread', position: 2 });

    const view = await rename(bread, 'MILK', { confirmMerge: true });

    // The renamed line was the later one, so the survivor keeps its own spelling.
    expect(view.id).toBe(milk.id);
    expect(view.absorbedLineId).toBe(bread.id);
    expect(view.content).toBe('Milk');
    expect(view.quantity).toBe(3);
    expect(view.version).toBe(2);
    const after = await stored();
    expect(after.map((line) => line.id)).toEqual([milk.id]);

    expect(emit.mock.calls.map((call) => call[0])).toEqual([
      RealtimeEvent.LineDeleted,
      RealtimeEvent.LineUpdated,
    ]);
    expect(emit.mock.calls[0][2]).toEqual({ id: bread.id, listId: ids.list });
    expect(emit.mock.calls[1][2]).toMatchObject({ id: milk.id, quantity: 3 });
  });

  it('keeps the new spelling when the renamed line is the earlier one (case 4)', async () => {
    const milk = await seedLine({ content: 'Milk', position: 1, quantity: 2 });
    const bread = await seedLine({ content: 'Bread', position: 2 });

    const view = await rename(milk, 'BREAD', { confirmMerge: true });

    expect(view.id).toBe(milk.id);
    expect(view.absorbedLineId).toBe(bread.id);
    expect(view.content).toBe('BREAD');
    expect(view.quantity).toBe(3);
    expect((await stored()).map((line) => line.id)).toEqual([milk.id]);
  });

  it('unions the products in the survivor’s order first, and recomputes the hash (case 5)', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const milk = await seedLine({ content: 'Milk', position: 1 });
    const bread = await seedLine({ content: 'Bread', position: 2 });
    await seedItems(milk.id, [a, b]);
    await seedItems(bread.id, [b, c]);

    const view = await rename(bread, 'milk', { confirmMerge: true });

    expect(await itemsOf(milk.id)).toEqual([a, b, c]);
    expect(view.itemIds).toEqual([a, b, c]);
    expect(view.itemSetHash).toBe(itemSetHash([a, b, c]));
    expect(
      await dataSource
        .getRepository(ListLineItem)
        .count({ where: { lineId: bread.id } })
    ).toBe(0);
  });

  it('refuses a union past the product bound and moves nothing (case 6)', async () => {
    const half = LINE_ITEM_SET_MAX / 2 + 1;
    const milk = await seedLine({ content: 'Milk', position: 1 });
    const bread = await seedLine({ content: 'Bread', position: 2 });
    await seedItems(
      milk.id,
      Array.from({ length: half }, () => randomUUID())
    );
    await seedItems(
      bread.id,
      Array.from({ length: half }, () => randomUUID())
    );

    await expect(
      rename(bread, 'milk', { confirmMerge: true })
    ).rejects.toMatchObject({
      code: 'line_merge_too_many_products',
      messageArgs: { max: LINE_ITEM_SET_MAX },
    });

    expect((await stored()).map((line) => line.content)).toEqual([
      'Milk',
      'Bread',
    ]);
    expect(await itemsOf(milk.id)).toHaveLength(half);
    expect(await itemsOf(bread.id)).toHaveLength(half);
  });

  describe('a pending line renamed onto an approved one (case 7)', () => {
    it('is refused for a caller who only writes', async () => {
      await seedLine({
        content: 'Milk',
        position: 1,
        approvalStatus: LineApprovalStatus.APPROVED,
      });
      const bread = await seedLine({ content: 'Bread', position: 2 });

      await expect(
        rename(bread, 'milk', { userId: ids.writer, confirmMerge: true })
      ).rejects.toMatchObject({ code: 'line_merge_needs_approval' });
      expect(await stored()).toHaveLength(2);
    });

    it('merges for a caller who decides', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        approvalStatus: LineApprovalStatus.APPROVED,
      });
      const bread = await seedLine({ content: 'Bread', position: 2 });

      const view = await rename(bread, 'milk', {
        userId: ids.decider,
        confirmMerge: true,
      });

      expect(view.id).toBe(milk.id);
      expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
      expect(view.approvedByUserId).toBe(ids.owner);
    });

    it('merges on a list that approves lines by itself', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        approvalStatus: LineApprovalStatus.APPROVED,
        listId: ids.autoList,
      });
      const bread = await seedLine({
        content: 'Bread',
        position: 2,
        listId: ids.autoList,
      });

      const view = await rename(bread, 'milk', {
        userId: ids.writer,
        confirmMerge: true,
      });

      expect(view.id).toBe(milk.id);
      expect(await stored(ids.autoList)).toHaveLength(1);
    });
  });

  it('leaves an approved survivor when an approved line is renamed onto a pending one (case 8)', async () => {
    const milk = await seedLine({ content: 'Milk', position: 1 });
    const bread = await seedLine({
      content: 'Bread',
      position: 2,
      approvalStatus: LineApprovalStatus.APPROVED,
    });

    // A plain writer, whose content edit would otherwise put an approved line
    // back to pending. Section 3 reads both statuses from before the edit.
    const view = await rename(bread, 'milk', {
      userId: ids.writer,
      confirmMerge: true,
    });

    expect(view.id).toBe(milk.id);
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    // Only the absorbed line was approved, so its approver stands.
    expect(view.approvedByUserId).toBe(ids.owner);
  });

  it('moves comments and settlements, and the purchases keep the basket they were made on (case 9)', async () => {
    // Plan 0136, section 7.6 reverses half of this test. The merge used to move
    // `generated_list_line_origins` to the survivor and sum an origin both lines
    // had; there are no origins any more, because an open basket holds no copy
    // of a line. What is left is the half that always did the work: the
    // settlements move, carrying the `basketId` they were made on, so the basket
    // reads one row afterwards with both lines' purchases on it. The trip rows
    // of a finished basket are the next test's.
    const milk = await seedLine({ content: 'Milk', position: 1, quantity: 2 });
    const bread = await seedLine({ content: 'Bread', position: 2 });

    const basket = await dataSource.getRepository(GeneratedList).save(
      dataSource.getRepository(GeneratedList).create({
        ownerUserId: ids.owner,
        name: 'Saturday',
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date(),
        kind: BasketKind.GENERATED,
        idempotencyKey: null,
      })
    );

    for (const line of [milk, bread]) {
      await dataSource.getRepository(LineComment).save(
        dataSource.getRepository(LineComment).create({
          lineId: line.id,
          authorUserId: ids.owner,
          body: `about ${line.content}`,
          audioContentType: null,
          audioByteLength: null,
          audioDurationSeconds: null,
          transcription: null,
        })
      );
      await dataSource.getRepository(LineSettlement).save(
        dataSource.getRepository(LineSettlement).create({
          lineId: line.id,
          listId: ids.list,
          itemId: null,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          settledByUserId: ids.owner,
          settledByParticipantId: null,
          settledAt: new Date(),
          revertedAt: null,
          basketId: basket.id,
        })
      );
    }

    const view = await rename(bread, 'milk', { confirmMerge: true });

    expect(
      await dataSource
        .getRepository(LineComment)
        .count({ where: { lineId: milk.id } })
    ).toBe(2);
    expect(
      await dataSource
        .getRepository(LineSettlement)
        .count({ where: { lineId: milk.id } })
    ).toBe(2);
    expect(view.boughtCount).toBe(2);

    // Both purchases are the survivor's and both still name the basket, which
    // is what makes the open basket's `bought` for that one row the sum of the
    // two: the number is read from these rows on every request rather than
    // copied anywhere at the merge.
    const moved = await dataSource
      .getRepository(LineSettlement)
      .find({ where: { lineId: milk.id } });
    expect(moved.map((row) => row.basketId)).toEqual([basket.id, basket.id]);
    expect(
      await dataSource
        .getRepository(LineSettlement)
        .count({ where: { lineId: bread.id } })
    ).toBe(0);
  });

  it('moves a finished trip’s rows, summing a basket that asked for both (plan 0135, test 10)', async () => {
    // A trip row names its line by a foreign key, so a row left on the absorbed
    // line would be deleted with it. The merge moves it, and a basket holding a
    // row on both lines ends with one, because `uq_basket_trip_rows_line` allows
    // one row per basket and zone line.
    const milk = await seedLine({ content: 'Milk', position: 1, quantity: 2 });
    const bread = await seedLine({ content: 'Bread', position: 2 });

    const baskets = dataSource.getRepository(GeneratedList);
    const ended = (name: string) =>
      baskets.save(
        baskets.create({
          ownerUserId: ids.owner,
          name,
          status: GeneratedListStatus.FINISHED,
          generatedAt: new Date(),
          kind: BasketKind.GENERATED,
          idempotencyKey: null,
        })
      );
    const both = await ended('Asked for both');
    const breadOnly = await ended('Asked for bread');

    const rows = dataSource.getRepository(BasketTripRow);
    await rows.insert([
      { basketId: both.id, listId: ids.list, lineId: milk.id, asked: 2 },
      { basketId: both.id, listId: ids.list, lineId: bread.id, asked: 3 },
      { basketId: breadOnly.id, listId: ids.list, lineId: bread.id, asked: 4 },
    ]);

    await rename(bread, 'milk', { confirmMerge: true });

    const askedOf = async (basketId: string) =>
      (await rows.find({ where: { basketId } })).map((row) => [
        row.lineId,
        row.asked,
      ]);
    // Both asks on the survivor, as one row.
    expect(await askedOf(both.id)).toEqual([[milk.id, 5]]);
    // The other basket's row is repointed and keeps its number.
    expect(await askedOf(breadOnly.id)).toEqual([[milk.id, 4]]);
  });

  it('never collides on a change of case or accents alone (case 10)', async () => {
    // Two lines of one name the list already held (plan 0091, section 5).
    const first = await seedLine({ content: 'jamon', position: 1 });
    const second = await seedLine({ content: 'Jamón', position: 2 });

    const view = await rename(second, 'JAMÓN');

    expect(view.id).toBe(second.id);
    expect(view.content).toBe('JAMÓN');
    expect((await stored()).map((line) => line.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('leaves one line after two concurrent renames onto one name (case 11)', async () => {
    const milk = await seedLine({ content: 'Milk', position: 1 });
    const bread = await seedLine({ content: 'Bread', position: 2 });
    const eggs = await seedLine({ content: 'Eggs', position: 3 });

    const views = await whileTheListIsHeld(() =>
      Promise.all([
        rename(bread, 'milk', { confirmMerge: true }),
        rename(eggs, 'milk', { confirmMerge: true }),
      ])
    );

    const after = await stored();
    expect(after.map((line) => [line.id, line.quantity])).toEqual([
      [milk.id, 3],
    ]);
    expect(views.map((view) => view.id)).toEqual([milk.id, milk.id]);
  });
});
