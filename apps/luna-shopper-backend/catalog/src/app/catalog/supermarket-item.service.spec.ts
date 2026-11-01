import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
// `SupermarketItem` is a value here: the audit double keys on the entity class.
import {
  SupermarketItem,
  type Item,
  type PriceScope,
  type SupermarketLocation,
} from '../entities';
import { fakeAudit } from './catalog-audit.testing';
import type { LocationScopeService } from './location-scopes';
import type { PlatformAdminService } from './platform-admin.service';
import { SupermarketItemService } from './supermarket-item.service';

const ADMIN = 'owner-1';

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

/** A stored row as the repository would hand it back, numerics included. */
function storedRow(overrides: Partial<SupermarketItem> = {}): SupermarketItem {
  return {
    id: 'si1',
    itemId: 'item-1',
    priceScopeId: 'scope-1',
    price: 1.75,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    priceObservedAt: new Date('2026-08-30T10:00:00.000Z'),
    priceSourceKind: PriceSourceKind.OFFICIAL_API,
    available: true,
    delistedAt: null,
    outOfStockAt: null,
    itemPriceId: 'p1',
    stale: false,
    validUntil: null,
    nextBoundaryAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SupermarketItem;
}

/**
 * The materialized row's service (plan 0080, section 7). It reads, and the one
 * thing it writes is availability, because that is a fact about stock and not
 * about price.
 */
describe('SupermarketItemService', () => {
  const item = { id: 'item-1' } as Item;
  const scope = { id: 'scope-1' } as PriceScope;
  const location = { id: 'loc-1' } as SupermarketLocation;
  /** The shop sells at `scope-1`, and that is the scope it is quoted from. */
  const stacks = {
    quotedScopeOf: jest.fn(async () => 'scope-1'),
  } as unknown as LocationScopeService;

  function build(overrides: Partial<Repository<SupermarketItem>> = {}) {
    const admin = makeAdmin();
    const saved: SupermarketItem[] = [];
    const supermarketItems = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((x) => x),
      save: jest.fn(async (rows: SupermarketItem | SupermarketItem[]) => {
        saved.push(...(Array.isArray(rows) ? rows : [rows]));
        return rows;
      }),
      ...overrides,
    } as unknown as Repository<SupermarketItem>;
    const items = {
      findOne: jest.fn(async () => item),
    } as unknown as Repository<Item>;
    const scopes = {
      findOne: jest.fn(async () => scope),
    } as unknown as Repository<PriceScope>;
    const locations = {
      findOne: jest.fn(async () => location),
    } as unknown as Repository<SupermarketLocation>;
    const audit = fakeAudit([
      [
        SupermarketItem,
        { name: 'supermarket_items', repository: supermarketItems },
      ],
    ]);
    const svc = new SupermarketItemService(
      supermarketItems,
      items,
      scopes,
      locations,
      admin,
      audit.service,
      stacks
    );
    return {
      svc,
      admin,
      supermarketItems,
      items,
      scopes,
      locations,
      audit,
      saved,
    };
  }

  describe('setAvailability (plan 0080, section 9)', () => {
    it('is gated to the platform admin', async () => {
      const { svc } = build();
      await expect(
        svc.setAvailability({
          userId: 'intruder',
          priceScopeId: 'scope-1',
          entries: [{ itemId: 'item-1', available: false }],
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires the scope to exist', async () => {
      const { svc, scopes } = build();
      (scopes.findOne as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        svc.setAvailability({
          userId: ADMIN,
          priceScopeId: 'missing',
          entries: [{ itemId: 'item-1', available: false }],
        })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a row with no price and no source for an item the scope has not priced', async () => {
      // A 404 from a detail call says "not stocked here" and states no price.
      const { svc, saved, audit } = build();
      const result = await svc.setAvailability({
        userId: ADMIN,
        priceScopeId: 'scope-1',
        entries: [{ itemId: 'item-1', available: false }],
      });
      expect(result).toEqual({ updated: 1, keptSold: 0 });
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        itemId: 'item-1',
        priceScopeId: 'scope-1',
        available: false,
        priceSourceKind: null,
      });
      expect(saved[0].price).toBeUndefined();
      expect(audit.recorded.map((r) => r.action)).toEqual(['CREATE']);
    });

    it('flips an existing row and records only the flag', async () => {
      const existing = storedRow({ available: true });
      const { svc, saved, audit } = build({
        find: jest.fn(async () => [existing]),
      } as unknown as Partial<Repository<SupermarketItem>>);
      await svc.setAvailability({
        userId: ADMIN,
        priceScopeId: 'scope-1',
        entries: [{ itemId: 'item-1', available: false }],
      });
      expect(saved).toHaveLength(1);
      expect(saved[0].available).toBe(false);
      // The price columns are untouched: availability is not a price write.
      expect(saved[0].price).toBe(1.75);
      expect(audit.recorded).toHaveLength(1);
      expect(audit.recorded[0]).toMatchObject({
        action: 'UPDATE',
        before: { available: true },
        after: { available: false },
      });
    });

    it('writes nothing for a row that already says so', async () => {
      const { svc, saved, audit } = build({
        find: jest.fn(async () => [storedRow({ available: false })]),
      } as unknown as Partial<Repository<SupermarketItem>>);
      const result = await svc.setAvailability({
        userId: ADMIN,
        priceScopeId: 'scope-1',
        entries: [{ itemId: 'item-1', available: false }],
      });
      expect(result).toEqual({ updated: 0, keptSold: 0 });
      expect(saved).toEqual([]);
      expect(audit.recorded).toEqual([]);
    });

    describe('onlyIfMissing (plan 0182)', () => {
      const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const SCOPE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

      /**
       * The statement is proved against Postgres in
       * `location-availability.integration.spec.ts`. Here the database is a
       * double that answers the rows it "created".
       */
      function buildOffer(created: string[]) {
        const query = jest.fn(async () => created.map((id) => ({ id })));
        const find = jest.fn(async () =>
          created.map((id) =>
            storedRow({ id, itemId: ITEM_A, priceScopeId: SCOPE, price: null })
          )
        );
        return {
          ...build({ query, find } as unknown as Partial<
            Repository<SupermarketItem>
          >),
          query,
        };
      }

      const offer = (
        svc: SupermarketItemService,
        itemIds: string[] = [ITEM_A, ITEM_B]
      ) =>
        svc.setAvailability({
          userId: ADMIN,
          priceScopeId: SCOPE,
          entries: itemIds.map((itemId) => ({ itemId, available: true })),
          onlyIfMissing: true,
        });

      it('creates in one statement that does nothing on a conflict and reads the product from items', async () => {
        const { svc, query, saved, audit } = buildOffer(['si-new']);

        expect(await offer(svc)).toEqual({ updated: 1, keptSold: 0 });

        expect(query).toHaveBeenCalledTimes(1);
        const [sql, parameters] = query.mock.calls[0] as unknown as [
          string,
          unknown[],
        ];
        expect(sql).toContain('INSERT INTO "supermarket_items"');
        // A row a bind or the shop derivation inserted first wins, and the
        // statement does not fail on it.
        expect(sql).toContain(
          'ON CONFLICT ("itemId", "priceScopeId") DO NOTHING'
        );
        // A product catalog no longer holds is left out by the join, so it
        // breaks no foreign key for the others.
        expect(sql).toContain('JOIN "items" i');
        expect(parameters).toEqual([SCOPE, [ITEM_A, ITEM_B], [true, true]]);
        // Nothing goes through the read then save path.
        expect(saved).toEqual([]);
        expect(audit.recorded.map((r) => r.action)).toEqual(['CREATE']);
        expect(audit.recorded[0].entityId).toBe('si-new');
      });

      it('counts nothing and records nothing when every row exists', async () => {
        const { svc, saved, audit } = buildOffer([]);

        expect(await offer(svc)).toEqual({ updated: 0, keptSold: 0 });

        expect(saved).toEqual([]);
        expect(audit.recorded).toEqual([]);
      });

      it('drops an id that is not a uuid instead of failing the batch on the cast', async () => {
        const { svc, query } = buildOffer([]);

        await offer(svc, ['not-a-uuid', ITEM_B]);

        expect(
          (query.mock.calls[0] as unknown as [string, unknown[]])[1]
        ).toEqual([SCOPE, [ITEM_B], [true]]);
      });

      it('sends no statement when no id is usable', async () => {
        const { svc, query } = buildOffer([]);

        expect(await offer(svc, ['not-a-uuid'])).toEqual({
          updated: 0,
          keptSold: 0,
        });
        expect(query).not.toHaveBeenCalled();
      });

      it('ignores delisted and outOfStock', async () => {
        const { svc, query } = buildOffer(['si-new']);

        await svc.setAvailability({
          userId: ADMIN,
          priceScopeId: SCOPE,
          entries: [
            {
              itemId: ITEM_A,
              available: true,
              delisted: true,
              outOfStock: true,
            },
          ],
          onlyIfMissing: true,
        });

        // The one statement is the insert, which names neither instant.
        expect(query).toHaveBeenCalledTimes(1);
        const [sql] = query.mock.calls[0] as unknown as [string];
        expect(sql).not.toContain('delistedAt');
        expect(sql).not.toContain('outOfStockAt');
      });
    });

    describe('delisted and outOfStock (plan 0220, sections 6.1 and 15.1)', () => {
      const FIRST = new Date('2026-10-01T00:00:00.000Z');

      /** A service over one stored row, with no price that keeps it sold. */
      function over(row: SupermarketItem) {
        return build({
          find: jest.fn(async () => [row]),
          query: jest.fn(async () => []),
        } as unknown as Partial<Repository<SupermarketItem>>);
      }

      const write = (
        svc: SupermarketItemService,
        entry: {
          available?: boolean;
          delisted?: boolean;
          outOfStock?: boolean;
        }
      ) =>
        svc.setAvailability({
          userId: ADMIN,
          priceScopeId: 'scope-1',
          entries: [{ itemId: 'item-1', ...entry }],
        });

      it('sets delistedAt once and keeps the first instant', async () => {
        const fresh = over(storedRow());
        await write(fresh.svc, { available: false, delisted: true });
        expect(fresh.saved[0].delistedAt).toBeInstanceOf(Date);
        expect(fresh.saved[0].available).toBe(false);

        const held = over(storedRow({ available: false, delistedAt: FIRST }));
        const result = await write(held.svc, {
          available: false,
          delisted: true,
        });
        // Already gone since FIRST: nothing to write and no audit row.
        expect(result).toEqual({ updated: 0, keptSold: 0 });
        expect(held.saved).toEqual([]);
        expect(held.audit.recorded).toEqual([]);
      });

      it('clears delistedAt on false and leaves it when absent', async () => {
        const back = over(storedRow({ available: false, delistedAt: FIRST }));
        await write(back.svc, { available: true, delisted: false });
        expect(back.saved[0]).toMatchObject({
          available: true,
          delistedAt: null,
        });

        const plain = over(storedRow({ available: true, delistedAt: FIRST }));
        await write(plain.svc, { available: false });
        expect(plain.saved[0].available).toBe(false);
        expect(plain.saved[0].delistedAt).toBe(FIRST);
      });

      it('sets outOfStockAt once, clears it on false, and leaves it when absent', async () => {
        const first = over(storedRow());
        await write(first.svc, { available: true, outOfStock: true });
        expect(first.saved[0].outOfStockAt).toBeInstanceOf(Date);
        // Out of stock hides nothing.
        expect(first.saved[0].available).toBe(true);

        const again = over(storedRow({ outOfStockAt: FIRST }));
        expect(
          await write(again.svc, { available: true, outOfStock: true })
        ).toEqual({ updated: 0, keptSold: 0 });

        const cleared = over(storedRow({ outOfStockAt: FIRST }));
        await write(cleared.svc, { available: true, outOfStock: false });
        expect(cleared.saved[0].outOfStockAt).toBeNull();

        const absent = over(storedRow({ outOfStockAt: FIRST }));
        await write(absent.svc, { available: false });
        expect(absent.saved[0].outOfStockAt).toBe(FIRST);
      });

      it('keeps the flag of a row when the entry gives an instant and no flag', async () => {
        // A 404 turned the product off at this scope, and the next whole walk
        // missed it: the first miss marks it out of stock and sells nothing.
        const off = over(storedRow({ available: false }));
        await write(off.svc, { outOfStock: true });
        expect(off.saved[0].available).toBe(false);
        expect(off.saved[0].outOfStockAt).toBeInstanceOf(Date);

        const sold = over(storedRow({ available: true, delistedAt: FIRST }));
        await write(sold.svc, { delisted: false });
        expect(sold.saved[0]).toMatchObject({
          available: true,
          delistedAt: null,
        });
      });

      it('creates no row for an entry that gives an instant and no flag', async () => {
        const { svc, saved, audit } = build({
          find: jest.fn(async () => []),
          query: jest.fn(async () => []),
        } as unknown as Partial<Repository<SupermarketItem>>);
        const result = await write(svc, { outOfStock: true });
        expect(result).toEqual({ updated: 0, keptSold: 0 });
        expect(saved).toEqual([]);
        expect(audit.recorded).toEqual([]);
      });

      it('records the instants in the trail beside the flag', async () => {
        const { svc, audit } = over(storedRow());
        await write(svc, { available: true, outOfStock: true });
        expect(audit.recorded).toHaveLength(1);
        expect(audit.recorded[0]).toMatchObject({
          action: 'UPDATE',
          before: { outOfStockAt: null },
        });
      });

      it('asks for the prices that keep a product sold only for a gone entry', async () => {
        const plain = over(storedRow());
        await write(plain.svc, { available: true, outOfStock: true });
        expect(plain.supermarketItems.query).not.toHaveBeenCalled();
      });

      it('keeps a gone product sold when a current person or leaflet price holds it', async () => {
        const ITEM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const row = storedRow({ itemId: ITEM });
        const { svc, saved, supermarketItems } = build({
          find: jest.fn(async () => [row]),
          query: jest.fn(async () => [{ itemId: ITEM }]),
        } as unknown as Partial<Repository<SupermarketItem>>);

        const result = await svc.setAvailability({
          userId: ADMIN,
          priceScopeId: 'scope-1',
          entries: [{ itemId: ITEM, available: false, delisted: true }],
        });

        expect(result).toEqual({ updated: 1, keptSold: 1 });
        expect(saved[0].available).toBe(true);
        expect(saved[0].delistedAt).toBeInstanceOf(Date);
        const [sql, parameters] = (supermarketItems.query as jest.Mock).mock
          .calls[0] as [string, unknown[]];
        expect(sql).toContain('"price_policies"');
        expect(parameters[2]).toEqual([
          PriceSourceKind.ADMIN,
          PriceSourceKind.OFFICIAL_LEAFLET,
        ]);
      });

      it('counts kept sold only for a row that was sold and would have turned off', async () => {
        const SOLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const OFF = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        const NONE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        const { svc, saved } = build({
          find: jest.fn(async () => [
            storedRow({ itemId: SOLD }),
            storedRow({ itemId: OFF, available: false }),
          ]),
          // Each of the three holds a current person or leaflet price.
          query: jest.fn(async () => [
            { itemId: SOLD },
            { itemId: OFF },
            { itemId: NONE },
          ]),
        } as unknown as Partial<Repository<SupermarketItem>>);

        const result = await svc.setAvailability({
          userId: ADMIN,
          priceScopeId: 'scope-1',
          entries: [SOLD, OFF, NONE].map((itemId) => ({
            itemId,
            available: false,
            delisted: true,
          })),
        });

        // OFF was not sold already, and NONE had no row: the price kept
        // neither from turning off, so only SOLD is a person's to decide.
        expect(result.keptSold).toBe(1);
        expect(saved.find((row) => row.itemId === SOLD)?.available).toBe(true);
        expect(saved.find((row) => row.itemId === OFF)?.available).toBe(false);
      });
    });
  });

  describe('reads', () => {
    it('get throws NotFound when the scope has no row for that item', async () => {
      const { svc } = build();
      await expect(
        svc.get({ userId: 'reader', itemId: 'item-1', priceScopeId: 'scope-1' })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('get answers the materialized row with its provenance and its flag', async () => {
      const { svc } = build({
        findOne: jest.fn(async () =>
          storedRow({
            stale: true,
            validUntil: new Date('2026-09-07T00:00:00.000Z'),
          })
        ),
      } as unknown as Partial<Repository<SupermarketItem>>);
      const view = await svc.get({
        userId: 'reader',
        itemId: 'item-1',
        priceScopeId: 'scope-1',
      });
      expect(view).toMatchObject({
        price: 1.75,
        observedAt: '2026-08-30T10:00:00.000Z',
        sourceKind: PriceSourceKind.OFFICIAL_API,
        stale: true,
        validUntil: '2026-09-07T00:00:00.000Z',
        itemPriceId: 'p1',
      });
    });

    it('listByLocation resolves the store to its scope and pages that', async () => {
      // The subject survived the re-keying because a shopper asks about a shop,
      // not about a warehouse code.
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => []),
      };
      const { svc } = build({
        createQueryBuilder: jest.fn(() => qb),
      } as unknown as Partial<Repository<SupermarketItem>>);

      await svc.listByLocation({
        userId: 'reader',
        supermarketLocationId: 'loc-1',
      });
      expect(qb.where).toHaveBeenCalledWith('si."priceScopeId" = :value', {
        value: 'scope-1',
      });
    });
  });
});

/**
 * The back office's effective price list (plan 0073, section 4; plan 0080,
 * section 10). It is the one read in this service behind the gate, and the
 * properties worth pinning are why: it starts from nothing, so with no filter
 * it is the whole price table, and `sourceKind` and `stale` are what make
 * "what have I overridden" and "what is shown on sufferance" answerable.
 */
describe('SupermarketItemService.adminList', () => {
  function build() {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => []),
    };
    const admin = makeAdmin();
    const supermarketItems = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<SupermarketItem>;
    const items = {
      find: jest.fn(async () => []),
    } as unknown as Repository<Item>;
    const svc = new SupermarketItemService(
      supermarketItems,
      items,
      {} as Repository<PriceScope>,
      {} as Repository<SupermarketLocation>,
      admin,
      // A read: it opens no transaction, so an unbound double is the honest
      // double. A write reaching it here would throw rather than pass quietly.
      fakeAudit([]).service,
      {} as LocationScopeService
    );
    return { svc, qb, items, admin };
  }

  it('is gated, unlike the three lists beside it', async () => {
    const { svc } = build();
    await expect(svc.adminList({ userId: 'intruder' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('with no filter it pages the whole table, newest first', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN });
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.orderBy).toHaveBeenCalledWith('si.createdAt', 'DESC');
  });

  it('answers "what have I overridden"', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, sourceKind: PriceSourceKind.ADMIN });
    expect(qb.andWhere).toHaveBeenCalledWith('si."priceSourceKind" = :kind', {
      kind: PriceSourceKind.ADMIN,
    });
  });

  it('answers "what is shown on sufferance"', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, stale: true });
    expect(qb.andWhere).toHaveBeenCalledWith('si."stale" = :stale', {
      stale: true,
    });
  });

  /**
   * Admin plan 0043, section 2: the price of every product on one page of the
   * product list, in one read. The clause itself is proved against Postgres in
   * `admin-product-list.integration.spec.ts`.
   */
  it('narrows to the products named', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, itemIds: ['item-1', 'item-2'] });
    expect(qb.andWhere).toHaveBeenCalledWith('si."itemId" IN (:...itemIds)', {
      itemIds: ['item-1', 'item-2'],
    });
  });

  /** `IN ()` is a syntax error, and an empty filter is no filter. */
  it('reads an empty list of products as no filter', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, itemIds: [] });
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  /**
   * `available: false` is a filter and not an absent one. Reading it as "no
   * filter" is the obvious bug, and it would hide exactly the rows an operator
   * opened the screen to find.
   */
  it('treats available=false as a filter rather than as absent', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, available: false });
    expect(qb.andWhere).toHaveBeenCalledWith('si."available" = :available', {
      available: false,
    });
  });

  /**
   * Admin plan 0023, section 3: the product's name rides the admin read,
   * because a page of prices is a page of distinct products and resolving a
   * name per row from the client is the request storm plan 0004 refused. One
   * batched read per page, by distinct id, and a price whose product is gone
   * keeps a null name rather than losing the row.
   */
  it('joins the product name onto each row, one read per distinct product', async () => {
    const { svc, qb, items } = build();
    qb.getMany.mockResolvedValue([
      storedRow({ id: 'si1', itemId: 'item-1' }),
      storedRow({ id: 'si2', itemId: 'item-1' }),
      storedRow({ id: 'si3', itemId: 'item-gone' }),
    ]);
    (items.find as jest.Mock).mockResolvedValue([
      { id: 'item-1', name: { en: 'Whole milk' } },
    ]);

    const page = await svc.adminList({ userId: ADMIN });

    expect(items.find).toHaveBeenCalledTimes(1);
    const where = (items.find as jest.Mock).mock.calls[0][0].where;
    expect(where.id.value).toEqual(['item-1', 'item-gone']);
    expect(page.items.map((row) => row.itemName)).toEqual([
      { en: 'Whole milk' },
      { en: 'Whole milk' },
      null,
    ]);
  });

  it('asks for no product at all on an empty page', async () => {
    const { svc, items } = build();
    await svc.adminList({ userId: ADMIN });
    expect(items.find).not.toHaveBeenCalled();
  });
});
