import type { ConfigService } from '@nestjs/config';
import {
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  SettlementOutcome,
  VOICE_COMMENT_CONTENT_TYPES,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import type { ListAccess, ListLine, ShoppingList } from '../entities';
import {
  LineSettlement,
  ListLineGroupRemoval,
  ListLineItem,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { CommentService } from './comment.service';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { SettlementService } from './settlement.service';

/**
 * The permission matrix (plan 0036, acceptance items 2 to 6).
 *
 * Everything a caller may do on a list is now one question asked of one resolver,
 * so this file is mostly a table: four permission sets crossed with the
 * operations of section 4's call site table. It is worth being a table rather
 * than a handful of representative cases, because the whole point of the plan is
 * that `WRITE` and `DECIDE` are independent, and independence is only visible in
 * the cells where one is present and the other is not.
 *
 * The doubles are hand rolled in the style of `list-create-sharing.spec.ts`: a
 * repository is an object with the two or three methods the code under test
 * calls, and nothing pretends to be TypeORM. A mock deep enough to fake a query
 * builder is a mock that can be made to agree with anything.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const USER_ID = 'u1';
const MEMBERSHIP_ID = 'm1';

interface World {
  listAccess: ListAccessService;
  lines: LineService;
  settlements: SettlementService;
  comments: CommentService;
  saved: Partial<ListLine>[];
  deleted: string[];
  events: { event: string; payload: unknown }[];
  list: ShoppingList;
}

/**
 * A world in which one caller holds `permissions` on one list.
 *
 * `role` is the caller's ZoneRole, which matters on its own: group staff hold all
 * four by derivation and never consult the row at all (plan 0036, section 2.4),
 * so the staff cases pass `permissions: null` to prove no row is read.
 */
function world(options: {
  permissions: ListPermission[] | null;
  role?: ZoneRole;
  status?: MembershipStatus;
  line?: Partial<ListLine>;
  autoApproveLines?: boolean;
  nextPosition?: number | null;
}): World {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: 'somebody-else',
    autoApproveLines: options.autoApproveLines ?? false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const line = {
    id: 'li1',
    listId: LIST_ID,
    content: 'Tinned tomatoes',
    quantity: 3,
    itemSetHash: null,
    position: 10,
    approvalStatus: LineApprovalStatus.PENDING,
    createdByUserId: 'author',
    approvedByUserId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...options.line,
  } as ListLine;

  const saved: Partial<ListLine>[] = [];
  const deleted: string[] = [];
  const events: { event: string; payload: unknown }[] = [];

  const memberships = {
    findOne: async () =>
      ({
        id: MEMBERSHIP_ID,
        zoneId: ZONE_ID,
        userId: USER_ID,
        role: options.role ?? ZoneRole.MEMBER,
        status: options.status ?? MembershipStatus.APPROVED,
      }) as never,
  };

  const accessRepo = {
    findOne: async () =>
      options.permissions === null
        ? null
        : ({
            id: 'a1',
            listId: LIST_ID,
            membershipId: MEMBERSHIP_ID,
            permissions: options.permissions,
          } as ListAccess),
  };

  const lineRepo = {
    findOne: async () => line,
    find: async () => [line],
    create: (data: Partial<ListLine>) => ({ ...data }),
    save: async (row: Partial<ListLine>) => {
      // The timestamps the database would have stamped. `toLineView` reads them
      // on the way out, so a fake that omitted them would fail for a reason that
      // has nothing to do with permissions.
      const stored = {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        ...row,
        id: row.id ?? 'li-new',
      };
      saved.push(stored);
      return stored;
    },
    delete: async ({ id }: { id: string }) => {
      deleted.push(id);
      return { affected: 1 };
    },
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawOne: async () => ({
          max: 42,
          next: options.nextPosition ?? null,
        }),
      };
      return qb;
    },
  };

  const listRepo = { findOne: async () => list };

  const listAccess = new ListAccessService(
    listRepo as never,
    accessRepo as never,
    lineRepo as never,
    new ZoneAuthzService(memberships as never)
  );

  // Plan 0048: the line's product set. This file is about who may do what, not
  // about products, but every write path now touches a set.
  const lineItems = fakeLineItems();
  // Plan 0070: a write to a subscribed line's set can leave a tombstone. No line
  // here is subscribed, so nothing lands in it, but the repository has to exist.
  const groupRemovals = fakeGroupRemovals();

  // What a settle writes (plan 0047). This file asks who may settle rather than
  // what the history says, but both services read the table back on their way
  // out: one to count what it just wrote, one for the indicators every line
  // carries. So it is the shared fake rather than a save-only stub.
  const settlementRows = fakeLineSettlements();
  const settlementRepo = settlementRows.repo;

  const dataSource = {
    transaction: async <T>(run: (m: unknown) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineGroupRemoval) {
            return groupRemovals.repo;
          }
          if (entity === ListLineItem) {
            return lineItems.repo;
          }
          return entity === LineSettlement ? settlementRepo : lineRepo;
        },
      }),
  } as unknown as DataSource;

  const publisher = {
    emit: (event: string, _zoneId: string, payload: unknown) =>
      events.push({ event, payload }),
    emitTo: (event: string, _audience: unknown, payload: unknown) =>
      events.push({ event, payload }),
  } as unknown as CoreEventsPublisher;

  const lines = new LineService(
    dataSource,
    lineRepo as never,
    lineItems.repo as never,
    groupRemovals.repo as never,
    settlementRepo as never,
    listAccess,
    fakeLineClaims().service,
    publisher
  );

  const settlements = new SettlementService(
    dataSource,
    settlementRepo as never,
    listAccess,
    fakeLineClaims().service,
    publisher
  );

  const commentRepo = {
    create: (data: unknown) => data,
    save: async (row: Record<string, unknown>) => ({
      ...row,
      id: 'c1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
  };
  // The audio repository and the config are both here for the constructor's sake:
  // nothing in this file leaves a voice comment, and the point of these specs is
  // who may do what rather than what a recording weighs.
  const audioRepo = {
    create: (data: unknown) => data,
    save: async (row: unknown) => row,
    findOne: async () => null,
  };
  const config = {
    getOrThrow: () => ({
      voiceComment: {
        maxBytes: 2 * 1024 * 1024,
        contentTypes: [...VOICE_COMMENT_CONTENT_TYPES],
      },
    }),
  } as unknown as ConfigService;

  const comments = new CommentService(
    commentRepo as never,
    audioRepo as never,
    dataSource,
    listAccess,
    publisher,
    config
  );

  return {
    listAccess,
    lines,
    settlements,
    comments,
    saved,
    deleted,
    events,
    list,
  };
}

const READ_ONLY = [ListPermission.READ];
const WRITER = [ListPermission.READ, ListPermission.WRITE];
const DECIDER = [ListPermission.READ, ListPermission.DECIDE];
const LIST_ADMIN = [ListPermission.READ, ListPermission.MANAGE];

describe('permissionsFor (plan 0036, section 4)', () => {
  it('gives a zone OWNER all four without reading a row', async () => {
    const w = world({ permissions: null, role: ZoneRole.OWNER });

    const permissions = await w.listAccess.permissionsFor(w.list, USER_ID);

    expect([...permissions].sort()).toEqual(
      [
        ListPermission.DECIDE,
        ListPermission.MANAGE,
        ListPermission.READ,
        ListPermission.WRITE,
      ].sort()
    );
  });

  it('gives a zone ADMIN the same, on a list they were never granted', async () => {
    // Acceptance 1: group admins are supposed to have full access to every list
    // in their zone, and used to have an odd subset of it instead.
    const w = world({ permissions: null, role: ZoneRole.ADMIN });

    expect(await w.listAccess.permissionsFor(w.list, USER_ID)).toEqual(
      new Set([
        ListPermission.READ,
        ListPermission.WRITE,
        ListPermission.DECIDE,
        ListPermission.MANAGE,
      ])
    );
  });

  it('gives a plain member exactly what their row holds', async () => {
    const w = world({ permissions: DECIDER });

    expect(await w.listAccess.permissionsFor(w.list, USER_ID)).toEqual(
      new Set(DECIDER)
    );
  });

  it('gives a member with no row nothing at all', async () => {
    const w = world({ permissions: null });

    expect(await w.listAccess.permissionsFor(w.list, USER_ID)).toEqual(
      new Set()
    );
  });

  it('no longer treats the list creator as a manager', async () => {
    // Plan 0036, section 2.5. The creator's power is an ordinary row now, so a
    // group admin can revoke it; deriving it from `createdByUserId` made it
    // exactly as irrevocable as staff status.
    const w = world({ permissions: null });
    w.list.createdByUserId = USER_ID;

    expect(await w.listAccess.permissionsFor(w.list, USER_ID)).toEqual(
      new Set()
    );
  });

  it('refuses a caller whose membership is not approved, before any of it', async () => {
    // The exception the frontend keys off to tell "you are not in this group"
    // apart from "you are, but not on this list".
    const w = world({
      permissions: LIST_ADMIN,
      status: MembershipStatus.PENDING,
    });

    await expect(
      w.listAccess.permissionsFor(w.list, USER_ID)
    ).rejects.toThrow();
  });
});

describe('a member holding {READ} (acceptance 2)', () => {
  it('may list the lines', async () => {
    const w = world({ permissions: READ_ONLY });
    await expect(
      w.listAccess.requireRead(LIST_ID, USER_ID)
    ).resolves.toBeDefined();
  });

  it('may not add a line', async () => {
    const w = world({ permissions: READ_ONLY });
    await expect(
      w.lines.add({ userId: USER_ID, listId: LIST_ID, content: 'Olive oil' })
    ).rejects.toThrow();
  });

  it('may not comment, which is the half that used to be wrong', async () => {
    // Plan 0036, section 1.4: commenting asked only for an approved zone
    // membership, so a reader could comment and so could somebody with no access
    // to the list at all. Read should mean read.
    const w = world({ permissions: READ_ONLY });
    await expect(
      w.comments.add({ userId: USER_ID, lineId: 'li1', body: 'no' })
    ).rejects.toThrow();
  });

  it('may still read the comments', async () => {
    const w = world({ permissions: READ_ONLY });
    await expect(
      w.listAccess.requireRead(LIST_ID, USER_ID)
    ).resolves.toBeDefined();
  });

  it('may edit no field of an approved line, which plan 0076 did not widen', async () => {
    // The plan opened a door for `WRITE` and for nobody else, so this is the
    // regression it is most able to cause.
    const w = world({
      permissions: READ_ONLY,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', content: 'Passata' })
    ).rejects.toThrow(/write access/i);
    // Told that they cannot write, rather than that the quantity of an approved
    // line needs approval rights. The second is true of a writer and beside the
    // point for a reader, who is refused this line whatever its approval, so the
    // write check is asked first.
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', quantity: 1 })
    ).rejects.toThrow(/write access/i);
  });
});

describe('a member holding {READ, WRITE} (acceptance 3)', () => {
  it('adds a line', async () => {
    const w = world({ permissions: WRITER });
    await expect(
      w.lines.add({ userId: USER_ID, listId: LIST_ID, content: 'Olive oil' })
    ).resolves.toBeDefined();
  });

  it('edits a pending line', async () => {
    const w = world({ permissions: WRITER });
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', content: 'Passata' })
    ).resolves.toBeDefined();
  });

  it('deletes a rejected line', async () => {
    const w = world({
      permissions: WRITER,
      line: { approvalStatus: LineApprovalStatus.REJECTED },
    });
    await expect(
      w.lines.delete({ userId: USER_ID, lineId: 'li1' })
    ).resolves.toEqual({ id: 'li1' });
  });

  it('comments', async () => {
    const w = world({ permissions: WRITER });
    await expect(
      w.comments.add({ userId: USER_ID, lineId: 'li1', body: 'got it' })
    ).resolves.toBeDefined();
  });

  it('is refused when it approves a line', async () => {
    const w = world({ permissions: WRITER });
    await expect(
      w.lines.setApproval({
        userId: USER_ID,
        lineId: 'li1',
        approvalStatus: LineApprovalStatus.APPROVED,
      })
    ).rejects.toThrow();
  });

  it('is refused when it says it bought something', async () => {
    // The stated cost of the migration (plan 0036, section 3.1), inherited by
    // the settle that replaced ticking off (plan 0047, section 4): saying what
    // happened in the shop is DECIDE, so yesterday's WRITER needs it granting
    // once.
    const w = world({ permissions: WRITER });
    await expect(
      w.settlements.settle({
        userId: USER_ID,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
      })
    ).rejects.toThrow();
  });

  it('fixes an approved line, and the fix puts it back to PENDING', async () => {
    // Plan 0076, section 2. The writer typed "Mile" and can correct it, and the
    // correction is what puts the line back in front of whoever approves.
    const w = world({
      permissions: WRITER,
      line: {
        approvalStatus: LineApprovalStatus.APPROVED,
        approvedByUserId: 'the-approver',
      },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Milk',
    });

    expect(view.content).toBe('Milk');
    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(view.approvedByUserId).toBeNull();
  });

  it('bumps the version once on an edit that also reverts the approval', async () => {
    const w = world({
      permissions: WRITER,
      line: {
        approvalStatus: LineApprovalStatus.APPROVED,
        approvedByUserId: 'the-approver',
        version: 4,
      },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Milk',
    });

    expect(view.version).toBe(5);
  });

  it('keeps the approval when the list approves lines by itself', async () => {
    // Plan 0076, section 2.3: nothing re-reads the option after creation, so a
    // reversion here would strand the line awaiting an approval the list's owner
    // switched off.
    const w = world({
      permissions: WRITER,
      autoApproveLines: true,
      line: {
        approvalStatus: LineApprovalStatus.APPROVED,
        approvedByUserId: 'the-approver',
      },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Milk',
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(view.approvedByUserId).toBe('the-approver');
  });

  it("is refused when it changes an approved line's quantity, by that field's name", async () => {
    // Plan 0076, section 3. The message names the quantity rather than the line,
    // because the same caller editing the content instead is allowed.
    const w = world({
      permissions: WRITER,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', quantity: 1 })
    ).rejects.toThrow(/quantity/i);
  });

  it('may not delete an approved line', async () => {
    const w = world({
      permissions: WRITER,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    await expect(
      w.lines.delete({ userId: USER_ID, lineId: 'li1' })
    ).rejects.toThrow();
  });
});

describe('a member holding {READ, DECIDE} (acceptance 4)', () => {
  it('approves a line', async () => {
    const w = world({ permissions: DECIDER });
    const view = await w.lines.setApproval({
      userId: USER_ID,
      lineId: 'li1',
      approvalStatus: LineApprovalStatus.APPROVED,
    });
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(view.approvedByUserId).toBe(USER_ID);
  });

  it('rejects a line', async () => {
    const w = world({ permissions: DECIDER });
    const view = await w.lines.setApproval({
      userId: USER_ID,
      lineId: 'li1',
      approvalStatus: LineApprovalStatus.REJECTED,
    });
    expect(view.approvalStatus).toBe(LineApprovalStatus.REJECTED);
  });

  it('records that the shop did not have it, and moves nothing', async () => {
    const w = world({ permissions: DECIDER });
    const { line, settlement } = await w.settlements.settle({
      userId: USER_ID,
      lineId: 'li1',
      outcome: SettlementOutcome.NOT_AVAILABLE,
    });
    expect(settlement.outcome).toBe(SettlementOutcome.NOT_AVAILABLE);
    // Nothing was bought, so nothing came off what the household still wants
    // (plan 0047, section 4).
    expect(settlement.quantity).toBe(0);
    expect(line.quantity).toBe(3);
  });

  it('comments', async () => {
    const w = world({ permissions: DECIDER });
    await expect(
      w.comments.add({ userId: USER_ID, lineId: 'li1', body: 'only one left' })
    ).resolves.toBeDefined();
  });

  it('changes an approved line quantity upward with no remainder', async () => {
    const w = world({
      permissions: DECIDER,
      line: { approvalStatus: LineApprovalStatus.APPROVED, quantity: 1 },
    });
    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      quantity: 3,
    });
    expect(view.quantity).toBe(3);
    expect(w.saved).toHaveLength(1);
  });

  it('is refused when it adds a line', async () => {
    const w = world({ permissions: DECIDER });
    await expect(
      w.lines.add({ userId: USER_ID, listId: LIST_ID, content: 'Olive oil' })
    ).rejects.toThrow();
  });

  it('is refused when it edits an unapproved line', async () => {
    const w = world({ permissions: DECIDER });
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', content: 'Passata' })
    ).rejects.toThrow();
  });

  it("is refused when it changes an approved line's content", async () => {
    // This is the cell the file's opening paragraph is about, and plan 0076 did
    // not move it. It is refused not because the line is approved, which stopped
    // mattering with that plan, but because content is a writer's field on every
    // line and this caller holds no `WRITE`. Section 2.1's exemption is about the
    // reversion, and its argument (un-approve, edit, approve) needs a caller who
    // can make the edit at all: this one cannot, on a `PENDING` line either, per
    // the case above. The caller who edits an approved line's content without
    // un-approving it holds both permissions, which is the case below.
    const w = world({
      permissions: DECIDER,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });

    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', content: 'Passata' })
    ).rejects.toThrow();
  });
});

describe('a member holding {READ, WRITE, DECIDE} (plan 0076, section 1)', () => {
  const WRITER_DECIDER = [
    ListPermission.READ,
    ListPermission.WRITE,
    ListPermission.DECIDE,
  ];

  it("changes an approved line's content, and it stays approved", async () => {
    // Plan 0076, section 2.1: the reversion would be ceremony for somebody who
    // can approve the line again in the next request, so they are exempt from it.
    const w = world({
      permissions: WRITER_DECIDER,
      line: {
        approvalStatus: LineApprovalStatus.APPROVED,
        approvedByUserId: 'the-approver',
      },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Passata',
    });

    expect(view.content).toBe('Passata');
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(view.approvedByUserId).toBe('the-approver');
  });

  it("changes an approved line's quantity, which a writer alone may not", async () => {
    const w = world({
      permissions: WRITER_DECIDER,
      line: { approvalStatus: LineApprovalStatus.APPROVED, quantity: 1 },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      quantity: 3,
      content: 'Passata',
    });

    // Both fields in one request, which is the combination the quantity refusal
    // turns away for a writer holding no `DECIDE`.
    expect(view.quantity).toBe(3);
    expect(view.content).toBe('Passata');
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
  });
});

describe('a member holding {READ, MANAGE} (acceptance 5)', () => {
  it('edits the content of an approved line, and it stays approved', async () => {
    // Plan 0076, section 2.2: `MANAGE` does not grant approval, so a reversion
    // here would put the line into a state its holder cannot get it out of.
    const w = world({
      permissions: LIST_ADMIN,
      line: {
        approvalStatus: LineApprovalStatus.APPROVED,
        approvedByUserId: 'the-approver',
      },
    });
    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Passata',
    });
    expect(view.content).toBe('Passata');
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(view.approvedByUserId).toBe('the-approver');
  });

  it('deletes an approved line', async () => {
    const w = world({
      permissions: LIST_ADMIN,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    await expect(
      w.lines.delete({ userId: USER_ID, lineId: 'li1' })
    ).resolves.toEqual({ id: 'li1' });
  });
});

describe('editing a rejected line (acceptance 6, plan 0036 section 4.2)', () => {
  it('returns it to PENDING and clears its approver', async () => {
    const w = world({
      permissions: WRITER,
      line: {
        approvalStatus: LineApprovalStatus.REJECTED,
        approvedByUserId: 'the-rejecter',
      },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Passata',
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(view.approvedByUserId).toBeNull();
  });

  it('does so on a quantity-only edit too', async () => {
    const w = world({
      permissions: WRITER,
      line: {
        approvalStatus: LineApprovalStatus.REJECTED,
        approvedByUserId: 'the-rejecter',
      },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      quantity: 1,
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
  });

  it('does so on a list that auto approves, rather than going back to APPROVED', async () => {
    // Plan 0037, section 3: the option governs what a **new** line starts as, and
    // a rejection somebody made on purpose is not undone by a setting or an edit.
    const w = world({
      permissions: WRITER,
      autoApproveLines: true,
      line: { approvalStatus: LineApprovalStatus.REJECTED },
    });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      quantity: 1,
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
  });

  it('leaves a pending line pending', async () => {
    const w = world({ permissions: WRITER });

    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Passata',
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
  });
});

describe('the whole call site table (plan 0036, section 4)', () => {
  /** One row per operation: what it needs, and a caller who has it and one who does not. */
  const cases: {
    operation: string;
    needs: ListPermission;
    run: (w: World) => Promise<unknown>;
  }[] = [
    {
      operation: 'line.add',
      needs: ListPermission.WRITE,
      run: (w) =>
        w.lines.add({ userId: USER_ID, listId: LIST_ID, content: 'Olive oil' }),
    },
    {
      operation: 'line.reorder',
      needs: ListPermission.WRITE,
      run: (w) =>
        w.lines.reorder({
          userId: USER_ID,
          listId: LIST_ID,
          orderedLineIds: [],
        }),
    },
    {
      operation: 'line.settle',
      needs: ListPermission.DECIDE,
      run: (w) =>
        w.settlements.settle({
          userId: USER_ID,
          lineId: 'li1',
          outcome: SettlementOutcome.BOUGHT,
        }),
    },
    {
      operation: 'line.setApproval',
      needs: ListPermission.DECIDE,
      run: (w) =>
        w.lines.setApproval({
          userId: USER_ID,
          lineId: 'li1',
          approvalStatus: LineApprovalStatus.APPROVED,
        }),
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.operation} needs ${testCase.needs}`, async () => {
      await expect(
        testCase.run(
          world({ permissions: [ListPermission.READ, testCase.needs] })
        )
      ).resolves.toBeDefined();

      await expect(
        testCase.run(world({ permissions: READ_ONLY }))
      ).rejects.toThrow();
    });

    it(`${testCase.operation} admits a group admin with no row`, async () => {
      await expect(
        testCase.run(world({ permissions: null, role: ZoneRole.ADMIN }))
      ).resolves.toBeDefined();
    });
  }
});
