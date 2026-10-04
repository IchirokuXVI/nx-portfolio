import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
// Value imports: the audit double keys on the entity class itself.
import {
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
  type Item,
} from '../entities';
import { fakeAudit } from './catalog-audit.testing';
import type { LocationScopeService } from './location-scopes';
import type { PlatformAdminService } from './platform-admin.service';
import { SupermarketLocationItemService } from './supermarket-location-item.service';

const ADMIN = 'owner-1';
const OBSERVED = '2026-09-04T08:00:00.000Z';

function makeAdmin(): jest.Mocked<PlatformAdminService> {
  return {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return { kind: 'admin', actorId: credential.userId };
    }),
  } as unknown as jest.Mocked<PlatformAdminService>;
}

function shopRow(
  overrides: Partial<SupermarketLocationItem> = {}
): SupermarketLocationItem {
  return {
    id: 'sli-1',
    itemId: 'item-1',
    supermarketLocationId: 'loc-1',
    positionInStore: null,
    available: null,
    availabilitySourceKind: null,
    availabilityObservedAt: null,
    availabilitySourceRunId: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SupermarketLocationItem;
}

function scopeRow(overrides: Partial<SupermarketItem> = {}): SupermarketItem {
  return {
    id: 'si-1',
    itemId: 'item-1',
    priceScopeId: 'scope-1',
    price: null,
    currency: null,
    unitPrice: null,
    unitPriceLabel: null,
    priceObservedAt: null,
    priceSourceKind: null,
    available: true,
    itemPriceId: null,
    stale: false,
    validUntil: null,
    nextBoundaryAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SupermarketItem;
}

interface BuildOptions {
  /** What the shop already holds, keyed by item. */
  held?: SupermarketLocationItem[];
  /** Every location of the scope this shop prices against. */
  scopeLocations?: { id: string }[];
  /** Every per shop row of that scope, for the derivation to read. */
  scopeOpinions?: SupermarketLocationItem[];
  /** The materialized rows the scope already has. */
  scopeRows?: SupermarketItem[];
  /** The products catalog holds. Absent means the one named `item-1`. */
  products?: Partial<Item>[];
}

const PRODUCT: Partial<Item> = {
  id: 'item-1',
  name: { en: 'Whole milk', es: 'Leche entera' },
  brand: 'Hacendado',
};

function build(options: BuildOptions = {}) {
  const {
    held = [],
    scopeLocations = [{ id: 'loc-1' }],
    scopeOpinions,
    scopeRows = [],
    products = [PRODUCT],
  } = options;

  const savedShopRows: SupermarketLocationItem[] = [];
  const savedScopeRows: SupermarketItem[] = [];

  const rows = {
    findOne: jest.fn(async () => held[0] ?? null),
    find: jest.fn(async (query: { where?: Record<string, unknown> }) => {
      // Two different reads share this repository: the shop's own rows before
      // the write, and every row of the scope during the derivation. They are
      // told apart by which key the caller filtered on.
      const where = (query?.where ?? {}) as Record<string, unknown>;
      return 'supermarketLocationId' in where &&
        typeof where['supermarketLocationId'] === 'string'
        ? held
        : (scopeOpinions ?? held);
    }),
    create: jest.fn((draft) => ({
      id: `new-${savedShopRows.length}`,
      ...draft,
    })),
    save: jest.fn(
      async (
        input: SupermarketLocationItem | SupermarketLocationItem[]
      ): Promise<unknown> => {
        savedShopRows.push(...(Array.isArray(input) ? input : [input]));
        return input;
      }
    ),
    // The page read of `listByLocation`: every held row, whatever was asked.
    createQueryBuilder: jest.fn(() => {
      const builder = {
        where: () => builder,
        andWhere: () => builder,
        orderBy: () => builder,
        addOrderBy: () => builder,
        take: () => builder,
        getMany: async () => held,
      };
      return builder;
    }),
  } as unknown as Repository<SupermarketLocationItem>;

  const items = {
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        (products.find((product) => product.id === where.id) as Item) ?? null
    ),
    // The batched name read of a page. It answers every product held rather
    // than reading the `In(...)`, so a row with no product proves the null.
    find: jest.fn(async () => products as Item[]),
  } as unknown as Repository<Item>;

  const locations = {
    findOne: jest.fn(async () => ({ id: 'loc-1' }) as SupermarketLocation),
    find: jest.fn(async () => scopeLocations as SupermarketLocation[]),
  } as unknown as Repository<SupermarketLocation>;

  /**
   * The shop is quoted from `scope-1`, and `scopeLocations` are the shops that
   * hold it: the two halves the derivation reads, which used to be a column on
   * the shop and a `find` by that column (plan 0105, section 3).
   */
  const stacks = {
    quotedScopeOf: jest.fn(async () => 'scope-1'),
    locationsHolding: jest.fn(async () => scopeLocations.map((l) => l.id)),
  } as unknown as LocationScopeService;

  const supermarketItems = {
    find: jest.fn(async () => scopeRows),
    create: jest.fn((draft) => ({ id: 'si-new', ...draft })),
    save: jest.fn(async (input: SupermarketItem) => {
      savedScopeRows.push(input);
      return input;
    }),
  } as unknown as Repository<SupermarketItem>;

  const audit = fakeAudit([
    [
      SupermarketLocationItem,
      { name: 'supermarket_location_items', repository: rows },
    ],
    [
      SupermarketItem,
      { name: 'supermarket_items', repository: supermarketItems },
    ],
    [
      SupermarketLocation,
      { name: 'supermarket_locations', repository: locations },
    ],
  ]);

  const svc = new SupermarketLocationItemService(
    rows,
    items,
    locations,
    makeAdmin(),
    audit.service,
    stacks
  );
  return { svc, rows, items, locations, audit, savedShopRows, savedScopeRows };
}

function request(
  overrides: Partial<{
    sourceKind: PriceSourceKind;
    entries: { itemId: string; available: boolean }[];
    sourceRunId: string | null;
  }> = {}
) {
  return {
    userId: ADMIN,
    supermarketLocationId: 'loc-1',
    sourceKind: PriceSourceKind.OFFICIAL_WEB,
    sourceRunId: 'run-1',
    observedAt: OBSERVED,
    entries: [{ itemId: 'item-1', available: true }],
    ...overrides,
  };
}

/**
 * The per shop half, and the column plan 0084 let an automated source write
 * (section 4).
 */
describe('SupermarketLocationItemService.setAvailability', () => {
  it('is gated, like every catalog write', async () => {
    const { svc } = build();
    await expect(
      svc.setAvailability(request({}) as never)
    ).resolves.toBeDefined();
    await expect(
      svc.setAvailability({ ...request(), userId: 'intruder' } as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires the shop to exist', async () => {
    const { svc, locations } = build();
    (locations.findOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(
      svc.setAvailability(request() as never)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * Section 3, all four rungs, over one automated write. The table is the whole
   * rule: who owns the row decides whether the crawl may touch it, and nothing
   * else does.
   */
  describe('the provenance ladder (section 3)', () => {
    const cases: {
      name: string;
      held: Partial<SupermarketLocationItem> | null;
      writes: boolean;
      conflicts: boolean;
    }[] = [
      {
        name: 'an ADMIN row is skipped and reported',
        held: {
          available: true,
          availabilitySourceKind: PriceSourceKind.ADMIN,
        },
        writes: false,
        conflicts: true,
      },
      {
        name: 'a null kind beside a non null value is treated as ADMIN',
        held: { available: true, availabilitySourceKind: null },
        writes: false,
        conflicts: true,
      },
      {
        name: 'a null kind beside a null value is free',
        held: { available: null, availabilitySourceKind: null },
        writes: true,
        conflicts: false,
      },
      {
        name: 'another automated kind loses to the newer observation',
        held: {
          available: true,
          availabilitySourceKind: PriceSourceKind.OFFICIAL_API,
        },
        writes: true,
        conflicts: false,
      },
      {
        name: 'no row at all is free',
        held: null,
        writes: true,
        conflicts: false,
      },
    ];

    it.each(cases)('$name', async ({ held, writes, conflicts }) => {
      const { svc, savedShopRows } = build({
        held: held ? [shopRow(held)] : [],
      });
      const result = await svc.setAvailability(
        request({ entries: [{ itemId: 'item-1', available: false }] }) as never
      );

      expect(result.written).toBe(writes ? 1 : 0);
      expect(result.conflicts).toHaveLength(conflicts ? 1 : 0);
      expect(savedShopRows.filter((r) => r.itemId === 'item-1')).toHaveLength(
        writes ? 1 : 0
      );
    });
  });

  it("names the item and both answers when it declines a person's row", async () => {
    const { svc } = build({
      held: [
        shopRow({
          available: true,
          availabilitySourceKind: PriceSourceKind.ADMIN,
        }),
      ],
    });
    const result = await svc.setAvailability(
      request({ entries: [{ itemId: 'item-1', available: false }] }) as never
    );
    expect(result.conflicts).toEqual([
      { itemId: 'item-1', held: true, offered: false },
    ]);
    expect(result.skipped).toBe(1);
  });

  /** A person overwrites anything, including a crawl's row, with no window. */
  it('lets a person write over a crawl', async () => {
    const { svc, savedShopRows } = build({
      held: [
        shopRow({
          available: true,
          availabilitySourceKind: PriceSourceKind.OFFICIAL_WEB,
        }),
      ],
    });
    const result = await svc.setAvailability(
      request({
        sourceKind: PriceSourceKind.ADMIN,
        sourceRunId: null,
        entries: [{ itemId: 'item-1', available: false }],
      }) as never
    );
    expect(result.conflicts).toEqual([]);
    expect(savedShopRows[0]).toMatchObject({
      available: false,
      availabilitySourceKind: PriceSourceKind.ADMIN,
      availabilitySourceRunId: null,
    });
  });

  /**
   * Absence is a claim. A shop missing from a product's list of shops does not
   * stock it, and writing null instead would throw that away.
   */
  it('writes false rather than clearing to null', async () => {
    const { svc, savedShopRows } = build();
    await svc.setAvailability(
      request({ entries: [{ itemId: 'item-1', available: false }] }) as never
    );
    expect(savedShopRows[0]).toMatchObject({
      available: false,
      availabilitySourceKind: PriceSourceKind.OFFICIAL_WEB,
      availabilitySourceRunId: 'run-1',
    });
    expect(savedShopRows[0].availabilityObservedAt).toEqual(new Date(OBSERVED));
  });

  it('writes nothing for a row that already says exactly this', async () => {
    const { svc, savedShopRows, audit } = build({
      held: [
        shopRow({
          available: false,
          availabilitySourceKind: PriceSourceKind.OFFICIAL_WEB,
        }),
      ],
    });
    const result = await svc.setAvailability(
      request({ entries: [{ itemId: 'item-1', available: false }] }) as never
    );
    expect(result).toEqual({ written: 0, skipped: 1, conflicts: [] });
    expect(savedShopRows).toEqual([]);
    expect(audit.recorded).toEqual([]);
  });

  /**
   * Section 5. The scope wide flag is derived from the shops beneath it, inside
   * the same handler, because both tables belong to catalog and the relation is
   * an invariant rather than a policy.
   */
  describe('the scope flag follows from the shops (section 5)', () => {
    it('is true when any shop of the scope says true', async () => {
      const { svc, savedScopeRows } = build({
        scopeLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
        scopeOpinions: [
          shopRow({
            id: 'a',
            supermarketLocationId: 'loc-1',
            available: false,
          }),
          shopRow({ id: 'b', supermarketLocationId: 'loc-2', available: true }),
        ],
        scopeRows: [scopeRow({ available: false })],
      });
      await svc.setAvailability(
        request({ entries: [{ itemId: 'item-1', available: false }] }) as never
      );
      expect(savedScopeRows).toHaveLength(1);
      expect(savedScopeRows[0].available).toBe(true);
    });

    it('is false when every shop that has an opinion says false', async () => {
      const { svc, savedScopeRows } = build({
        scopeLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
        scopeOpinions: [
          shopRow({
            id: 'a',
            supermarketLocationId: 'loc-1',
            available: false,
          }),
          shopRow({ id: 'b', supermarketLocationId: 'loc-2', available: null }),
        ],
        scopeRows: [scopeRow({ available: true })],
      });
      await svc.setAvailability(
        request({ entries: [{ itemId: 'item-1', available: false }] }) as never
      );
      expect(savedScopeRows).toHaveLength(1);
      expect(savedScopeRows[0].available).toBe(false);
    });

    it('leaves the scope alone when no shop has an opinion', async () => {
      const { svc, savedScopeRows } = build({
        scopeOpinions: [shopRow({ id: 'a', available: null })],
        scopeRows: [scopeRow({ available: true })],
      });
      await svc.setAvailability(
        request({ entries: [{ itemId: 'item-1', available: false }] }) as never
      );
      expect(savedScopeRows).toEqual([]);
    });

    /** Section 3, one level up: a person's row is not recomputed from shops. */
    it("does not recompute a scope row a person's kind stands on", async () => {
      const { svc, savedScopeRows } = build({
        scopeOpinions: [shopRow({ id: 'a', available: true })],
        scopeRows: [
          scopeRow({
            available: false,
            priceSourceKind: PriceSourceKind.ADMIN,
          }),
        ],
      });
      await svc.setAvailability(
        request({ entries: [{ itemId: 'item-1', available: true }] }) as never
      );
      expect(savedScopeRows).toEqual([]);
    });
  });
});

/** `upsert` keeps the rest of the row and no longer writes `available`. */
describe('SupermarketLocationItemService.upsert', () => {
  it('writes the position and nothing about stock', async () => {
    const { svc, savedShopRows } = build({
      held: [shopRow({ available: true })],
    });
    await svc.upsert({
      userId: ADMIN,
      itemId: 'item-1',
      supermarketLocationId: 'loc-1',
      positionInStore: 'Aisle 4',
    });
    expect(savedShopRows).toHaveLength(1);
    expect(savedShopRows[0].positionInStore).toBe('Aisle 4');
    // Untouched, because this route cannot state provenance and a value with
    // none is one no automated writer could tell from an unwritten one.
    expect(savedShopRows[0].available).toBe(true);
    expect(savedShopRows[0].availabilitySourceKind).toBeNull();
  });
});

/**
 * The product's name and brand ride on every read of the row (admin plan 0042,
 * section 2). The fake proves which reads fill them and what a missing product
 * or brand reads as; the join itself is proved against real Postgres in
 * `location-availability.integration.spec.ts`.
 */
describe('SupermarketLocationItemService, the product a row names', () => {
  const named = {
    itemName: { en: 'Whole milk', es: 'Leche entera' },
    itemBrand: 'Hacendado',
  };

  it('fills both on the answer of an upsert, from the read it already made', async () => {
    const { svc, items } = build({ held: [shopRow()] });
    const view = await svc.upsert({
      userId: ADMIN,
      itemId: 'item-1',
      supermarketLocationId: 'loc-1',
      positionInStore: 'Aisle 4',
    });
    expect(view).toMatchObject(named);
    expect(items.findOne).toHaveBeenCalledTimes(1);
  });

  it('fills both on a get', async () => {
    const { svc } = build({ held: [shopRow()] });
    const view = await svc.get({
      userId: ADMIN,
      itemId: 'item-1',
      supermarketLocationId: 'loc-1',
    });
    expect(view).toMatchObject(named);
  });

  it('fills both on every row of a page, with one read for the page', async () => {
    const { svc, items } = build({
      held: [
        shopRow(),
        shopRow({ id: 'sli-2', itemId: 'item-2' }),
        shopRow({ id: 'sli-3', itemId: 'item-gone' }),
      ],
      products: [
        PRODUCT,
        { id: 'item-2', name: { es: 'Arroz redondo' }, brand: null },
      ],
    });
    const page = await svc.listByLocation({
      userId: ADMIN,
      supermarketLocationId: 'loc-1',
    });

    expect(page.items.map((row) => [row.itemName, row.itemBrand])).toEqual([
      [named.itemName, 'Hacendado'],
      // A product with no brand keeps its name and a null brand.
      [{ es: 'Arroz redondo' }, null],
      // A row whose product is gone still lists, with both null.
      [null, null],
    ]);
    expect(items.find).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for an empty page', async () => {
    const { svc, items } = build();
    const page = await svc.listByLocation({
      userId: ADMIN,
      supermarketLocationId: 'loc-1',
    });
    expect(page.items).toEqual([]);
    expect(items.find).not.toHaveBeenCalled();
  });
});
