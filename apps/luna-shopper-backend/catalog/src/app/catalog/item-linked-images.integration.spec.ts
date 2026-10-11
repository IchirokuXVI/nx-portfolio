import { JwtService } from '@nestjs/jwt';
import {
  ItemImageSource,
  UnitOfMeasure,
  type ItemLinkedImageLink,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { ItemLinkedImages1758900000000 } from '../db/migrations/1758900000000-ItemLinkedImages';
import { categoryId } from '../db/taxonomy/ids';
import { seedTaxonomy } from '../db/taxonomy/taxonomy-seed';
import {
  Brand,
  CATALOG_ENTITIES,
  Category,
  Item,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemLinkedImageService } from './item-linked-image.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import type { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';
import { SupermarketService } from './supermarket.service';

/**
 * A chain photo is a link we can turn off, against real Postgres (plan 0198).
 *
 * Almost everything this plan promises is a property of SQL that a double
 * cannot prove: the upsert on the source row, the cascade, the one statement
 * that computes what a product shows, and the transaction that takes a chain's
 * photos out of every product when its switch goes off.
 *
 * **Nothing here opens an address.** Every assertion is on strings.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-linked-images.integration.spec.ts
 */
const SCHEMA = 'plan0198_linked_images_test';
const OWNER = 'ac700000-0000-4000-a000-000000000198';

const OWN_PHOTO = 'https://photos.example.org/leche.jpg';
const MERCADONA_PHOTO =
  'https://prod-mercadona.imgix.net/images/leche.jpg?fit=crop&h=300&w=300';
const MERCADONA_SECOND = 'https://prod-mercadona.imgix.net/images/leche-2.jpg';
const DIA_PHOTO = 'https://www.dia.es/product_images/1/1_ISO_0_ES.jpg';

describeIntegration('a chain photo is a link (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  let chains: SupermarketService;
  let links: ItemLinkedImageService;

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
      // `public` for the extensions the search reads, after the scratch schema.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.transaction((m) => seedTaxonomy(m));

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const events = {
      itemGroupChanged: () => undefined,
      productGroupDeleted: () => undefined,
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      new ProductGroupService(
        dataSource.getRepository(ProductGroup),
        admin,
        audit,
        events
      ),
      admin,
      audit,
      events,
      new CategoryService(dataSource.getRepository(Category), admin, audit),
      itemEanStoreOf(dataSource)
    );
    chains = new SupermarketService(
      dataSource.getRepository(Supermarket),
      // Read only when an update names a default scope, which none here does.
      {} as unknown as PriceScopeService,
      admin,
      audit
    );
    links = new ItemLinkedImageService(dataSource, admin, audit);
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "items"`);
    await dataSource.query(`DELETE FROM "supermarkets"`);
    await dataSource.query(`DELETE FROM "catalog_audit"`);
  });

  const product = (name: string, imageUrl: string | null = null) =>
    items.create({
      userId: OWNER,
      name: { es: name, en: name },
      categoryIds: [categoryId('frozen-pizzas')],
      defaultUnit: UnitOfMeasure.MILLILITER,
      unitSize: 1000,
      imageUrl,
    });
  const chain = (name: string) =>
    chains.create({ userId: OWNER, name: { es: name } });
  const link = (
    itemId: string,
    supermarketId: string,
    url: string,
    sourceEntryId: string = randomUUID()
  ): ItemLinkedImageLink => ({
    sourceEntryId,
    itemId,
    supermarketId,
    url,
    runId: null,
  });
  const send = (...entries: ItemLinkedImageLink[]) =>
    links.linkBatch({ userId: OWNER, entries });
  const turn = (supermarketId: string, enabled: boolean) =>
    chains.setLinkedImagesEnabled({ userId: OWNER, supermarketId, enabled });
  const get = (itemId: string) => items.get({ userId: OWNER, itemId });
  const saved = async (itemId: string): Promise<string[]> =>
    (await links.listByItem({ userId: OWNER, itemId })).images.map(
      (image) => image.url
    );
  const count = async (table: string): Promise<number> => {
    const [{ n }] = await dataSource.query(
      `SELECT count(*)::int AS "n" FROM "${table}"`
    );
    return n as number;
  };
  /**
   * `firstLinkedAt` is `now()`, and two batches of one test can land in one
   * millisecond. The order under test is by that column, so a test that reads
   * an order sets it.
   */
  const linkedAt = (sourceEntryId: string, at: string) =>
    dataSource.query(
      `UPDATE "item_linked_images" SET "firstLinkedAt" = $2 WHERE "sourceEntryId" = $1`,
      [sourceEntryId, at]
    );

  describe('the migration', () => {
    it('starts with every switch off and no product showing a chain photo', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      expect(mercadona.linkedImagesEnabled).toBe(false);
      const [row] = await dataSource.query(
        `SELECT "linkedImages" FROM "items" WHERE "id" = $1`,
        [milk.id]
      );
      expect(row.linkedImages).toEqual([]);
    }, 60_000);

    it('holds one link for each source row, and refuses an address that is not https', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      const row = randomUUID();
      const insert = (url: string) =>
        dataSource.query(
          `INSERT INTO "item_linked_images" ("sourceEntryId", "itemId", "supermarketId", "url")
           VALUES ($1, $2, $3, $4)`,
          [row, milk.id, mercadona.id, url]
        );
      await expect(
        insert('http://prod-mercadona.imgix.net/a.jpg')
      ).rejects.toThrow(/ck_item_linked_images_https/);
      await insert(MERCADONA_PHOTO);
      await expect(insert(MERCADONA_SECOND)).rejects.toThrow(
        /pk_item_linked_images/
      );
    }, 60_000);

    it('deletes the links of a product and of a chain with them', async () => {
      const milk = await product('Leche');
      const oil = await product('Aceite');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(milk.id, dia.id, DIA_PHOTO),
        link(oil.id, dia.id, 'https://www.dia.es/product_images/2/2.jpg')
      );
      expect(await count('item_linked_images')).toBe(3);

      await items.delete({ userId: OWNER, itemId: oil.id });
      expect(await count('item_linked_images')).toBe(2);

      await turn(mercadona.id, true);
      await turn(dia.id, true);
      expect((await get(milk.id)).images).toHaveLength(2);
      // The chain goes, and the product stops showing its photo in the same
      // transaction.
      await chains.delete({ userId: OWNER, supermarketId: dia.id });
      expect(await count('item_linked_images')).toBe(1);
      expect((await get(milk.id)).images.map((image) => image.url)).toEqual([
        MERCADONA_PHOTO,
      ]);
    }, 60_000);

    it('goes down and up again', async () => {
      const migration = new ItemLinkedImages1758900000000();
      const runner = dataSource.createQueryRunner();
      try {
        await runner.query(`SET search_path = "${SCHEMA}", public`);
        await migration.down(runner);
        const gone = await runner.query(
          `SELECT to_regclass('"${SCHEMA}"."item_linked_images"') AS "table"`
        );
        expect(gone[0].table).toBeNull();
        await migration.up(runner);
      } finally {
        await runner.release();
      }
      const milk = await product('Leche', OWN_PHOTO);
      // The owner's photo is what it was.
      expect((await get(milk.id)).ownImageUrl).toBe(OWN_PHOTO);
    }, 60_000);
  });

  describe('linkBatch', () => {
    it('upserts on the source row and counts what it did', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      const row = randomUUID();

      expect(
        await send(link(milk.id, mercadona.id, MERCADONA_PHOTO, row))
      ).toEqual({ linked: 1, moved: 0, unchanged: 0, rejected: [] });
      // The same statement again moves only the clock.
      expect(
        await send(link(milk.id, mercadona.id, MERCADONA_PHOTO, row))
      ).toEqual({ linked: 0, moved: 0, unchanged: 1, rejected: [] });
      // A new address for the same row replaces the old one.
      expect(
        await send(link(milk.id, mercadona.id, MERCADONA_SECOND, row))
      ).toMatchObject({ linked: 1, moved: 0, unchanged: 0 });
      expect(await saved(milk.id)).toEqual([MERCADONA_SECOND]);
      expect(await count('item_linked_images')).toBe(1);
    }, 60_000);

    it('refuses an http address for that entry and saves the rest of the batch', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      const bad = link(
        milk.id,
        mercadona.id,
        'http://prod-mercadona.imgix.net/a.jpg'
      );
      const long = link(
        milk.id,
        mercadona.id,
        `https://prod-mercadona.imgix.net/${'a'.repeat(500)}`
      );
      const orphan = link(randomUUID(), mercadona.id, MERCADONA_SECOND);
      const stranger = link(milk.id, randomUUID(), MERCADONA_SECOND);

      const result = await send(
        bad,
        long,
        orphan,
        stranger,
        link(milk.id, mercadona.id, MERCADONA_PHOTO)
      );

      expect(result).toMatchObject({ linked: 1, moved: 0, unchanged: 0 });
      expect(result.rejected).toEqual(
        expect.arrayContaining([
          { sourceEntryId: bad.sourceEntryId, reason: 'NOT_HTTPS' },
          { sourceEntryId: long.sourceEntryId, reason: 'TOO_LONG' },
          { sourceEntryId: orphan.sourceEntryId, reason: 'ITEM_NOT_FOUND' },
          {
            sourceEntryId: stranger.sourceEntryId,
            reason: 'SUPERMARKET_NOT_FOUND',
          },
        ])
      );
      expect(result.rejected).toHaveLength(4);
      expect(await saved(milk.id)).toEqual([MERCADONA_PHOTO]);
    }, 60_000);

    it('keeps three links for three rows bound to one product, two of one chain', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');

      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(milk.id, mercadona.id, MERCADONA_SECOND),
        link(milk.id, dia.id, DIA_PHOTO)
      );

      expect(await count('item_linked_images')).toBe(3);
      expect((await saved(milk.id)).sort()).toEqual(
        [MERCADONA_PHOTO, MERCADONA_SECOND, DIA_PHOTO].sort()
      );
    }, 60_000);

    it('moves the link of a row that is linked again under another product, and refreshes both', async () => {
      const milk = await product('Leche');
      const oil = await product('Aceite');
      const mercadona = await chain('Mercadona');
      await turn(mercadona.id, true);
      const row = randomUUID();
      await send(link(milk.id, mercadona.id, MERCADONA_PHOTO, row));
      expect((await get(milk.id)).imageUrl).toBe(MERCADONA_PHOTO);

      expect(
        await send(link(oil.id, mercadona.id, MERCADONA_PHOTO, row))
      ).toEqual({ linked: 0, moved: 1, unchanged: 0, rejected: [] });

      expect(await count('item_linked_images')).toBe(1);
      expect((await get(milk.id)).images).toEqual([]);
      expect((await get(oil.id)).imageUrl).toBe(MERCADONA_PHOTO);
    }, 60_000);

    it('admits the harvester and nobody without a credential', async () => {
      await expect(
        links.linkBatch({ userId: randomUUID(), entries: [] })
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        links.unlink({ userId: randomUUID(), sourceEntryIds: [] })
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        links.disableAll({ userId: randomUUID() })
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        links.listByItem({ userId: randomUUID(), itemId: randomUUID() })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }, 60_000);
  });

  describe('what a client is given', () => {
    it('answers nothing of a chain while every switch is off, and the admin read still answers every link', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(milk.id, mercadona.id, MERCADONA_SECOND),
        link(milk.id, dia.id, DIA_PHOTO)
      );

      const view = await get(milk.id);
      expect(view).toMatchObject({
        imageUrl: null,
        imageSource: null,
        imageSupermarketId: null,
        ownImageUrl: null,
        images: [],
      });

      const admin = await links.listByItem({ userId: OWNER, itemId: milk.id });
      expect(admin.images).toHaveLength(3);
      expect(admin.images.every((image) => image.enabled === false)).toBe(true);
    }, 60_000);

    it('answers the photos of the one chain that is on, oldest first, with one entry for an address two rows share', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      const [first, second, twin, other] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ];
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO, first),
        link(milk.id, mercadona.id, MERCADONA_SECOND, second),
        // A second row of the chain that prints the first row's photo.
        link(milk.id, mercadona.id, MERCADONA_PHOTO, twin),
        link(milk.id, dia.id, DIA_PHOTO, other)
      );
      await linkedAt(second, '2026-01-01T00:00:00Z');
      await linkedAt(first, '2026-02-01T00:00:00Z');
      await linkedAt(twin, '2026-03-01T00:00:00Z');
      await linkedAt(other, '2025-01-01T00:00:00Z');

      await turn(mercadona.id, true);

      const view = await get(milk.id);
      expect(view.images).toEqual([
        {
          url: MERCADONA_SECOND,
          source: ItemImageSource.CHAIN,
          supermarketId: mercadona.id,
        },
        {
          url: MERCADONA_PHOTO,
          source: ItemImageSource.CHAIN,
          supermarketId: mercadona.id,
        },
      ]);
      expect(view).toMatchObject({
        imageUrl: MERCADONA_SECOND,
        imageSource: ItemImageSource.CHAIN,
        imageSupermarketId: mercadona.id,
        ownImageUrl: null,
      });
      // No photo of the chain that is off, in any field.
      expect(JSON.stringify(view)).not.toContain('www.dia.es');
    }, 60_000);

    it('answers the owner photo first, keeps the links, and names OWNER as the source', async () => {
      const milk = await product('Leche', OWN_PHOTO);
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(milk.id, mercadona.id, MERCADONA_SECOND),
        link(milk.id, dia.id, DIA_PHOTO)
      );
      // Saved although the product has a photo of its own.
      expect(await count('item_linked_images')).toBe(3);

      await turn(mercadona.id, true);
      await turn(dia.id, true);

      const view = await get(milk.id);
      expect(view.images).toHaveLength(4);
      expect(view.images[0]).toEqual({
        url: OWN_PHOTO,
        source: ItemImageSource.OWNER,
        supermarketId: null,
      });
      expect(view).toMatchObject({
        imageUrl: OWN_PHOTO,
        imageSource: ItemImageSource.OWNER,
        imageSupermarketId: null,
        ownImageUrl: OWN_PHOTO,
      });
      // The owner's column never holds a chain's address.
      const [row] = await dataSource.query(
        `SELECT "imageUrl" FROM "items" WHERE "id" = $1`,
        [milk.id]
      );
      expect(row.imageUrl).toBe(OWN_PHOTO);
    }, 60_000);

    it('carries no address of a chain that is off on any read that answers a product', async () => {
      const milk = await product('Leche entera clásica');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(milk.id, dia.id, DIA_PHOTO)
      );
      // One chain on, so the test also proves the read is not simply empty.
      await turn(dia.id, true);

      const reads: Record<string, unknown> = {
        get: await get(milk.id),
        getMany: await items.getMany({ ids: [milk.id] }),
        search: await items.search({ userId: OWNER, query: 'leche' }),
        listing: await items.search({ userId: OWNER, order: 'name' }),
        searchOffers: await items.searchOffers({
          userId: OWNER,
          query: 'leche',
        }),
      };
      for (const [name, answer] of Object.entries(reads)) {
        const body = JSON.stringify(answer);
        expect({
          name,
          leaked: body.includes('prod-mercadona.imgix.net'),
        }).toEqual({ name, leaked: false });
      }
      for (const name of ['get', 'getMany', 'search', 'listing']) {
        expect({
          name,
          shown: JSON.stringify(reads[name]).includes(DIA_PHOTO),
        }).toEqual({ name, shown: true });
      }
    }, 60_000);

    it('does not put a stale list back when an admin edits the product', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      await turn(mercadona.id, true);
      await send(link(milk.id, mercadona.id, MERCADONA_PHOTO));

      const renamed = await items.update({
        userId: OWNER,
        itemId: milk.id,
        brand: 'Hacendado',
      });
      expect(renamed.images.map((image) => image.url)).toEqual([
        MERCADONA_PHOTO,
      ]);
      expect((await get(milk.id)).imageUrl).toBe(MERCADONA_PHOTO);

      // The edit is in the trail, and the derived column is not.
      const trail: { before: unknown; after: unknown }[] =
        await dataSource.query(
          `SELECT "before", "after" FROM "catalog_audit" WHERE "entity" = 'items'`
        );
      expect(trail.length).toBeGreaterThan(0);
      expect(JSON.stringify(trail)).not.toContain('linkedImages');
    }, 60_000);
  });

  describe('the switches', () => {
    it('takes the photos of a chain out of every product when it is turned off, and keeps the links', async () => {
      const milk = await product('Leche');
      const oil = await product('Aceite');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(oil.id, mercadona.id, MERCADONA_SECOND),
        link(milk.id, dia.id, DIA_PHOTO)
      );
      expect((await turn(mercadona.id, true)).linkedImagesEnabled).toBe(true);
      await turn(dia.id, true);
      expect((await get(milk.id)).images).toHaveLength(2);
      expect((await get(oil.id)).images).toHaveLength(1);

      const off = await turn(mercadona.id, false);

      expect(off.linkedImagesEnabled).toBe(false);
      expect((await get(oil.id)).images).toEqual([]);
      expect((await get(milk.id)).images.map((image) => image.url)).toEqual([
        DIA_PHOTO,
      ]);
      expect(await count('item_linked_images')).toBe(3);
      // On again, with no harvest in between.
      await turn(mercadona.id, true);
      expect((await get(oil.id)).imageUrl).toBe(MERCADONA_SECOND);
    }, 60_000);

    it('removes a link and refreshes its product', async () => {
      const milk = await product('Leche');
      const mercadona = await chain('Mercadona');
      await turn(mercadona.id, true);
      const row = randomUUID();
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO, row),
        link(milk.id, mercadona.id, MERCADONA_SECOND)
      );

      expect(
        await links.unlink({
          userId: OWNER,
          sourceEntryIds: [row, randomUUID()],
        })
      ).toEqual({ unlinked: 1 });

      expect((await get(milk.id)).images.map((image) => image.url)).toEqual([
        MERCADONA_SECOND,
      ]);
    }, 60_000);

    it('stops every chain and empties every product in one call, and leaves the link rows', async () => {
      const milk = await product('Leche');
      const oil = await product('Aceite');
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      const lidl = await chain('LIDL');
      await send(
        link(milk.id, mercadona.id, MERCADONA_PHOTO),
        link(oil.id, dia.id, DIA_PHOTO)
      );
      await turn(mercadona.id, true);
      await turn(dia.id, true);

      expect(await links.disableAll({ userId: OWNER })).toEqual({
        supermarkets: 2,
        items: 2,
      });

      expect((await get(milk.id)).images).toEqual([]);
      expect((await get(oil.id)).images).toEqual([]);
      for (const each of [mercadona, dia, lidl]) {
        expect(
          (await chains.get({ userId: OWNER, supermarketId: each.id }))
            .linkedImagesEnabled
        ).toBe(false);
      }
      expect(await count('item_linked_images')).toBe(2);
      // A second stop finds nothing to do.
      expect(await links.disableAll({ userId: OWNER })).toEqual({
        supermarkets: 0,
        items: 0,
      });
    }, 60_000);

    it('records both switch writes in the audit log, and not a write that changed nothing', async () => {
      const mercadona = await chain('Mercadona');
      const dia = await chain('DIA');
      await dataSource.query(`DELETE FROM "catalog_audit"`);
      const switched = () =>
        dataSource.query(
          `SELECT "entityId", "actorId", "before", "after"
             FROM "catalog_audit"
            WHERE "entity" = 'supermarkets' AND "action" = 'UPDATE'
            ORDER BY "at", "id"`
        ) as Promise<
          {
            entityId: string;
            actorId: string;
            before: Record<string, unknown>;
            after: Record<string, unknown>;
          }[]
        >;

      await turn(mercadona.id, true);
      await turn(mercadona.id, true);
      await turn(dia.id, true);
      expect(await switched()).toEqual([
        {
          entityId: mercadona.id,
          actorId: OWNER,
          before: { linkedImagesEnabled: false },
          after: { linkedImagesEnabled: true },
        },
        {
          entityId: dia.id,
          actorId: OWNER,
          before: { linkedImagesEnabled: false },
          after: { linkedImagesEnabled: true },
        },
      ]);

      await links.disableAll({ userId: OWNER });
      const after = await switched();
      expect(after).toHaveLength(4);
      expect(
        after
          .slice(2)
          .map((row) => row.entityId)
          .sort()
      ).toEqual([mercadona.id, dia.id].sort());
      expect(
        after
          .slice(2)
          .every((row) => row.after['linkedImagesEnabled'] === false)
      ).toBe(true);
    }, 60_000);

    it('does not turn a chain on again when its name is edited', async () => {
      const mercadona = await chain('Mercadona');
      await turn(mercadona.id, true);
      const renamed = await chains.update({
        userId: OWNER,
        supermarketId: mercadona.id,
        name: { es: 'Mercadona S.A.' },
      });
      expect(renamed.linkedImagesEnabled).toBe(true);
      await links.disableAll({ userId: OWNER });
      await chains.update({
        userId: OWNER,
        supermarketId: mercadona.id,
        websiteUrl: 'https://www.mercadona.es',
      });
      expect(
        (await chains.get({ userId: OWNER, supermarketId: mercadona.id }))
          .linkedImagesEnabled
      ).toBe(false);
    }, 60_000);
  });
});
