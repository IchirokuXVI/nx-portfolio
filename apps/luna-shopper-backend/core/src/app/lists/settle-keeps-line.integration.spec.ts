import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
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
import { DataSource, IsNull } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { BasketAnnouncer } from '../baskets/basket-announcer.service';
import { fakeCoreConfig } from '../baskets/basket-config.fake';
import { BasketCoverageService } from '../baskets/basket-coverage.service';
import { BasketDemandService } from '../baskets/basket-demand.service';
import { BasketPatchReader } from '../baskets/basket-patch.reader';
import { BasketReadService } from '../baskets/basket-read.service';
import { BasketRowResolver } from '../baskets/basket-row-resolver';
import { BasketSettleService } from '../baskets/basket-settle.service';
import { BasketWriteContext } from '../baskets/basket-write.context';
import { fakeBasketMarks } from '../baskets/changes/basket-marks.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import {
  Basket,
  BasketParticipant,
  BasketSource,
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
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { LineChangeRecorder } from './changes/line-change.recorder';
import { LineMergeService } from './line-merge.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { SettlementService } from './settlement.service';

/** A product a card added; catalog ids are opaque to core. */
const OAT = '5b7f1c2e-9a4d-4e63-8b10-2c7d9e4a6f31';

/**
 * No write deletes a line because it reached 0, against real Postgres. Plan
 * 0263 proposed that rule and the owner withdrew it on 2026-11-12: a line is
 * deleted only by hand, from its sheet or its page.
 *
 * Both settles save the lowered line BEFORE they insert the buy, so a rule on
 * any save of a line at 0 would leave the buy on a deleted row. The line here
 * is as bare as a line gets, a product from a card with no name, chain,
 * favourite, comment or buy. The delta and the basket demand that take it to 0
 * leave it standing too.
 */
describeIntegration('a settle keeps the line it lowers (real Postgres)', () => {
  let dataSource: DataSource;
  let settlements: SettlementService;
  let basketSettle: BasketSettleService;
  let lines: LineService;
  let demand: BasketDemandService;

  const ids = { zone: '', list: '', owner: randomUUID() };
  let position = 0;

  const emitted: { event: string; payload: unknown }[] = [];
  const events = {
    emit: (event: string, _zoneId: string, payload: unknown) =>
      emitted.push({ event, payload }),
    emitTo: (event: string, _audience: unknown, payload: unknown) =>
      emitted.push({ event, payload }),
    emitToUsers: (event: string, _users: string[], payload: unknown) =>
      emitted.push({ event, payload }),
  };

  const claims = {
    claimsOf: async () => new Map(),
    claimOf: async () => ({ claimed: false, claimedByUserId: null }),
    announceReleased: async () => undefined,
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(dataSource.getRepository(ZoneMembership))
    );
    const baskets = dataSource.getRepository(Basket);
    const coverage = new BasketCoverageService(baskets);
    const announcer = new BasketAnnouncer(
      coverage,
      events as unknown as CoreEventsPublisher,
      new BasketPatchReader(baskets, fakeCoreConfig())
    );

    settlements = new SettlementService(
      dataSource,
      dataSource.getRepository(LineSettlement),
      listAccess,
      fakeLineClaims().service,
      events as never,
      announcer,
      new LineChangeRecorder()
    );

    const sharing = {
      writableAmong: async (_userId: string, listIds: readonly string[]) =>
        new Set(listIds),
      liveParticipantById: async (participantId: string) =>
        dataSource
          .getRepository(BasketParticipant)
          .findOne({ where: { id: participantId } }),
      listParticipants: async ({ basketId }: { basketId: string }) => ({
        participants: (
          await dataSource
            .getRepository(BasketParticipant)
            .find({ where: { basketId, revokedAt: IsNull() } })
        ).map((row) => ({
          id: row.id,
          kind: row.kind,
          displayName: row.displayName,
          username: row.username,
          guestNumber: row.guestNumber,
          userId: row.userId,
          shareLinkId: row.shareLinkId,
        })),
      }),
    } as never;
    const allPermissions = {
      permissionsAmong: async (_userId: string, listIds: readonly string[]) =>
        new Map(
          listIds.map((listId) => [
            listId,
            new Set([
              ListPermission.READ,
              ListPermission.WRITE,
              ListPermission.DECIDE,
              ListPermission.MANAGE,
            ]),
          ])
        ),
    } as never;
    const read = new BasketReadService(
      baskets,
      coverage,
      sharing,
      allPermissions,
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      fakeBasketMarks(),
      fakeCoreConfig()
    );
    const context = new BasketWriteContext(
      baskets,
      coverage,
      sharing,
      new BasketRowResolver(baskets, fakeCoreConfig()),
      read,
      announcer
    );
    basketSettle = new BasketSettleService(
      dataSource,
      baskets,
      context,
      claims as never,
      events as never,
      new LineChangeRecorder()
    );

    lines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ListLineGroupRemoval),
      dataSource.getRepository(LineSettlement),
      listAccess,
      fakeLineClaims().service,
      events as never,
      new CoreAuditService(dataSource),
      new LineMergeService(new LineChangeRecorder()),
      new LineChangeRecorder(),
      announcer
    );
    demand = new BasketDemandService(
      context,
      lines,
      listAccess,
      events as never
    );

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Settle keeps',
        joinCode: `SK${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    ids.zone = zone.id;
    await dataSource.getRepository(ZoneMembership).save(
      dataSource.getRepository(ZoneMembership).create({
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

  beforeEach(() => {
    emitted.length = 0;
  });

  afterAll(async () => {
    if (ids.zone) {
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  /** A product line from a card: not named, no chain, no favourite. */
  async function bareLine(
    quantity: number,
    unit: 'UNIT' | 'GRAM' = 'UNIT'
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId: ids.list,
        content: 'Oat drink',
        quantity,
        unit,
        position,
        named: false,
        itemSetHash: OAT,
        favoriteItemId: null,
        preferredSupermarketId: null,
        createdByUserId: ids.owner,
        approvalStatus: LineApprovalStatus.APPROVED,
      })
    );
    await dataSource
      .getRepository(ListLineItem)
      .save(
        dataSource
          .getRepository(ListLineItem)
          .create({ lineId: saved.id, itemId: OAT, position: 0 })
      );
    return saved;
  }

  async function basketOver(): Promise<{
    basketId: string;
    participantId: string;
  }> {
    const repo = dataSource.getRepository(Basket);
    const basket = await repo.save(
      repo.create({
        ownerUserId: ids.owner,
        kind: BasketKind.GENERATED,
        name: 'Saturday',
        status: BasketStatus.OPEN,
        generatedAt: new Date(),
        idempotencyKey: null,
      })
    );
    await dataSource.getRepository(BasketSource).save(
      dataSource.getRepository(BasketSource).create({
        basketId: basket.id,
        zoneId: ids.zone,
        listId: ids.list,
      })
    );
    const participant = await dataSource.getRepository(BasketParticipant).save(
      dataSource.getRepository(BasketParticipant).create({
        basketId: basket.id,
        shareLinkId: null,
        kind: ParticipantKind.OWNER,
        userId: ids.owner,
        displayName: null,
        username: 'Owner',
        guestNumber: null,
        sessionSecretHash: null,
        userAgent: null,
        joinedAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
      })
    );
    return { basketId: basket.id, participantId: participant.id };
  }

  /** The row as it stands, deleted or not. */
  const rowOf = (id: string) =>
    dataSource
      .getRepository(ListLine)
      .findOneOrFail({ where: { id }, withDeleted: true });
  const buysOf = (lineId: string) =>
    dataSource.getRepository(LineSettlement).find({ where: { lineId } });
  const deletions = () =>
    emitted.filter((entry) => entry.event === RealtimeEvent.LineDeleted);

  describe('the list page settle (item 1)', () => {
    it.each([1, 3])(
      'BOUGHT %i of a bare line at 1 leaves it at 0, standing, with its buy',
      async (bought) => {
        const line = await bareLine(1);

        const { line: view } = await settlements.settle({
          userId: ids.owner,
          lineId: line.id,
          outcome: SettlementOutcome.BOUGHT,
          unit: 'UNIT',
          quantity: bought,
        });

        const row = await rowOf(line.id);
        expect(row.quantity).toBe(0);
        expect(row.deletedAt).toBeNull();
        expect(await buysOf(line.id)).toHaveLength(1);
        expect(view.boughtCount).toBe(1);
        expect(deletions()).toEqual([]);
      }
    );
  });

  describe('the basket settle (item 2)', () => {
    it.each([1, 3])(
      'BOUGHT %i of a bare line at 1 leaves it at 0, standing, with its buy',
      async (bought) => {
        const line = await bareLine(1);
        const { basketId, participantId } = await basketOver();

        await basketSettle.settle({
          basketId,
          participantId,
          rowKey: line.id,
          lineIds: [line.id],
          outcome: SettlementOutcome.BOUGHT,
          unit: 'UNIT',
          quantity: bought,
          from: 1,
        });

        const row = await rowOf(line.id);
        expect(row.quantity).toBe(0);
        expect(row.deletedAt).toBeNull();
        const buys = await buysOf(line.id);
        expect(buys).toHaveLength(1);
        expect(buys[0]).toMatchObject({
          outcome: SettlementOutcome.BOUGHT,
          quantity: bought,
          basketId,
        });
        expect(deletions()).toEqual([]);
      }
    );
  });

  describe('a write that takes the line to 0', () => {
    it('the delta leaves a bare line from 25 g at 0, standing', async () => {
      const line = await bareLine(25, 'GRAM');

      const answer = await lines.addQuantity({
        userId: ids.owner,
        lineId: line.id,
        delta: -25,
        unit: 'GRAM',
      });

      expect(answer).toMatchObject({
        id: line.id,
        quantity: 0,
        itemIds: [OAT],
      });
      expect(answer).not.toHaveProperty('deleted');
      const row = await rowOf(line.id);
      expect(row.quantity).toBe(0);
      expect(row.deletedAt).toBeNull();
      expect(
        await dataSource
          .getRepository(ListLineItem)
          .count({ where: { lineId: line.id } })
      ).toBe(1);
      expect(deletions()).toEqual([]);
    });

    it('a basket demand of 0 leaves a bare line at 0, standing', async () => {
      const line = await bareLine(1);
      const { basketId, participantId } = await basketOver();

      await demand.setDemand({
        basketId,
        participantId,
        rowKey: line.id,
        lineId: line.id,
        quantity: 0,
        unit: 'UNIT',
        from: 1,
      });

      const row = await rowOf(line.id);
      expect(row.quantity).toBe(0);
      expect(row.deletedAt).toBeNull();
      expect(deletions()).toEqual([]);
    });
  });
});
