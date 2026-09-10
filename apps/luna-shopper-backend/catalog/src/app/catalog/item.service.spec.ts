import {
  ItemCategory,
  UnitOfMeasure,
  type CreateItemInput,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
// `QueryFailedError` is a value here, not just a type: the duplicate barcode
// cases raise one, because that is what the service recognizes.
import { QueryFailedError, type Repository } from 'typeorm';
// `Item` is a value here, not just a type: the audit double keys on the entity
// class the service hands it.
import { Item, type ProductGroup, type SupermarketItem } from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { fakeAudit } from './catalog-audit.testing';
import { ItemService } from './item.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ProductGroupService } from './product-group.service';

const ADMIN = 'owner-1';

function makeAdmin(): jest.Mocked<PlatformAdminService> {
  return {
    // The gate takes the whole request now and answers who it let through
    // (plan 0072). Reading `userId` keeps every case here meaning what it did:
    // these files are about the services, not about the gate.
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return { kind: 'admin', actorId: credential.userId };
    }),
  } as unknown as jest.Mocked<PlatformAdminService>;
}

function makeQb(rows: Item[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['take', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => rows);
  return qb;
}

/**
 * The three collaborators the service gained with plan 0048, as doubles.
 *
 * Everything the plan is actually about, the ranking and the trigger maintained
 * documents, lives in SQL and is covered by `catalog-search.integration.spec.ts`
 * against real Postgres. What is left for a unit spec is the shape of the
 * service: the admin gate, which branch a request takes, and what comes back.
 */
function build(overrides: {
  items?: Partial<Repository<Item>>;
  prices?: Partial<Repository<SupermarketItem>>;
}) {
  const admin = makeAdmin();
  const groups = {
    load: jest.fn(async (id: string) => ({ id }) as ProductGroup),
  } as unknown as jest.Mocked<ProductGroupService>;
  // Plan 0070: a write that moves a product's group announces it. Fire and
  // forget, so nothing here waits on it, but a spec that left it out would fail
  // on the write rather than on what it is testing.
  const events = {
    itemGroupChanged: jest.fn(),
    productGroupDeleted: jest.fn(),
  } as unknown as jest.Mocked<CatalogEventsPublisher>;
  // Plan 0075: every write runs inside a transaction this opens. The double
  // routes the write back to the same fake repository, and records what moved.
  const audit = fakeAudit([
    [Item, { name: 'items', repository: overrides.items ?? {} }],
  ]);
  const service = new ItemService(
    overrides.items as Repository<Item>,
    {} as Repository<ProductGroup>,
    (overrides.prices ?? {}) as Repository<SupermarketItem>,
    groups,
    admin,
    audit.service,
    events
  );
  return { service, admin, groups, events, audit };
}

describe('ItemService', () => {
  it('create is gated to the platform admin', async () => {
    const items = {
      save: jest.fn(async (x) => ({ id: 'i1', ...x })),
      create: jest.fn((x) => x),
    } as unknown as Repository<Item>;
    const { service } = build({ items });

    await expect(
      service.create({
        userId: 'intruder',
        name: { en: 'Milk', es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(items.save).not.toHaveBeenCalled();

    await expect(
      service.create({
        userId: ADMIN,
        name: { en: 'Milk', es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      })
    ).resolves.toMatchObject({ name: { en: 'Milk', es: 'Leche' } });
  });

  it('assigning a group checks the group exists (plan 0048, section 1)', async () => {
    const items = {
      save: jest.fn(async (x) => ({ id: 'i1', ...x })),
      create: jest.fn((x) => x),
    } as unknown as Repository<Item>;
    const { service, groups } = build({ items });

    await service.create({
      userId: ADMIN,
      name: { en: 'Milk', es: 'Leche' },
      category: ItemCategory.DAIRY,
      defaultUnit: UnitOfMeasure.LITER,
      productGroupId: 'g1',
    });

    // The foreign key would refuse a dangling id anyway; going through the group
    // service is what turns that into "product group not found".
    expect(groups.load).toHaveBeenCalledWith('g1');
  });

  it('a query ranks, and a query is what makes it rank (plan 0048, section 3)', async () => {
    const rows = [
      {
        id: 'i1',
        name: { en: 'Milk', es: 'Leche' },
        brand: null,
        imageUrl: null,
        sku: null,
        ean: null,
        unitSize: null,
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
        productGroupId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as unknown as Item[];
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => makeQb(rows)),
    } as unknown as Repository<Item>;
    const { service, admin } = build({ items });

    const page = await service.search({ userId: 'any-reader', query: 'milk' });

    // Reads are open to any authenticated user, which is unchanged.
    expect(admin.requireAdmin).not.toHaveBeenCalled();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name.en).toBe('Milk');
    // The ranked branch is the raw query, because a relevance score is not a
    // column the query builder can order by.
    expect(items.query).toHaveBeenCalled();
    expect(items.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('a barcode query filters and ranks on ean, in that order', async () => {
    const rows: Item[] = [];
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => makeQb(rows)),
    } as unknown as Repository<Item>;
    const { service } = build({ items });

    await service.search({ userId: 'reader', query: '8480000181077' });

    const [sql, values] = (items.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    // Read the placeholder out of the SQL and then check what was bound to it,
    // rather than searching the values for the digits: the raw term is the same
    // string, so looking it up by value finds the trigram parameter instead.
    const position = Number(/i\."ean" = \$(\d+)/.exec(sql)?.[1] ?? 0);
    expect(position).toBeGreaterThan(0);
    // Bound, never interpolated, like every other value in this query.
    expect(values[position - 1]).toBe('8480000181077');
    // First key of the ordering, so the scanned product cannot be pushed under a
    // text hit that happened to score above the zero this query earns.
    expect(sql).toContain(`ORDER BY (i."ean" = $${position}) DESC`);
  });

  it('leaves the ean test out when the query is words', async () => {
    const rows: Item[] = [];
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => makeQb(rows)),
    } as unknown as Repository<Item>;
    const { service } = build({ items });

    await service.search({ userId: 'reader', query: 'leche' });

    const [sql] = (items.query as jest.Mock).mock.calls[0] as [string];
    expect(sql).not.toContain('i."ean" = $');
    // And no ranking key standing in for it: Postgres refuses a constant in
    // ORDER BY, which is what a `false` written there would be. The first key
    // is the whole word test, which is an expression over a column and so is
    // always legal there.
    expect(sql).toContain('ORDER BY ("catalog_norm"');
  });

  it('no query still lists, because the admin surface uses it that way', async () => {
    const rows: Item[] = [];
    const qb = makeQb(rows);
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<Item>;
    const { service } = build({ items });

    await service.search({ userId: 'any-reader' });

    expect(items.createQueryBuilder).toHaveBeenCalled();
    expect(items.query).not.toHaveBeenCalled();
  });

  /**
   * Plan 0073, section 4: what curation has not reached.
   *
   * An ungrouped product is invisible to every "show me milk" read, so a filter
   * that spells "no group" is the only way the back office can find one. It has
   * to be a flag rather than a null `productGroupId`, since absent already means
   * "any group".
   */
  it('lists the products belonging to no group at all', async () => {
    const rows: Item[] = [];
    const qb = makeQb(rows);
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<Item>;
    const { service } = build({ items });

    await service.search({ userId: 'operator', withoutProductGroup: true });

    expect(qb.andWhere).toHaveBeenCalledWith('i."productGroupId" IS NULL');
  });

  /**
   * The filter applies on the ranked branch too. It would be easy to add it only
   * to the listing branch, and a filter that silently stopped applying when the
   * caller typed a word would be worse than one that was never offered.
   */
  it('applies the ungrouped filter to a ranked search as well', async () => {
    const rows: Item[] = [];
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => makeQb(rows)),
    } as unknown as Repository<Item>;
    const { service } = build({ items });

    await service.search({
      userId: 'operator',
      query: 'leche',
      withoutProductGroup: true,
    });

    const sql = (items.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('i."productGroupId" IS NULL');
  });

  it('quotes no price when the caller names no scopes (section 3.1)', async () => {
    const rows = [
      {
        id: 'i1',
        name: { en: 'Milk', es: 'Leche' },
        brand: null,
        imageUrl: null,
        sku: null,
        ean: null,
        unitSize: null,
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
        productGroupId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as unknown as Item[];
    const prices = {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<SupermarketItem>;
    const items = {
      query: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(() => makeQb(rows)),
    } as unknown as Repository<Item>;
    const { service } = build({ items, prices });

    const page = await service.search({ userId: 'reader', query: 'milk' });

    // No default is resolved here. That is plan 0049's job, and until it lands
    // an unscoped search degrades to suggestions without price hints, which is
    // exactly what the composer wants.
    expect(page.items[0].bestOffer).toBeUndefined();
    expect(prices.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('get throws NotFound for a missing item', async () => {
    const items = {
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Item>;
    const { service } = build({ items });
    await expect(
      service.get({ userId: 'reader', itemId: 'missing' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- Several products in one transaction (plan 0100) ---------------------

  describe('createMany', () => {
    function milk(overrides: Partial<CreateItemInput> = {}): CreateItemInput {
      return {
        name: { es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
        ...overrides,
      };
    }

    function batchItems() {
      let next = 1;
      return {
        create: jest.fn((row) => row),
        save: jest.fn(async (row) => ({ id: `i-${next++}`, ...row })),
      } as unknown as Repository<Item>;
    }

    it('is gated to the platform admin, and writes nothing for anybody else', async () => {
      const items = batchItems();
      const { service } = build({ items });

      await expect(
        service.createMany({ userId: 'intruder', items: [milk()] })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(items.save).not.toHaveBeenCalled();
    });

    it('creates every product in one transaction, in the order asked for', async () => {
      const items = batchItems();
      const { service, audit } = build({ items });
      // One transaction for the whole file, not one per product: forty calls
      // would be forty transactions, so the thirty seventh failing would leave
      // thirty six products nothing points at.
      const opened = jest.spyOn(audit.service, 'write');

      const result = await service.createMany({
        userId: ADMIN,
        items: [milk({ name: { es: 'Leche' } }), milk({ name: { es: 'Pan' } })],
      });

      expect(result.items.map((row) => row.name)).toEqual([
        { es: 'Leche' },
        { es: 'Pan' },
      ]);
      expect(opened).toHaveBeenCalledTimes(1);
      expect(audit.recorded).toHaveLength(2);
    });

    it('announces the products it created straight into a group', async () => {
      const items = batchItems();
      const { service, events } = build({ items });

      await service.createMany({
        userId: ADMIN,
        items: [milk({ productGroupId: 'g-1' }), milk()],
      });

      // Plan 0070: a household subscribed to Milk should get a milk the catalog
      // has only just heard of, and no second write is coming that would say so.
      expect(events.itemGroupChanged).toHaveBeenCalledTimes(1);
      expect(events.itemGroupChanged).toHaveBeenCalledWith('i-1', null, 'g-1');
    });

    it('refuses an empty list and one over the cap, before it writes anything', async () => {
      const items = batchItems();
      const { service } = build({ items });

      await expect(
        service.createMany({ userId: ADMIN, items: [] })
      ).rejects.toBeInstanceOf(ValidationException);

      await expect(
        service.createMany({
          userId: ADMIN,
          items: Array.from({ length: 1001 }, () => milk()),
        })
      ).rejects.toBeInstanceOf(ValidationException);
      expect(items.save).not.toHaveBeenCalled();
    });

    it('refuses a list that names one EAN twice, naming the barcode', async () => {
      const items = batchItems();
      const { service } = build({ items });

      await expect(
        service.createMany({
          userId: ADMIN,
          items: [
            milk({ ean: '8480000123456' }),
            milk({ ean: '8480000123456' }),
          ],
        })
      ).rejects.toBeInstanceOf(ValidationException);
      expect(items.save).not.toHaveBeenCalled();
    });
  });

  /**
   * The barcode is unique when present, and every write that can meet that
   * index has to say so in words the operator can act on.
   *
   * A duplicate inside one list is caught before the write and is the case
   * above. This is the other one: the barcode belongs to a product already in
   * the table, so only Postgres can find out, and the `QueryFailedError` it
   * raises has to be turned into a 409. `create` and `update` used to let it
   * through, and an operator was told 500 for a barcode they could see.
   */
  describe('a barcode the catalog already holds', () => {
    /** What the driver raises on `uq_items_ean`, as the service reads it. */
    function duplicateEan() {
      const error = new QueryFailedError('insert', [], new Error('duplicate'));
      (error as unknown as { driverError: { code: string } }).driverError = {
        code: '23505',
      };
      return error;
    }

    function refusingItems() {
      return {
        create: jest.fn((x) => x),
        save: jest.fn(async () => {
          throw duplicateEan();
        }),
        findOne: jest.fn(async () => ({
          id: 'i1',
          name: { en: 'Milk', es: 'Leche' },
          brand: null,
          imageUrl: null,
          sku: null,
          ean: null,
          unitSize: 1,
          category: ItemCategory.DAIRY,
          defaultUnit: UnitOfMeasure.LITER,
          productGroupId: null,
        })),
      } as unknown as Repository<Item>;
    }

    it('answers create with a conflict, not an unclassified error', async () => {
      const { service } = build({ items: refusingItems() });

      await expect(
        service.create({
          userId: ADMIN,
          name: { en: 'Milk', es: 'Leche' },
          category: ItemCategory.DAIRY,
          defaultUnit: UnitOfMeasure.LITER,
          ean: '8480000123456',
        })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers an edit that types a taken barcode the same way', async () => {
      const { service } = build({ items: refusingItems() });

      await expect(
        service.update({
          userId: ADMIN,
          itemId: 'i1',
          ean: '8480000123456',
        })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers a batch the same way, and the batch says none landed', async () => {
      const { service } = build({ items: refusingItems() });

      await expect(
        service.createMany({
          userId: ADMIN,
          items: [
            {
              name: { es: 'Leche' },
              category: ItemCategory.DAIRY,
              defaultUnit: UnitOfMeasure.LITER,
              ean: '8480000123456',
            },
          ],
        })
      ).rejects.toThrow(/none of them were created/);
    });

    it('leaves an error that is not a duplicate barcode alone', async () => {
      const items = {
        create: jest.fn((x) => x),
        save: jest.fn(async () => {
          throw new Error('the database went away');
        }),
      } as unknown as Repository<Item>;
      const { service } = build({ items });

      await expect(
        service.create({
          userId: ADMIN,
          name: { en: 'Milk', es: 'Leche' },
          category: ItemCategory.DAIRY,
          defaultUnit: UnitOfMeasure.LITER,
        })
      ).rejects.toThrow('the database went away');
    });
  });
});
