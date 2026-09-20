import {
  BasketKind,
  GeneratedLineOrigin,
  GeneratedListStatus,
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
import {
  BasketSource,
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  GeneratedListParticipant,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { GeneratedListLineRenameService } from './generated-list-line-rename.service';
import { GeneratedListLineService } from './generated-list-line.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';
import { WaitingSettlementService } from './waiting-settlement.service';

/**
 * Renaming a basket line renames its lines (plan 0113, section 10).
 *
 * Against Postgres, because nearly everything asserted is rows moving under
 * locks: zone lines renamed and merged through plan 0112's merge, origin rows
 * that the zone merge moves and the basket merge then folds under a unique key,
 * settlements and options that belong to a basket line which is deleted, and a
 * refusal that must leave every one of those tables exactly as it was.
 *
 * The zone line service, the merge, the list access and the basket projection
 * are all real. The sharing service is a double: its participant lookup reads
 * the real table, and `writableAmong` asks the real list access, because the
 * SQL behind the real one is plan 0051's and its own specs own it.
 */
describeIntegration(
  'renaming a basket line renames its lines (real Postgres)',
  () => {
    let dataSource: DataSource;
    let renames: GeneratedListLineRenameService;
    let lineWrites: GeneratedListLineService;
    const zoneEmit = jest.fn();
    const basketEvents = {
      emit: jest.fn(),
      emitToUsers: jest.fn(),
      emitToGeneratedList: jest.fn(),
    };

    const ITEM_A = randomUUID();
    const ITEM_B = randomUUID();
    const ids = {
      zone: '',
      flat: '',
      parents: '',
      basket: '',
      owner: randomUUID(),
      friend: randomUUID(),
      reader: randomUUID(),
    };
    /** Participant row ids, one per kind of reader. */
    const people = { owner: '', friend: '', reader: '', guest: '' };

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      const memberships = dataSource.getRepository(ZoneMembership);
      const listAccess = new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(memberships)
      );
      const claims = fakeLineClaims();
      const zoneLines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        claims.service,
        { emit: zoneEmit } as never,
        new CoreAuditService(dataSource),
        new LineMergeService()
      );
      const generated = new GeneratedListService(
        dataSource,
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOrigin),
        dataSource.getRepository(GeneratedListLineOption),
        dataSource.getRepository(LineSettlement),
        // The run's profile resolution and walk order, which no projection reads.
        undefined as never,
        claims.service,
        basketEvents as never,
        undefined as never,
        undefined as never,
        dataSource.getRepository(BasketSource)
      );
      const participants = dataSource.getRepository(GeneratedListParticipant);
      const sharing = {
        liveParticipantById: (participantId: string, generatedListId: string) =>
          participants.findOne({
            where: { id: participantId, generatedListId, revokedAt: IsNull() },
          }),
        writableAmong: async (userId: string, listIds: readonly string[]) => {
          const writable = new Set<string>();
          for (const listId of listIds) {
            const { permissions } = await listAccess.resolve(listId, userId);
            if (permissions.has(ListPermission.WRITE)) {
              writable.add(listId);
            }
          }
          return writable;
        },
        seesZoneData: async (participant: GeneratedListParticipant) =>
          participant.kind === ParticipantKind.OWNER,
        ensureOwnerParticipant: () =>
          participants.findOneOrFail({ where: { id: people.owner } }),
      } as unknown as GeneratedListSharingService;

      renames = new GeneratedListLineRenameService(
        dataSource,
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOrigin),
        dataSource.getRepository(ShoppingList),
        zoneLines,
        listAccess,
        sharing,
        generated,
        basketEvents as never
      );
      lineWrites = new GeneratedListLineService(
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOption),
        generated,
        listAccess,
        zoneLines,
        claims.service,
        sharing,
        new WaitingSettlementService(claims.service, {
          emit: jest.fn(),
        } as never),
        basketEvents as never,
        renames
      );

      const zone = await dataSource.getRepository(Zone).save(
        dataSource.getRepository(Zone).create({
          name: 'Rename Basket Zone',
          joinCode: `RBL${Date.now()}`.slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: ids.owner,
          config: {},
        })
      );
      ids.zone = zone.id;

      const lists = dataSource.getRepository(ShoppingList);
      for (const [key, name] of [
        ['flat', 'Flat'],
        ['parents', 'Parents'],
      ] as const) {
        ids[key] = (
          await lists.save(
            lists.create({ zoneId: zone.id, name, createdByUserId: ids.owner })
          )
        ).id;
      }

      // The owner holds everything by role. The friend writes both lists and
      // decides neither, which is the caller plan 0112's approval refusal is
      // about. The reader writes the flat's list and only reads the parents'.
      await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId: ids.owner,
          username: 'Owner',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
      const readWrite = [ListPermission.READ, ListPermission.WRITE];
      for (const [userId, username, access] of [
        [ids.friend, 'Friend', { flat: readWrite, parents: readWrite }],
        [
          ids.reader,
          'Reader',
          { flat: readWrite, parents: [ListPermission.READ] },
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
        for (const [listKey, permissions] of Object.entries(access)) {
          await dataSource.getRepository(ListAccess).save(
            dataSource.getRepository(ListAccess).create({
              listId: ids[listKey as 'flat' | 'parents'],
              membershipId: membership.id,
              permissions: [...permissions],
            })
          );
        }
      }

      const basket = await dataSource.getRepository(GeneratedList).save(
        dataSource.getRepository(GeneratedList).create({
          ownerUserId: ids.owner,
          name: 'Saturday',
          status: GeneratedListStatus.OPEN,
          generatedAt: new Date(),
          kind: BasketKind.GENERATED,
          defaultTargetListId: null,
          idempotencyKey: null,
        })
      );
      ids.basket = basket.id;

      const now = new Date();
      for (const [key, kind, userId, guestNumber] of [
        ['owner', ParticipantKind.OWNER, ids.owner, null],
        ['friend', ParticipantKind.REGISTERED, ids.friend, null],
        ['reader', ParticipantKind.REGISTERED, ids.reader, null],
        ['guest', ParticipantKind.GUEST, null, 1],
      ] as const) {
        people[key] = (
          await participants.save(
            participants.create({
              generatedListId: basket.id,
              kind,
              userId,
              guestNumber,
              joinedAt: now,
              lastSeenAt: now,
            })
          )
        ).id;
      }
    });

    afterAll(async () => {
      if (ids.basket) {
        await dataSource
          .getRepository(LineSettlement)
          .delete({ settledByParticipantId: people.owner });
        // Participants, lines, options and origins cascade from the basket.
        await dataSource
          .getRepository(GeneratedList)
          .delete({ id: ids.basket });
      }
      if (ids.zone) {
        // Memberships, lists, access rows and lines cascade from the zone.
        await dataSource.getRepository(Zone).delete({ id: ids.zone });
      }
      await dataSource?.destroy();
    });

    beforeEach(async () => {
      zoneEmit.mockReset();
      basketEvents.emit.mockReset();
      basketEvents.emitToUsers.mockReset();
      basketEvents.emitToGeneratedList.mockReset();
      await dataSource
        .getRepository(LineSettlement)
        .delete({ settledByParticipantId: people.owner });
      await dataSource
        .getRepository(GeneratedListLine)
        .delete({ generatedListId: ids.basket });
      await dataSource.getRepository(ListLine).delete({ listId: ids.flat });
      await dataSource.getRepository(ListLine).delete({ listId: ids.parents });
    });

    async function seedZoneLine(seed: {
      listId: string;
      content: string;
      position: number;
      quantity?: number;
      approvalStatus?: LineApprovalStatus;
    }): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      const approved = seed.approvalStatus === LineApprovalStatus.APPROVED;
      return repo.save(
        repo.create({
          listId: seed.listId,
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

    async function seedBasketLine(seed: {
      content: string;
      position: number;
      quantity?: number;
      settledQuantity?: number;
      origins?: { line: ListLine; quantity: number }[];
      options?: string[];
    }): Promise<GeneratedListLine> {
      const repo = dataSource.getRepository(GeneratedListLine);
      const origins = seed.origins ?? [];
      const line = await repo.save(
        repo.create({
          generatedListId: ids.basket,
          content: seed.content,
          quantity: seed.quantity ?? 1,
          settledQuantity: seed.settledQuantity ?? 0,
          itemId: null,
          origin:
            origins.length > 0
              ? GeneratedLineOrigin.DERIVED
              : GeneratedLineOrigin.ADDED,
          targetListId: null,
          position: seed.position,
        })
      );
      for (const origin of origins) {
        await dataSource.getRepository(GeneratedListLineOrigin).insert({
          generatedListLineId: line.id,
          zoneId: ids.zone,
          listId: origin.line.listId,
          lineId: origin.line.id,
          quantity: origin.quantity,
          lineVersion: origin.line.version,
        });
      }
      if (seed.options?.length) {
        await dataSource.getRepository(GeneratedListLineOption).insert(
          seed.options.map((itemId, position) => ({
            generatedListLineId: line.id,
            itemId,
            position,
          }))
        );
      }
      return line;
    }

    function renameAs(
      participantId: string,
      line: GeneratedListLine,
      content: string,
      confirmMerge?: boolean
    ) {
      return renames.renameAsParticipant({
        generatedListId: ids.basket,
        lineId: line.id,
        participantId,
        content,
        confirmMerge,
      });
    }

    async function zoneLines(listId: string): Promise<ListLine[]> {
      return dataSource.getRepository(ListLine).find({
        where: { listId },
        order: { position: 'ASC', id: 'ASC' },
      });
    }

    async function basketLine(id: string): Promise<GeneratedListLine | null> {
      return dataSource
        .getRepository(GeneratedListLine)
        .findOne({ where: { id } });
    }

    async function originsOf(generatedListLineId: string) {
      const rows = await dataSource
        .getRepository(GeneratedListLineOrigin)
        .find({ where: { generatedListLineId }, order: { quantity: 'ASC' } });
      return rows.map((row) => ({
        lineId: row.lineId,
        quantity: row.quantity,
      }));
    }

    /** One basket line from each list's "leche", the everyday case. */
    async function lecheFromBothLists() {
      const flatLeche = await seedZoneLine({
        listId: ids.flat,
        content: 'leche',
        position: 1,
        quantity: 2,
      });
      const parentsLeche = await seedZoneLine({
        listId: ids.parents,
        content: 'Leche',
        position: 1,
      });
      const line = await seedBasketLine({
        content: 'leche',
        position: 1,
        quantity: 3,
        origins: [
          { line: flatLeche, quantity: 2 },
          { line: parentsLeche, quantity: 1 },
        ],
      });
      return { flatLeche, parentsLeche, line };
    }

    /**
     * The flat's list already asks for Milk, and a basket line from its "leche"
     * sits below a basket line from its Milk.
     */
    async function milkAndLecheInOneList() {
      const flatMilk = await seedZoneLine({
        listId: ids.flat,
        content: 'Milk',
        position: 1,
        quantity: 2,
      });
      const flatLeche = await seedZoneLine({
        listId: ids.flat,
        content: 'leche',
        position: 2,
        quantity: 3,
      });
      const milk = await seedBasketLine({
        content: 'Milk',
        position: 1,
        quantity: 2,
        settledQuantity: 1,
        origins: [{ line: flatMilk, quantity: 2 }],
        options: [ITEM_A],
      });
      const leche = await seedBasketLine({
        content: 'leche',
        position: 2,
        quantity: 3,
        settledQuantity: 1,
        origins: [{ line: flatLeche, quantity: 3 }],
        options: [ITEM_A, ITEM_B],
      });
      return { flatMilk, flatLeche, milk, leche };
    }

    it('renames the basket line and every zone line it came from (case 1)', async () => {
      const { flatLeche, parentsLeche, line } = await lecheFromBothLists();

      const result = await renameAs(people.friend, line, 'Milk');

      expect(result.line.id).toBe(line.id);
      expect(result.line.content).toBe('Milk');
      expect('absorbedLineId' in result).toBe(false);
      expect((await zoneLines(ids.flat)).map((row) => row.id)).toEqual([
        flatLeche.id,
      ]);
      expect((await zoneLines(ids.flat))[0].content).toBe('Milk');
      expect((await zoneLines(ids.parents))[0].id).toBe(parentsLeche.id);
      expect((await zoneLines(ids.parents))[0].content).toBe('Milk');
      const stored = await basketLine(line.id);
      expect(stored?.content).toBe('Milk');
      expect(stored?.lastEditedByParticipantId).toBe(people.friend);
      // Each list room hears its own line, and nothing is deleted.
      expect(zoneEmit.mock.calls.map((call) => call[0])).toEqual([
        RealtimeEvent.LineUpdated,
        RealtimeEvent.LineUpdated,
      ]);
    });

    it('refuses somebody who cannot write one origin list, and renames nothing (case 2)', async () => {
      const { line } = await lecheFromBothLists();

      await expect(renameAs(people.reader, line, 'Milk')).rejects.toMatchObject(
        { code: 'forbidden' }
      );

      expect((await zoneLines(ids.flat))[0].content).toBe('leche');
      expect((await zoneLines(ids.parents))[0].content).toBe('Leche');
      expect((await basketLine(line.id))?.content).toBe('leche');
      expect(zoneEmit).not.toHaveBeenCalled();
    });

    it('refuses a guest (case 3)', async () => {
      const { line } = await lecheFromBothLists();

      await expect(renameAs(people.guest, line, 'Milk')).rejects.toMatchObject({
        code: 'forbidden',
      });
      expect((await basketLine(line.id))?.content).toBe('leche');
    });

    it('lets only the owner rename a line that is on no list (case 4)', async () => {
      const line = await seedBasketLine({ content: 'batteries', position: 1 });

      await expect(
        renameAs(people.friend, line, 'AA batteries')
      ).rejects.toMatchObject({ code: 'forbidden' });
      const result = await renameAs(people.owner, line, 'AA batteries');

      expect(result.line.content).toBe('AA batteries');
      expect(zoneEmit).not.toHaveBeenCalled();
    });

    it('names the list and zone a name is taken on, and writes nothing without confirmMerge (case 5)', async () => {
      const flatMilk = await seedZoneLine({
        listId: ids.flat,
        content: 'Milk',
        position: 1,
        quantity: 3,
      });
      const flatLeche = await seedZoneLine({
        listId: ids.flat,
        content: 'leche',
        position: 2,
        quantity: 2,
      });
      const line = await seedBasketLine({
        content: 'leche',
        position: 1,
        quantity: 2,
        origins: [{ line: flatLeche, quantity: 2 }],
      });

      await expect(renameAs(people.friend, line, 'milk')).rejects.toMatchObject(
        {
          code: 'line_merge_required',
          details: {
            lists: [
              {
                listId: ids.flat,
                listName: 'Flat',
                zoneName: 'Rename Basket Zone',
                otherContent: 'Milk',
                otherQuantity: 3,
              },
            ],
            basket: null,
          },
        }
      );

      expect(
        (await zoneLines(ids.flat)).map((row) => [row.id, row.content])
      ).toEqual([
        [flatMilk.id, 'Milk'],
        [flatLeche.id, 'leche'],
      ]);
      expect((await basketLine(line.id))?.content).toBe('leche');
      expect(zoneEmit).not.toHaveBeenCalled();
      expect(basketEvents.emitToGeneratedList).not.toHaveBeenCalled();
    });

    it('merges the zone lines as plan 0112 does once confirmed, and renames the basket line (case 6)', async () => {
      const flatMilk = await seedZoneLine({
        listId: ids.flat,
        content: 'Milk',
        position: 1,
        quantity: 3,
      });
      const flatLeche = await seedZoneLine({
        listId: ids.flat,
        content: 'leche',
        position: 2,
        quantity: 2,
      });
      const line = await seedBasketLine({
        content: 'leche',
        position: 1,
        quantity: 2,
        origins: [{ line: flatLeche, quantity: 2 }],
      });

      const result = await renameAs(people.friend, line, 'milk', true);

      const flat = await zoneLines(ids.flat);
      expect(flat.map((row) => [row.id, row.content, row.quantity])).toEqual([
        [flatMilk.id, 'Milk', 5],
      ]);
      // The zone merge moved the basket line's origin onto the survivor.
      expect(await originsOf(line.id)).toEqual([
        { lineId: flatMilk.id, quantity: 2 },
      ]);
      expect(result.line.content).toBe('milk');
      expect('absorbedLineId' in result).toBe(false);
      expect(zoneEmit.mock.calls.map((call) => call[0])).toEqual([
        RealtimeEvent.LineDeleted,
        RealtimeEvent.LineUpdated,
      ]);
      expect(zoneEmit.mock.calls[0][2]).toEqual({
        id: flatLeche.id,
        listId: ids.flat,
      });
    });

    it('names the basket line a name is taken by, beside the list, in one refusal', async () => {
      const { milk, leche } = await milkAndLecheInOneList();

      await expect(renameAs(people.owner, leche, 'milk')).rejects.toMatchObject(
        {
          code: 'line_merge_required',
          details: {
            lists: [
              { listId: ids.flat, otherContent: 'Milk', otherQuantity: 2 },
            ],
            basket: {
              otherLineId: milk.id,
              otherContent: 'Milk',
              otherQuantity: 2,
            },
          },
        }
      );
      expect(await basketLine(leche.id)).not.toBeNull();
      expect(await zoneLines(ids.flat)).toHaveLength(2);
    });

    it('merges two basket lines once confirmed: summed numbers, one origin, moved settlements and options (cases 7 and 11)', async () => {
      const { flatMilk, flatLeche, milk, leche } =
        await milkAndLecheInOneList();
      const settlement = await dataSource.getRepository(LineSettlement).save(
        dataSource.getRepository(LineSettlement).create({
          lineId: flatLeche.id,
          listId: ids.flat,
          itemId: null,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          settledByParticipantId: people.owner,
          settledAt: new Date(),
          generatedListLineId: leche.id,
        })
      );

      const result = await renameAs(people.owner, leche, 'milk', true);

      // The earlier line survives, with its own spelling.
      expect(result.absorbedLineId).toBe(leche.id);
      expect(result.line.id).toBe(milk.id);
      expect(result.line.content).toBe('Milk');
      // The answer reflects the writes rather than the row read before them.
      expect(result.line.quantity).toBe(5);
      expect(result.line.settledQuantity).toBe(2);
      expect(result.line.options).toEqual([ITEM_A, ITEM_B]);
      expect(result.line.origins?.map((origin) => origin.quantity)).toEqual([
        5,
      ]);

      expect(await basketLine(leche.id)).toBeNull();
      // Both basket lines ended on one zone line, so their origins are one row.
      expect(await originsOf(milk.id)).toEqual([
        { lineId: flatMilk.id, quantity: 5 },
      ]);
      const moved = await dataSource
        .getRepository(LineSettlement)
        .findOneOrFail({ where: { id: settlement.id } });
      expect(moved.generatedListLineId).toBe(milk.id);
      expect(moved.lineId).toBe(flatMilk.id);

      const basketRoom = basketEvents.emitToGeneratedList.mock.calls;
      expect(basketRoom.map((call) => call[0])).toEqual([
        RealtimeEvent.GeneratedListLineRemoved,
        RealtimeEvent.GeneratedListLineUpdated,
      ]);
      expect(basketRoom[0][2]).toEqual({
        generatedListId: ids.basket,
        lineId: leche.id,
      });
    });

    it('refuses the whole rename when a pending zone line would merge into an approved one, naming the list (case 8)', async () => {
      await seedZoneLine({
        listId: ids.flat,
        content: 'Milk',
        position: 1,
        approvalStatus: LineApprovalStatus.APPROVED,
      });
      const flatLeche = await seedZoneLine({
        listId: ids.flat,
        content: 'leche',
        position: 2,
      });
      const parentsLeche = await seedZoneLine({
        listId: ids.parents,
        content: 'leche',
        position: 1,
      });
      const line = await seedBasketLine({
        content: 'leche',
        position: 1,
        quantity: 2,
        origins: [
          { line: flatLeche, quantity: 1 },
          { line: parentsLeche, quantity: 1 },
        ],
      });

      await expect(
        renameAs(people.friend, line, 'milk', true)
      ).rejects.toMatchObject({
        code: 'line_merge_needs_approval',
        messageArgs: { listName: 'Flat' },
      });

      expect((await zoneLines(ids.flat)).map((row) => row.content)).toEqual([
        'Milk',
        'leche',
      ]);
      expect((await zoneLines(ids.parents))[0].content).toBe('leche');
      expect((await basketLine(line.id))?.content).toBe('leche');
    });

    it('broadcasts the surviving line to the basket room with no zone data (case 9)', async () => {
      const { line } = await lecheFromBothLists();

      await renameAs(people.owner, line, 'Milk');

      const room = basketEvents.emitToGeneratedList.mock.calls.find(
        (call) => call[0] === RealtimeEvent.GeneratedListLineUpdated
      );
      expect(room).toBeDefined();
      const payload = room?.[2] as { line: Record<string, unknown> };
      expect(payload.line['content']).toBe('Milk');
      expect('origins' in payload.line).toBe(false);
      expect('targetListId' in payload.line).toBe(false);
      expect('origin' in payload.line).toBe(false);
      const wire = JSON.stringify(payload);
      for (const secret of [
        ids.flat,
        ids.parents,
        ids.zone,
        'Flat',
        'Parents',
      ]) {
        expect(wire).not.toContain(secret);
      }
      // The owner's own sessions hear the owner's projection, as for any edit.
      const owner = basketEvents.emitToUsers.mock.calls.find(
        (call) => call[0] === RealtimeEvent.GeneratedListLineUpdated
      );
      expect(owner?.[1]).toEqual([ids.owner]);
    });

    it('gives the owner the same rename through the old line edit (case 10)', async () => {
      const { flatMilk, milk, leche } = await milkAndLecheInOneList();

      await expect(
        lineWrites.updateLine({
          userId: ids.owner,
          generatedListId: ids.basket,
          lineId: leche.id,
          content: 'milk',
        })
      ).rejects.toMatchObject({
        code: 'line_merge_required',
        details: { basket: { otherLineId: milk.id } },
      });

      const result = await lineWrites.updateLine({
        userId: ids.owner,
        generatedListId: ids.basket,
        lineId: leche.id,
        content: 'milk',
        confirmMerge: true,
      });

      expect(result.id).toBe(milk.id);
      expect(result.absorbedLineId).toBe(leche.id);
      expect(result.quantity).toBe(5);
      expect((await zoneLines(ids.flat)).map((row) => row.id)).toEqual([
        flatMilk.id,
      ]);
      expect(await basketLine(leche.id)).toBeNull();
    });

    it('folds two lines of one list that a basket line came from into one', async () => {
      // Plan 0091 migrated no duplicates, so one basket line can carry two lines
      // of one list. Renamed together, the second meets the first's new name.
      const first = await seedZoneLine({
        listId: ids.flat,
        content: 'leche',
        position: 1,
        quantity: 1,
      });
      const second = await seedZoneLine({
        listId: ids.flat,
        content: 'leche entera',
        position: 2,
        quantity: 2,
      });
      const line = await seedBasketLine({
        content: 'leche',
        position: 1,
        quantity: 3,
        origins: [
          { line: first, quantity: 1 },
          { line: second, quantity: 2 },
        ],
      });

      await expect(renameAs(people.friend, line, 'Milk')).rejects.toMatchObject(
        {
          code: 'line_merge_required',
          details: {
            lists: [
              { listId: ids.flat, otherContent: 'Milk', otherQuantity: 1 },
            ],
          },
        }
      );
      expect((await zoneLines(ids.flat)).map((row) => row.content)).toEqual([
        'leche',
        'leche entera',
      ]);

      await renameAs(people.friend, line, 'Milk', true);

      expect(
        (await zoneLines(ids.flat)).map((row) => [
          row.id,
          row.content,
          row.quantity,
        ])
      ).toEqual([[first.id, 'Milk', 3]]);
      expect(await originsOf(line.id)).toEqual([
        { lineId: first.id, quantity: 3 },
      ]);
    });
  }
);
