import {
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  BasketStatus,
  LineApprovalStatus,
  LineChangeKind,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  PURCHASE_SESSION_GAP_MS,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
  type BasketEntryPatch,
  type BasketLinePick,
  type BasketLinesChangedEvent,
  type BasketView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
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
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { BasketAnnouncer } from './basket-announcer.service';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketLiveService } from './basket-live.service';
import { BasketPatchReader } from './basket-patch.reader';
import { BasketProductService } from './basket-product.service';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowRenameService } from './basket-row-rename.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import {
  WRITABLE_AMONG_SQL,
  type WritableAmongRow,
} from './basket-sharing.sql';
import { BasketWriteContext } from './basket-write.context';
import { BasketChangesService } from './changes/basket-changes.service';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A basket row is a product (plan 0201).
 *
 * Against Postgres, because the product of a line is read from four tables:
 * its products in the order the line holds them, its favourite, the standing
 * purchases of this basket in its trip, and for a `LIVE` basket the session
 * those purchases have to be in. A fixture that hands the rules an entry
 * proves the rules. Only a database proves that the read hands them the right
 * entry.
 *
 * The five steps themselves are stated as a table in the `basket-rules`
 * library, and the grouping in `basket-rows.spec.ts`. What is here is each of
 * them reached through the read and through the writes.
 *
 * **Fixtures.** Each test makes its own zone, so no test reads the lines of
 * another. A basket covers the lists it is given by name and never a whole
 * zone. A `LIVE` basket covers every list its owner writes, so its owner and
 * its zone are made for that one test.
 */
describeIntegration('a basket row is a product (real Postgres)', () => {
  let dataSource: DataSource;
  let read: BasketReadService;
  let liveService: BasketLiveService;
  let productService: BasketProductService;
  let settleService: BasketSettleService;
  let revertService: BasketRevertService;
  let demandService: BasketDemandService;
  let renameService: BasketRowRenameService;
  let changes: BasketChangesService;

  const zoneIds: string[] = [];
  let position = 0;

  /** One `basket.linesChanged` envelope, and the baskets it was sent to. */
  interface Sent {
    basketIds: readonly string[];
    payload: BasketLinesChangedEvent;
  }
  const sent: Sent[] = [];

  const events = {
    emit: () => undefined,
    emitToUsers: () => undefined,
    emitTo: (
      event: string,
      audience: { basketIds?: readonly string[] },
      payload: BasketLinesChangedEvent
    ) => {
      if (event === RealtimeEvent.BasketLinesChanged) {
        sent.push({ basketIds: audience.basketIds ?? [], payload });
      }
    },
  };

  /** The claim, which has its own integration spec and is not this one's. */
  const claims = {
    claimsOf: async () => new Map(),
    claimOf: async () => ({ claimed: false, claimedByUserId: null }),
    announceReleased: async () => undefined,
    announce: () => undefined,
  };

  const HOUR = 60 * 60 * 1000;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const baskets = dataSource.getRepository(Basket);
    const participants = dataSource.getRepository(BasketParticipant);
    const coverage = new BasketCoverageService(baskets);
    const announcer = new BasketAnnouncer(
      coverage,
      events as unknown as CoreEventsPublisher,
      new BasketPatchReader(baskets, fakeCoreConfig())
    );
    const resolver = new BasketRowResolver(baskets, fakeCoreConfig());

    // The methods the context, the read and the writes ask of it. Who writes a
    // list is asked of the database with the statement the real service runs,
    // because two cases below are about a reader who writes some of the
    // covered lists and not others.
    const sharing = {
      writableAmong: async (userId: string, listIds: readonly string[]) => {
        if (listIds.length === 0) {
          return new Set<string>();
        }
        const rows = await dataSource.query<WritableAmongRow[]>(
          WRITABLE_AMONG_SQL,
          [userId, [...listIds]]
        );
        return new Set(rows.map((row) => row.listId));
      },
      liveParticipantById: async (participantId: string, basketId: string) =>
        participants.findOne({
          where: { id: participantId, basketId, revokedAt: IsNull() },
        }),
      listParticipants: async ({ basketId }: { basketId: string }) => ({
        participants: (
          await participants.find({ where: { basketId, revokedAt: IsNull() } })
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
      // The owner's row, made the first time the permanent basket is read.
      ensureOwnerParticipant: async (basket: Basket) =>
        (await participants.findOne({
          where: { basketId: basket.id, userId: basket.ownerUserId },
        })) ?? ownerOf(basket),
    } as never;

    // The **real** access service: the change of demand asks it what the owner
    // may do on the list, and the rename asks it who may edit a line.
    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(dataSource.getRepository(ZoneMembership))
    );
    // The real reader of the marks, because a mark belongs to the key of a
    // row and the key is the product now (plan 0201).
    const marks = new BasketMarksReader(
      dataSource.getRepository(ListLineChange),
      fakeCoreConfig()
    );

    read = new BasketReadService(
      baskets,
      coverage,
      sharing,
      listAccess,
      // The walk order has its own file. Here a row stands where its oldest
      // line stands.
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      marks,
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
    settleService = new BasketSettleService(
      dataSource,
      baskets,
      context,
      claims as never,
      events as never,
      new LineChangeRecorder()
    );
    revertService = new BasketRevertService(
      dataSource,
      context,
      claims as never,
      events as never,
      new LineChangeRecorder()
    );
    const lines = new LineService(
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
    demandService = new BasketDemandService(
      context,
      lines,
      listAccess,
      events as never
    );
    renameService = new BasketRowRenameService(
      dataSource,
      context,
      lines,
      listAccess,
      sharing,
      events as never
    );
    liveService = new BasketLiveService(dataSource, baskets, sharing, read);
    productService = new BasketProductService(
      baskets,
      context,
      read,
      liveService
    );
    changes = new BasketChangesService(
      dataSource.getRepository(ListLineChange),
      context,
      read,
      marks
    );
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    const zones = dataSource.getRepository(Zone);
    for (const zoneId of zoneIds) {
      // Memberships, lists, lines and settlements cascade from the zone.
      await zones.delete({ id: zoneId });
    }
    await dataSource?.destroy();
  });

  // --- fixtures ------------------------------------------------------------

  /** One zone, its owner, and a member who writes no list until one is granted. */
  interface World {
    zoneId: string;
    zoneName: string;
    owner: string;
    member: string;
    memberMembershipId: string;
  }

  async function world(name: string): Promise<World> {
    const owner = randomUUID();
    const member = randomUUID();
    const zones = dataSource.getRepository(Zone);
    const zoneName = `Product rows ${name}`;
    const zone = await zones.save(
      zones.create({
        name: zoneName,
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: owner,
        config: {},
      })
    );
    zoneIds.push(zone.id);
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: owner,
        username: 'Ana',
        // A zone OWNER writes every list in it by role.
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    const joined = await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: member,
        username: 'Bruno',
        // A plain member writes a list only through a `list_access` row.
        role: ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      })
    );
    return {
      zoneId: zone.id,
      zoneName,
      owner,
      member,
      memberMembershipId: joined.id,
    };
  }

  async function list(w: World, name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId: w.zoneId, name, createdByUserId: w.owner })
    );
    return saved.id;
  }

  /** Let the member write one list. */
  async function grant(w: World, listId: string): Promise<void> {
    const repo = dataSource.getRepository(ListAccess);
    await repo.save(
      repo.create({
        listId,
        membershipId: w.memberMembershipId,
        permissions: [ListPermission.READ, ListPermission.WRITE],
      })
    );
  }

  /** A line with its products in the order given, which is the order it holds. */
  async function line(
    w: World,
    listId: string,
    content: string,
    over: {
      quantity?: number;
      itemIds?: string[];
      favoriteItemId?: string | null;
    } = {}
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    const itemIds = over.itemIds ?? [];
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity: over.quantity ?? 2,
        position,
        createdByUserId: w.owner,
        approvalStatus: LineApprovalStatus.APPROVED,
        // The basket no longer reads the hash (plan 0201). It is set as a real
        // line has it, so nothing here passes because the column was empty.
        itemSetHash: itemIds.length > 0 ? [...itemIds].sort().join('|') : null,
        favoriteItemId: over.favoriteItemId ?? null,
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

  interface Held {
    basket: Basket;
    /** The owner's participant row. */
    participantId: string;
  }

  /** The owner's participant row of a basket, joined an hour ago. */
  async function ownerOf(basket: Basket): Promise<BasketParticipant> {
    const participants = dataSource.getRepository(BasketParticipant);
    return participants.save(
      participants.create({
        basketId: basket.id,
        shareLinkId: null,
        kind: ParticipantKind.OWNER,
        userId: basket.ownerUserId,
        displayName: null,
        username: 'Ana',
        guestNumber: null,
        sessionSecretHash: null,
        userAgent: null,
        joinedAt: new Date(Date.now() - HOUR),
        lastSeenAt: new Date(),
        revokedAt: null,
      })
    );
  }

  /**
   * A trip of the owner that covers exactly the lists it is given.
   *
   * Made an hour ago, so a change written by a test is after the moment its
   * readers could first see the basket, and is marked for them.
   */
  async function basket(w: World, ...listIds: string[]): Promise<Held> {
    const repo = dataSource.getRepository(Basket);
    const saved = await repo.save(
      repo.create({
        ownerUserId: w.owner,
        kind: BasketKind.GENERATED,
        name: 'Saturday',
        status: BasketStatus.OPEN,
        generatedAt: new Date(Date.now() - HOUR),
        idempotencyKey: null,
      })
    );
    const sources = dataSource.getRepository(BasketSource);
    for (const listId of listIds) {
      await sources.save(
        sources.create({ basketId: saved.id, zoneId: w.zoneId, listId })
      );
    }
    return { basket: saved, participantId: (await ownerOf(saved)).id };
  }

  /** Somebody who came through a link: an account, or a guest with none. */
  async function join(held: Held, userId: string | null): Promise<string> {
    const participants = dataSource.getRepository(BasketParticipant);
    const guest = userId === null;
    const saved = await participants.save(
      participants.create({
        basketId: held.basket.id,
        shareLinkId: null,
        kind: guest ? ParticipantKind.GUEST : ParticipantKind.REGISTERED,
        userId,
        displayName: guest ? 'Marta' : null,
        username: guest ? null : 'Bruno',
        guestNumber: guest ? 1 : null,
        sessionSecretHash: guest ? randomUUID() : null,
        userAgent: null,
        joinedAt: new Date(Date.now() - HOUR),
        lastSeenAt: new Date(),
        revokedAt: null,
        // A link visitor always carries one and the owner never does (plan
        // 0140).
        expiresAt: new Date(Date.now() + 12 * HOUR),
      })
    );
    return saved.id;
  }

  /** The whole basket as one of its people reads it, with the picks given. */
  const viewOf = (
    held: Held,
    picks?: BasketLinePick[],
    participantId = held.participantId
  ): Promise<BasketView> =>
    read.read({ basketId: held.basket.id, participantId, picks });

  /** What a test needs of a row to say which lines are in it. */
  const shapeOf = (view: BasketView) =>
    view.rows.map((row) => ({
      productId: row.productId,
      lineIds: row.entries.map((entry) => entry.lineId),
    }));

  const quantityOf = async (id: string) =>
    (await dataSource.getRepository(ListLine).findOneByOrFail({ id })).quantity;

  const contentOf = async (id: string) =>
    (await dataSource.getRepository(ListLine).findOneByOrFail({ id })).content;

  const standingOf = (lineId: string) =>
    dataSource.getRepository(LineSettlement).find({
      where: { lineId, revertedAt: IsNull() },
      order: { settledAt: 'ASC', id: 'ASC' },
    });

  /** One person buys units of the lines they name, through one basket. */
  const buy = (
    held: Held,
    lines: ListLine[],
    quantity: number,
    from: number,
    itemId?: string
  ) =>
    settleService.settle({
      basketId: held.basket.id,
      participantId: held.participantId,
      rowKey: lines[0].id,
      lineIds: lines.map((row) => row.id),
      outcome: SettlementOutcome.BOUGHT,
      quantity,
      from,
      itemId,
    });

  /** The patches one basket was sent for one line, oldest first. */
  const patchesOf = (held: Held, lineId: string): BasketEntryPatch[] =>
    sent
      .filter((entry) => entry.basketIds.includes(held.basket.id))
      .flatMap((entry) => entry.payload.entries ?? [])
      .filter((entry) => entry.lineId === lineId);

  /**
   * Wait for a basket to be sent this many patches of a line.
   *
   * An announcement is not awaited by the write it follows (plan 0204, section
   * 3), so it lands a moment after the answer.
   */
  async function patchesFor(
    held: Held,
    lineId: string,
    count: number
  ): Promise<BasketEntryPatch[]> {
    const deadline = Date.now() + 5000;
    while (patchesOf(held, lineId).length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return patchesOf(held, lineId);
  }

  // --- the merge (section 2) -----------------------------------------------

  describe('the merge', () => {
    it('makes one row of two lines with different sets and the same product', async () => {
      const w = await world('one product');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const first = await line(w, flat, 'Milk', { itemIds: [pascual] });
      const second = await line(w, parents, 'Leche', {
        quantity: 1,
        itemIds: [pascual, puleva],
      });

      const view = await viewOf(held);

      // Before plan 0201 these were two rows, because the sets differ, and
      // the same carton stood in the basket twice.
      expect(view.rows).toHaveLength(1);
      const [row] = view.rows;
      expect(row).toMatchObject({
        // The oldest line names the row. It is an address and not an identity.
        rowKey: first.id,
        content: 'Milk',
        productId: pascual,
        left: 3,
        bought: 0,
        asked: 3,
        state: BasketRowState.WANTED,
      });
      expect(row).not.toHaveProperty('optionIds');
      // Each entry is its own line: its name, its products in the order the
      // line holds them, its favourite and its list (section 3).
      expect(row.entries).toEqual([
        expect.objectContaining({
          lineId: first.id,
          listId: flat,
          content: 'Milk',
          itemIds: [pascual],
          favoriteItemId: null,
          canWrite: true,
          tripItemId: null,
          left: 2,
        }),
        expect.objectContaining({
          lineId: second.id,
          listId: parents,
          content: 'Leche',
          itemIds: [pascual, puleva],
          favoriteItemId: null,
          canWrite: true,
          tripItemId: null,
          left: 1,
        }),
      ]);
      // The names of the list and its zone are in `lists` under that id, so an
      // entry repeats neither.
      expect(view.lists).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            listId: flat,
            name: 'Flat',
            zoneId: w.zoneId,
            zoneName: w.zoneName,
          }),
          expect.objectContaining({ listId: parents, name: 'Parents' }),
        ])
      );
      expect(view.progress).toEqual({
        done: 0,
        unavailable: 0,
        total: 1,
        pending: 1,
      });
    });

    it('makes two rows of two lines with the same set and different favourites', async () => {
      const w = await world('two favourites');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const first = await line(w, flat, 'Milk', {
        itemIds: [pascual, puleva],
        favoriteItemId: pascual,
      });
      const second = await line(w, parents, 'Milk', {
        itemIds: [pascual, puleva],
        favoriteItemId: puleva,
      });

      // Before plan 0201 this was one row with two options. A row is one
      // product, so two households that want two cartons are two rows.
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [first.id] },
        { productId: puleva, lineIds: [second.id] },
      ]);
    });

    it('makes one row of two lines with no product and the same name', async () => {
      const w = await world('by name');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const first = await line(w, flat, 'Jamón');
      const second = await line(w, parents, 'jamon', { quantity: 1 });

      const view = await viewOf(held);

      expect(shapeOf(view)).toEqual([
        { productId: null, lineIds: [first.id, second.id] },
      ]);
      // A row with no product is named by its oldest line.
      expect(view.rows[0]).toMatchObject({ content: 'Jamón', left: 3 });
    });

    it('keeps a line with a product apart from a line of the same name with none', async () => {
      const w = await world('name and product');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const pascual = randomUUID();
      const named = await line(w, listId, 'Milk');
      const product = await line(w, listId, 'Milk', { itemIds: [pascual] });

      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: null, lineIds: [named.id] },
        { productId: pascual, lineIds: [product.id] },
      ]);
    });

    it('ignores a favourite that is not one of the products of the line', async () => {
      const w = await world('stale favourite');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      // The favourite was taken off the line and the column still names it.
      const only = await line(w, listId, 'Milk', {
        itemIds: [pascual, puleva],
        favoriteItemId: randomUUID(),
      });

      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [only.id] },
      ]);
    });
  });

  // --- the picks of the gateway (section 1, step 3) --------------------------

  describe('the picks of the gateway', () => {
    it('moves a line to the row of its pick, and ignores a pick that is not on the line', async () => {
      const w = await world('picks');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const fixed = await line(w, listId, 'Puleva', { itemIds: [puleva] });
      const priced = await line(w, listId, 'Milk', {
        quantity: 1,
        itemIds: [pascual, puleva],
      });

      // With no prices the line counts as its first product.
      const alone = await viewOf(held);
      expect(shapeOf(alone)).toEqual([
        { productId: puleva, lineIds: [fixed.id] },
        { productId: pascual, lineIds: [priced.id] },
      ]);
      expect(alone.progress.total).toBe(2);

      // The gateway found the second product cheapest for that line.
      const picked = await viewOf(held, [
        { lineId: priced.id, itemId: puleva },
      ]);
      expect(shapeOf(picked)).toEqual([
        { productId: puleva, lineIds: [fixed.id, priced.id] },
      ]);
      expect(picked.rows[0]).toMatchObject({ rowKey: fixed.id, left: 3 });
      // Only the full read counts with the picks.
      expect(picked.progress.total).toBe(1);

      // A pick that is not a product of its line is ignored, and the line
      // falls to its first product.
      const wrong = await viewOf(held, [
        { lineId: priced.id, itemId: randomUUID() },
        // A pick for a line the basket does not hold changes nothing either.
        { lineId: randomUUID(), itemId: puleva },
      ]);
      expect(shapeOf(wrong)).toEqual(shapeOf(alone));
    });

    it('lets the favourite of a line win over its pick', async () => {
      const w = await world('favourite and pick');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const loved = await line(w, listId, 'Milk', {
        itemIds: [pascual, puleva],
        favoriteItemId: pascual,
      });

      // The favourite wins also when another product is cheaper at the shop.
      expect(
        shapeOf(await viewOf(held, [{ lineId: loved.id, itemId: puleva }]))
      ).toEqual([{ productId: pascual, lineIds: [loved.id] }]);
    });

    it('counts the progress of a write, of a card and of the summary with no picks', async () => {
      const w = await world('progress');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      await line(w, listId, 'Puleva', { itemIds: [puleva] });
      const priced = await line(w, listId, 'Milk', {
        quantity: 1,
        itemIds: [pascual, puleva],
      });
      const picks = [{ lineId: priced.id, itemId: puleva }];

      expect((await viewOf(held, picks)).progress.total).toBe(1);

      // No write holds a price, so its answer counts the rows core builds
      // alone. A change of demand to the number it already has writes nothing
      // and answers.
      const answer = await demandService.setDemand({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: priced.id,
        lineId: priced.id,
        quantity: 1,
        from: 1,
      });
      expect(answer.progress.total).toBe(2);
      // The count of a basket card and of the back office.
      expect((await read.progressOf(held.basket)).total).toBe(2);
    });
  });

  // --- the buy in this trip (section 1, step 1) -----------------------------

  describe('the buy in this trip', () => {
    it('moves a line to the row of the product it was bought as, and a revert moves it back', async () => {
      const w = await world('trip product');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, oat] = [randomUUID(), randomUUID()];
      const milk = await line(w, listId, 'Milk', {
        itemIds: [pascual],
        favoriteItemId: pascual,
      });
      const drink = await line(w, listId, 'Oat drink', {
        quantity: 1,
        itemIds: [oat],
      });
      expect(shapeOf(await viewOf(held))).toHaveLength(2);

      // A change "for this trip only": the shopper took the oat drink for the
      // household that asked for milk. The line does not hold that product.
      const bought = await buy(held, [milk], 1, 2, oat);

      const [written] = await standingOf(milk.id);
      expect(written.itemId).toBe(oat);
      // The answer is the named line, and it says what it counts as now.
      expect(bought.entries).toEqual([
        expect.objectContaining({
          lineId: milk.id,
          left: 1,
          bought: 1,
          tripItemId: oat,
          // The line itself did not change.
          itemIds: [pascual],
          favoriteItemId: pascual,
        }),
      ]);

      // It wins over the favourite, and over a pick the gateway might send.
      const after = await viewOf(held, [{ lineId: milk.id, itemId: pascual }]);
      expect(shapeOf(after)).toEqual([
        { productId: oat, lineIds: [milk.id, drink.id] },
      ]);
      expect(after.rows[0]).toMatchObject({
        rowKey: milk.id,
        left: 2,
        bought: 1,
        state: BasketRowState.PARTLY,
      });

      const back = await revertService.revert({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      // A buy that was taken back says nothing, so the favourite decides again.
      expect(back.entries).toEqual([
        expect.objectContaining({
          lineId: milk.id,
          left: 2,
          bought: 0,
          tripItemId: null,
        }),
      ]);
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [milk.id] },
        { productId: oat, lineIds: [drink.id] },
      ]);
    });

    it('carries the product of the buy in the patch of basket.linesChanged', async () => {
      const w = await world('patch');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, oat] = [randomUUID(), randomUUID()];
      const milk = await line(w, listId, 'Milk', { itemIds: [pascual] });

      await buy(held, [milk], 1, 2, oat);

      // A client that holds the line in the row of another product reads the
      // basket again. No patch can say which row the line is in now.
      const [first] = await patchesFor(held, milk.id, 1);
      expect(first).toMatchObject({
        lineId: milk.id,
        left: 1,
        bought: 1,
        tripItemId: oat,
      });
      // A room holds guests, so the patch carries the product and nothing else
      // an entry gained: no name, no products of the line, no list.
      expect(first).not.toHaveProperty('content');
      expect(first).not.toHaveProperty('itemIds');
      expect(first).not.toHaveProperty('favoriteItemId');
      expect(first).not.toHaveProperty('canWrite');
      expect(first).not.toHaveProperty('listId');

      await revertService.revert({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      const [, second] = await patchesFor(held, milk.id, 2);
      expect(second).toMatchObject({
        lineId: milk.id,
        left: 2,
        bought: 0,
        tripItemId: null,
      });
    });

    it('takes the product of the newest standing buy', async () => {
      const w = await world('newest buy');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, oat, soy] = [randomUUID(), randomUUID(), randomUUID()];
      const milk = await line(w, listId, 'Milk', {
        quantity: 3,
        itemIds: [pascual],
      });

      await buy(held, [milk], 1, 3, oat);
      await buy(held, [milk], 1, 2, soy);
      // The order is the time of the buy, moved through the row itself.
      const [older] = await standingOf(milk.id);
      await dataSource
        .getRepository(LineSettlement)
        .update(older.id, { settledAt: new Date(Date.now() - 10 * 60 * 1000) });

      expect((await viewOf(held)).rows[0].productId).toBe(soy);

      // The newest buy is taken back, and the older one decides.
      await revertService.revert({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        target: 'UNITS',
        units: 1,
        from: 2,
      });
      expect((await viewOf(held)).rows[0].productId).toBe(oat);
    });

    it('names no product for "they had none"', async () => {
      const w = await world('they had none');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, oat] = [randomUUID(), randomUUID()];
      const milk = await line(w, listId, 'Milk', { itemIds: [pascual] });

      const closed = await settleService.settle({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 2,
        itemId: oat,
      });

      // The shop had none of the product the row was drawn as. Nothing was
      // bought, so the line counts as what it did.
      expect(closed.entries[0]).toMatchObject({
        state: BasketRowState.NOT_AVAILABLE,
        tripItemId: null,
      });
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [milk.id] },
      ]);
    });

    it('forgets the product of a buy once the session of a LIVE basket is over', async () => {
      // A `LIVE` basket never ends, so its trip is its current session. Its
      // own owner and its own zone, because it covers every list its owner
      // writes.
      const w = await world('live session');
      const listId = await list(w, 'Weekly');
      const [pascual, oat] = [randomUUID(), randomUUID()];
      const milk = await line(w, listId, 'Milk', { itemIds: [pascual] });
      const repo = dataSource.getRepository(Basket);
      const live = await repo.save(
        repo.create({
          ownerUserId: w.owner,
          kind: BasketKind.LIVE,
          name: null,
          status: BasketStatus.OPEN,
          generatedAt: new Date(Date.now() - 24 * HOUR),
          idempotencyKey: null,
        })
      );
      const held = { basket: live, participantId: (await ownerOf(live)).id };

      await buy(held, [milk], 1, 2, oat);
      expect((await viewOf(held)).rows[0]).toMatchObject({
        productId: oat,
        bought: 1,
      });

      // The buy is an hour past the gap that ends a session, by the database's
      // own clock.
      await dataSource
        .getRepository(LineSettlement)
        .update(
          { lineId: milk.id },
          { settledAt: new Date(Date.now() - PURCHASE_SESSION_GAP_MS - HOUR) }
        );

      // Yesterday's change for one trip does not decide today's row.
      const today = await viewOf(held);
      expect(shapeOf(today)).toEqual([
        { productId: pascual, lineIds: [milk.id] },
      ]);
      expect(today.rows[0]).toMatchObject({ bought: 0, left: 1 });
      expect(today.rows[0].entries[0].tripItemId).toBeNull();
    });
  });

  // --- what a settle records (section 4) -----------------------------------

  describe('the product a settle records', () => {
    it('records the product the named lines agree on when none is named', async () => {
      const w = await world('settle agrees');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const first = await line(w, flat, 'Milk', {
        quantity: 1,
        itemIds: [puleva],
      });
      // Two products, and the favourite is the one the first line holds.
      const second = await line(w, parents, 'Leche', {
        quantity: 1,
        itemIds: [pascual, puleva],
        favoriteItemId: puleva,
      });

      await buy(held, [first, second], 2, 2);

      expect((await standingOf(first.id))[0].itemId).toBe(puleva);
      expect((await standingOf(second.id))[0].itemId).toBe(puleva);
    });

    it('records no product when the named lines disagree, or hold none', async () => {
      const w = await world('settle disagrees');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const first = await line(w, listId, 'Milk', {
        quantity: 1,
        itemIds: [pascual],
      });
      const second = await line(w, listId, 'Leche', {
        quantity: 1,
        itemIds: [puleva],
      });
      const bread = await line(w, listId, 'Bread', { quantity: 1 });

      // Two rows named in one settle. Guessing one of the two products would
      // put a product in a household's history that nobody chose.
      await buy(held, [first, second], 2, 2);
      await buy(held, [bread], 1, 1);

      expect((await standingOf(first.id))[0].itemId).toBeNull();
      expect((await standingOf(second.id))[0].itemId).toBeNull();
      expect((await standingOf(bread.id))[0].itemId).toBeNull();
      // With no product recorded, each line counts as what it did.
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [first.id] },
        { productId: puleva, lineIds: [second.id] },
        { productId: null, lineIds: [bread.id] },
      ]);
    });
  });

  // --- writes name their lines (section 4) ---------------------------------

  describe('a write acts on the lines it names', () => {
    /** One row of two lists' lines that count as one product. */
    async function twoLists(name: string) {
      const w = await world(name);
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const other = await list(w, 'Not covered');
      const held = await basket(w, flat, parents);
      const pascual = randomUUID();
      const first = await line(w, flat, 'Milk', { itemIds: [pascual] });
      const second = await line(w, parents, 'Leche', {
        quantity: 1,
        itemIds: [pascual],
      });
      // The same product on a list the basket does not cover.
      const outside = await line(w, other, 'Milk', { itemIds: [pascual] });
      // And on a covered list at zero, which the basket does not draw.
      const zero = await line(w, flat, 'Pascual', {
        quantity: 0,
        itemIds: [pascual],
      });
      return { w, held, pascual, first, second, outside, zero };
    }

    it('settles the named line and leaves the rest of its row alone', async () => {
      const { held, pascual, first, second } = await twoLists('settle named');
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [first.id, second.id] },
      ]);

      const result = await buy(held, [second], 1, 1);

      // The settle did not rebuild the row from a key: the older line of the
      // same row would have taken the unit, oldest first.
      expect(await quantityOf(first.id)).toBe(2);
      expect(await standingOf(first.id)).toHaveLength(0);
      expect(await quantityOf(second.id)).toBe(0);
      expect(result.entries).toEqual([
        expect.objectContaining({
          lineId: second.id,
          left: 0,
          bought: 1,
          state: BasketRowState.DONE,
          tripItemId: pascual,
        }),
      ]);
      expect((await viewOf(held)).rows[0]).toMatchObject({
        left: 2,
        bought: 1,
        state: BasketRowState.PARTLY,
      });
    });

    it('refuses a settle whose `from` is not the sum over the named lines', async () => {
      const { held, first } = await twoLists('settle stale');

      // The row asks for three. The request names one line, which asks for two.
      await expect(buy(held, [first], 1, 3)).rejects.toMatchObject({
        code: 'stale_quantity',
      });
      expect(await standingOf(first.id)).toHaveLength(0);
      expect(await quantityOf(first.id)).toBe(2);
    });

    it('refuses a settle that names a line the basket does not draw, for every line', async () => {
      const { held, first, second, outside, zero } =
        await twoLists('settle refused');

      // A line on a list outside the coverage, and a line at zero with no buy
      // that keeps it a row, are the same refusal.
      for (const stranger of [outside, zero]) {
        await expect(
          buy(held, [first, second, stranger], 3, 3)
        ).rejects.toMatchObject({
          code: 'not_found',
          message: 'Row not found',
        });
      }
      await expect(
        buy(held, [first, { id: randomUUID() } as ListLine], 2, 2)
      ).rejects.toMatchObject({ code: 'not_found' });
      // Nothing was applied to the lines that were found.
      expect(await standingOf(first.id)).toHaveLength(0);
      expect(await standingOf(second.id)).toHaveLength(0);
      expect(await quantityOf(first.id)).toBe(2);

      // The row key is the address of the request, so it is one of its lines.
      await expect(
        settleService.settle({
          basketId: held.basket.id,
          participantId: held.participantId,
          rowKey: second.id,
          lineIds: [first.id],
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 2,
        })
      ).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'lineIds' },
      });
      await expect(
        settleService.settle({
          basketId: held.basket.id,
          participantId: held.participantId,
          rowKey: first.id,
          lineIds: [],
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 2,
        })
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('takes units back from the named line only, and guards `from` over it', async () => {
      const { held, first, second, outside } = await twoLists('revert named');
      await buy(held, [first, second], 3, 3);

      // The row bought three. The request names one line, which bought two.
      await expect(
        revertService.revert({
          basketId: held.basket.id,
          participantId: held.participantId,
          rowKey: first.id,
          lineIds: [first.id],
          target: 'UNITS',
          units: 1,
          from: 3,
        })
      ).rejects.toMatchObject({ code: 'stale_quantity' });
      await expect(
        revertService.revert({
          basketId: held.basket.id,
          participantId: held.participantId,
          rowKey: first.id,
          lineIds: [first.id, outside.id],
          target: 'UNITS',
          units: 1,
          from: 2,
        })
      ).rejects.toMatchObject({ code: 'not_found', message: 'Row not found' });

      const result = await revertService.revert({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: second.id,
        lineIds: [second.id],
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      expect(await quantityOf(second.id)).toBe(1);
      // The newest purchase of the row is on both lines. Only the named one
      // gave its unit back.
      expect(await quantityOf(first.id)).toBe(0);
      expect((await standingOf(first.id)).map((row) => row.quantity)).toEqual([
        2,
      ]);
      expect(result.entries).toEqual([
        expect.objectContaining({ lineId: second.id, left: 1, bought: 0 }),
      ]);
    });

    it('refuses to rename a line that has a product', async () => {
      const w = await world('rename product');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const withProduct = await line(w, listId, 'Milk', {
        itemIds: [randomUUID()],
      });
      const plain = await line(w, listId, 'Bread');

      // A row with a product is named by the catalog.
      await expect(
        renameService.rename({
          basketId: held.basket.id,
          participantId: held.participantId,
          userId: w.owner,
          rowKey: withProduct.id,
          lineIds: [withProduct.id],
          content: 'Oat milk',
        })
      ).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'lineIds' },
      });
      // One named line with a product refuses the whole rename.
      await expect(
        renameService.rename({
          basketId: held.basket.id,
          participantId: held.participantId,
          userId: w.owner,
          rowKey: plain.id,
          lineIds: [plain.id, withProduct.id],
          content: 'Oat milk',
        })
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(await contentOf(withProduct.id)).toBe('Milk');
      expect(await contentOf(plain.id)).toBe('Bread');
    });

    it('renames the named line only, and it leaves its row', async () => {
      const w = await world('rename named');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const other = await list(w, 'Not covered');
      const held = await basket(w, flat, parents);
      const first = await line(w, flat, 'Milk');
      const second = await line(w, parents, 'milk');
      const outside = await line(w, other, 'Milk');
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: null, lineIds: [first.id, second.id] },
      ]);

      await expect(
        renameService.rename({
          basketId: held.basket.id,
          participantId: held.participantId,
          userId: w.owner,
          rowKey: second.id,
          lineIds: [second.id, outside.id],
          content: 'Oat milk',
        })
      ).rejects.toMatchObject({ code: 'not_found' });

      const result = await renameService.rename({
        basketId: held.basket.id,
        participantId: held.participantId,
        userId: w.owner,
        rowKey: second.id,
        lineIds: [second.id],
        content: 'Oat milk',
      });

      // Before plan 0201 the rename took every entry of the row.
      expect(await contentOf(first.id)).toBe('Milk');
      expect(await contentOf(second.id)).toBe('Oat milk');
      expect(result.entries).toEqual([
        expect.objectContaining({ lineId: second.id, content: 'Oat milk' }),
      ]);
      expect(result).not.toHaveProperty('replacedRowKey');
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: null, lineIds: [first.id] },
        { productId: null, lineIds: [second.id] },
      ]);
    });
  });

  // --- the change of demand (section 4, review point 2) ---------------------

  describe('the change of demand', () => {
    it('raises a line at zero, which the basket does not draw', async () => {
      const w = await world('demand zero');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const pascual = randomUUID();
      const zero = await line(w, listId, 'Milk', {
        quantity: 0,
        itemIds: [pascual],
      });
      expect((await viewOf(held)).rows).toEqual([]);

      // How a list that holds a product at zero asks for it again. Every other
      // write refuses a line the basket does not draw.
      const result = await demandService.setDemand({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: zero.id,
        lineId: zero.id,
        quantity: 2,
        from: 0,
      });

      expect(await quantityOf(zero.id)).toBe(2);
      expect(result.entries).toEqual([
        expect.objectContaining({ lineId: zero.id, left: 2 }),
      ]);
      expect(result.progress.total).toBe(1);
      expect(shapeOf(await viewOf(held))).toEqual([
        { productId: pascual, lineIds: [zero.id] },
      ]);
    });

    it('refuses a rejected line, which no basket may raise', async () => {
      const w = await world('demand rejected');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const rejected = await line(w, listId, 'Milk', { quantity: 2 });
      await dataSource.query(
        `UPDATE "list_lines" SET "approvalStatus" = 'REJECTED' WHERE id = $1`,
        [rejected.id]
      );

      // A rejected line is a decision. The read does not draw it, and the one
      // write that reaches a line at zero must not reach this one.
      await expect(
        demandService.setDemand({
          basketId: held.basket.id,
          participantId: held.participantId,
          rowKey: rejected.id,
          lineId: rejected.id,
          quantity: 5,
          from: 2,
        })
      ).rejects.toThrow('Row not found');
      expect(await quantityOf(rejected.id)).toBe(2);
    });

    it('answers no entry for a line it took to zero', async () => {
      const w = await world('demand to zero');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const milk = await line(w, listId, 'Milk');

      const result = await demandService.setDemand({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: milk.id,
        lineId: milk.id,
        quantity: 0,
        from: 2,
      });

      // A line that is absent from the answer left the basket.
      expect(await quantityOf(milk.id)).toBe(0);
      expect(result.entries).toEqual([]);
      expect(result.progress.total).toBe(0);
    });

    it('refuses a line that is not on a covered list, a deleted one, and a stale `from`', async () => {
      const w = await world('demand refused');
      const covered = await list(w, 'Covered');
      const other = await list(w, 'Not covered');
      const held = await basket(w, covered);
      const milk = await line(w, covered, 'Milk');
      const outside = await line(w, other, 'Milk');
      const deleted = await line(w, covered, 'Bread');
      await dataSource
        .getRepository(ListLine)
        .update(deleted.id, { deletedAt: new Date() });
      const ask = (rowKey: string, lineId: string, from: number) =>
        demandService.setDemand({
          basketId: held.basket.id,
          participantId: held.participantId,
          rowKey,
          lineId,
          quantity: 5,
          from,
        });

      await expect(ask(outside.id, outside.id, 2)).rejects.toMatchObject({
        code: 'not_found',
        message: 'Row not found',
      });
      await expect(ask(deleted.id, deleted.id, 2)).rejects.toMatchObject({
        code: 'not_found',
      });
      const missing = randomUUID();
      await expect(ask(missing, missing, 2)).rejects.toMatchObject({
        code: 'not_found',
      });
      // The row key and the line are the same id on this route.
      await expect(ask(deleted.id, milk.id, 2)).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'lineId' },
      });
      await expect(ask(milk.id, milk.id, 4)).rejects.toMatchObject({
        code: 'stale_quantity',
      });
      expect(await quantityOf(milk.id)).toBe(2);
      expect(await quantityOf(outside.id)).toBe(2);
    });

    it('lets a guest change a line that is alone in its row, and no other', async () => {
      const w = await world('demand guest');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const pascual = randomUUID();
      const bread = await line(w, flat, 'Bread');
      const first = await line(w, flat, 'Milk', { itemIds: [pascual] });
      const second = await line(w, parents, 'Leche', {
        quantity: 1,
        itemIds: [pascual],
      });
      const zero = await line(w, flat, 'Salt', { quantity: 0 });
      const guest = await join(held, null);
      const asGuest = (lineId: string, quantity: number, from: number) =>
        demandService.setDemand({
          basketId: held.basket.id,
          participantId: guest,
          rowKey: lineId,
          lineId,
          quantity,
          from,
        });

      // A guest was served no list. Who may change a demand did not move with
      // plan 0201: a row of one entry, and no other.
      await asGuest(bread.id, 3, 2);
      expect(await quantityOf(bread.id)).toBe(3);

      // Two households in one row ask two questions, and a guest was not told
      // which is which. The refusal does not say the line exists.
      for (const lineId of [first.id, second.id]) {
        await expect(
          asGuest(lineId, 4, lineId === first.id ? 2 : 1)
        ).rejects.toMatchObject({
          code: 'validation_failed',
          messageArgs: { field: 'lineId' },
        });
      }
      // A line at zero is in no row, so it is not alone in one.
      await expect(asGuest(zero.id, 1, 0)).rejects.toMatchObject({
        code: 'validation_failed',
      });
      expect(await quantityOf(first.id)).toBe(2);
      expect(await quantityOf(second.id)).toBe(1);
      expect(await quantityOf(zero.id)).toBe(0);

      // The owner writes both lists, so they name either line of the row.
      await demandService.setDemand({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: second.id,
        lineId: second.id,
        quantity: 4,
        from: 1,
      });
      expect(await quantityOf(second.id)).toBe(4);
      expect(await quantityOf(first.id)).toBe(2);
    });
  });

  // --- the lines that need a price (section 1) ------------------------------

  describe('basket.priceChoices', () => {
    it('answers the lines with two or more products, no favourite and no buy in the trip', async () => {
      const w = await world('price choices');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
      await line(w, listId, 'One product', { itemIds: [a] });
      const choice = await line(w, listId, 'Two products', { itemIds: [b, a] });
      await line(w, listId, 'A favourite', {
        itemIds: [a, b],
        favoriteItemId: b,
      });
      // A favourite that was taken off the line decides nothing.
      const stale = await line(w, listId, 'A stale favourite', {
        itemIds: [b, c],
        favoriteItemId: a,
      });
      const bought = await line(w, listId, 'Bought in this trip', {
        itemIds: [a, b],
      });
      const taken = await line(w, listId, 'Bought and taken back', {
        itemIds: [c, a, b],
      });
      await line(w, listId, 'No product');
      // At zero with nothing bought, so the basket does not cover it.
      await line(w, listId, 'At zero', { quantity: 0, itemIds: [a, b] });

      await buy(held, [bought], 1, 2);
      await buy(held, [taken], 1, 2);
      await revertService.revert({
        basketId: held.basket.id,
        participantId: held.participantId,
        rowKey: taken.id,
        lineIds: [taken.id],
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      const answer = await productService.priceChoices({
        basketId: held.basket.id,
        participantId: held.participantId,
      });

      expect(answer).toEqual({
        basketId: held.basket.id,
        participantId: held.participantId,
        // Oldest line first, and the products in the order the line holds them.
        lines: [
          { lineId: choice.id, itemIds: [b, a] },
          { lineId: stale.id, itemIds: [b, c] },
          { lineId: taken.id, itemIds: [c, a, b] },
        ],
      });

      // A guest reads the same basket, so the gateway prices the same lines.
      const guest = await join(held, null);
      const asGuest = await productService.priceChoices({
        basketId: held.basket.id,
        participantId: guest,
      });
      expect(asGuest.lines).toEqual(answer.lines);
    });

    it('answers no line for a basket that needs no price', async () => {
      const w = await world('no price choices');
      const listId = await list(w, 'Weekly');
      const held = await basket(w, listId);
      await line(w, listId, 'Milk', { itemIds: [randomUUID()] });
      await line(w, listId, 'Bread');

      expect(
        (
          await productService.priceChoices({
            basketId: held.basket.id,
            participantId: held.participantId,
          })
        ).lines
      ).toEqual([]);
    });

    it('makes the permanent basket when it is the first to ask for it', async () => {
      // Its own owner and its own zone: a `LIVE` basket covers every list its
      // owner writes.
      const w = await world('live price choices');
      const listId = await list(w, 'Weekly');
      const [a, b] = [randomUUID(), randomUUID()];
      const milk = await line(w, listId, 'Milk', { itemIds: [a, b] });
      const baskets = dataSource.getRepository(Basket);
      expect(await baskets.count({ where: { ownerUserId: w.owner } })).toBe(0);

      // The gateway asks this before the basket itself.
      const answer = await productService.livePriceChoices({ userId: w.owner });

      const live = await baskets.findOneByOrFail({
        ownerUserId: w.owner,
        kind: BasketKind.LIVE,
      });
      const owner = await dataSource
        .getRepository(BasketParticipant)
        .findOneByOrFail({ basketId: live.id, userId: w.owner });
      expect(answer).toEqual({
        basketId: live.id,
        participantId: owner.id,
        lines: [{ lineId: milk.id, itemIds: [a, b] }],
      });
      // A second ask makes no second basket.
      expect(
        (await productService.livePriceChoices({ userId: w.owner })).basketId
      ).toBe(live.id);
      expect(await baskets.count({ where: { ownerUserId: w.owner } })).toBe(1);

      // And the read of that basket takes the pick the gateway made of it.
      const view = await liveService.live({
        userId: w.owner,
        picks: [{ lineId: milk.id, itemId: b }],
      });
      expect(view.id).toBe(live.id);
      expect(shapeOf(view)).toEqual([{ productId: b, lineIds: [milk.id] }]);
      expect(shapeOf(await liveService.live({ userId: w.owner }))).toEqual([
        { productId: a, lineIds: [milk.id] },
      ]);
    });
  });

  // --- the lists that can take a product (section 5) ------------------------

  describe('basket.productLists', () => {
    async function shelves() {
      const w = await world('product lists');
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const asks = await list(w, 'A asks for it');
      const atZero = await list(w, 'B holds it at zero');
      const without = await list(w, 'C does not hold it');
      const second = await list(w, 'D holds it as a second product');
      const trip = await list(w, 'E bought it in this trip');
      const gone = await list(w, 'F deleted its line');
      const notCovered = await list(w, 'G is not covered');
      const held = await basket(w, asks, atZero, without, second, trip, gone);

      await line(w, asks, 'Milk', { itemIds: [pascual] });
      const zero = await line(w, atZero, 'Leche', {
        quantity: 0,
        itemIds: [pascual],
      });
      // A newer line of the same list that holds it too. The oldest is named.
      await line(w, atZero, 'Leche entera', {
        quantity: 0,
        itemIds: [puleva, pascual],
      });
      await line(w, without, 'Bread');
      // It counts as its first product, so the list does not ask for this one.
      const other = await line(w, second, 'Any milk', {
        quantity: 1,
        itemIds: [puleva, pascual],
      });
      // It holds another product and was bought as this one for the trip.
      const swapped = await line(w, trip, 'Puleva', { itemIds: [puleva] });
      await buy(held, [swapped], 1, 2, pascual);
      const deleted = await line(w, gone, 'Milk', { itemIds: [pascual] });
      await dataSource
        .getRepository(ListLine)
        .update(deleted.id, { deletedAt: new Date() });
      await line(w, notCovered, 'Milk', { quantity: 0, itemIds: [pascual] });

      return {
        w,
        held,
        pascual,
        puleva,
        atZero,
        without,
        second,
        gone,
        zero,
        other,
      };
    }

    it('answers a list with the line at zero, a list without it, and no list that asks for it', async () => {
      const s = await shelves();

      const answer = await productService.productLists({
        basketId: s.held.basket.id,
        participantId: s.held.participantId,
        itemId: s.pascual,
      });

      const zone = { zoneId: s.w.zoneId, zoneName: s.w.zoneName };
      // One zone, so the order is the name of the list.
      expect(answer.lists).toEqual([
        {
          listId: s.atZero,
          listName: 'B holds it at zero',
          ...zone,
          // The page raises this line with the demand route and makes no
          // second one.
          lineId: s.zero.id,
          lineName: 'Leche',
          quantity: 0,
        },
        {
          listId: s.without,
          listName: 'C does not hold it',
          ...zone,
          lineId: null,
          lineName: null,
          quantity: null,
        },
        {
          listId: s.second,
          listName: 'D holds it as a second product',
          ...zone,
          // Core decides what a line counts as with no picks, so this list is
          // answered with its line. A client that draws the line in the row
          // of this product leaves the list out.
          lineId: s.other.id,
          lineName: 'Any milk',
          quantity: 1,
        },
        {
          listId: s.gone,
          listName: 'F deleted its line',
          ...zone,
          // A deleted line cannot be raised.
          lineId: null,
          lineName: null,
          quantity: null,
        },
      ]);
    });

    it('answers every writable covered list for a product no line counts as', async () => {
      const s = await shelves();

      const answer = await productService.productLists({
        basketId: s.held.basket.id,
        participantId: s.held.participantId,
        itemId: randomUUID(),
      });

      expect(answer.lists).toHaveLength(6);
      expect(answer.lists.every((entry) => entry.lineId === null)).toBe(true);
    });

    it('leaves out a list the actor may not write', async () => {
      const s = await shelves();
      const member = await join(s.held, s.w.member);
      const ask = () =>
        productService.productLists({
          basketId: s.held.basket.id,
          participantId: member,
          itemId: s.pascual,
        });

      // A member of the zone who was given no list writes none of them.
      expect((await ask()).lists).toEqual([]);

      await grant(s.w, s.without);
      expect((await ask()).lists.map((entry) => entry.listId)).toEqual([
        s.without,
      ]);
    });

    it('refuses a guest', async () => {
      const s = await shelves();
      const guest = await join(s.held, null);

      // A guest holds no list. An empty answer would read as "every list
      // already asks for it".
      await expect(
        productService.productLists({
          basketId: s.held.basket.id,
          participantId: guest,
          itemId: s.pascual,
        })
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  // --- bought through another basket (plans 0188 and 0203) ------------------

  describe('a row merged on a product that another basket bought', () => {
    it('reads as one BOUGHT_ELSEWHERE row, and comes back as one row on a revert', async () => {
      const w = await world('bought elsewhere');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      // Two trips of the same person over the same two lists.
      const a = await basket(w, flat, parents);
      const b = await basket(w, flat, parents);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const first = await line(w, flat, 'Milk', { itemIds: [pascual] });
      const second = await line(w, parents, 'Leche', {
        quantity: 1,
        itemIds: [pascual, puleva],
      });

      await buy(a, [first, second], 3, 3);

      const other = await viewOf(b);
      expect(shapeOf(other)).toEqual([
        { productId: pascual, lineIds: [first.id, second.id] },
      ]);
      expect(other.rows[0]).toMatchObject({
        rowKey: first.id,
        left: 0,
        bought: 0,
        asked: 0,
        boughtElsewhere: 3,
        state: BasketRowState.BOUGHT_ELSEWHERE,
        note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
        // The buys are changes, and they marked the row of the product.
        mark: BasketRowMark.CHANGED,
        touchedBy: null,
      });
      expect(
        other.rows[0].entries.map((entry) => [
          entry.state,
          entry.boughtElsewhere,
          // This basket bought nothing, so no buy of its trip names a product.
          entry.tripItemId,
        ])
      ).toEqual([
        [BasketRowState.BOUGHT_ELSEWHERE, 2, null],
        [BasketRowState.BOUGHT_ELSEWHERE, 1, null],
      ]);
      // The row counts toward nothing (plan 0203, section 4).
      expect(other.progress).toEqual({
        done: 0,
        unavailable: 0,
        total: 0,
        pending: 0,
      });
      expect(other.unseenChangeCount).toBe(2);

      // The basket that bought reads its own row, and no mark of its own buy.
      const own = await viewOf(a);
      expect(shapeOf(own)).toEqual([
        { productId: pascual, lineIds: [first.id, second.id] },
      ]);
      expect(own.rows[0]).toMatchObject({
        bought: 3,
        boughtElsewhere: 0,
        state: BasketRowState.DONE,
        mark: null,
      });
      expect(own.rows[0].entries.map((entry) => entry.tripItemId)).toEqual([
        pascual,
        pascual,
      ]);

      // One change row for each line the buy lowered, naming the basket.
      const recorded = await dataSource.getRepository(ListLineChange).find({
        where: { basketId: a.basket.id, kind: LineChangeKind.BOUGHT },
      });
      expect(recorded.map((row) => row.lineId).sort()).toEqual(
        [first.id, second.id].sort()
      );

      // Each basket is sent the lines as it reads them. The other basket is
      // told that its marks moved, and the one that bought is not.
      const [toOther] = await patchesFor(b, second.id, 1);
      expect(toOther).toMatchObject({
        state: BasketRowState.BOUGHT_ELSEWHERE,
        boughtElsewhere: 1,
        tripItemId: null,
      });
      const [toOwn] = await patchesFor(a, second.id, 1);
      expect(toOwn).toMatchObject({
        state: BasketRowState.DONE,
        bought: 1,
        tripItemId: pascual,
      });
      const moved = (held: Held) =>
        sent
          .filter((entry) => entry.basketIds.includes(held.basket.id))
          .some((entry) => entry.payload.marksMoved === true);
      expect(moved(b)).toBe(true);
      expect(moved(a)).toBe(false);

      await revertService.revert({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: first.id,
        lineIds: [first.id, second.id],
        target: 'UNITS',
        units: 3,
        from: 3,
      });

      const back = await viewOf(b);
      expect(shapeOf(back)).toEqual([
        { productId: pascual, lineIds: [first.id, second.id] },
      ]);
      expect(back.rows[0]).toMatchObject({
        left: 3,
        boughtElsewhere: 0,
        state: BasketRowState.WANTED,
        note: null,
      });
      const reverted = await dataSource.getRepository(ListLineChange).find({
        where: { basketId: a.basket.id, kind: LineChangeKind.BUY_REVERTED },
      });
      expect(reverted.map((row) => row.lineId).sort()).toEqual(
        [first.id, second.id].sort()
      );
    });
  });

  // --- the marks follow the product (plan 0138, section 7) ------------------

  describe('a mark belongs to the product a line counts as', () => {
    /** Somebody else deletes a line on its own list page. */
    async function deleteLine(w: World, gone: ListLine): Promise<void> {
      await dataSource.transaction(async (manager) => {
        await manager
          .getRepository(ListLine)
          .update(gone.id, { deletedAt: new Date() });
        await new LineChangeRecorder().deleted(
          manager,
          { id: gone.listId, zoneId: w.zoneId },
          gone,
          { userId: w.member, participantId: null, basketId: null }
        );
      });
    }

    it('passes the mark of a deleted line to the row its product is still on', async () => {
      const w = await world('mark passed');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const pascual = randomUUID();
      const kept = await line(w, flat, 'Milk', { itemIds: [pascual] });
      // Another name and the same product. Before plan 0201 the two were one
      // row only when their whole sets were the same.
      const gone = await line(w, parents, 'Leche', {
        quantity: 1,
        itemIds: [pascual, randomUUID()],
      });

      await deleteLine(w, gone);

      const view = await viewOf(held);
      // The thing is still in the basket, so no disabled row is drawn.
      expect(shapeOf(view)).toEqual([
        { productId: pascual, lineIds: [kept.id] },
      ]);
      expect(view.rows[0]).toMatchObject({
        state: BasketRowState.WANTED,
        mark: BasketRowMark.CHANGED,
      });
      expect(view.unseenChangeCount).toBe(1);

      // The marks alone answer the same line, and the change points at it.
      const marks = await changes.marksOf({
        basketId: held.basket.id,
        participantId: held.participantId,
      });
      expect(marks.lines).toEqual([
        { lineId: kept.id, mark: BasketRowMark.CHANGED },
      ]);
      const page = await changes.list({
        basketId: held.basket.id,
        participantId: held.participantId,
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        kind: LineChangeKind.DELETED,
        rowKey: kept.id,
      });
    });

    it('draws a disabled row for a deleted line when only its name is still covered', async () => {
      const w = await world('mark removed');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const [pascual, puleva] = [randomUUID(), randomUUID()];
      const kept = await line(w, flat, 'Milk', { itemIds: [pascual] });
      const gone = await line(w, parents, 'Milk', {
        quantity: 1,
        itemIds: [puleva],
      });

      await deleteLine(w, gone);

      const view = await viewOf(held);
      // The covered "Milk" counts as another product, so what went is no
      // longer in the basket.
      expect(view.rows).toHaveLength(2);
      expect(view.rows.find((row) => row.rowKey === kept.id)).toMatchObject({
        productId: pascual,
        mark: null,
      });
      expect(view.rows.find((row) => row.rowKey === gone.id)).toMatchObject({
        content: 'Milk',
        // A removed row holds no entries, so it counts as no product.
        productId: null,
        state: BasketRowState.REMOVED,
        mark: BasketRowMark.REMOVED,
        entries: [],
      });
      const page = await changes.list({
        basketId: held.basket.id,
        participantId: held.participantId,
      });
      expect(page.items[0].rowKey).toBeNull();
    });

    it('points a change of a covered line at that line, and not at the anchor of its row', async () => {
      const w = await world('change row key');
      const flat = await list(w, 'Flat');
      const parents = await list(w, 'Parents');
      const held = await basket(w, flat, parents);
      const other = await basket(w, flat, parents);
      const pascual = randomUUID();
      const anchor = await line(w, flat, 'Milk', { itemIds: [pascual] });
      const newer = await line(w, parents, 'Leche', { itemIds: [pascual] });

      // Bought through another basket, which is a change in this one.
      await buy(other, [newer], 1, 2);

      const page = await changes.list({
        basketId: held.basket.id,
        participantId: held.participantId,
      });
      expect(page.items).toHaveLength(1);
      // Before plan 0201 this was the anchor of the row. A read with picks can
      // group the lines in another way, so the change names its own line.
      expect(page.items[0].rowKey).toBe(newer.id);
      expect(page.items[0].rowKey).not.toBe(anchor.id);
      // Every line of the row carries the mark of the row.
      const marks = await changes.marksOf({
        basketId: held.basket.id,
        participantId: held.participantId,
      });
      expect(marks.lines).toEqual([
        { lineId: anchor.id, mark: BasketRowMark.CHANGED },
        { lineId: newer.id, mark: BasketRowMark.CHANGED },
      ]);
    });
  });
});
