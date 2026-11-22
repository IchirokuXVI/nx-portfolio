import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  LineChangeKind,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
  type BuyForListBasketRequest,
  type ItemSnapshot,
  type SettlementPaid,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketLineAlreadyInRowException,
  BasketProductHasNoNameException,
  BasketRowHasNoProductException,
} from '@portfolio/luna-shopper/platform';
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
import {
  WRITABLE_AMONG_SQL,
  type WritableAmongRow,
} from './basket-sharing.sql';
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
  let readService: BasketReadService;

  const announcer = fakeBasketAnnouncer();
  const emitted: string[] = [];
  /** The version each event carried, by event, in emission order. */
  const versions: { event: string; version: number | undefined }[] = [];
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
      // The statement the sharing service asks, so a grant of READ alone is
      // what refuses spec 5, as in the service.
      writableAmong: async (userId: string, listIds: readonly string[]) =>
        new Set(
          (
            await dataSource.query<WritableAmongRow[]>(WRITABLE_AMONG_SQL, [
              userId,
              [...listIds],
            ])
          ).map((row) => row.listId)
        ),
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
    readService = read;
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
      emit: (
        event: string,
        _zoneId: string,
        payload: { version?: number; line?: { version?: number } }
      ) => {
        emitted.push(event);
        versions.push({
          event,
          version: payload?.line?.version ?? payload?.version,
        });
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
    versions.length = 0;
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
    itemIds: readonly string[] = [MILK],
    content = 'Whole milk',
    named = false
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        named,
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
      // Typed by the household of the first list, so a line made on the
      // second must never carry it (plan 0273, amended on 2026-11-22).
      milk: await line(asking.id, userId, 2, [MILK], 'Our usual milk', true),
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
    // The buy bumps the line's version as a settle does, so the event after
    // it carries a newer one than the line was born with.
    expect(made[0].version).toBe(2);
    expect(versions).toEqual([
      { event: 'line.added', version: 1 },
      { event: 'line.settled', version: 2 },
    ]);
    expect(result.entries.map((entry) => entry.lineId).sort()).toEqual(
      [w.milk.id, made[0].id].sort()
    );
  });

  it('names the new line by the product, never by the row line’s typed text (spec 8)', async () => {
    const w = await world();

    await buy(w, { content: 'Leche entera' });

    const [made] = await linesOf(w.other);
    expect(made).toMatchObject({
      content: 'Leche entera',
      named: false,
      quantity: 0,
    });
    expect(made.content).not.toBe(w.milk.content);
  });

  it('answers basket_product_has_no_name and writes nothing when no name is known (spec 8)', async () => {
    const w = await world();

    await expect(
      buy(w, { content: undefined, itemSnapshot: null })
    ).rejects.toBeInstanceOf(BasketProductHasNoNameException);
    expect(await linesOf(w.other)).toHaveLength(0);
    expect(await settlementsOnList(w.other)).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('answers basket_row_has_no_product for a row of free text and writes nothing (spec 8)', async () => {
    const w = await world();
    const free = await line(w.asking, w.userId, 1, [], 'Bread', true);

    await expect(buy(w, { rowKey: free.id })).rejects.toBeInstanceOf(
      BasketRowHasNoProductException
    );
    expect(await linesOf(w.other)).toHaveLength(0);
    expect(await settlementsOnList(w.other)).toBe(0);
  });

  it('refuses a list the actor may only read with 403 and writes nothing (spec 5)', async () => {
    const w = await world();
    // A member whose grant on the second list is READ alone.
    const reader = randomUUID();
    const { zoneId } = await dataSource
      .getRepository(ShoppingList)
      .findOneByOrFail({ id: w.other });
    const membership = await dataSource.getRepository(ZoneMembership).save({
      zoneId,
      userId: reader,
      username: 'Reader',
      role: ZoneRole.MEMBER,
      status: MembershipStatus.APPROVED,
    });
    await dataSource.getRepository(ListAccess).save({
      listId: w.other,
      membershipId: membership.id,
      permissions: [ListPermission.READ],
    });
    const shopper = await participant(
      w.basket,
      ParticipantKind.REGISTERED,
      reader
    );

    await expect(
      buy(w, { participantId: shopper, userId: reader })
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await linesOf(w.other)).toHaveLength(0);
    expect(await settlementsOnList(w.other)).toBe(0);
  });

  it('records the buy on the lineId given and makes no line (spec 2)', async () => {
    const w = await world();
    const kept = await line(w.other, w.userId, 0);

    await buy(w, { lineId: kept.id });

    expect((await linesOf(w.other)).map((row) => row.id)).toEqual([kept.id]);
    // A found line at 0 is bumped as a settle bumps one.
    expect(
      (
        await dataSource
          .getRepository(ListLine)
          .findOneByOrFail({ id: kept.id })
      ).version
    ).toBe(kept.version + 1);
    expect(versions).toEqual([
      { event: 'line.settled', version: kept.version + 1 },
    ]);
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

  it('makes an entry asking 0 that settles and reverts by its line (spec 7)', async () => {
    const w = await world();

    /** The row that holds this line, as the basket read serves it. */
    const rowOf = async (lineId: string) => {
      const view = await readService.read({
        basketId: w.basket.id,
        participantId: w.participantId,
      });
      const row = view.rows.find((candidate) =>
        candidate.entries.some((entry) => entry.lineId === lineId)
      );
      if (!row) {
        throw new Error(`no row holds ${lineId}`);
      }
      return row;
    };
    /**
     * The entry's ask, as the read counts it (plan 0274, section 3): its
     * `left` plus the units of its standing buys that met the ask.
     */
    const askedOf = async (lineId: string) => {
      const row = await rowOf(lineId);
      const entry = row.entries.find((one) => one.lineId === lineId);
      const applied = (await standingOf(lineId)).reduce(
        (sum, settlement) => sum + settlement.applied,
        0
      );
      return (entry?.left ?? Number.NaN) + applied;
    };

    await buy(w);
    const [made] = await linesOf(w.other);

    // The buy met no ask: the line asked for nothing (plan 0273, section 1).
    expect((await standingOf(made.id)).map((row) => row.applied)).toEqual([0]);
    const afterBuy = await rowOf(made.id);
    expect(
      afterBuy.entries.find((one) => one.lineId === made.id)
    ).toMatchObject({ left: 0, bought: 2 });
    expect(await askedOf(made.id)).toBe(0);
    // The row asks for the first list's 2 alone: the new entry adds nothing.
    expect(afterBuy).toMatchObject({ asked: w.milk.quantity, bought: 2 });

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
    expect(await askedOf(made.id)).toBe(0);

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
      // The revert gives back only units that met an ask (plan 0274, section
      // 4), and none did, so the list still asks for nothing.
      left: 0,
    });
    expect(
      (await standingOf(made.id)).reduce((sum, row) => sum + row.quantity, 0)
    ).toBe(2);
    expect(await askedOf(made.id)).toBe(0);
    expect(await rowOf(made.id)).toMatchObject({
      asked: w.milk.quantity,
      bought: 2,
    });
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
