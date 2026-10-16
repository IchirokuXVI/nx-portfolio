import {
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  NO_LINE_CLAIM,
  NO_LINE_SETTLEMENTS,
  RealtimeEvent,
  ZoneRole,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import {
  LineSettlement,
  ListLineGroupRemoval,
  ListLineItem,
  type ListAccess,
  type ListLine,
  type ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeLineChanges } from './changes/line-change.fake';
import { itemSetHash } from './item-set-hash';
import { keptFavorite, lineItemSetOf } from './line-item-set';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { LineMergeService } from './line-merge.service';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { toLineView } from './list.mappers';

/**
 * A line names its favourite product and its supermarket (plan 0199).
 *
 * The rules of section 2 that `LineService` owns: 1, 2 for an update, 3, 4, 5,
 * 7 and 8, with a null that clears and an absent field that leaves the value.
 * The sync of a product group is in `product-group-sync.service.spec.ts`, the
 * decision of a merge is in `line-merge.service.spec.ts`, and what Postgres
 * stores is in `line-favorite-and-supermarket.integration.spec.ts`.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const ACTOR = 'u-actor';
const LINE_ID = 'li1';
const MILK_GROUP = '7c2b4d1a-8e35-4f90-b6a2-1d4c7e9b0f52';
const CHAIN = '5d0e7a91-3c44-4b1e-9f27-000000000001';
const OTHER_CHAIN = '5d0e7a91-3c44-4b1e-9f27-000000000002';

/** Deterministic UUIDs, because the service checks the shape of every id. */
function itemId(n: number): string {
  return `3f1a0c5e-2b7d-4a6f-8c91-${String(n).padStart(12, '0')}`;
}

interface Options {
  items?: { itemId: string; source?: LineItemSource }[];
  productGroupId?: string | null;
  favoriteItemId?: string | null;
  preferredSupermarketId?: string | null;
  approvalStatus?: LineApprovalStatus;
  permissions?: ListPermission[];
}

const EVERYTHING = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
  ListPermission.MANAGE,
];

function build(options: Options = {}) {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: ACTOR,
    autoApproveLines: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const seeded = options.items ?? [];
  const line = {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 1,
    itemSetHash: itemSetHash(seeded.map((item) => item.itemId)),
    productGroupId: options.productGroupId ?? null,
    favoriteItemId: options.favoriteItemId ?? null,
    preferredSupermarketId: options.preferredSupermarketId ?? null,
    position: 10,
    approvalStatus: options.approvalStatus ?? LineApprovalStatus.PENDING,
    createdByUserId: ACTOR,
    approvedByUserId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  } as ListLine;

  const saved: Partial<ListLine>[] = [];
  const events: { event: RealtimeEvent; line: LineView }[] = [];

  const lineRepo = {
    findOne: async () => line,
    // An add reads the list before it decides to create or to raise. Empty, so
    // an add here always creates.
    find: async () => [],
    create: (data: Partial<ListLine>) => ({ ...data }),
    save: async (row: Partial<ListLine>) => {
      const stored = {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        ...row,
        id: row.id ?? 'li-new',
      };
      saved.push(stored);
      return stored;
    },
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawOne: async () => ({ max: 10 }),
      };
      return qb;
    },
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    {
      findOne: async () =>
        ({
          id: 'a1',
          listId: LIST_ID,
          membershipId: 'm1',
          permissions: options.permissions ?? EVERYTHING,
        }) as ListAccess,
    } as never,
    lineRepo as never,
    new ZoneAuthzService({
      findOne: async () =>
        ({
          id: 'm1',
          zoneId: ZONE_ID,
          userId: ACTOR,
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        }) as never,
    } as never)
  );

  const lineItems = fakeLineItems(
    seeded.map((item, position) => ({
      lineId: LINE_ID,
      itemId: item.itemId,
      position,
      source: item.source ?? LineItemSource.USER,
    }))
  );
  const groupRemovals = fakeGroupRemovals();
  const settlements = fakeLineSettlements();

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineItem) {
            return lineItems.repo;
          }
          if (entity === ListLineGroupRemoval) {
            return groupRemovals.repo;
          }
          if (entity === LineSettlement) {
            return settlements.repo;
          }
          return lineRepo;
        },
      } as unknown as EntityManager),
  } as unknown as DataSource;

  const changes = fakeLineChanges();
  const service = new LineService(
    dataSource,
    lineRepo as never,
    lineItems.repo as never,
    groupRemovals.repo as never,
    settlements.repo as never,
    listAccess,
    fakeLineClaims().service,
    {
      emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
        events.push({ event, line: payload }),
    } as unknown as CoreEventsPublisher,
    {} as never,
    new LineMergeService(changes.recorder),
    changes.recorder,
    fakeBasketAnnouncer()
  );

  const update = (
    fields: Omit<Parameters<LineService['update']>[0], 'userId' | 'lineId'>
  ) => service.update({ userId: ACTOR, lineId: LINE_ID, ...fields });

  return { service, update, saved, events, line, lineItems };
}

describe('the favourite is one of the products (plan 0199, rule 1)', () => {
  it('takes a product the line holds', async () => {
    const w = build({ items: [{ itemId: itemId(1) }, { itemId: itemId(2) }] });

    const view = await w.update({ favoriteItemId: itemId(2) });

    expect(view.favoriteItemId).toBe(itemId(2));
    expect(w.saved[0].favoriteItemId).toBe(itemId(2));
    // The set did not move, so neither did the identity of the line.
    expect(view.itemIds).toEqual([itemId(1), itemId(2)]);
    expect(view.itemSetHash).toBe(itemSetHash([itemId(1), itemId(2)]));
  });

  it('refuses a product the line does not hold, with validation_failed, and writes nothing', async () => {
    const w = build({ items: [{ itemId: itemId(1) }] });

    const refused = w.update({ favoriteItemId: itemId(9) });

    await expect(refused).rejects.toBeInstanceOf(ValidationException);
    await expect(refused).rejects.toMatchObject({
      code: 'validation_failed',
      messageArgs: { field: 'favoriteItemId' },
    });
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('refuses any favourite on a line with no products', async () => {
    const w = build();

    await expect(
      w.update({ favoriteItemId: itemId(1) })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('adds a product and makes it the favourite in one request', async () => {
    const w = build({ items: [{ itemId: itemId(1) }] });

    const view = await w.update({
      itemIds: [itemId(1), itemId(2)],
      favoriteItemId: itemId(2),
    });

    expect(view.itemIds).toEqual([itemId(1), itemId(2)]);
    expect(view.favoriteItemId).toBe(itemId(2));
  });

  it('reads the set as it stands after the update, so a product the same request removes is refused', async () => {
    const w = build({ items: [{ itemId: itemId(1) }, { itemId: itemId(2) }] });

    await expect(
      w.update({ itemIds: [itemId(1)], favoriteItemId: itemId(2) })
    ).rejects.toBeInstanceOf(ValidationException);
    // The set was not rewritten either: the refusal is of the whole request.
    expect(w.lineItems.rows.map((row) => row.itemId)).toEqual([
      itemId(1),
      itemId(2),
    ]);
    expect(w.saved).toHaveLength(0);
  });

  it('refuses a value that is not a UUID, for either field', async () => {
    const w = build({ items: [{ itemId: itemId(1) }] });

    await expect(w.update({ favoriteItemId: 'milk' })).rejects.toMatchObject({
      code: 'validation_failed',
      messageArgs: { field: 'favoriteItemId' },
    });
    await expect(
      w.update({ preferredSupermarketId: 'mercadona' })
    ).rejects.toMatchObject({
      code: 'validation_failed',
      messageArgs: { field: 'preferredSupermarketId' },
    });
    expect(w.saved).toHaveLength(0);
  });
});

describe('null clears and absent leaves alone (plan 0199, section 1)', () => {
  it('clears the favourite on null and leaves the chain', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }],
      favoriteItemId: itemId(1),
      preferredSupermarketId: CHAIN,
    });

    const view = await w.update({ favoriteItemId: null });

    expect(view.favoriteItemId).toBeNull();
    expect(view.preferredSupermarketId).toBe(CHAIN);
  });

  it('clears the chain on null and leaves the favourite', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }],
      favoriteItemId: itemId(1),
      preferredSupermarketId: CHAIN,
    });

    const view = await w.update({ preferredSupermarketId: null });

    expect(view.preferredSupermarketId).toBeNull();
    expect(view.favoriteItemId).toBe(itemId(1));
  });

  it('leaves both alone on an update that names neither', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }],
      favoriteItemId: itemId(1),
      preferredSupermarketId: CHAIN,
    });

    const view = await w.update({ quantity: 4 });

    expect(view.quantity).toBe(4);
    expect(view.favoriteItemId).toBe(itemId(1));
    expect(view.preferredSupermarketId).toBe(CHAIN);
  });

  it('writes both in one request, and replaces a chain with another', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }],
      preferredSupermarketId: CHAIN,
    });

    const view = await w.update({
      favoriteItemId: itemId(1),
      preferredSupermarketId: OTHER_CHAIN,
    });

    expect(view.favoriteItemId).toBe(itemId(1));
    expect(view.preferredSupermarketId).toBe(OTHER_CHAIN);
  });
});

describe('a favourite that leaves the set is cleared (plan 0199, rule 2)', () => {
  it('clears it when an update with itemIds drops that product', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }, { itemId: itemId(2) }],
      favoriteItemId: itemId(2),
    });

    const view = await w.update({ itemIds: [itemId(1)] });

    expect(view.favoriteItemId).toBeNull();
    // In the row the edit saved, which is the transaction that rewrote the set.
    expect(w.saved).toHaveLength(1);
    expect(w.saved[0].favoriteItemId).toBeNull();
  });

  it('keeps it when an update with itemIds keeps that product', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }, { itemId: itemId(2) }],
      favoriteItemId: itemId(2),
    });

    const view = await w.update({ itemIds: [itemId(2), itemId(3)] });

    expect(view.favoriteItemId).toBe(itemId(2));
  });

  it('clears it when the set becomes empty: a line with no products has no favourite', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }],
      favoriteItemId: itemId(1),
    });

    const view = await w.update({ itemIds: [] });

    expect(view.itemIds).toEqual([]);
    expect(view.favoriteItemId).toBeNull();
  });

  it('is one rule for every writer of a set', () => {
    expect(keptFavorite('a', ['a', 'b'])).toBe('a');
    expect(keptFavorite('a', ['b'])).toBeNull();
    expect(keptFavorite('a', [])).toBeNull();
    expect(keptFavorite(null, ['a'])).toBeNull();
    expect(keptFavorite(undefined, ['a'])).toBeNull();
  });
});

describe('adoptItemIds does not touch the favourite (plan 0199, rule 3)', () => {
  it('keeps the favourite on the product that changed owner', async () => {
    const w = build({
      productGroupId: MILK_GROUP,
      items: [
        { itemId: itemId(1), source: LineItemSource.GROUP },
        { itemId: itemId(2), source: LineItemSource.GROUP },
      ],
      favoriteItemId: itemId(1),
      preferredSupermarketId: CHAIN,
    });

    const view = await w.update({ adoptItemIds: [itemId(1)] });

    expect(view.groupItemIds).toEqual([itemId(2)]);
    expect(view.favoriteItemId).toBe(itemId(1));
    expect(view.preferredSupermarketId).toBe(CHAIN);
  });
});

describe('the supermarket does not depend on the products (plan 0199, rule 4)', () => {
  it('stays when the set changes and when it becomes empty', async () => {
    const w = build({
      items: [{ itemId: itemId(1) }],
      preferredSupermarketId: CHAIN,
    });

    expect(
      (await w.update({ itemIds: [itemId(2)] })).preferredSupermarketId
    ).toBe(CHAIN);
    expect((await w.update({ itemIds: [] })).preferredSupermarketId).toBe(
      CHAIN
    );
  });

  it('is written on a line with no products', async () => {
    const w = build();

    const view = await w.update({ preferredSupermarketId: CHAIN });

    expect(view.preferredSupermarketId).toBe(CHAIN);
    expect(view.itemIds).toEqual([]);
  });
});

describe('who may write them (plan 0199, rule 5)', () => {
  const fields = [
    { name: 'favoriteItemId', edit: { favoriteItemId: itemId(1) } },
    { name: 'preferredSupermarketId', edit: { preferredSupermarketId: CHAIN } },
    // The field the rule is copied from, so the three stay in step.
    { name: 'itemIds', edit: { itemIds: [itemId(1)] } },
  ] as const;

  describe.each(fields)('$name', ({ edit }) => {
    it('is refused to a reader', async () => {
      const w = build({
        items: [{ itemId: itemId(1) }],
        permissions: [ListPermission.READ],
      });

      await expect(w.update(edit)).rejects.toBeInstanceOf(ForbiddenException);
      expect(w.saved).toHaveLength(0);
    });

    it('is written by a writer on a line that is not approved, which stays pending', async () => {
      const w = build({
        items: [{ itemId: itemId(1) }],
        permissions: [ListPermission.READ, ListPermission.WRITE],
      });

      const view = await w.update(edit);

      expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
      expect(w.saved).toHaveLength(1);
    });

    it('puts an approved line back to waiting when a writer writes it', async () => {
      const w = build({
        items: [{ itemId: itemId(1) }],
        approvalStatus: LineApprovalStatus.APPROVED,
        permissions: [ListPermission.READ, ListPermission.WRITE],
      });

      const view = await w.update(edit);

      expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
      expect(view.approvedByUserId).toBeNull();
    });

    it('is out of reach of DECIDE alone on an approved line', async () => {
      const w = build({
        items: [{ itemId: itemId(1) }],
        approvalStatus: LineApprovalStatus.APPROVED,
        permissions: [ListPermission.READ, ListPermission.DECIDE],
      });

      await expect(w.update(edit)).rejects.toBeInstanceOf(ForbiddenException);
      expect(w.saved).toHaveLength(0);
    });

    it('leaves an approved line approved when a manager writes it', async () => {
      const w = build({
        items: [{ itemId: itemId(1) }],
        approvalStatus: LineApprovalStatus.APPROVED,
        permissions: [ListPermission.READ, ListPermission.MANAGE],
      });

      const view = await w.update(edit);

      expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    });
  });
});

describe('an add never sets them (plan 0199, rule 7)', () => {
  it('starts a new line with both null, also when it has products', async () => {
    const w = build();

    const { line: view, merged } = await w.service.add({
      userId: ACTOR,
      listId: LIST_ID,
      content: 'Bread',
      itemIds: [itemId(1)],
    });

    expect(merged).toBe(false);
    expect(view.favoriteItemId).toBeNull();
    expect(view.preferredSupermarketId).toBeNull();
  });

  it('starts every line of a batch with both null', async () => {
    const w = build();

    const results = await w.service.addMany({
      userId: ACTOR,
      listId: LIST_ID,
      items: [{ content: 'Bread', itemIds: [itemId(1)] }, { content: 'Eggs' }],
    });

    for (const { line: view } of results) {
      expect(view.favoriteItemId).toBeNull();
      expect(view.preferredSupermarketId).toBeNull();
    }
  });
});

describe('the version and the event (plan 0199, rule 8)', () => {
  it.each([
    { name: 'the favourite', edit: { favoriteItemId: itemId(1) } },
    { name: 'the chain', edit: { preferredSupermarketId: CHAIN } },
    { name: 'a null', edit: { favoriteItemId: null } },
  ])(
    'raises the version on a write of $name and announces the new line',
    async ({ edit }) => {
      const w = build({ items: [{ itemId: itemId(1) }] });

      const view = await w.update(edit);

      expect(view.version).toBe(2);
      expect(w.events).toEqual([
        { event: RealtimeEvent.LineUpdated, line: view },
      ]);
      expect(w.events[0].line).toHaveProperty('favoriteItemId');
      expect(w.events[0].line).toHaveProperty('preferredSupermarketId');
    }
  );
});

describe('the mapper (plan 0199, section 1)', () => {
  const row = {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 1,
    itemSetHash: null,
    productGroupId: null,
    position: 1,
    approvalStatus: LineApprovalStatus.PENDING,
    createdByUserId: ACTOR,
    approvedByUserId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const view = (line: Partial<ListLine>) =>
    toLineView(
      { ...row, ...line } as ListLine,
      lineItemSetOf([itemId(1)]),
      NO_LINE_SETTLEMENTS,
      NO_LINE_CLAIM
    );

  it('carries both fields as the row holds them', () => {
    expect(
      view({ favoriteItemId: itemId(1), preferredSupermarketId: CHAIN })
    ).toMatchObject({
      favoriteItemId: itemId(1),
      preferredSupermarketId: CHAIN,
    });
  });

  it('answers null and never an absent key, also for a row with no such property', () => {
    // A line that `save` has just inserted has no value for a nullable column
    // with no default, so the entity carries `undefined` there.
    const mapped = view({});

    expect(mapped.favoriteItemId).toBeNull();
    expect(mapped.preferredSupermarketId).toBeNull();
    expect(Object.keys(mapped)).toEqual(
      expect.arrayContaining(['favoriteItemId', 'preferredSupermarketId'])
    );
  });

  it('keeps the products an array of ids', () => {
    expect(view({ favoriteItemId: itemId(1) }).itemIds).toEqual([itemId(1)]);
  });
});
