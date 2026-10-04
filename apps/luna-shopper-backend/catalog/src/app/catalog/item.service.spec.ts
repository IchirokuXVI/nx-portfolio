import {
  UnitOfMeasure,
  type CreateItemInput,
} from '@portfolio/luna-shopper/contracts';
import {
  CategoryNotALeafException,
  CategoryNotFoundException,
  ConflictException,
  ForbiddenException,
  ITEM_EAN_DETAIL,
  ITEM_EAN_HOLDER_DETAIL,
  ItemEanHeldException,
  ItemEanInvalidException,
  ItemNeedsACategoryException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
// `QueryFailedError` is a value here, not just a type: the duplicate barcode
// cases raise one, because that is what the service recognizes.
import { QueryFailedError, type Repository } from 'typeorm';
// `Item` is a value here, not just a type: the audit double keys on the entity
// class the service hands it.
import {
  Item,
  type Brand,
  type ProductGroup,
  type SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { fakeAudit } from './catalog-audit.testing';
import { fakeCategories } from './category.testing';
import { fakeItemEans } from './item-ean.testing';
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
  /** The registry the brand write step looks a key up in (plan 0115). */
  brands?: Brand[];
  /** Which ids are roots or unknown to the category double (plan 0166). */
  categories?: Parameters<typeof fakeCategories>[0];
  /** Rows of `item_eans` the spec did not write through the service. */
  eans?: Parameters<typeof fakeItemEans>[0];
}) {
  const admin = makeAdmin();
  // The lookup answers the whole registry rather than narrowing it the way the
  // real one does. That is safe here because the service indexes what it gets
  // by key and then reads the one key it computed, so an extra row is never
  // reachable. What the specs below assert about it is the call count.
  const registry = overrides.brands ?? [];
  const brands = {
    find: jest.fn(async () => registry),
  } as unknown as jest.Mocked<Repository<Brand>>;
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
  // Plan 0166: the leaves a write names, and what every read answers.
  const categories = fakeCategories(overrides.categories);
  // Plan 0185: every barcode of every product, as one map.
  const eans = fakeItemEans(overrides.eans);
  const service = new ItemService(
    overrides.items as Repository<Item>,
    {} as Repository<ProductGroup>,
    (overrides.prices ?? {}) as Repository<SupermarketItem>,
    brands,
    groups,
    admin,
    audit.service,
    events,
    categories.service,
    eans.store
  );
  return { service, admin, groups, events, audit, brands, categories, eans };
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
        categoryIds: ['milk'],
        defaultUnit: UnitOfMeasure.LITER,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(items.save).not.toHaveBeenCalled();

    await expect(
      service.create({
        userId: ADMIN,
        name: { en: 'Milk', es: 'Leche' },
        categoryIds: ['milk'],
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
      categoryIds: ['milk'],
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
    // Any barcode of the product, not only its first (plan 0185): the same
    // placeholder is looked up in `item_eans`.
    expect(sql).toContain(
      `SELECT ie."itemId" FROM "item_eans" ie WHERE ie."ean" = $${position}`
    );
    // First key of the ordering, so the scanned product cannot be pushed under a
    // text hit that happened to score above the zero this query earns.
    expect(sql).toMatch(
      new RegExp(
        `ORDER BY \\(\\(i\\."ean" = \\$${position} OR i\\."id" = \\([^)]*\\)\\)\\) DESC NULLS LAST`
      )
    );
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
        categoryIds: ['milk'],
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
            milk({ ean: '8480000123459' }),
            milk({ ean: '8480000123459' }),
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
  describe('the pack count (plan 0162)', () => {
    const MILK = {
      id: 'i1',
      name: { en: 'Milk', es: 'Leche' },
      brand: null,
      imageUrl: null,
      sku: null,
      ean: null,
      unitSize: 6,
      packCount: 6,
      defaultUnit: UnitOfMeasure.LITER,
      productGroupId: null,
    };

    function items() {
      return {
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => ({ id: 'i1', ...x })),
        findOne: jest.fn(async () => ({ ...MILK })),
      } as unknown as Repository<Item>;
    }

    it('is answered on every view, and null when the create names none', async () => {
      const { service } = build({ items: items() });
      const created = await service.create({
        userId: ADMIN,
        name: { es: 'Leche' },
        categoryIds: ['milk'],
        defaultUnit: UnitOfMeasure.LITER,
      });
      expect(created.packCount).toBeNull();
      expect(
        (await service.get({ userId: ADMIN, itemId: 'i1' })).packCount
      ).toBe(6);
    });

    it('is written by a create and by a bulk create', async () => {
      const { service } = build({ items: items() });
      const created = await service.create({
        userId: ADMIN,
        name: { es: 'Leche' },
        categoryIds: ['milk'],
        defaultUnit: UnitOfMeasure.LITER,
        packCount: 6,
      });
      expect(created.packCount).toBe(6);
      const many = await service.createMany({
        userId: ADMIN,
        items: [
          {
            name: { es: 'Atún' },
            categoryIds: ['tuna-and-bonito'],
            defaultUnit: UnitOfMeasure.GRAM,
            packCount: 8,
          },
        ],
      });
      expect(many.items[0].packCount).toBe(8);
    });

    it('is changed by an update, which can also clear it', async () => {
      const { service, audit } = build({ items: items() });
      expect(
        (await service.update({ userId: ADMIN, itemId: 'i1', packCount: 4 }))
          .packCount
      ).toBe(4);
      expect(
        (await service.update({ userId: ADMIN, itemId: 'i1', packCount: null }))
          .packCount
      ).toBeNull();
      expect(audit.recorded.map((row) => row.after)).toEqual([
        { packCount: 4 },
        { packCount: null },
      ]);
    });

    it('is left alone by an update that does not name it', async () => {
      const { service } = build({ items: items() });
      const updated = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        sku: 'X-1',
      });
      expect(updated.packCount).toBe(6);
    });

    describe('fillPackCounts', () => {
      const ITEM = '6f1c2f7e-6d3a-4b58-9d4e-1c2b3a4d5e6f';

      it('is gated like every other write', async () => {
        const { service } = build({ items: items() });
        await expect(
          service.fillPackCounts({
            userId: 'intruder',
            entries: [{ itemId: ITEM, packCount: 6 }],
          })
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('refuses a product named twice, a count out of bounds and a list over the cap', async () => {
        const { service, audit } = build({ items: items() });
        await expect(
          service.fillPackCounts({
            userId: ADMIN,
            entries: [
              { itemId: ITEM, packCount: 6 },
              { itemId: ITEM, packCount: 4 },
            ],
          })
        ).rejects.toBeInstanceOf(ValidationException);
        for (const packCount of [1, 1001, 2.5]) {
          await expect(
            service.fillPackCounts({
              userId: ADMIN,
              entries: [{ itemId: ITEM, packCount }],
            })
          ).rejects.toBeInstanceOf(ValidationException);
        }
        await expect(
          service.fillPackCounts({
            userId: ADMIN,
            entries: Array.from({ length: 1001 }, (_, i) => ({
              itemId: `${i}`,
              packCount: 6,
            })),
          })
        ).rejects.toBeInstanceOf(ValidationException);
        expect(audit.recorded).toEqual([]);
      });

      it('writes nothing, and opens nothing, for ids that name no product', async () => {
        const { service, audit } = build({ items: items() });
        await expect(
          service.fillPackCounts({
            userId: ADMIN,
            entries: [{ itemId: 'not-a-uuid', packCount: 6 }],
          })
        ).resolves.toEqual({ written: 0 });
        expect(audit.recorded).toEqual([]);
      });
    });
  });

  /**
   * Plan 0184. A product holds a real barcode or none, and the check runs on
   * a write that sets or changes the EAN, never on one that leaves it alone:
   * 211 products already hold an in-store code, and each of them still has to
   * load and still has to save its other fields.
   */
  describe('the EAN a product may hold (plan 0184)', () => {
    const IN_STORE = '2204500000000';
    const REAL = '4006381333931';

    /** A catalog holding one product, with the EAN the test names. */
    function holding(ean: string | null) {
      return {
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => ({ id: 'i1', ...x })),
        findOne: jest.fn(async () => ({
          id: 'i1',
          name: { en: 'Cheese', es: 'Queso' },
          brand: null,
          imageUrl: null,
          sku: null,
          ean,
          unitSize: 1,
          packCount: null,
          defaultUnit: UnitOfMeasure.KILOGRAM,
          productGroupId: null,
        })),
      } as unknown as Repository<Item>;
    }

    const cheese = (ean: string | null | undefined) => ({
      name: { en: 'Cheese', es: 'Queso' },
      categoryIds: ['milk'],
      defaultUnit: UnitOfMeasure.KILOGRAM,
      ean,
    });

    it.each([
      ['an in-store code', IN_STORE, 'IN_STORE'],
      ['an 11 digit code', '84100100012', 'LENGTH'],
      ['a wrong check digit', '4006381333932', 'CHECK_DIGIT'],
      ['a code with a space in it', '4006381 333931', 'NOT_DIGITS'],
      ['an empty string', '', 'EMPTY'],
    ])(
      'refuses a create with %s, naming the code and the reason',
      async (_what, ean, reason) => {
        const { service, audit } = build({ items: holding(null) });

        const refusal = await service
          .create({ userId: ADMIN, ...cheese(ean) })
          .catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(ItemEanInvalidException);
        expect((refusal as ItemEanInvalidException).code).toBe(
          'item_ean_invalid'
        );
        expect((refusal as ItemEanInvalidException).details).toEqual({
          ean,
          reason,
        });
        expect(audit.recorded).toEqual([]);
      }
    );

    it('creates with a real barcode, trimmed, and with none', async () => {
      const { service } = build({ items: holding(null) });

      expect(
        (await service.create({ userId: ADMIN, ...cheese(` ${REAL} `) })).ean
      ).toBe(REAL);
      expect(
        (await service.create({ userId: ADMIN, ...cheese(null) })).ean
      ).toBeNull();
      expect(
        (await service.create({ userId: ADMIN, ...cheese(undefined) })).ean
      ).toBeNull();
    });

    it('refuses a whole batch for one bad EAN, before it writes anything', async () => {
      const { service, audit } = build({ items: holding(null) });

      await expect(
        service.createMany({
          userId: ADMIN,
          items: [cheese(REAL), cheese(IN_STORE)],
        })
      ).rejects.toBeInstanceOf(ItemEanInvalidException);
      expect(audit.recorded).toEqual([]);
    });

    it('refuses an update that changes the EAN to an invalid one', async () => {
      const { service, audit } = build({ items: holding(REAL) });

      await expect(
        service.update({ userId: ADMIN, itemId: 'i1', ean: IN_STORE })
      ).rejects.toBeInstanceOf(ItemEanInvalidException);
      await expect(
        service.update({ userId: ADMIN, itemId: 'i1', ean: '84100100012' })
      ).rejects.toBeInstanceOf(ItemEanInvalidException);
      expect(audit.recorded).toEqual([]);
    });

    it('lets a product that holds an in-store code load', async () => {
      const { service } = build({ items: holding(IN_STORE) });

      expect((await service.get({ userId: ADMIN, itemId: 'i1' })).ean).toBe(
        IN_STORE
      );
    });

    it('does not refuse an update that does not name the EAN', async () => {
      const { service } = build({ items: holding(IN_STORE) });

      const updated = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        sku: 'X-1',
      });

      expect(updated.sku).toBe('X-1');
      expect(updated.ean).toBe(IN_STORE);
    });

    it('does not refuse an update that sends back the EAN the product holds', async () => {
      // What a client that sends the whole product back does. The back office
      // sends only what changed, so this is the rule for every other writer.
      const { service } = build({ items: holding(IN_STORE) });

      const updated = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        ean: IN_STORE,
        sku: 'X-1',
      });

      expect(updated.sku).toBe('X-1');
      expect(updated.ean).toBe(IN_STORE);
    });

    it('lets an update replace an in-store code with a real barcode, or clear it', async () => {
      // Two catalogs, because `holding` answers the same row on every read: a
      // second edit through the first one would start from the in-store code
      // again while the barcode rows remember the first edit.
      const replacing = build({ items: holding(IN_STORE) });
      expect(
        (
          await replacing.service.update({
            userId: ADMIN,
            itemId: 'i1',
            ean: REAL,
          })
        ).ean
      ).toBe(REAL);

      const clearing = build({ items: holding(IN_STORE) });
      expect(
        (
          await clearing.service.update({
            userId: ADMIN,
            itemId: 'i1',
            ean: null,
          })
        ).ean
      ).toBeNull();
    });
  });

  /**
   * Plan 0185. A product holds several barcodes, `items.ean` is the first of
   * them, and a barcode names one product. What the database itself holds,
   * the primary key and the cascade, is in `item-eans.integration.spec.ts`.
   */
  describe('more than one barcode (plan 0185)', () => {
    const FIRST = '8402001002083';
    const SECOND = '8402001047251';
    const THIRD = '4006381333931';
    const IN_STORE = '2204500000000';

    /** A catalog that remembers what it was told, unlike the fixtures above. */
    function remembering(rows: Partial<Item>[]) {
      const held = new Map<string, Item>(
        rows.map((row) => [
          row.id as string,
          {
            name: { en: 'Whole milk', es: 'Leche entera' },
            brand: null,
            imageUrl: null,
            sku: null,
            ean: null,
            unitSize: 1000,
            packCount: null,
            defaultUnit: UnitOfMeasure.MILLILITER,
            productGroupId: null,
            ...row,
          } as Item,
        ])
      );
      return {
        create: jest.fn((x) => x),
        save: jest.fn(async (x: Item) => {
          const row = { ...x, id: x.id ?? `new-${held.size + 1}` } as Item;
          held.set(row.id, row);
          return row;
        }),
        findOne: jest.fn(async (options: { where: { id: string } }) => {
          const row = held.get(options.where.id);
          return row ? { ...row } : null;
        }),
        // `In(...)` is not read: the service indexes what comes back by id.
        find: jest.fn(async () =>
          [...held.values()].map((row) => ({ ...row }))
        ),
      } as unknown as Repository<Item>;
    }

    const milkInput = (ean: string | null) => ({
      name: { en: 'Whole milk', es: 'Leche entera' },
      categoryIds: ['milk'],
      defaultUnit: UnitOfMeasure.MILLILITER,
      ean,
    });
    const milk = (ean: string | null) => ({
      userId: ADMIN,
      ...milkInput(ean),
    });

    it('writes the first barcode of a created product as a row, and answers it in eans', async () => {
      const { service, eans } = build({ items: remembering([]) });

      const created = await service.create(milk(FIRST));
      expect(created.ean).toBe(FIRST);
      expect(created.eans).toEqual([FIRST]);
      expect(eans.rows.get(FIRST)).toBe(created.id);

      const bare = await service.create(milk(null));
      expect(bare.eans).toEqual([]);

      const many = await service.createMany({
        userId: ADMIN,
        items: [milkInput(SECOND), milkInput(null)],
      });
      expect(many.items.map((item) => item.eans)).toEqual([[SECOND], []]);
      expect(eans.rows.get(SECOND)).toBe(many.items[0].id);
    });

    it('refuses a create whose barcode is one of another product’s further barcodes', async () => {
      // `uq_items_ean` cannot see this one: it is not that product's first.
      const { service } = build({
        items: remembering([{ id: 'i1', ean: FIRST }]),
        eans: [
          [FIRST, 'i1'],
          [SECOND, 'i1'],
        ],
      });

      await expect(service.create(milk(SECOND))).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it('adds a barcode beside the first one, and finds the product by either', async () => {
      const { service, eans } = build({
        items: remembering([{ id: 'i1', ean: FIRST }]),
        eans: [[FIRST, 'i1']],
      });

      await expect(
        service.addEan({ userId: 'intruder', itemId: 'i1', ean: SECOND })
      ).rejects.toBeInstanceOf(ForbiddenException);

      const view = await service.addEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: ` ${SECOND} `,
      });
      expect(view.ean).toBe(FIRST);
      expect(view.eans).toEqual([FIRST, SECOND]);
      expect(eans.rows.get(SECOND)).toBe('i1');

      // The acceptance criterion: `findByEan` finds it by its second barcode.
      const bySecond = await service.findByEan({ userId: ADMIN, ean: SECOND });
      expect(bySecond.item?.id).toBe('i1');
      expect(bySecond.item?.eans).toEqual([FIRST, SECOND]);
      expect(
        (await service.findByEan({ userId: ADMIN, ean: FIRST })).item?.id
      ).toBe('i1');
      expect(
        (await service.findByEan({ userId: ADMIN, ean: THIRD })).item
      ).toBeNull();

      // Both barcodes in one batch lookup answer the one product once.
      const both = await service.findByEans({
        userId: ADMIN,
        eans: [FIRST, SECOND, THIRD],
      });
      expect(both.items.map((item) => item.id)).toEqual(['i1']);

      // Adding it again changes nothing and refuses nothing.
      const again = await service.addEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: SECOND,
      });
      expect(again.eans).toEqual([FIRST, SECOND]);
    });

    it('makes an added barcode the first one of a product that had none', async () => {
      const { service, audit } = build({
        items: remembering([{ id: 'i1', ean: null }]),
      });

      const view = await service.addEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: SECOND,
      });
      expect(view.ean).toBe(SECOND);
      expect(view.eans).toEqual([SECOND]);
      // The first barcode is a column of the product, so the trail has it.
      expect(audit.recorded).toEqual([
        expect.objectContaining({
          action: 'UPDATE',
          entityId: 'i1',
          before: { ean: null },
          after: { ean: SECOND },
        }),
      ]);
    });

    it('never takes an in-store code as a barcode, and leaves one that is already the first where it is', async () => {
      const { service, eans } = build({
        items: remembering([{ id: 'i1', ean: IN_STORE }]),
      });

      await expect(
        service.addEan({ userId: ADMIN, itemId: 'i1', ean: IN_STORE })
      ).rejects.toBeInstanceOf(ItemEanInvalidException);
      expect(eans.rows.size).toBe(0);

      // A real barcode beside it: `items.ean` keeps the old code, which is in
      // no row and so in no list.
      const view = await service.addEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: FIRST,
      });
      expect(view.ean).toBe(IN_STORE);
      expect(view.eans).toEqual([FIRST]);
      // And the old code finds nothing: it joins nothing (plan 0184).
      expect(
        (await service.findByEan({ userId: ADMIN, ean: IN_STORE })).item
      ).toBeNull();
    });

    it('refuses a barcode another product holds with item_ean_held, naming the holder', async () => {
      const { service, eans } = build({
        items: remembering([
          { id: 'i1', ean: FIRST },
          { id: 'i2', ean: SECOND },
        ]),
        eans: [
          [FIRST, 'i1'],
          [SECOND, 'i2'],
        ],
      });

      const refusal = await service
        .addEan({ userId: ADMIN, itemId: 'i1', ean: SECOND })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ItemEanHeldException);
      expect((refusal as ItemEanHeldException).code).toBe('item_ean_held');
      expect((refusal as ItemEanHeldException).details).toEqual({
        [ITEM_EAN_DETAIL]: SECOND,
        [ITEM_EAN_HOLDER_DETAIL]: 'i2',
      });
      expect(eans.rows.get(SECOND)).toBe('i2');
    });

    it('removes a barcode, and promotes the oldest of the rest when the first one goes', async () => {
      const { service, eans } = build({
        items: remembering([{ id: 'i1', ean: FIRST }]),
        eans: [
          [FIRST, 'i1'],
          [SECOND, 'i1'],
          [THIRD, 'i1'],
        ],
      });

      // One it does not hold is a 404, and nothing moves.
      await expect(
        service.removeEan({ userId: ADMIN, itemId: 'i1', ean: '96385074' })
      ).rejects.toBeInstanceOf(NotFoundException);

      const withoutThird = await service.removeEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: THIRD,
      });
      expect(withoutThird.ean).toBe(FIRST);
      expect(withoutThird.eans).toEqual([FIRST, SECOND]);

      const withoutFirst = await service.removeEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: FIRST,
      });
      expect(withoutFirst.ean).toBe(SECOND);
      expect(withoutFirst.eans).toEqual([SECOND]);

      const bare = await service.removeEan({
        userId: ADMIN,
        itemId: 'i1',
        ean: SECOND,
      });
      expect(bare.ean).toBeNull();
      expect(bare.eans).toEqual([]);
      expect(eans.rows.size).toBe(0);
    });

    it('treats the ean of an update as the first barcode: it replaces that one and keeps the rest', async () => {
      const { service, eans } = build({
        items: remembering([
          { id: 'i1', ean: FIRST },
          { id: 'i2', ean: null },
        ]),
        eans: [
          [FIRST, 'i1'],
          [SECOND, 'i1'],
        ],
      });

      // A new first barcode: the old first one is taken off the product.
      const replaced = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        ean: THIRD,
      });
      expect(replaced.ean).toBe(THIRD);
      expect(replaced.eans).toEqual([THIRD, SECOND]);
      expect(eans.rows.has(FIRST)).toBe(false);

      // A barcode the product already holds is a reorder: it becomes the
      // first, and the old first barcode stays one of the product's barcodes.
      const promoted = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        ean: SECOND,
      });
      expect(promoted.ean).toBe(SECOND);
      expect(promoted.eans).toEqual([SECOND, THIRD]);
      expect(eans.rows.get(THIRD)).toBe('i1');

      // Another product's further barcode is a conflict `uq_items_ean` cannot
      // see, and it is refused all the same.
      await service.addEan({ userId: ADMIN, itemId: 'i1', ean: FIRST });
      await expect(
        service.update({ userId: ADMIN, itemId: 'i2', ean: FIRST })
      ).rejects.toBeInstanceOf(ConflictException);

      // Clearing the first barcode promotes the oldest of the rest.
      const cleared = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        ean: null,
      });
      expect(cleared.ean).toBe(THIRD);
      expect(cleared.eans).toEqual([THIRD, FIRST]);
      // And the barcode it gave up is free for the other product.
      const taken = await service.update({
        userId: ADMIN,
        itemId: 'i2',
        ean: SECOND,
      });
      expect(taken.eans).toEqual([SECOND]);
    });

    it('teaches a batch of barcodes, and names the ones it could not write', async () => {
      const { service, eans } = build({
        items: remembering([
          { id: '11111111-1111-4111-8111-111111111111', ean: FIRST },
          { id: '22222222-2222-4222-8222-222222222222', ean: null },
        ]),
        eans: [[FIRST, '11111111-1111-4111-8111-111111111111']],
      });
      const one = '11111111-1111-4111-8111-111111111111';
      const two = '22222222-2222-4222-8222-222222222222';
      const gone = '99999999-9999-4999-8999-999999999999';

      await expect(
        service.teachEans({ userId: 'intruder', entries: [] })
      ).rejects.toBeInstanceOf(ForbiddenException);

      const result = await service.teachEans({
        userId: ADMIN,
        entries: [
          { itemId: one, ean: SECOND },
          // Already this product's: nothing to do, and not a refusal.
          { itemId: one, ean: FIRST },
          // Held by the first product.
          { itemId: two, ean: FIRST },
          { itemId: two, ean: IN_STORE },
          { itemId: gone, ean: THIRD },
          { itemId: two, ean: THIRD },
        ],
      });

      expect(result.added).toBe(2);
      expect(result.refused).toEqual([
        { itemId: two, ean: IN_STORE, reason: 'INVALID', heldBy: null },
        { itemId: two, ean: FIRST, reason: 'HELD', heldBy: one },
        { itemId: gone, ean: THIRD, reason: 'NOT_FOUND', heldBy: null },
      ]);
      expect(eans.rows.get(SECOND)).toBe(one);
      // The product with no first barcode took the one it was taught.
      expect(eans.rows.get(THIRD)).toBe(two);
      expect((await service.get({ userId: ADMIN, itemId: two })).ean).toBe(
        THIRD
      );
    });
  });

  describe('a barcode the catalog already holds', () => {
    /** What the driver raises on `uq_items_ean`, as the service reads it. */
    function duplicateEan(detail?: string) {
      const error = new QueryFailedError('insert', [], new Error('duplicate'));
      (
        error as unknown as { driverError: { code: string; detail?: string } }
      ).driverError = { code: '23505', detail };
      return error;
    }

    function refusingItems(detail?: string) {
      return {
        create: jest.fn((x) => x),
        save: jest.fn(async () => {
          throw duplicateEan(detail);
        }),
        findOne: jest.fn(async () => ({
          id: 'i1',
          name: { en: 'Milk', es: 'Leche' },
          brand: null,
          imageUrl: null,
          sku: null,
          ean: null,
          unitSize: 1,
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
          categoryIds: ['milk'],
          defaultUnit: UnitOfMeasure.LITER,
          ean: '8480000123459',
        })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers an edit that types a taken barcode the same way', async () => {
      const { service } = build({ items: refusingItems() });

      await expect(
        service.update({
          userId: ADMIN,
          itemId: 'i1',
          ean: '8480000123459',
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
              categoryIds: ['milk'],
              defaultUnit: UnitOfMeasure.LITER,
              ean: '8480000123459',
            },
          ],
        })
      ).rejects.toThrow(/none of them were created/);
    });

    it('names the barcode in the batch refusal (plan 0158)', async () => {
      const { service } = build({
        items: refusingItems('Key (ean)=(8480000123459) already exists.'),
      });

      await expect(
        service.createMany({
          userId: ADMIN,
          items: [
            {
              name: { es: 'Leche' },
              categoryIds: ['milk'],
              defaultUnit: UnitOfMeasure.LITER,
              ean: '8480000123459',
            },
          ],
        })
      ).rejects.toThrow(/EAN 8480000123459/);
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
          categoryIds: ['milk'],
          defaultUnit: UnitOfMeasure.LITER,
        })
      ).rejects.toThrow('the database went away');
    });
  });

  /**
   * The one write step every product write shares (plan 0115, section 4).
   *
   * Four cases, and the fourth is the one that is easy to get wrong: an
   * unregistered brand is **accepted**, not refused, because a person creating a
   * product by hand in the back office has to be able to and refusing it is the
   * curator's decision.
   */
  describe('the brand a written product carries', () => {
    const MAHOU = {
      id: 'b1',
      key: 'mahou',
      label: 'Mahou',
      privateLabelSupermarketId: null,
    } as Brand;

    const savingItems = () =>
      ({
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => ({ id: 'i1', ...x })),
        findOne: jest.fn(async () => ({
          id: 'i1',
          name: { es: 'Cerveza' },
          brand: 'MAHOU',
          brandKey: 'mahou',
          brandId: null,
        })),
      }) as unknown as Repository<Item>;

    const draft = {
      userId: ADMIN,
      name: { es: 'Cerveza' },
      categoryIds: ['uncategorised'],
      defaultUnit: UnitOfMeasure.UNIT,
    };

    it('has no brand at all when the text has no letters or digits', async () => {
      const { service } = build({ items: savingItems() });

      const created = await service.create({ ...draft, brand: '---' });

      // LIDL's `-` and `---` reach here, and need no case of their own.
      expect(created.brand).toBeNull();
    });

    it('stores the registered label, whatever spelling was sent', async () => {
      const items = savingItems();
      const { service } = build({ items, brands: [MAHOU] });

      const created = await service.create({ ...draft, brand: 'MAHOU' });

      expect(created.brand).toBe('Mahou');
      expect(items.save).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: 'Mahou',
          brandKey: 'mahou',
          brandId: 'b1',
        })
      );
    });

    it('stores the canonical brand when the key belongs to a spelling', async () => {
      const items = savingItems();
      const { service } = build({
        items,
        brands: [
          MAHOU,
          {
            id: 'b2',
            key: 'mahou5estrellas',
            label: 'MAHOU 5 ESTRELLAS',
            privateLabelSupermarketId: null,
            canonicalBrandId: MAHOU.id,
          } as Brand,
        ],
      });

      await service.create({ ...draft, brand: 'Mahou 5 Estrellas' });

      // The id and the label are the brand it is a spelling of, and the key is
      // still the product's own text: that key is what brings it back if the
      // link is ever undone (plan 0124, section 4.1).
      expect(items.save).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: 'Mahou',
          brandKey: 'mahou5estrellas',
          brandId: 'b1',
        })
      );
    });

    it('accepts an unregistered brand, keyed and unlinked', async () => {
      const items = savingItems();
      const { service } = build({ items });

      await service.create({ ...draft, brand: '  El Pozo ' });

      expect(items.save).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: 'El Pozo',
          brandKey: 'elpozo',
          brandId: null,
        })
      );
    });

    it('clears all three columns when an edit removes the brand', async () => {
      const items = savingItems();
      const { service } = build({ items, brands: [MAHOU] });

      await service.update({ userId: ADMIN, itemId: 'i1', brand: null });

      expect(items.save).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: null,
          brandKey: null,
          brandId: null,
        })
      );
    });

    it('resolves every distinct key of a batch in one query', async () => {
      const items = savingItems();
      const { service, brands } = build({ items, brands: [MAHOU] });

      await service.createMany({
        userId: ADMIN,
        items: [
          { ...draft, brand: 'MAHOU' },
          { ...draft, brand: 'Mahou' },
          { ...draft, brand: 'El Pozo' },
          { ...draft, brand: null },
        ].map(({ userId: _userId, ...input }) => input as CreateItemInput),
      });

      // One lookup for the whole file, not one per product: a thousand row
      // decisions file would otherwise be a thousand round trips.
      expect(brands.find).toHaveBeenCalledTimes(1);
    });
  });
  /**
   * A product's categories (plan 0166, sections 2 and 3). The rules the
   * database holds are proven in `category.integration.spec.ts`; this is the
   * order of work: what is refused before anything is written, and what is
   * written in which order.
   */
  describe('the categories a product sits on (plan 0166)', () => {
    const saving = () =>
      ({
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => ({ id: x.id ?? 'i1', ...x })),
        findOne: jest.fn(async () => ({ id: 'i1', name: { es: 'Leche' } })),
        find: jest.fn(async () => [
          { id: 'i1', name: { es: 'Uno' } },
          { id: 'i2', name: { es: 'Dos' } },
        ]),
      }) as unknown as Repository<Item>;

    const draft = {
      userId: ADMIN,
      name: { es: 'Leche' },
      defaultUnit: UnitOfMeasure.LITER,
    };

    it('writes the leaves in the order meant, and answers them', async () => {
      const items = saving();
      const { service, categories } = build({ items });

      const created = await service.create({
        ...draft,
        categoryIds: ['milk', 'plant-based-drinks-and-horchata', 'milk'],
      });

      expect(categories.written).toEqual([
        {
          itemId: 'i1',
          categoryIds: ['milk', 'plant-based-drinks-and-horchata'],
        },
      ]);
      expect(created.categories.map((c) => c.id)).toEqual([
        'milk',
        'plant-based-drinks-and-horchata',
      ]);
    });

    it('refuses an empty list, a root and an unknown id before writing anything', async () => {
      const items = saving();
      const { service, categories } = build({
        items,
        categories: { roots: ['eggs-milk-and-butter'], unknown: ['gone'] },
      });

      await expect(
        service.create({ ...draft, categoryIds: [] })
      ).rejects.toBeInstanceOf(ItemNeedsACategoryException);
      await expect(
        service.create({
          ...draft,
          categoryIds: ['milk', 'eggs-milk-and-butter'],
        })
      ).rejects.toBeInstanceOf(CategoryNotALeafException);
      await expect(
        service.create({ ...draft, categoryIds: ['gone'] })
      ).rejects.toBeInstanceOf(CategoryNotFoundException);
      await expect(
        service.createMany({
          userId: ADMIN,
          items: [
            { ...draft, categoryIds: ['milk'] },
            { ...draft, categoryIds: [] },
          ],
        })
      ).rejects.toBeInstanceOf(ItemNeedsACategoryException);

      expect(items.save).not.toHaveBeenCalled();
      expect(categories.written).toEqual([]);
    });

    it('leaves the set alone on an update that does not name it', async () => {
      const items = saving();
      const { service, categories } = build({ items });

      const updated = await service.update({
        userId: ADMIN,
        itemId: 'i1',
        name: { es: 'Leche entera' },
      });

      expect(categories.written).toEqual([]);
      // Read back rather than invented: the double answers its own leaf.
      expect(updated.categories).toHaveLength(1);
    });

    it('replaces the set on an update that names it, and refuses emptying it', async () => {
      const items = saving();
      const { service, categories } = build({ items });

      await service.update({
        userId: ADMIN,
        itemId: 'i1',
        categoryIds: ['plant-based-drinks-and-horchata'],
      });
      expect(categories.written).toEqual([
        { itemId: 'i1', categoryIds: ['plant-based-drinks-and-horchata'] },
      ]);

      await expect(
        service.update({ userId: ADMIN, itemId: 'i1', categoryIds: [] })
      ).rejects.toBeInstanceOf(ItemNeedsACategoryException);
    });

    describe('updateMany', () => {
      it('is gated, and refuses an empty list, a repeat and one over the cap', async () => {
        const items = saving();
        const { service } = build({ items });

        await expect(
          service.updateMany({ userId: 'intruder', items: [{ itemId: 'i1' }] })
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          service.updateMany({ userId: ADMIN, items: [] })
        ).rejects.toBeInstanceOf(ValidationException);
        await expect(
          service.updateMany({
            userId: ADMIN,
            items: [{ itemId: 'i1' }, { itemId: 'i1' }],
          })
        ).rejects.toBeInstanceOf(ValidationException);
        await expect(
          service.updateMany({
            userId: ADMIN,
            items: Array.from({ length: 1001 }, (_, i) => ({
              itemId: `i${i}`,
            })),
          })
        ).rejects.toBeInstanceOf(ValidationException);
        expect(items.save).not.toHaveBeenCalled();
      });

      it('checks every entry before writing any, and answers in the order asked', async () => {
        const items = saving();
        const { service, categories } = build({
          items,
          categories: { roots: ['water-and-soft-drinks'] },
        });

        await expect(
          service.updateMany({
            userId: ADMIN,
            items: [
              { itemId: 'i1', categoryIds: ['cola'] },
              { itemId: 'i2', categoryIds: ['water-and-soft-drinks'] },
            ],
          })
        ).rejects.toBeInstanceOf(CategoryNotALeafException);
        expect(items.save).not.toHaveBeenCalled();
        expect(categories.written).toEqual([]);

        const done = await service.updateMany({
          userId: ADMIN,
          items: [
            { itemId: 'i2', categoryIds: ['water'] },
            { itemId: 'i1', name: { es: 'Uno nuevo' } },
          ],
        });
        expect(done.items.map((item) => item.id)).toEqual(['i2', 'i1']);
        expect(categories.written).toEqual([
          { itemId: 'i2', categoryIds: ['water'] },
        ]);
      });

      it('names a product that does not exist', async () => {
        const items = saving();
        const { service } = build({ items });

        await expect(
          service.updateMany({
            userId: ADMIN,
            items: [{ itemId: 'i1' }, { itemId: 'i9' }],
          })
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });
  });
});
