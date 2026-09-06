import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  LineApprovalStatus,
  MembershipStatus,
  ParticipantKind,
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
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';
import { WaitingSettlementService } from './waiting-settlement.service';

/**
 * A line reaches as many lists as are raised, against real Postgres (plan 0092).
 *
 * The unit spec beside this one owns the rules: which of the three cases a write
 * takes, what an adoption moves, what a creation claims. What it cannot own is
 * everything between those decisions and the rows two households eventually
 * read, because it fakes `promote` and therefore agrees with itself about what
 * the ordinary add did.
 *
 * So this is the sentence plan 0058 could not say, asserted end to end: a line
 * somebody typed in the aisle, raised for **two** lists, produces two zone
 * lines, two provenance rows and two claims, and reaching the first list never
 * refuses the second. That refusal is exactly what "binding is once" was, and it
 * is what this file exists to keep deleted.
 *
 * Everything that touches the database is real, including `LineService.add` and
 * its plan 0091 merge. The participant and the basket projection are faked,
 * because they are access questions the unit spec already covers and neither
 * writes a row.
 */
describeIntegration(
  'a line sent to every list that wants it (plan 0092)',
  () => {
    let dataSource: DataSource;
    let origins: GeneratedListOriginsService;
    let settles: GeneratedListSettleService;
    let claims: FakeLineClaims;

    const ids = {
      zone: '',
      flat: '',
      parents: '',
      basket: '',
      shopper: randomUUID(),
    };

    /**
     * The participant the write is made as: the owner, with every access.
     *
     * A real uuid rather than a readable label, because the write stamps it onto
     * `lastEditedByParticipantId`, which is a uuid column.
     */
    const PARTICIPANT = randomUUID();

    async function seedBasketLine(content: string): Promise<GeneratedListLine> {
      return dataSource.getRepository(GeneratedListLine).save(
        dataSource.getRepository(GeneratedListLine).create({
          generatedListId: ids.basket,
          content,
          quantity: 1,
          settledQuantity: 0,
          itemId: null,
          // Typed into the basket in the aisle, so it exists nowhere else until
          // somebody raises a list for it.
          origin: GeneratedLineOrigin.ADDED,
          targetListId: null,
          position: 1,
        })
      );
    }

    function raise(
      line: GeneratedListLine,
      listId: string,
      quantity: number
    ): Promise<unknown> {
      return origins.setOriginQuantity({
        generatedListId: ids.basket,
        lineId: line.id,
        participantId: PARTICIPANT,
        sourceListId: listId,
        // No zone line named: neither list holds one, so both are created.
        quantity,
        from: 0,
      });
    }

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      claims = fakeLineClaims();
      const authz = new ZoneAuthzService(
        dataSource.getRepository(ZoneMembership)
      );
      const listAccess = new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        authz
      );
      const zoneLines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        claims.service,
        { emitToUsers: jest.fn(), emit: jest.fn() } as never,
        new CoreAuditService(dataSource)
      );
      const waiting = new WaitingSettlementService(claims.service, {
        emit: jest.fn(),
      } as never);
      const lineWrites = new GeneratedListLineService(
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOption),
        undefined as never,
        listAccess,
        zoneLines,
        claims.service,
        undefined as never,
        waiting,
        { emitToUsers: jest.fn(), emit: jest.fn() } as never
      );

      // The two access questions, answered as they are for an owner who holds
      // WRITE everywhere. Faked because they read auth's tables rather than
      // core's, and the unit spec owns what happens when they say no.
      const sharing = {
        liveParticipantById: async () => ({
          id: PARTICIPANT,
          kind: ParticipantKind.OWNER,
          userId: ids.shopper,
        }),
        // Whoever is asked for is live on this basket, which is the answer the
        // settle needs and an access question the unit spec already owns.
        livePresenceEntry: async (participantId: string) => ({
          participantId,
          kind: ParticipantKind.GUEST,
          displayName: 'Dani',
          guestNumber: 1,
          userId: null,
        }),
        seesZoneData: async () => true,
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        writableIntersection: async () => [
          { listId: ids.flat, zoneId: ids.zone },
          { listId: ids.parents, zoneId: ids.zone },
        ],
      } as unknown as GeneratedListSharingService;
      const generated = {
        basketLineViewFor: async (line: GeneratedListLine) => ({ id: line.id }),
      } as unknown as GeneratedListService;

      origins = new GeneratedListOriginsService(
        dataSource,
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOrigin),
        dataSource.getRepository(ListLine),
        dataSource.getRepository(LineSettlement),
        dataSource.getRepository(ShoppingList),
        sharing,
        generated,
        lineWrites,
        claims.service,
        waiting,
        {
          emitToUsers: jest.fn(),
          emit: jest.fn(),
          emitToGeneratedList: jest.fn(),
        } as never
      );

      settles = new GeneratedListSettleService(
        dataSource,
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOrigin),
        dataSource.getRepository(GeneratedListLineOption),
        dataSource.getRepository(ShoppingList),
        sharing,
        generated,
        claims.service,
        {
          emitToUsers: jest.fn(),
          emit: jest.fn(),
          emitToGeneratedList: jest.fn(),
        } as never
      );

      const zone = await dataSource.getRepository(Zone).save(
        dataSource.getRepository(Zone).create({
          name: 'Flat',
          joinCode: `P92${Date.now()}`.slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: ids.shopper,
          config: {},
        })
      );
      ids.zone = zone.id;
      await dataSource.getRepository(ZoneMembership).save(
        dataSource.getRepository(ZoneMembership).create({
          zoneId: zone.id,
          userId: ids.shopper,
          username: 'Shopper',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
      for (const [key, name] of [
        ['flat', 'Flat'],
        ['parents', 'Parents'],
      ] as const) {
        const list = await dataSource.getRepository(ShoppingList).save(
          dataSource.getRepository(ShoppingList).create({
            zoneId: zone.id,
            name,
            createdByUserId: ids.shopper,
          })
        );
        ids[key] = list.id;
      }

      const basket = await dataSource.getRepository(GeneratedList).save(
        dataSource.getRepository(GeneratedList).create({
          ownerUserId: ids.shopper,
          name: 'Saturday',
          // Live, which is DRAFT as well as ACTIVE: nothing writes ACTIVE.
          status: GeneratedListStatus.DRAFT,
          generatedAt: new Date(),
          sourceSnapshot: {
            profileId: null,
            pricingProfileId: null,
            sources: [{ zoneId: zone.id, listId: ids.flat }],
          },
          defaultTargetListId: null,
          idempotencyKey: null,
        })
      );
      ids.basket = basket.id;
    });

    afterAll(async () => {
      if (ids.basket) {
        await dataSource
          .getRepository(GeneratedList)
          .delete({ id: ids.basket });
      }
      if (ids.zone) {
        await dataSource.getRepository(Zone).delete({ id: ids.zone });
      }
      await dataSource?.destroy();
    });

    beforeEach(async () => {
      for (const listId of [ids.flat, ids.parents]) {
        await dataSource.getRepository(ListLine).delete({ listId });
      }
      claims.announced.length = 0;
    });

    it('creates a line on each list raised, with a provenance row and a claim', async () => {
      const line = await seedBasketLine(
        `Batteries ${randomUUID().slice(0, 8)}`
      );

      await raise(line, ids.flat, 3);
      await raise(line, ids.parents, 2);

      const written = await dataSource
        .getRepository(GeneratedListLineOrigin)
        .find({
          where: { generatedListLineId: line.id },
          order: { createdAt: 'ASC' },
        });
      expect(written.map((row) => row.listId)).toEqual([ids.flat, ids.parents]);
      expect(written.map((row) => row.quantity)).toEqual([3, 2]);

      // Two zone lines, each asking for what that household asked for.
      const zoneLines = await dataSource.getRepository(ListLine).find({
        where: written.map((row) => ({ id: row.lineId })),
      });
      expect(zoneLines.map((row) => [row.listId, row.quantity]).sort()).toEqual(
        [
          [ids.flat, 3],
          [ids.parents, 2],
        ].sort()
      );

      // One claim per list, named as the basket's owner (plan 0052, section 2).
      expect(claims.announced.map((row) => row.listId)).toEqual([
        ids.flat,
        ids.parents,
      ]);
      expect(claims.announced.every((row) => row.claimed)).toBe(true);
      expect(
        claims.announced.every((row) => row.claimedByUserId === ids.shopper)
      ).toBe(true);

      // The basket buys all of it: one typed, then three and two asked for.
      const basketLine = await dataSource
        .getRepository(GeneratedListLine)
        .findOneByOrFail({ id: line.id });
      expect(basketLine.quantity).toBe(6);
      // Written on the first list it reached and never again (section 2).
      expect(basketLine.targetListId).toBe(ids.flat);
    });

    it('lands on the line a list already holds rather than creating a second', async () => {
      // Plan 0091's merge, reached through the ordinary add: the household typed
      // the name themselves before the shopper raised their row.
      const content = `Milk ${randomUUID().slice(0, 8)}`;
      const existing = await dataSource.getRepository(ListLine).save(
        dataSource.getRepository(ListLine).create({
          listId: ids.parents,
          content: content.toUpperCase(),
          quantity: 1,
          itemSetHash: null,
          position: 1,
          approvalStatus: LineApprovalStatus.APPROVED,
          createdByUserId: ids.shopper,
          approvedByUserId: ids.shopper,
          version: 1,
        })
      );
      const line = await seedBasketLine(content);

      await raise(line, ids.parents, 2);

      const rows = await dataSource
        .getRepository(ListLine)
        .find({ where: { listId: ids.parents } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(existing.id);
      expect(rows[0].quantity).toBe(3);

      const [origin] = await dataSource
        .getRepository(GeneratedListLineOrigin)
        .find({ where: { generatedListLineId: line.id } });
      // The provenance row names the line it landed on, with what this basket
      // added rather than that line's total.
      expect(origin.lineId).toBe(existing.id);
      expect(origin.quantity).toBe(2);
    });

    it('refuses a line another basket is carrying, and takes it once that basket has bought it', async () => {
      // The two predicates plan 0092 had to copy from `LINE_CLAIMS_SQL` when it
      // turned this check on. Without them a line bought all the way through, in
      // a basket somebody left open, reads as carried here and as claimed by
      // nobody there: one screen says the milk is free and the next refuses to
      // put it in a basket.
      const content = `Rice ${randomUUID().slice(0, 8)}`;
      const zoneLine = await dataSource.getRepository(ListLine).save(
        dataSource.getRepository(ListLine).create({
          listId: ids.parents,
          content,
          quantity: 2,
          itemSetHash: null,
          position: 1,
          approvalStatus: LineApprovalStatus.APPROVED,
          createdByUserId: ids.shopper,
          approvedByUserId: ids.shopper,
          version: 1,
        })
      );
      const other = await dataSource.getRepository(GeneratedList).save(
        dataSource.getRepository(GeneratedList).create({
          ownerUserId: ids.shopper,
          name: 'Thursday',
          status: GeneratedListStatus.DRAFT,
          generatedAt: new Date(),
          sourceSnapshot: {
            profileId: null,
            pricingProfileId: null,
            sources: [],
          },
          defaultTargetListId: null,
          idempotencyKey: null,
        })
      );
      const otherLine = await dataSource.getRepository(GeneratedListLine).save(
        dataSource.getRepository(GeneratedListLine).create({
          generatedListId: other.id,
          content,
          quantity: 2,
          settledQuantity: 0,
          itemId: null,
          origin: GeneratedLineOrigin.DERIVED,
          targetListId: null,
          position: 1,
        })
      );
      await dataSource.getRepository(GeneratedListLineOrigin).save(
        dataSource.getRepository(GeneratedListLineOrigin).create({
          generatedListLineId: otherLine.id,
          zoneId: ids.zone,
          listId: ids.parents,
          lineId: zoneLine.id,
          quantity: 2,
          lineVersion: zoneLine.version,
        })
      );

      const line = await seedBasketLine(content);
      const adopt = () =>
        origins.setOriginQuantity({
          generatedListId: ids.basket,
          lineId: line.id,
          participantId: PARTICIPANT,
          sourceListId: ids.parents,
          sourceLineId: zoneLine.id,
          quantity: 2,
          from: 0,
        });

      await expect(adopt()).rejects.toMatchObject({
        code: 'validation_failed',
      });

      // The other basket bought all of it, so it is done with the line and
      // releases it, exactly as the claim says it does.
      await dataSource
        .getRepository(GeneratedListLine)
        .update({ id: otherLine.id }, { settledQuantity: 2 });

      await adopt();
      const written = await dataSource
        .getRepository(GeneratedListLineOrigin)
        .find({ where: { generatedListLineId: line.id } });
      expect(written).toHaveLength(1);

      await dataSource.getRepository(GeneratedList).delete({ id: other.id });
    });

    it('refuses a second raise onto a list this basket has already reached', async () => {
      const line = await seedBasketLine(`Bread ${randomUUID().slice(0, 8)}`);
      await raise(line, ids.flat, 2);

      await expect(raise(line, ids.flat, 1)).rejects.toMatchObject({
        code: 'stale_quantity',
      });
      const rows = await dataSource
        .getRepository(ListLine)
        .find({ where: { listId: ids.flat } });
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(2);
    });

    describe('a purchase made before the line reached a list (plan 0093)', () => {
      /** A guest in the shop, who has no account and no access to any list. */
      const GUEST = randomUUID();

      /** Buy some of a basket line, whatever it is currently bound to. */
      function settle(line: GeneratedListLine, quantity: number) {
        return settles.settle({
          generatedListId: ids.basket,
          lineId: line.id,
          participantId: GUEST,
          outcome: SettlementOutcome.BOUGHT,
          quantity,
        });
      }

      it('is recorded when it happens and lands on the first list raised', async () => {
        // The whole plan in one pass, through real Postgres and its two new
        // check constraints. A guest types a line in the aisle, buys four before
        // anybody has said whose they are, and the owner sends the line to the
        // flat's list at home. The flat's line then reads bought, because it
        // was.
        const line = await seedBasketLine(
          `Batteries ${randomUUID().slice(0, 8)}`
        );
        await dataSource
          .getRepository(GeneratedListLine)
          .update({ id: line.id }, { quantity: 4 });
        line.quantity = 4;

        await settle(line, 4);

        // Written, dated, attributed and named by product, and belonging to no
        // list: this is the row plan 0058 section 4.1 refused to write.
        const settlements = dataSource.getRepository(LineSettlement);
        const waiting = await settlements.find({
          where: { generatedListLineId: line.id },
        });
        expect(waiting).toHaveLength(1);
        expect(waiting[0]).toMatchObject({
          lineId: null,
          listId: null,
          quantity: 4,
          settledByParticipantId: GUEST,
          settledByUserId: null,
        });

        await raise(line, ids.flat, 4);

        // One settlement, home, attributed to the guest who made it.
        const home = await settlements.find({
          where: { generatedListLineId: line.id },
        });
        expect(home).toHaveLength(1);
        expect(home[0]).toMatchObject({
          listId: ids.flat,
          quantity: 4,
          settledByParticipantId: GUEST,
        });
        expect(home[0].lineId).not.toBeNull();
        expect(home[0].settledAt).toEqual(waiting[0].settledAt);

        // And the household's line: asked for four, receives four, lands at zero
        // with the bought indicator set (plan 0047, section 5).
        const zoneLine = await dataSource
          .getRepository(ListLine)
          .findOneByOrFail({ id: home[0].lineId as string });
        expect(zoneLine.listId).toBe(ids.flat);
        expect(zoneLine.quantity).toBe(0);
      });

      it('splits across two lists, oldest purchase first', async () => {
        // Four bought, a list asking for three, then a second asking for two:
        // three come home to the first, one to the second, and the second still
        // asks for one.
        const line = await seedBasketLine(`Milk ${randomUUID().slice(0, 8)}`);
        await dataSource
          .getRepository(GeneratedListLine)
          .update({ id: line.id }, { quantity: 4 });
        line.quantity = 4;

        await settle(line, 4);
        await raise(line, ids.flat, 3);
        await raise(line, ids.parents, 2);

        const settlements = dataSource.getRepository(LineSettlement);
        const rows = await settlements.find({
          where: { generatedListLineId: line.id },
          order: { quantity: 'DESC' },
        });
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => [row.listId, row.quantity])).toEqual([
          [ids.flat, 3],
          [ids.parents, 1],
        ]);
        // Both halves keep the moment the purchase was made.
        expect(rows[1].settledAt).toEqual(rows[0].settledAt);

        const lines = dataSource.getRepository(ListLine);
        const flat = await lines.findOneByOrFail({
          id: rows[0].lineId as string,
        });
        const parents = await lines.findOneByOrFail({
          id: rows[1].lineId as string,
        });
        expect(flat.quantity).toBe(0);
        expect(parents.quantity).toBe(1);
      });
    });
  }
);
