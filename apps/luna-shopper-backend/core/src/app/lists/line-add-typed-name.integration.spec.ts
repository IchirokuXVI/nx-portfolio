import {
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
  type LineAddNeedsChoiceDetails,
} from '@portfolio/luna-shopper/contracts';
import {
  LineAddNeedsChoiceException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import {
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { LineChangeRecorder } from './changes/line-change.recorder';
import { LineMergeService } from './line-merge.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * A typed name meets the line that holds that product, on real Postgres (plan
 * 0228, progress evidence).
 *
 * **Two adds of one typed name, racing on a list with one candidate at zero,
 * write one raise.** The first raises the line and the second meets it wanted
 * and writes nothing (plan 0260 R2, A1). Both answer `merged: true` with that
 * line, the list still holds one row of the name, and its quantity is the one
 * step of the raise. A mock has no row and no lock, so two adds that overlap
 * can only be run here.
 *
 * **An add that meets a wanted line leaves the row byte for byte** (plan
 * 0260, section 7.1): quantity, version and `updatedAt` as they were, and no
 * `list_line_changes` row. A mock can only say `save` was not called.
 *
 * The rest are the reads a mock cannot prove: the products in the refusal's
 * `details` come from an `In` query, and a chosen line of another list or a
 * deleted one is kept out by the repository read itself.
 */
describeIntegration(
  'a typed name meets its product line (real Postgres)',
  () => {
    const announcer = fakeBasketAnnouncer();
    let dataSource: DataSource;
    let lines: LineService;

    const ids = { zone: '', list: '', other: '', owner: randomUUID() };
    const WHOLE = randomUUID();
    const OAT = randomUUID();

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
        // The caller is the zone OWNER, whose permissions are derived from the
        // role and never stored (plan 0036, section 2.4).
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(membershipRepo)
      );

      lines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        { emit: jest.fn() } as never,
        new CoreAuditService(dataSource),
        new LineMergeService(new LineChangeRecorder()),
        new LineChangeRecorder(),
        announcer
      );

      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Typed name zone',
          joinCode: `TYP${Date.now()}`.slice(0, 16),
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
      ids.other = (
        await lists.save(
          lists.create({
            zoneId: zone.id,
            name: 'Pharmacy',
            createdByUserId: ids.owner,
          })
        )
      ).id;
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
      await dataSource.getRepository(ListLine).delete({ listId: ids.other });
    });

    /** A product line, made the way a list page makes one. */
    async function productLine(
      content: string,
      itemId: string,
      listId = ids.list
    ): Promise<string> {
      const { line } = await lines.add({
        userId: ids.owner,
        listId,
        content,
        itemIds: [itemId],
        quantity: 1,
      });
      return line.id;
    }

    /** Lowers a line to zero by hand, as a buy or an edit to 0 leaves it. */
    async function keep(lineId: string): Promise<void> {
      await dataSource
        .getRepository(ListLine)
        .update({ id: lineId }, { quantity: 0 });
    }

    /** How many change records name the line (plan 0138). */
    async function changesOf(lineId: string): Promise<number> {
      const [row] = await dataSource.query(
        'SELECT count(*)::int AS "count" FROM list_line_changes WHERE "lineId" = $1',
        [lineId]
      );
      return (row as { count: number }).count;
    }

    /** Every line of the list, deleted ones included, by position. */
    async function stored(listId = ids.list): Promise<ListLine[]> {
      return dataSource.getRepository(ListLine).find({
        where: { listId },
        withDeleted: true,
        order: { position: 'ASC' },
      });
    }

    /**
     * Holds the list row locked while both adds arrive, then lets go, so the
     * overlap is a property of the test and not of the machine (the reason
     * `line-quantity-delta.integration.spec.ts` gives).
     */
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

    it('raises the one kept product line once from two racing adds of its name, and creates nothing', async () => {
      const milk = await productLine('Leche entera', WHOLE);
      await keep(milk);

      const results = await whileTheListIsHeld(() =>
        Promise.all([
          lines.add({
            userId: ids.owner,
            listId: ids.list,
            content: 'leche entera',
            quantity: 3,
            askIfAmbiguous: true,
          }),
          lines.add({
            userId: ids.owner,
            listId: ids.list,
            content: 'LECHE ENTERA',
            quantity: 3,
          }),
        ])
      );

      expect(results.map((result) => result.merged)).toEqual([true, true]);
      expect(results.map((result) => result.line.id)).toEqual([milk, milk]);
      // Whichever took the lock first raised the line; the other met it
      // wanted and added nothing (plan 0260 R2, A1).
      expect(results.map((result) => result.outcome).sort()).toEqual([
        'ALREADY_ON_LIST',
        'RAISED',
      ]);
      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(3);
      expect(rows[0].content).toBe('Leche entera');
    });

    it('leaves a wanted weighed product line byte for byte beside an open typed add, and raises it from zero to 25 (plan 0260)', async () => {
      const { line: bananas } = await lines.add({
        userId: ids.owner,
        listId: ids.list,
        content: 'Platanos',
        itemIds: [WHOLE],
        unit: 'GRAM',
        quantity: 750,
      });
      const before = (await stored())[0];
      const changesBefore = await changesOf(bananas.id);

      const met = await lines.add({
        userId: ids.owner,
        listId: ids.list,
        content: 'platanos',
        quantity: 2,
        unit: 'UNIT',
      });

      expect(met).toMatchObject({
        merged: true,
        outcome: 'ALREADY_ON_LIST',
        line: { id: bananas.id, quantity: 750, unit: 'GRAM' },
      });
      expect(met.alreadyOnList.map((line) => line.id)).toEqual([bananas.id]);
      const after = (await stored())[0];
      expect(after.quantity).toBe(before.quantity);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt.toISOString()).toBe(
        before.updatedAt.toISOString()
      );
      expect(await changesOf(bananas.id)).toBe(changesBefore);
      expect(await stored()).toHaveLength(1);

      await keep(bananas.id);
      const raised = await lines.add({
        userId: ids.owner,
        listId: ids.list,
        content: 'platanos',
      });

      expect(raised).toMatchObject({
        outcome: 'RAISED',
        line: { id: bananas.id, quantity: 25, unit: 'GRAM' },
      });
      expect((await stored())[0].quantity).toBe(25);
      expect(await changesOf(bananas.id)).toBe(changesBefore + 1);
    });

    it('asks which line, naming each with its products, when two kept lines hold a product', async () => {
      const whole = await productLine('Leche entera', WHOLE);
      const oat = await productLine('Leche entera', OAT);
      // Both at zero, so the add would write a raise (plan 0260 R3).
      await keep(whole);
      await keep(oat);

      const refused = await lines
        .add({
          userId: ids.owner,
          listId: ids.list,
          content: 'leche entera',
          askIfAmbiguous: true,
        })
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(LineAddNeedsChoiceException);
      const details = (refused as LineAddNeedsChoiceException)
        .details as unknown as LineAddNeedsChoiceDetails;
      expect(details.lines.map((line) => [line.lineId, line.itemIds])).toEqual([
        [whole, [WHOLE]],
        [oat, [OAT]],
      ]);
      // The refusal wrote nothing.
      expect((await stored()).map((row) => row.quantity)).toEqual([0, 0]);

      // The person's answer raises the line they chose.
      const answered = await lines.add({
        userId: ids.owner,
        listId: ids.list,
        content: 'leche entera',
        intoLineId: oat,
      });
      expect(answered).toMatchObject({
        merged: true,
        outcome: 'RAISED',
        line: { id: oat },
      });
      expect((await stored()).map((row) => row.quantity)).toEqual([0, 1]);
    });

    it('refuses a chosen line of another list, or a deleted one, and creates nothing', async () => {
      const elsewhere = await productLine('Leche entera', WHOLE, ids.other);
      const gone = await productLine('Leche entera', OAT);
      await dataSource.getRepository(ListLine).softDelete({ id: gone });

      for (const intoLineId of [elsewhere, gone, randomUUID()]) {
        await expect(
          lines.add({
            userId: ids.owner,
            listId: ids.list,
            content: 'Leche entera',
            intoLineId,
          })
        ).rejects.toBeInstanceOf(NotFoundException);
      }

      expect((await stored()).map((row) => row.id)).toEqual([gone]);
      expect((await stored(ids.other)).map((row) => row.quantity)).toEqual([1]);
    });
  }
);
