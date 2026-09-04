import {
  ItemCategory,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
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
    // ORDER BY, which is what a `false` written there would be.
    expect(sql).toContain('ORDER BY round(GREATEST(');
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
});
