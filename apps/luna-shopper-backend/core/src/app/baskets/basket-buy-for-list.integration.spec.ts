import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  LineChangeKind,
  MembershipStatus,
  ParticipantKind,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
  type BuyForListBasketRequest,
  type ItemSnapshot,
  type SettlementPaid,
} from '@portfolio/luna-shopper/contracts';
import { BasketLineAlreadyInRowException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import {
  Basket,
  BasketParticipant,
  BasketSource,
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineChange,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { itemSetHash } from '../lists/item-set-hash';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeBasketAnnouncer } from './basket-announcer.fake';
import { BasketBuyForListService } from './basket-buy-for-list.service';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketWriteContext } from './basket-write.context';
import { BasketMarksReader } from './changes/basket-marks.reader';

/**
 * A buy for a list that did not ask makes its line in the same write (plan
 * 0273, section 1).
 *
 * Against Postgres, because the rule under test is a transaction: a line and a
 * settlement written together or not at all, under the list lock, and a line
 * the read then draws. A fake manager can only agree with itself about that.
 *
 * One zone with two lists, a basket that covers both, and milk asked for on
 * the first. The buys are for the second.
 */
describeIntegration('a buy for a list that did not ask (real Postgres)', () => {
  let dataSource: DataSource;
  let service: BasketBuyForListService;
  let settleService: BasketSettleService;
  let revertService: BasketRevertService;

  const announcer = fakeBasketAnnouncer();
  const emitted: string[] = [];
  const zoneIds: string[] = [];
  let position = 0;

  const MILK = randomUUID();
  const SCOPE = randomUUID();
  const SHOP = randomUUID();
  const CHAIN = randomUUID();
  const MILK_NAME: ItemSnapshot = {
    name: { en: 'Whole milk', es: 'Leche entera' },
    brand: 'Hacendado',
    unitSize: 1,
    packCount: null,
    defaultUnit: 'LITER' as ItemSnapshot['defaultUnit'],
    approxWeight: null,
  };
  const AT_SHOP: SettlementPaid = {
    priceScopeId: SCOPE,
    supermarketLocationId: SHOP,
    supermarketId: CHAIN,
    pricePaidCents: 95,
    pricePaidCurrency: 'EUR',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const baskets = dataSource.getRepository(Basket);
    const coverage = new BasketCoverageService(baskets);
    const resolver = new BasketRowResolver(baskets, fakeCoreConfig());
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
    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(dataSource.getRepository(ZoneMembership))
    );
    const read = new BasketReadService(
      baskets,
      coverage,
      sharing,
      listAccess,
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      new BasketMarksReader(
        dataSource.getRepository(ListLineChange),
        fakeCoreConfig()
      ),
      fakeCoreConfig()
    );
    const context = new BasketWriteContext(
      baskets,
      coverage,
      sharing,
      resolver,
      read,
      announcer
    );
    const claims = {
      claimsOf: async () => new Map(),
      claimOf: async () => ({ claimed: false, claimedByUserId: null }),
      announceReleased: async () => undefined,
    } as never;
    const events = {
      emit: (event: string) => {
        emitted.push(event);
      },
      emitTo: () => undefined,
    } as never;
    const lines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ListLineGroupRemoval),
      dataSource.getRepository(LineSettlement),
      listAccess,
      claims,
      events,
      new CoreAuditService(dataSource),
      new LineMergeService(new LineChangeRecorder()),
      new LineChangeRecorder(),
      announcer
    );
    service = new BasketBuyForListService(
      dataSource,
      baskets,
      context,
      lines,
      claims,
      events,
      new LineChangeRecorder()
    );
    settleService = new BasketSettleService(
      dataSource,
      baskets,
      context,
      claims,
      events,
      new LineChangeRecorder()
    );
    revertService = new BasketRevertService(
      dataSource,
      context,
      claims,
      events,
      new LineChangeRecorder()
    );
  });

  afterAll(async () => {
    const zones = dataSource.getRepository(Zone);
    for (const zoneId of zoneIds) {
      await zones.delete({ id: zoneId });
    }
    await dataSource?.destroy();
  });

  beforeEach(() => {
    announcer.reset();
    emitted.length = 0;
    jest.restoreAllMocks();
  });

  // --- fixtures ----------------------------------------------------------

  interface World {
    userId: string;
    asking: string;
    other: string;
    basket: Basket;
    participantId: string;
    milk: ListLine;
  }

  async function line(
    listId: string,
    createdByUserId: string,
    quantity: number,
    itemIds: readonly string[] = [MILK]
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content: 'Whole milk',
        named: false,
        quantity,
        position,
        createdByUserId,
        approvalStatus: LineApprovalStatus.APPROVED,
        itemSetHash: itemSetHash([...itemIds]),
      })
    );
    const items = dataSource.getRepository(ListLineItem);
    for (const [index, itemId] of itemIds.entries()) {
      await items.save(
        items.create({ lineId: saved.id, itemId, position: index })
      );
    }
    return saved;
  }

  async function participant(
    basket: Basket,
    kind: ParticipantKind,
    userId: string | null
  ): Promise<string> {
    const participants = dataSource.getRepository(BasketParticipant);
    const guest = kind === ParticipantKind.GUEST;
    const saved = await participants.save(
      participants.create({
        basketId: basket.id,
        shareLinkId: null,
        kind,
        userId,
        displayName: guest ? 'Marta' : null,
        username: guest ? null : 'Shopper',
        guestNumber: guest ? 1 : null,
        sessionSecretHash: guest ? randomUUID() : null,
        userAgent: null,
        joinedAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        expiresAt:
          kind === ParticipantKind.OWNER
            ? null
            : new Date(Date.now() + 12 * 60 * 60 * 1000),
      })
    );
    return saved.id;
  }

  /** Two lists of one zone, one asking for milk, and a basket over both. */
  async function world(): Promise<World> {
    const userId = randomUUID();
    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Buy for a list',
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: userId,
        config: {},
      })
    );
    zoneIds.push(zone.id);
    await dataSource.getRepository(ZoneMembership).save({
      zoneId: zone.id,
      userId,
      username: 'Ana',
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    });
    const lists = dataSource.getRepository(ShoppingList);
    const asking = await lists.save(
      lists.create({ zoneId: zone.id, name: 'Home', createdByUserId: userId })
    );
    const other = await lists.save(
      lists.create({
        zoneId: zone.id,
        name: 'Grandma',
        createdByUserId: userId,
      })
    );
    const repo = dataSource.getRepository(Basket);
    const basket = await repo.save(
      repo.create({
        ownerUserId: userId,
        kind: BasketKind.GENERATED,
        name: 'Saturday',
        status: BasketStatus.OPEN,
        generatedAt: new Date(),
        idempotencyKey: null,
      })
    );
    const sources = dataSource.getRepository(BasketSource);
    for (const listId of [asking.id, other.id]) {
      await sources.save(
        sources.create({ basketId: basket.id, zoneId: zone.id, listId })
      );
    }
    return {
      userId,
      asking: asking.id,
      other: other.id,
      basket,
      participantId: await participant(basket, ParticipantKind.OWNER, userId),
      milk: await line(asking.id, userId, 2),
    };
  }

  const buy = (
    w: World,
    extra: Partial<BuyForListBasketRequest> = {}
  ): ReturnType<BasketBuyForListService['buyForList']> =>
    service.buyForList({
      basketId: w.basket.id,
      participantId: w.participantId,
      userId: w.userId,
      rowKey: w.milk.id,
      targetListId: w.other,
      quantity: 2,
      unit: 'UNIT',
      itemId: MILK,
      content: 'Whole milk',
      paid: AT_SHOP,
      itemSnapshot: MILK_NAME,
      ...extra,
    });

  const linesOf = (listId: string) =>
    dataSource.getRepository(ListLine).find({ where: { listId } });
  const standingOf = (lineId: string) =>
    dataSource
      .getRepository(LineSettlement)
      .find({ where: { lineId, revertedAt: IsNull() } });
  const settlementsOnList = (listId: string) =>
    dataSource.getRepository(LineSettlement).count({ where: { listId } });

  // --- the specs ---------------------------------------------------------

  it('makes one line at 0 and one BOUGHT settlement in this basket (spec 1)', async () => {
    const w = await world();

    const result = await buy(w);

    const made = await linesOf(w.other);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      quantity: 0,
      unit: 'UNIT',
      named: false,
      content: 'Whole milk',
      itemSetHash: itemSetHash([MILK]),
    });
    const items = await dataSource
      .getRepository(ListLineItem)
      .find({ where: { lineId: made[0].id } });
    expect(items.map((item) => item.itemId)).toEqual([MILK]);

    const bought = await standingOf(made[0].id);
    expect(bought).toHaveLength(1);
    expect(bought[0]).toMatchObject({
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
      unit: 'UNIT',
      itemId: MILK,
      basketId: w.basket.id,
      listId: w.other,
      settledByParticipantId: w.participantId,
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
      supermarketId: CHAIN,
      pricePaidCents: 95,
      pricePaidCurrency: 'EUR',
      itemSnapshot: MILK_NAME,
    });

    // The line's own change row, as any added line gets, and no buy row:
    // the line asked for nothing before and after.
    const changes = await dataSource
      .getRepository(ListLineChange)
      .find({ where: { lineId: made[0].id } });
    expect(changes.map((change) => change.kind)).toEqual([
      LineChangeKind.ADDED,
    ]);
    expect(emitted).toEqual(['line.added', 'line.settled']);
    expect(result.entries.map((entry) => entry.lineId).sort()).toEqual(
      [w.milk.id, made[0].id].sort()
    );
  });

  it('names the line after the row’s own line when catalog gave no name', async () => {
    const w = await world();

    await buy(w, { content: undefined, itemSnapshot: null });

    const [made] = await linesOf(w.other);
    expect(made).toMatchObject({ content: 'Whole milk', quantity: 0 });
  });

  it('records the buy on the lineId given and makes no line (spec 2)', async () => {
    const w = await world();
    const kept = await line(w.other, w.userId, 0);

    await buy(w, { lineId: kept.id });

    expect((await linesOf(w.other)).map((row) => row.id)).toEqual([kept.id]);
    const bought = await standingOf(kept.id);
    expect(bought.map((row) => row.quantity)).toEqual([2]);
    expect(
      (
        await dataSource
          .getRepository(ListLine)
          .findOneByOrFail({ id: kept.id })
      ).quantity
    ).toBe(0);
    expect(emitted).toEqual(['line.settled']);
  });

  it('uses the list’s line of the product at 0 when no lineId is given', async () => {
    const w = await world();
    const kept = await line(w.other, w.userId, 0);

    await buy(w);

    expect((await linesOf(w.other)).map((row) => row.id)).toEqual([kept.id]);
    expect((await standingOf(kept.id)).map((row) => row.quantity)).toEqual([2]);
  });

  it('answers basket_line_already_in_row for a line that is an entry (spec 3)', async () => {
    const w = await world();

    await expect(
      buy(w, { targetListId: w.asking, lineId: w.milk.id })
    ).rejects.toBeInstanceOf(BasketLineAlreadyInRowException);
    // The same answer when the list's line of the product is the entry.
    await expect(buy(w, { targetListId: w.asking })).rejects.toBeInstanceOf(
      BasketLineAlreadyInRowException
    );
    expect(await settlementsOnList(w.asking)).toBe(0);
  });

  it('refuses a guest and writes nothing (spec 4)', async () => {
    const w = await world();
    const guest = await participant(w.basket, ParticipantKind.GUEST, null);

    await expect(buy(w, { participantId: guest })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await linesOf(w.other)).toHaveLength(0);
    expect(await settlementsOnList(w.other)).toBe(0);
  });

  it('answers 404 for a list the basket does not cover (spec 5)', async () => {
    const w = await world();
    const elsewhere = await world();

    await expect(
      buy(w, { targetListId: elsewhere.other })
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await linesOf(elsewhere.other)).toHaveLength(0);
  });

  it('leaves no line and no settlement when the settlement insert fails (spec 6)', async () => {
    const w = await world();
    const original = dataSource.transaction.bind(dataSource) as (
      work: (manager: EntityManager) => Promise<unknown>
    ) => Promise<unknown>;
    jest
      .spyOn(dataSource, 'transaction')
      .mockImplementationOnce(((work: (m: EntityManager) => Promise<unknown>) =>
        original((manager) => work(failingSettlements(manager)))) as never);

    await expect(buy(w)).rejects.toThrow('forced settlement failure');

    expect(await linesOf(w.other)).toHaveLength(0);
    expect(await settlementsOnList(w.other)).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('makes an entry with left 0 that settles and reverts by its line (spec 7)', async () => {
    const w = await world();
    await buy(w);
    const [made] = await linesOf(w.other);

    const settled = await settleService.settle({
      basketId: w.basket.id,
      participantId: w.participantId,
      rowKey: made.id,
      lineIds: [made.id],
      outcome: SettlementOutcome.BOUGHT,
      unit: 'UNIT',
      quantity: 1,
      from: 0,
      itemId: MILK,
    });
    const entry = settled.entries.find((one) => one.lineId === made.id);
    expect(entry).toMatchObject({ left: 0, bought: 3 });

    const reverted = await revertService.revert({
      basketId: w.basket.id,
      participantId: w.participantId,
      rowKey: made.id,
      lineIds: [made.id],
      target: 'UNITS',
      units: 1,
      from: 3,
    });
    expect(
      reverted.entries.find((one) => one.lineId === made.id)
    ).toMatchObject({
      bought: 2,
      // The revert gives the units back to the line as it always does,
      // whether or not the buy lowered it (`basket-revert.service.ts`), so
      // the list asks for one again. Not this plan's to change.
      left: 1,
    });
    expect(
      (await standingOf(made.id)).reduce((sum, row) => sum + row.quantity, 0)
    ).toBe(2);
  });

  /** The caller's manager, whose settlement repository throws on save. */
  function failingSettlements(manager: EntityManager): EntityManager {
    return new Proxy(manager, {
      get(target, prop, receiver) {
        if (prop === 'getRepository') {
          return (entity: unknown) => {
            const repo = target.getRepository(entity as never);
            if (entity !== LineSettlement) {
              return repo;
            }
            return new Proxy(repo, {
              get(inner, key, innerReceiver) {
                if (key === 'save') {
                  return async () => {
                    throw new Error('forced settlement failure');
                  };
                }
                const value = Reflect.get(inner, key, innerReceiver);
                return typeof value === 'function' ? value.bind(inner) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
});
