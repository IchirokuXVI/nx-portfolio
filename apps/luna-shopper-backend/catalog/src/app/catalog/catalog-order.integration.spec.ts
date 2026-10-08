import { JwtService } from '@nestjs/jwt';
import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type ItemOrder,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  Brand,
  CATALOG_ENTITIES,
  Category,
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The three orders of plan 0196 on the product listing, against real
 * Postgres: `category`, `price` and `unitPrice`.
 *
 * Every claim here is about an `ORDER BY`, a keyset seek and the scalar
 * subquery both of them read, and a fake can prove none of the three. The
 * unit specs build this service on repositories that answer what they are
 * told to.
 *
 * Seven products in one group, so each read names the group and sees those
 * seven and nothing a migration may have seeded. Their names are one word and
 * a letter, A to G, and the name is the second key of each order.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=catalog-order
 */
const SCHEMA = 'plan0196_catalog_order_test';
const OWNER = 'ac700000-0000-4000-a000-000000000196';
const SHOPPER = 'shopper';
const OBSERVED = new Date('2026-10-01T10:00:00.000Z');

type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
const LETTERS: readonly Letter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

describeIntegration('the catalog orders of plan 0196 (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;

  const ids = {
    group: '',
    first: '',
    second: '',
    product: {} as Record<Letter, string>,
  };
  /** The letter of a product id, which is how every expectation is written. */
  const letterOf = new Map<string, Letter>();

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      // `public` behind the scratch schema for `pg_trgm`, as in the search
      // integration spec, which explains why at length.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const events = {
      itemGroupChanged: jest.fn(),
      productGroupDeleted: jest.fn(),
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    const groups = new ProductGroupService(
      dataSource.getRepository(ProductGroup),
      admin,
      audit,
      events
    );
    const categories = new CategoryService(
      dataSource.getRepository(Category),
      admin,
      audit
    );
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      groups,
      admin,
      audit,
      events,
      categories,
      itemEanStoreOf(dataSource)
    );

    // Three leaves of the seeded tree, in the order of the tree: the first
    // leaf, the last leaf, and one between them under another root than the
    // first. The tree answers its roots and then its leaves, grouped by root.
    const tree = (await categories.tree({ userId: SHOPPER })).categories;
    const leaves = tree.filter((row) => row.parentId !== null);
    const early = leaves[0];
    const late = leaves[leaves.length - 1];
    const mid = leaves.find(
      (leaf) => leaf.parentId !== early.parentId && leaf.id !== late.id
    );
    if (!mid) {
      throw new Error('The seeded tree has fewer than two roots with leaves.');
    }

    ids.group = (
      await groups.create({
        userId: OWNER,
        name: { en: 'Order test', es: 'Prueba de orden' },
        slug: 'plan-0196-order',
        referenceUnit: UnitOfMeasure.UNIT,
        synonyms: { en: [], es: [] },
      })
    ).id;

    // What each product sits on. C names two leaves, and the first one named
    // is its first category, so it sorts with the middle leaf and not with
    // the early one it also holds. F ends with none, below.
    const categoryIds: Record<Letter, string[]> = {
      A: [late.id],
      B: [early.id],
      C: [mid.id, early.id],
      D: [early.id],
      E: [mid.id],
      F: [early.id],
      G: [late.id],
    };
    for (const letter of LETTERS) {
      const created = await items.create({
        userId: OWNER,
        name: { en: `Orden ${letter}`, es: `Orden ${letter}` },
        categoryIds: categoryIds[letter],
        defaultUnit: UnitOfMeasure.UNIT,
        productGroupId: ids.group,
      });
      ids.product[letter] = created.id;
      letterOf.set(created.id, letter);
    }
    // A product needs a category to be written, so the one with none is made
    // the way a source leaves one behind: its rows are taken away.
    await dataSource.query(
      `DELETE FROM "item_categories" WHERE "itemId" = $1`,
      [ids.product.F]
    );

    const chains = dataSource.getRepository(Supermarket);
    const chain = (name: string) =>
      chains.save(
        chains.create({
          name: { en: name, es: name },
          logoUrl: null,
          websiteUrl: null,
          externalBrandKey: null,
        })
      );
    const scopes = dataSource.getRepository(PriceScope);
    const scope = async (name: string) =>
      (
        await scopes.save(
          scopes.create({
            supermarketId: (await chain(name)).id,
            kind: PriceScopeKind.STORE,
            externalKey: `${name}-1`,
            label: null,
          })
        )
      ).id;
    ids.first = await scope('First');
    ids.second = await scope('Second');

    const prices = dataSource.getRepository(SupermarketItem);
    const row = (
      letter: Letter,
      priceScopeId: string,
      price: number | null,
      unitPrice: number | null,
      available = true
    ) =>
      prices.create({
        itemId: ids.product[letter],
        priceScopeId,
        price,
        unitPrice,
        unitPriceLabel: unitPrice === null ? null : 'kg',
        currency: 'EUR',
        priceObservedAt: OBSERVED,
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
        available,
      });
    await prices.save([
      // A: cheapest at the first scope, and the lowest unit price at the
      // second, so the two orders name two different offers for it.
      row('A', ids.first, 3, 6),
      row('A', ids.second, 3.5, 1),
      // B and C: one price and one unit price, so the name decides.
      row('B', ids.first, 1, 2),
      row('C', ids.first, 1, 2),
      // D: a price and no unit price.
      row('D', ids.second, 2, null),
      // E: no row at all.
      // F: a leaflet tile with a unit price and no till price (plan 0157).
      // The lowest unit price of the seven, and not an offer.
      row('F', ids.first, null, 0.1),
      // G: the lowest price of the seven, at a scope that does not stock it.
      row('G', ids.first, 0.5, 0.2, false),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  const bothScopes = () => [ids.first, ids.second];
  const letters = (page: readonly ItemView[]): Letter[] =>
    page.map((item) => letterOf.get(item.id) as Letter);

  /** Every page of one order, each as its letters, until the cursor ends. */
  async function walk(
    order: ItemOrder,
    limit: number,
    extra: { priceScopeIds?: string[]; query?: string } = {
      priceScopeIds: bothScopes(),
    }
  ): Promise<Letter[][]> {
    const pages: Letter[][] = [];
    let cursor: string | undefined;
    // Seven products can fill at most seven pages. One more turn than that
    // is a cursor that never ends.
    for (let turn = 0; turn < 9; turn += 1) {
      const page = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order,
        limit,
        cursor,
        ...extra,
      });
      pages.push(letters(page.items));
      if (page.nextCursor === null) {
        return pages;
      }
      cursor = page.nextCursor;
    }
    throw new Error(`The ${order} order never reached its last page.`);
  }

  describe('order=price', () => {
    it('pages seven products three at a time, with no repeat and no skip', async () => {
      // B and C tie at 1 and fall to the name. D at 2, A at its lower 3.
      // E has no row, F has no till price and G is not stocked: no price,
      // so they come last, by name. G would be first by its number alone.
      expect(await walk('price', 3)).toEqual([
        ['B', 'C', 'D'],
        ['A', 'E', 'F'],
        ['G'],
      ]);
    });

    it('seeks across a tie and across the rows with no price, one row at a time', async () => {
      expect((await walk('price', 1)).flat()).toEqual([
        'B',
        'C',
        'D',
        'A',
        'E',
        'F',
        'G',
      ]);
    });

    it('answers every product by name when the read has no scope', async () => {
      expect(await walk('price', 3, {})).toEqual([
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
        ['G'],
      ]);
    });

    it('reads the price at the scopes of the read and at no other', async () => {
      // At the second scope alone, A costs 3.5 and D costs 2. B and C have
      // no row there.
      expect(
        (await walk('price', 3, { priceScopeIds: [ids.second] })).flat()
      ).toEqual(['D', 'A', 'B', 'C', 'E', 'F', 'G']);
    });

    it('takes the listed branch with a term too', async () => {
      // With a term and no order this is the ranked branch, which cannot
      // answer a keyset cursor. With the order it is every match by price.
      expect(
        await walk('price', 3, {
          priceScopeIds: bothScopes(),
          query: 'orden',
        })
      ).toEqual([['B', 'C', 'D'], ['A', 'E', 'F'], ['G']]);
    });

    it('attaches the cheapest offer, as every order but unitPrice does', async () => {
      const page = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'price',
        priceScopeIds: bothScopes(),
      });

      const a = page.items.find((item) => item.id === ids.product.A);
      expect(a?.bestOffer).toMatchObject({
        priceScopeId: ids.first,
        price: 3,
        unitPrice: 6,
      });
    });
  });

  describe('order=unitPrice', () => {
    it('pages seven products three at a time, with no repeat and no skip', async () => {
      // A by its unit price of 1 at the second scope. B and C tie at 2. D
      // has a price and no unit price, so it joins the ones with none.
      expect(await walk('unitPrice', 3)).toEqual([
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
        ['G'],
      ]);
    });

    it('seeks one row at a time', async () => {
      expect((await walk('unitPrice', 1)).flat()).toEqual([
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
      ]);
    });

    it('attaches the offer with the lowest unit price, the number that placed the row', async () => {
      const page = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'unitPrice',
        priceScopeIds: bothScopes(),
      });

      expect(page.items[0].id).toBe(ids.product.A);
      expect(page.items[0].bestOffer).toMatchObject({
        priceScopeId: ids.second,
        price: 3.5,
        unitPrice: 1,
      });
      // A row with a price and no unit price keeps its cheapest offer.
      const d = page.items.find((item) => item.id === ids.product.D);
      expect(d?.bestOffer).toMatchObject({ price: 2, unitPrice: null });
    });

    it('picks the same offer out of every offer, and leaves that array in its order', async () => {
      const page = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'unitPrice',
        priceScopeIds: bothScopes(),
        offers: 'all',
      });

      const a = page.items[0];
      expect(a.bestOffer?.priceScopeId).toBe(ids.second);
      expect(a.offers?.map((offer) => offer.priceScopeId)).toEqual([
        ids.first,
        ids.second,
      ]);
    });
  });

  describe('order=category', () => {
    it('pages seven products three at a time, with no repeat and no skip', async () => {
      // B and D on the first leaf. C by its first category, the middle
      // leaf, with E. A and G on the last leaf. F on none, last.
      expect(await walk('category', 3)).toEqual([
        ['B', 'D', 'C'],
        ['E', 'A', 'G'],
        ['F'],
      ]);
    });

    it('seeks one row at a time', async () => {
      expect((await walk('category', 1)).flat()).toEqual([
        'B',
        'D',
        'C',
        'E',
        'A',
        'G',
        'F',
      ]);
    });

    it('needs no scope', async () => {
      expect((await walk('category', 3, {})).flat()).toEqual([
        'B',
        'D',
        'C',
        'E',
        'A',
        'G',
        'F',
      ]);
    });
  });

  describe('a cursor of another order', () => {
    it('starts over', async () => {
      const byPrice = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'price',
        limit: 3,
        priceScopeIds: bothScopes(),
      });
      expect(byPrice.nextCursor).not.toBeNull();

      const byCategory = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'category',
        limit: 3,
        priceScopeIds: bothScopes(),
        cursor: byPrice.nextCursor ?? undefined,
      });

      expect(letters(byCategory.items)).toEqual(['B', 'D', 'C']);
    });

    it('starts over under the name order as well', async () => {
      const byPrice = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'price',
        limit: 3,
        priceScopeIds: bothScopes(),
      });

      const byName = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'name',
        limit: 3,
        cursor: byPrice.nextCursor ?? undefined,
      });

      expect(letters(byName.items)).toEqual(['A', 'B', 'C']);
    });
  });
});
