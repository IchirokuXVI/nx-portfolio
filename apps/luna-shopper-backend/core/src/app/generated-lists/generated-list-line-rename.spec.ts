import {
  GeneratedListStatus,
  ListPermission,
  ParticipantKind,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  GeneratedListFinishedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type {
  GeneratedList,
  GeneratedListLine,
  GeneratedListParticipant,
} from '../entities';
import { GeneratedListLineRenameService } from './generated-list-line-rename.service';

/**
 * Who may rename a basket line (plan 0113, section 2), and what is refused
 * before anything is locked.
 *
 * Every case here is refused or answered **before the transaction opens**, and
 * the double for the data source fails the test if one is opened. What happens
 * inside it (the plans, the merges, the broadcasts) is rows moving under locks,
 * and the integration spec beside this one proves it against Postgres.
 */

const BASKET = 'gl-1';
const LINE = 'gll-1';
const OWNER = 'u-owner';
const FRIEND = 'u-friend';
const FLAT = 'l-flat';
const PARENTS = 'l-parents';

/** Thrown by the data source double, so a test can tell "authorized" apart. */
const REACHED = 'reached the transaction';

function build(options: {
  status?: GeneratedListStatus;
  origins?: string[];
  writable?: string[];
  participant?: Partial<GeneratedListParticipant> | null;
}) {
  const basket = {
    id: BASKET,
    ownerUserId: OWNER,
    status: options.status ?? GeneratedListStatus.ACTIVE,
  } as GeneratedList;
  const line = {
    id: LINE,
    generatedListId: BASKET,
    content: 'leche',
    quantity: 2,
    settledQuantity: 0,
    itemId: null,
    position: 1,
  } as GeneratedListLine;
  const participant =
    options.participant === null
      ? null
      : ({
          id: 'p-friend',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: FRIEND,
          ...options.participant,
        } as GeneratedListParticipant);
  const writable = new Set(options.writable ?? []);
  const transactions: number[] = [];

  const service = new GeneratedListLineRenameService(
    {
      transaction: async () => {
        transactions.push(1);
        throw new Error(REACHED);
      },
    } as never,
    { findOne: async () => basket } as never,
    // A copy per read, so nothing here can pass by sharing one object.
    { findOne: async () => ({ ...line }) } as never,
    {
      find: async () =>
        (options.origins ?? []).map((listId) => ({
          generatedListLineId: LINE,
          listId,
          lineId: `zl-${listId}`,
        })),
    } as never,
    // Every origin list still exists. `In([...])` carries its ids on `value`.
    {
      find: async ({ where }: { where: { id: { value: string[] } } }) =>
        where.id.value.map((id) => ({ id })),
    } as never,
    {} as never,
    {
      resolve: async () => ({
        permissions: new Set([ListPermission.READ, ListPermission.WRITE]),
      }),
    } as never,
    {
      liveParticipantById: async () => participant,
      writableAmong: async (_userId: string, listIds: readonly string[]) =>
        new Set(listIds.filter((listId) => writable.has(listId))),
      seesZoneData: async () => false,
    } as never,
    {
      basketLineViewFor: async (row: GeneratedListLine) => ({
        id: row.id,
        content: row.content,
      }),
    } as never,
    {
      emit: jest.fn(),
      emitToUsers: jest.fn(),
      emitToGeneratedList: jest.fn(),
    } as never
  );

  function rename(content: string) {
    return service.renameAsParticipant({
      generatedListId: BASKET,
      lineId: LINE,
      participantId: 'p-friend',
      content,
    });
  }

  return { rename, transactions };
}

describe('who may rename a basket line (plan 0113, section 2)', () => {
  it('refuses a guest, who holds no access to any list', async () => {
    const { rename, transactions } = build({
      origins: [FLAT],
      writable: [FLAT],
      participant: { kind: ParticipantKind.GUEST, userId: null },
    });

    await expect(rename('Milk')).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactions).toEqual([]);
  });

  it('refuses a guest a line on no list as well', async () => {
    const { rename } = build({
      participant: { kind: ParticipantKind.GUEST, userId: null },
    });

    await expect(rename('Milk')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a participant whose credential is no longer live', async () => {
    const { rename } = build({ participant: null });

    await expect(rename('Milk')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses somebody who can write one origin list and not the other, and opens nothing', async () => {
    const { rename, transactions } = build({
      origins: [FLAT, PARENTS],
      writable: [FLAT],
    });

    await expect(rename('Milk')).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactions).toEqual([]);
  });

  it('lets somebody who can write every origin list through to the rename', async () => {
    const { rename, transactions } = build({
      origins: [FLAT, PARENTS, FLAT],
      writable: [FLAT, PARENTS],
    });

    await expect(rename('Milk')).rejects.toThrow(REACHED);
    expect(transactions).toEqual([1]);
  });

  it('refuses a registered participant a line that is on no list', async () => {
    const { rename, transactions } = build({});

    await expect(rename('Milk')).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactions).toEqual([]);
  });

  it('lets the owner rename a line that is on no list', async () => {
    const { rename } = build({
      participant: {
        id: 'p-owner',
        kind: ParticipantKind.OWNER,
        userId: OWNER,
      },
    });

    await expect(rename('Milk')).rejects.toThrow(REACHED);
  });

  it('holds the owner to the same rule as anybody else on a line with origins', async () => {
    const { rename } = build({
      origins: [FLAT],
      writable: [],
      participant: {
        id: 'p-owner',
        kind: ParticipantKind.OWNER,
        userId: OWNER,
      },
    });

    await expect(rename('Milk')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('what a rename refuses or skips before it locks anything', () => {
  it('refuses a finished basket with its own code', async () => {
    const { rename, transactions } = build({
      status: GeneratedListStatus.COMPLETED,
      origins: [FLAT],
      writable: [FLAT],
    });

    await expect(rename('Milk')).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
    expect(transactions).toEqual([]);
  });

  it('refuses an empty name', async () => {
    const { rename } = build({ origins: [FLAT], writable: [FLAT] });

    await expect(rename('   ')).rejects.toBeInstanceOf(ValidationException);
  });

  it('answers the line unchanged when the name is the one it already has', async () => {
    const { rename, transactions } = build({
      origins: [FLAT],
      writable: [FLAT],
    });

    const result = await rename('  leche ');

    expect(result).toEqual({ line: { id: LINE, content: 'leche' } });
    expect(transactions).toEqual([]);
  });
});
