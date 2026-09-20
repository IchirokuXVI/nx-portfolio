import { COVERED_LINES_SQL } from '../baskets/basket.sql';
import {
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  MergeRequestStatus,
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
  CommentAudio,
  CORE_ENTITIES,
  LineComment,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  MergeRequest,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import {
} from '../generated-lists/generated-list.sql';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { MergeService } from '../merge/merge.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { LIST_COUNTS_SQL } from '../zones/zone-summary.sql';
import { LineMergeService } from './line-merge.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { LISTS_HOLDING_ITEM_SQL } from './list-holding.sql';
import { SettlementService } from './settlement.service';
import { SUGGESTION_CANDIDATES_SQL } from './suggestions/suggestions.sql';

/**
 * A deleted line keeps its purchases, against real Postgres (plan 0132).
 *
 * Every assertion here needs a database. Two of them need one because the
 * behaviour under test is TypeORM's own and a fake would agree with either
 * answer: whether `@DeleteDateColumn` filters a locking read, and whether
 * `repo.delete` stays a real delete on a soft deletable entity. The rest need
 * one because the predicate they prove is written in raw SQL, which the column
 * does not reach, so a fake repository returning rows would agree with the
 * predicate being missing.
 *
 * What the fixture is: one zone, one list, and lines seeded per test. A purchase
 * is a `line_settlements` row, which is the thing this plan exists to keep.
 */
describeIntegration(
  'a deleted line keeps its purchases (real Postgres)',
  () => {
    let dataSource: DataSource;
    let lines: LineService;
    let settlements: SettlementService;
    let merges: MergeService;
    const emit = jest.fn();

    const MILK = randomUUID();
    const ids = {
      zone: '',
      list: '',
      owner: randomUUID(),
      other: randomUUID(),
    };

    async function seedLine(
      content: string,
      options: {
        quantity?: number;
        approvalStatus?: LineApprovalStatus;
        itemIds?: string[];
        productGroupId?: string | null;
      } = {}
    ): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      const line = await repo.save(
        repo.create({
          listId: ids.list,
          content,
          quantity: options.quantity ?? 2,
          approvalStatus: options.approvalStatus ?? LineApprovalStatus.APPROVED,
          position: 1,
          createdByUserId: ids.owner,
          productGroupId: options.productGroupId ?? null,
        })
      );
      for (const [position, itemId] of (options.itemIds ?? []).entries()) {
        const items = dataSource.getRepository(ListLineItem);
        await items.save(items.create({ lineId: line.id, itemId, position }));
      }
      return line;
    }

    /** One purchase of a line, at a stated moment so nothing is a race. */
    async function purchase(
      line: ListLine,
      at: string
    ): Promise<LineSettlement> {
      const repo = dataSource.getRepository(LineSettlement);
      return repo.save(
        repo.create({
          lineId: line.id,
          listId: ids.list,
          itemId: MILK,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          settledByUserId: ids.owner,
          settledAt: new Date(at),
        })
      );
    }

    /** The row as the database holds it, deleted or not. */
    async function rawLine(
      lineId: string
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await dataSource.query(
        `SELECT * FROM "list_lines" WHERE "id" = $1`,
        [lineId]
      );
      return rows[0];
    }

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      const zone = await dataSource.getRepository(Zone).save(
        dataSource.getRepository(Zone).create({
          name: 'Home',
          joinCode: `SD${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(
            0,
            16
          ),
          status: ZoneStatus.ACTIVE,
          ownerUserId: ids.owner,
          config: {},
        })
      );
      ids.zone = zone.id;
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId: ids.owner,
          username: 'Owner',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
      await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId: ids.other,
          username: 'Other',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
      const list = await dataSource.getRepository(ShoppingList).save(
        dataSource.getRepository(ShoppingList).create({
          zoneId: zone.id,
          name: 'Weekly shop',
          createdByUserId: ids.owner,
        })
      );
      ids.list = list.id;

      // The second member can delete an approved line, which is what the merge
      // case needs: a tombstone whose deleter is somebody other than the owner.
      const grants = dataSource.getRepository(ListAccess);
      const membership = await memberships.findOneOrFail({
        where: { zoneId: zone.id, userId: ids.other },
      });
      await grants.save(
        grants.create({
          listId: list.id,
          membershipId: membership.id,
          permissions: [ListPermission.READ, ListPermission.MANAGE],
        })
      );

      const listAccess = new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(memberships)
      );
      lines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        { emit } as never,
        new CoreAuditService(dataSource),
        new LineMergeService()
      );
      settlements = new SettlementService(
        dataSource,
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        { emit } as never
      );
      merges = new MergeService(
        dataSource,
        dataSource.getRepository(MergeRequest),
        memberships,
        new ZoneAuthzService(memberships),
        // An approved merge also tells the kicked member, through the audience
        // form of the publisher (plan 0111).
        { emit, emitTo: emit } as never
      );
    });

    afterAll(async () => {
      if (ids.zone) {
        // Memberships, the list, its lines and everything hanging off them all
        // cascade from the zone, a soft deleted line included.
        await dataSource.getRepository(Zone).delete({ id: ids.zone });
      }
      await dataSource?.destroy();
    });

    beforeEach(async () => {
      emit.mockClear();
      // A real delete rather than a soft one: these are the fixtures of the last
      // test, and a tombstone left behind would be counted by the next.
      await dataSource.query(`DELETE FROM "list_lines" WHERE "listId" = $1`, [
        ids.list,
      ]);
    });

    describe("what TypeORM's soft delete does, before anything is built on it", () => {
      it('does not return a soft deleted line to a locking findOne', async () => {
        // The load bearing one (plan 0132, section 9, test 1). A basket settle
        // reads its origin with exactly this call
        // (`generated-list-settle.service.ts`), and the reopen does too. If the
        // column did not reach a locked read, a soft deleted origin would settle
        // as though it still stood instead of reporting ORIGIN_DELETED.
        const line = await seedLine('Milk');
        await dataSource.getRepository(ListLine).softDelete({ id: line.id });

        const found = await dataSource.transaction((manager) =>
          manager.getRepository(ListLine).findOne({
            where: { id: line.id },
            lock: { mode: 'pessimistic_write' },
          })
        );

        expect(found).toBeNull();
        // Still there, which is the difference between this and a real delete.
        expect(await rawLine(line.id)).toBeDefined();
      });

      it('still deletes for real through repo.delete', async () => {
        // The rename merge depends on this (plan 0132, section 9, test 2): it
        // moves everything onto the survivor and then removes the absorbed row,
        // and a `delete` that had quietly become soft would leave a ghost behind
        // every rename.
        const line = await seedLine('Bread');

        await dataSource.getRepository(ListLine).delete({ id: line.id });

        expect(await rawLine(line.id)).toBeUndefined();
      });
    });

    describe("a member's delete (section 6)", () => {
      it('keeps the row, marks it, and empties what it held', async () => {
        const line = await seedLine('Milk', {
          itemIds: [MILK],
          productGroupId: randomUUID(),
        });
        await dataSource
          .getRepository(ListLine)
          .update({ id: line.id }, { itemSetHash: 'a-hash' });
        const comments = dataSource.getRepository(LineComment);
        const comment = await comments.save(
          comments.create({
            lineId: line.id,
            listId: ids.list,
            authorUserId: ids.owner,
            body: 'the blue one',
          })
        );
        const audio = dataSource.getRepository(CommentAudio);
        await audio.save(
          audio.create({
            commentId: comment.id,
            contentType: 'audio/webm',
            audio: Buffer.from([1, 2, 3]),
          })
        );
        const removals = dataSource.getRepository(ListLineGroupRemoval);
        await removals.save(
          removals.create({ lineId: line.id, itemId: randomUUID() })
        );

        await expect(
          lines.delete({ userId: ids.owner, lineId: line.id })
        ).resolves.toEqual({ id: line.id });

        const row = await rawLine(line.id);
        expect(row).toMatchObject({
          content: 'Milk',
          quantity: 2,
          listId: ids.list,
          deletedByUserId: ids.owner,
          itemSetHash: null,
          productGroupId: null,
          // Not bumped: nothing reconciles against a deleted line (section 2).
          version: line.version,
        });
        expect(row?.['deletedAt']).toBeInstanceOf(Date);

        // What a client acts on is unchanged: one `line.deleted`, carrying the
        // two ids it has always carried (section 7).
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(
          RealtimeEvent.LineDeleted,
          ids.zone,
          { id: line.id, listId: ids.list },
          ids.list
        );

        // Everything it owned apart from its purchases, gone in the same
        // transaction, `comment_audio` through its comment.
        expect(await comments.count({ where: { lineId: line.id } })).toBe(0);
        expect(await audio.count({ where: { commentId: comment.id } })).toBe(0);
        expect(
          await dataSource
            .getRepository(ListLineItem)
            .count({ where: { lineId: line.id } })
        ).toBe(0);
        expect(await removals.count({ where: { lineId: line.id } })).toBe(0);
      });

      it('answers not found the second time', async () => {
        const line = await seedLine('Milk');
        await lines.delete({ userId: ids.owner, lineId: line.id });

        await expect(
          lines.delete({ userId: ids.owner, lineId: line.id })
        ).rejects.toThrow('Line not found');
      });

      it('lets the same text come back as a new line, merging into nothing', async () => {
        const line = await seedLine('Milk');
        await purchase(line, '2026-01-01T10:00:00.000Z');
        await lines.delete({ userId: ids.owner, lineId: line.id });

        const added = await lines.add({
          userId: ids.owner,
          listId: ids.list,
          content: 'Milk',
          quantity: 1,
        });

        expect(added.line.id).not.toBe(line.id);
        expect(added.line.quantity).toBe(1);
        expect(added.merged).toBe(false);
      });
    });

    describe('the point of the plan (section 9, test 9)', () => {
      it('keeps both purchases, and serves them by product but not by line', async () => {
        const line = await seedLine('Milk', { itemIds: [MILK] });
        await purchase(line, '2026-01-01T10:00:00.000Z');
        await purchase(line, '2026-02-01T10:00:00.000Z');

        await lines.delete({ userId: ids.owner, lineId: line.id });

        const kept = await dataSource
          .getRepository(LineSettlement)
          .count({ where: { lineId: line.id } });
        expect(kept).toBe(2);

        // GET /v1/items/:id/settlements never joins `list_lines`, so a deleted
        // line's purchases are served with no change. That is the read the plan
        // promises "what did I spend" will keep answering.
        const byItem = await settlements.listForItem({
          userId: ids.owner,
          itemId: MILK,
        });
        expect(byItem.items).toHaveLength(2);

        // GET /v1/lines/:id/settlements goes through the gate, which is a
        // repository read, so the line is not there to have a history.
        await expect(
          settlements.listForLine({ userId: ids.owner, lineId: line.id })
        ).rejects.toThrow('Line not found');
      });
    });

    describe('the raw SQL reads (section 4.2)', () => {
      it('stops counting a line deleted while it still asked for two', async () => {
        const standing = await seedLine('Bread', { quantity: 1 });
        const going = await seedLine('Milk', { quantity: 2 });

        const before = await dataSource.query(
          `SELECT ${LIST_COUNTS_SQL} AS counts FROM "shopping_lists" l WHERE l.id = $1`,
          [ids.list]
        );
        expect(before[0].counts).toEqual({ lineCount: 2, wantedCount: 2 });

        await lines.delete({ userId: ids.owner, lineId: going.id });

        const after = await dataSource.query(
          `SELECT ${LIST_COUNTS_SQL} AS counts FROM "shopping_lists" l WHERE l.id = $1`,
          [ids.list]
        );
        expect(after[0].counts).toEqual({ lineCount: 1, wantedCount: 1 });
        expect(standing.id).toBeDefined();
      });

      it('is never a row of a basket that covers its list', async () => {
        const standing = await seedLine('Bread');
        const going = await seedLine('Milk');
        await lines.delete({ userId: ids.owner, lineId: going.id });

        // The run composed candidate lines until plan 0136 and composes none
        // now, so the question moved with it: a deleted line is not **covered**,
        // which is the one predicate every basket read shares. `deletedAt IS
        // NULL` sits in `COVERED_LINES_SQL` for exactly this.
        const covered = await dataSource.query(COVERED_LINES_SQL, [
          [ids.list],
          // No basket, so no purchase is in scope and the second half of the
          // predicate cannot put a line back on the screen.
          randomUUID(),
          null,
          false,
        ]);
        expect(covered.map((row: { id: string }) => row.id)).toEqual([
          standing.id,
        ]);
      });

      it('does not name the list as holding a product whose only line is deleted', async () => {
        const going = await seedLine('Milk', { itemIds: [MILK] });

        const before = await dataSource.query(LISTS_HOLDING_ITEM_SQL, [
          MILK,
          ids.owner,
          null,
          10,
        ]);
        expect(before).toHaveLength(1);

        await lines.delete({ userId: ids.owner, lineId: going.id });

        const after = await dataSource.query(LISTS_HOLDING_ITEM_SQL, [
          MILK,
          ids.owner,
          null,
          10,
        ]);
        expect(after).toEqual([]);
      });

      it('does not suggest a deleted line that sits at zero with purchases', async () => {
        const going = await seedLine('Milk', { quantity: 0 });
        await purchase(going, '2026-01-01T10:00:00.000Z');

        const before = await dataSource.query(SUGGESTION_CANDIDATES_SQL, [
          ids.list,
          new Date('2026-01-01T00:00:00.000Z'),
          // The skip window the claim's coverage fragment carries (plan 0137).
          // Nothing here skips anything.
          12 * 60 * 60 * 1000,
        ]);
        expect(before.map((row: { lineId: string }) => row.lineId)).toEqual([
          going.id,
        ]);

        await lines.delete({ userId: ids.owner, lineId: going.id });

        const after = await dataSource.query(SUGGESTION_CANDIDATES_SQL, [
          ids.list,
          new Date('2026-01-01T00:00:00.000Z'),
          // The skip window the claim's coverage fragment carries (plan 0137).
          // Nothing here skips anything.
          12 * 60 * 60 * 1000,
        ]);
        expect(after).toEqual([]);
      });
    });

    describe('the reads that must see a deleted line (section 4.3)', () => {
      it('moves deletedByUserId onto the target of a member merge', async () => {
        const line = await seedLine('Milk');
        await lines.delete({ userId: ids.other, lineId: line.id });
        expect((await rawLine(line.id))?.['deletedByUserId']).toBe(ids.other);

        const repo = dataSource.getRepository(MergeRequest);
        const request = await repo.save(
          repo.create({
            zoneId: ids.zone,
            sourceUserId: ids.other,
            targetUserId: ids.owner,
            requestedByUserId: ids.owner,
            status: MergeRequestStatus.PENDING,
          })
        );

        await merges.approve({
          userId: ids.owner,
          zoneId: ids.zone,
          mergeId: request.id,
        });

        // A merged away member must not remain the author of a tombstone, and the
        // update reaches it only because an UPDATE query builder is not filtered
        // by the soft delete column.
        expect((await rawLine(line.id))?.['deletedByUserId']).toBe(ids.owner);
      });
    });

    describe('a rename merge is still a real delete (section 9, test 8)', () => {
      it('removes the absorbed row and leaves its purchases on the survivor', async () => {
        const milk = await seedLine('Milk');
        const leche = await seedLine('Leche');
        const bought = await purchase(leche, '2026-01-01T10:00:00.000Z');

        const written = await lines.update({
          userId: ids.owner,
          lineId: leche.id,
          version: leche.version,
          content: 'Milk',
          confirmMerge: true,
        });

        // Which of the two survives is the earlier of them, so the result says
        // rather than the fixture: both were seeded at the same position and the
        // tie breaks on the id.
        const absorbedId = written.absorbedLineId as string;
        const survivorId = absorbedId === leche.id ? milk.id : leche.id;

        // Gone for real, tombstone and all, because a rename that left one behind
        // would leave a ghost behind every rename (plan 0132, section 6).
        expect(await rawLine(absorbedId)).toBeUndefined();
        const moved = await dataSource
          .getRepository(LineSettlement)
          .findOne({ where: { id: bought.id } });
        expect(moved?.lineId).toBe(survivorId);
      });
    });
  }
);
