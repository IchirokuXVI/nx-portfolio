import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  RealtimeEvent,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineService } from '../lists/line.service';
import type { ListAccessService } from '../lists/list-access.service';
import { GeneratedListLineService } from './generated-list-line.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * Editing a basket (plan 0050, section 5), which is one rule tested from every
 * side:
 *
 * > An edit inside a generated list changes the shared zone lists **only** when
 * > the user has said which shared list should receive it.
 *
 * So most of what is asserted below is a **negative**: that `LineService.add` was
 * not called. That is deliberate and it is the shape the plan asks for, because
 * the failure this rule exists to prevent is silent. A user tidies up their own
 * shopping list at the till and, without meaning to, rewrites a list four other
 * people depend on, and nothing on their screen says so.
 */

const OWNER = 'u-owner';
/** The owner's own participant row, which every line they add is authored by. */
const OWNER_PARTICIPANT = 'p-owner';
const BASKET = 'gl-1';
const ZONE = 'z-flat';
const TARGET_LIST = 'l-flat';

interface Harness {
  service: GeneratedListLineService;
  /** Every zone line `LineService.add` was asked to create. */
  zoneAdds: { listId: string; content: string; quantity?: number }[];
  /** Provenance rows written by a promotion. */
  promotions: unknown[][];
  saved: Partial<GeneratedListLine>[];
  events: RealtimeEvent[];
  claims: FakeLineClaims;
}

function build(options: {
  defaultTargetListId?: string | null;
  line?: Partial<GeneratedListLine>;
  lines?: Partial<GeneratedListLine>[];
  optionRows?: Partial<GeneratedListLineOption>[];
  /** The zone lines this basket line came from (plan 0052, section 3.3). */
  claiming?: { zoneId: string; listId: string; lineId: string }[];
}): Harness {
  const basket = {
    id: BASKET,
    ownerUserId: OWNER,
    name: null,
    status: GeneratedListStatus.DRAFT,
    generatedAt: new Date('2026-09-01T10:00:00.000Z'),
    sourceSnapshot: { profileId: null, sources: [] },
    defaultTargetListId: options.defaultTargetListId ?? null,
    idempotencyKey: null,
  } as GeneratedList;

  const line = {
    id: 'gll-1',
    generatedListId: BASKET,
    content: 'Milk',
    quantity: 2,
    settledQuantity: 0,
    itemId: null,
    origin: GeneratedLineOrigin.DERIVED,
    targetListId: null,
    position: 1,
    ...options.line,
  } as GeneratedListLine;

  const lines = (options.lines ?? [line]) as GeneratedListLine[];
  const optionRows = (options.optionRows ?? []) as GeneratedListLineOption[];

  const zoneAdds: Harness['zoneAdds'] = [];
  const promotions: unknown[][] = [];
  const saved: Partial<GeneratedListLine>[] = [];
  const events: RealtimeEvent[] = [];

  const lineRepo = {
    findOne: async ({ where }: { where: { id: string } }) =>
      lines.find((row) => row.id === where.id) ?? null,
    find: async () => lines,
    create: (data: Partial<GeneratedListLine>) => ({ ...data }),
    save: async (
      row: Partial<GeneratedListLine> | Partial<GeneratedListLine>[]
    ) => {
      const rows = Array.isArray(row) ? row : [row];
      for (const one of rows) {
        saved.push({ ...one, id: one.id ?? `gll-new-${saved.length}` });
      }
      return Array.isArray(row)
        ? rows
        : { ...rows[0], id: rows[0].id ?? `gll-new-${saved.length - 1}` };
    },
    delete: async () => ({ affected: 1 }),
    count: async () => lines.length,
    createQueryBuilder: () => ({
      select: () => ({
        where: () => ({ getRawOne: async () => ({ max: '3' }) }),
      }),
    }),
    manager: {
      getRepository: () => ({
        save: async (row: Partial<GeneratedListLine>) => {
          saved.push(row);
          return row;
        },
      }),
      query: async (_sql: string, params: unknown[]) => {
        promotions.push(params);
        return [];
      },
    },
  };

  const optionRepo = {
    find: async () => optionRows,
    findOne: async ({ where }: { where: { itemId: string } }) =>
      optionRows.find((row) => row.itemId === where.itemId) ?? null,
    insert: async () => undefined,
  };

  const generatedLists = {
    load: async () => basket,
    lineViewFor: async (row: GeneratedListLine) => ({ id: row.id }),
    viewFor: async () => ({ id: BASKET }),
  } as unknown as GeneratedListService;

  const listAccess = {
    getList: async () => ({ id: TARGET_LIST, zoneId: ZONE }),
  } as unknown as ListAccessService;

  const zoneLines = {
    add: async (req: {
      listId: string;
      content: string;
      quantity?: number;
    }) => {
      zoneAdds.push(req);
      return { id: 'zone-line-1', version: 1 } as LineView;
    },
  } as unknown as LineService;

  const publisher = {
    emitToUsers: (event: RealtimeEvent) => {
      events.push(event);
    },
  } as unknown as CoreEventsPublisher;

  const claims = fakeLineClaims({}, () => options.claiming ?? []);

  // The owner's participant row, which a line records itself as authored by
  // (plan 0055, section 4). Idempotent in the real service; here it is the one
  // method this suite needs from sharing.
  const sharing = {
    ensureOwnerParticipant: async () => ({ id: OWNER_PARTICIPANT }),
  } as unknown as GeneratedListSharingService;

  const service = new GeneratedListLineService(
    lineRepo as never,
    optionRepo as never,
    generatedLists,
    listAccess,
    zoneLines,
    claims.service,
    sharing,
    publisher
  );

  return { service, zoneAdds, promotions, saved, events, claims };
}

describe('editing a basket line', () => {
  it('changes the basket copy and never the zone line', async () => {
    const { service, zoneAdds, saved } = build({});

    await service.updateLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
      content: 'Whole milk',
      quantity: 4,
    });

    expect(saved[0].content).toBe('Whole milk');
    expect(saved[0].quantity).toBe(4);
    // The rule the whole plan turns on.
    expect(zoneAdds).toEqual([]);
  });

  it('allows a quantity of zero on an edit, as a zone line does', async () => {
    const { service, saved } = build({});

    await service.updateLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
      quantity: 0,
    });

    expect(saved[0].quantity).toBe(0);
  });

  it('refuses a pick that is not one of the line’s options', async () => {
    // A settlement records the pick, so an arbitrary id here would put a product
    // nobody offered into a household's purchase history.
    const { service } = build({ optionRows: [{ itemId: 'item-a' } as never] });

    await expect(
      service.updateLine({
        userId: OWNER,
        generatedListId: BASKET,
        lineId: 'gll-1',
        itemId: 'item-not-offered',
      })
    ).rejects.toThrow(/not one of the options/);
  });

  it('switches the pick to another option without touching the zone line', async () => {
    const { service, saved, zoneAdds } = build({
      optionRows: [
        { itemId: 'item-a' } as never,
        { itemId: 'item-b' } as never,
      ],
    });

    await service.updateLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
      itemId: 'item-b',
    });

    expect(saved[0].itemId).toBe('item-b');
    expect(zoneAdds).toEqual([]);
  });

  it('refuses to send a DERIVED line to a list, since its origins are already there', async () => {
    const { service } = build({});

    await expect(
      service.updateLine({
        userId: OWNER,
        generatedListId: BASKET,
        lineId: 'gll-1',
        targetListId: TARGET_LIST,
      })
    ).rejects.toThrow(/added to this basket/);
  });

  it('deletes a line from the basket and leaves every origin wanted', async () => {
    const { service, zoneAdds, events } = build({});

    const result = await service.deleteLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
    });

    expect(result).toEqual({ id: 'gll-1' });
    // "I decided not to buy this today" must not look like "somebody bought it".
    expect(zoneAdds).toEqual([]);
    expect(events).toEqual([RealtimeEvent.GeneratedListUpdated]);
  });

  it('lets go of the zone lines it was carrying (plan 0052, section 3.3)', async () => {
    // The line leaves the basket, so nobody is out buying it any more. The zone
    // line itself is untouched and stays wanted, which is the distinction the
    // test above is about and this one does not disturb.
    const { service, claims } = build({
      claiming: [{ zoneId: ZONE, listId: TARGET_LIST, lineId: 'zl-1' }],
    });

    await service.deleteLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
    });

    expect(claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['zl-1'] },
    ]);
  });
});

describe('adding a line to a basket', () => {
  it('keeps it in the basket alone when no list is named', async () => {
    const { service, zoneAdds, saved } = build({});

    await service.addLine({
      userId: OWNER,
      generatedListId: BASKET,
      content: 'Batteries',
    });

    expect(saved[0].origin).toBe(GeneratedLineOrigin.ADDED);
    expect(saved[0].targetListId).toBeNull();
    expect(zoneAdds).toEqual([]);
  });

  it('creates it in the zone list through the ordinary add path when one is named', async () => {
    const { service, zoneAdds, promotions } = build({});

    await service.addLine({
      userId: OWNER,
      generatedListId: BASKET,
      content: 'Batteries',
      quantity: 2,
      targetListId: TARGET_LIST,
    });

    // Through LineService.add and not an insert of our own, so WRITE is checked
    // at that moment and the line starts PENDING approval like any other.
    expect(zoneAdds).toEqual([
      {
        userId: OWNER,
        listId: TARGET_LIST,
        content: 'Batteries',
        quantity: 2,
        itemIds: [],
      },
    ]);
    // The created line becomes the basket line's provenance row.
    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toContain('zone-line-1');
    expect(promotions[0]).toContain(ZONE);
  });

  it('uses the basket default when the request says nothing', async () => {
    const { service, zoneAdds } = build({ defaultTargetListId: TARGET_LIST });

    await service.addLine({
      userId: OWNER,
      generatedListId: BASKET,
      content: 'Batteries',
    });

    expect(zoneAdds).toHaveLength(1);
  });

  it('lets an explicit null beat the basket default', async () => {
    // One private line in a basket that is otherwise mirrored into a shared list.
    const { service, zoneAdds } = build({ defaultTargetListId: TARGET_LIST });

    await service.addLine({
      userId: OWNER,
      generatedListId: BASKET,
      content: 'A present for the flatmates',
      targetListId: null,
    });

    expect(zoneAdds).toEqual([]);
  });

  it('refuses an empty line', async () => {
    const { service } = build({});

    await expect(
      service.addLine({
        userId: OWNER,
        generatedListId: BASKET,
        content: '   ',
      })
    ).rejects.toThrow(/needs some text/);
  });
});

describe('promoting an added line later', () => {
  it('creates the zone line once, and not again when the target is set twice', async () => {
    const { service, zoneAdds } = build({
      line: { origin: GeneratedLineOrigin.ADDED },
    });

    await service.updateLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
      targetListId: TARGET_LIST,
    });
    // The line now carries a target, so a second set is not a second promotion:
    // a shared list is not something a basket may put two copies into.
    await service.updateLine({
      userId: OWNER,
      generatedListId: BASKET,
      lineId: 'gll-1',
      targetListId: TARGET_LIST,
    });

    expect(zoneAdds).toHaveLength(1);
  });
});

describe('reordering a basket', () => {
  it('refuses an order that does not name every line exactly once', async () => {
    const { service } = build({
      lines: [
        { id: 'gll-1', generatedListId: BASKET, position: 1 } as never,
        { id: 'gll-2', generatedListId: BASKET, position: 2 } as never,
      ],
    });

    await expect(
      service.reorderLines({
        userId: OWNER,
        generatedListId: BASKET,
        lineIds: ['gll-1'],
      })
    ).rejects.toThrow(/exactly once/);
  });

  it('renumbers every line to the order it was given', async () => {
    const { service, saved } = build({
      lines: [
        { id: 'gll-1', generatedListId: BASKET, position: 1 } as never,
        { id: 'gll-2', generatedListId: BASKET, position: 2 } as never,
      ],
    });

    await service.reorderLines({
      userId: OWNER,
      generatedListId: BASKET,
      lineIds: ['gll-2', 'gll-1'],
    });

    expect(saved.map((row) => [row.id, row.position])).toEqual([
      ['gll-2', 1],
      ['gll-1', 2],
    ]);
  });
});
