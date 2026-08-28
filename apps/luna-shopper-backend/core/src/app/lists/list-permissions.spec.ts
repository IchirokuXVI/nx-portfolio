import {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  MembershipStatus,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import type { ListAccess, ListLine, ShoppingList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { CommentService } from './comment.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

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
    itemId: null,
    position: 10,
    approvalStatus: LineApprovalStatus.PENDING,
    status: LineStatus.PENDING,
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

  const dataSource = {
    transaction: async <T>(run: (m: unknown) => Promise<T>) =>
      run({ getRepository: () => lineRepo }),
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
    listAccess,
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
  const comments = new CommentService(
    commentRepo as never,
    listAccess,
    publisher
  );

  return { listAccess, lines, comments, saved, deleted, events, list };
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

  it('is refused when it ticks a line off', async () => {
    // The stated cost of the migration (plan 0036, section 3.1): ticking off has
    // moved into DECIDE, so yesterday's WRITER needs it granting once.
    const w = world({ permissions: WRITER });
    await expect(
      w.lines.setStatus({
        userId: USER_ID,
        lineId: 'li1',
        status: LineStatus.READY,
      })
    ).rejects.toThrow();
  });

  it('may not touch an approved line at all', async () => {
    const w = world({
      permissions: WRITER,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', quantity: 1 })
    ).rejects.toThrow();
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

  it('sets a line to NOT_AVAILABLE', async () => {
    const w = world({ permissions: DECIDER });
    const view = await w.lines.setStatus({
      userId: USER_ID,
      lineId: 'li1',
      status: LineStatus.NOT_AVAILABLE,
    });
    expect(view.status).toBe(LineStatus.NOT_AVAILABLE);
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
    // Acceptance 7 of plan 0037 as well. Quantity is the one field, and a request
    // naming any other is refused rather than silently trimmed, so a client that
    // thought it was renaming a line finds out that it did not.
    const w = world({
      permissions: DECIDER,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    await expect(
      w.lines.update({ userId: USER_ID, lineId: 'li1', content: 'Passata' })
    ).rejects.toThrow();
  });
});

describe('a member holding {READ, MANAGE} (acceptance 5)', () => {
  it('edits the content of an approved line', async () => {
    const w = world({
      permissions: LIST_ADMIN,
      line: { approvalStatus: LineApprovalStatus.APPROVED },
    });
    const view = await w.lines.update({
      userId: USER_ID,
      lineId: 'li1',
      content: 'Passata',
    });
    expect(view.content).toBe('Passata');
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
      operation: 'line.setStatus',
      needs: ListPermission.DECIDE,
      run: (w) =>
        w.lines.setStatus({
          userId: USER_ID,
          lineId: 'li1',
          status: LineStatus.READY,
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
