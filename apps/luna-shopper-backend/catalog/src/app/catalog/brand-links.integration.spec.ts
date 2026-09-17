import { JwtService } from '@nestjs/jwt';
import { ItemCategory, UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  BrandKeyTakenException,
  BrandLinkKeepsKeyException,
  BrandLinkOwnsNoChainException,
  BrandLinkTooDeepException,
  BrandLinkToSelfException,
  BrandNotLinkedException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  Brand,
  CATALOG_ENTITIES,
  Item,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { BrandService } from './brand.service';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * A brand linked to the brand it spells, against real Postgres (plan 0124,
 * section 9).
 *
 * Everything asserted here is a claim about SQL that a mocked repository cannot
 * make: row locks serialising two requests that would together build a chain of
 * links, one `UPDATE` moving exactly the products a link moves and no others, a
 * check constraint refusing a self link, and a delete that puts products back
 * where the registration found them.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0124_brand_links_test';

const OWNER = '44444444-4444-4444-8444-444444444444';

describeIntegration(
  'brands linked to the brand they spell (real Postgres)',
  () => {
    let dataSource: DataSource;
    let brands: BrandService;
    let items: ItemService;

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
        extra: { options: `-c search_path=${SCHEMA},public` },
      });
      await dataSource.initialize();
      await dataSource.runMigrations();

      const admin = new PlatformAdminService(new JwtService(), {
        getOrThrow: () => ({
          adminJwtPublicKey: '',
          serviceActorIds: [OWNER],
        }),
      } as never);
      const events = {
        itemGroupChanged: jest.fn(),
        productGroupDeleted: jest.fn(),
      } as unknown as CatalogEventsPublisher;
      const audit = new CatalogAuditService(dataSource);

      brands = new BrandService(dataSource.getRepository(Brand), admin, audit);
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
        events
      );
    }, 180_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    beforeEach(async () => {
      // Items reference brands, and brands reference each other, so the links go
      // first or the delete fails on its own foreign key.
      await dataSource.query(`DELETE FROM "items"`);
      await dataSource.query(`UPDATE "brands" SET "canonicalBrandId" = NULL`);
      await dataSource.query(`DELETE FROM "brands"`);
      await dataSource.query(`DELETE FROM "supermarkets"`);
    });

    const product = (name: string, brand: string | null) =>
      items.create({
        userId: OWNER,
        name: { es: name },
        brand,
        category: ItemCategory.OTHER,
        defaultUnit: UnitOfMeasure.UNIT,
      });

    const register = (label: string, privateLabelSupermarketId?: string) =>
      brands.create({ userId: OWNER, label, privateLabelSupermarketId });

    async function itemRow(id: string) {
      const [row] = await dataSource.query(
        `SELECT "brand", "brandKey", "brandId" FROM "items" WHERE "id" = $1`,
        [id]
      );
      return row as {
        brand: string | null;
        brandKey: string | null;
        brandId: string | null;
      };
    }

    /** How many rows break the one level rule right now. Always zero. */
    async function chains(): Promise<number> {
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS count
         FROM "brands" b
         JOIN "brands" c ON c."id" = b."canonicalBrandId"
        WHERE c."canonicalBrandId" IS NOT NULL`
      );
      return count as number;
    }

    describe('the one level rule', () => {
      it('refuses a brand pointed at itself', async () => {
        const brand = await register('Deborah');

        await expect(
          brands.update({
            userId: OWNER,
            brandId: brand.id,
            canonicalBrandId: brand.id,
          })
        ).rejects.toBeInstanceOf(BrandLinkToSelfException);
      }, 180_000);

      it('refuses a link to a brand that is itself a spelling, and names it', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });
        const third = await register('Deborah 72H');

        const refused = brands.update({
          userId: OWNER,
          brandId: third.id,
          canonicalBrandId: spelling.id,
        });

        await expect(refused).rejects.toBeInstanceOf(BrandLinkTooDeepException);
        // The brand that breaks the rule, so the back office can open it.
        await expect(refused).rejects.toMatchObject({
          details: { brandId: spelling.id },
        });
      }, 180_000);

      it('refuses to link a brand other brands are spellings of', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });
        const other = await register('Deborah Cosmetics');

        const refused = brands.update({
          userId: OWNER,
          brandId: deborah.id,
          canonicalBrandId: other.id,
        });

        await expect(refused).rejects.toBeInstanceOf(BrandLinkTooDeepException);
        // One of the brands pointing at it, which is what makes it canonical.
        await expect(refused).rejects.toMatchObject({
          details: { brandId: spelling.id },
        });
      }, 180_000);

      it('refuses a link to a brand that does not exist', async () => {
        const brand = await register('Deborah');

        await expect(
          brands.update({
            userId: OWNER,
            brandId: brand.id,
            canonicalBrandId: '11111111-1111-4111-8111-111111111111',
          })
        ).rejects.toMatchObject({ code: 'not_found' });
      }, 180_000);

      it('serialises two requests that would together make a chain', async () => {
        const a = await register('Alpha');
        const b = await register('Bravo');

        // A to B and B to A at the same time. Both transactions lock both rows in
        // ascending id order, so one waits for the other rather than deadlocking,
        // and the one that waits sees what the first wrote.
        const [first, second] = await Promise.allSettled([
          brands.update({
            userId: OWNER,
            brandId: a.id,
            canonicalBrandId: b.id,
          }),
          brands.update({
            userId: OWNER,
            brandId: b.id,
            canonicalBrandId: a.id,
          }),
        ]);

        const settled = [first, second];
        expect(
          settled.filter((one) => one.status === 'fulfilled')
        ).toHaveLength(1);
        const rejected = settled.find(
          (one) => one.status === 'rejected'
        ) as PromiseRejectedResult;
        // A deadlock would arrive as a QueryFailedError instead, which is exactly
        // what the id order is there to prevent.
        expect(rejected.reason).toBeInstanceOf(BrandLinkTooDeepException);
        expect(await chains()).toBe(0);
      }, 180_000);
    });

    describe('a linked brand owns no chain', () => {
      let mercadona: Supermarket;

      beforeEach(async () => {
        const chain = dataSource.getRepository(Supermarket);
        mercadona = await chain.save(
          chain.create({
            name: { es: 'Testcadona' },
            logoUrl: null,
            websiteUrl: null,
            externalBrandKey: null,
          })
        );
      });

      it('refuses a create that names both a chain and a link', async () => {
        const deborah = await register('Deborah');

        await expect(
          brands.create({
            userId: OWNER,
            label: 'DEBORAH 48H',
            canonicalBrandId: deborah.id,
            privateLabelSupermarketId: mercadona.id,
          })
        ).rejects.toBeInstanceOf(BrandLinkOwnsNoChainException);
      }, 180_000);

      it('refuses a chain set on a brand that is already a spelling', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        await expect(
          brands.update({
            userId: OWNER,
            brandId: spelling.id,
            privateLabelSupermarketId: mercadona.id,
          })
        ).rejects.toBeInstanceOf(BrandLinkOwnsNoChainException);
      }, 180_000);

      it('clears the chain a brand held when it becomes a spelling', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H', mercadona.id);

        const linked = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        expect(linked.privateLabelSupermarketId).toBeNull();
        // And an unlink does not bring it back, because nothing recorded it.
        const unlinked = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: null,
        });
        expect(unlinked.privateLabelSupermarketId).toBeNull();
      }, 180_000);
    });

    describe('a spelling keeps its key', () => {
      it('refuses a rename that would change a linked brand’s key', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        await expect(
          brands.update({
            userId: OWNER,
            brandId: spelling.id,
            label: 'Deborah 72H',
          })
        ).rejects.toBeInstanceOf(BrandLinkKeepsKeyException);
      }, 180_000);

      it('allows a rename that keeps the key', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        const renamed = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          label: 'Deborah 48h',
        });

        expect(renamed.label).toBe('Deborah 48h');
        expect(renamed.key).toBe('deborah48h');
      }, 180_000);

      it('allows an unlink and a rename in one request', async () => {
        const printed = await product('Crema', 'DEBORAH 48H');
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });
        expect((await itemRow(printed.id)).brandId).toBe(deborah.id);

        const freed = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: null,
          label: 'Deborah Duo',
        });

        expect(freed.key).toBe('deborahduo');
        // The product comes back under the key it carried, and the rename then
        // stamps the new key over it, so the row is not left disagreeing with
        // itself.
        const row = await itemRow(printed.id);
        expect(row.brandId).toBe(spelling.id);
        expect(row.brand).toBe('Deborah Duo');
        expect(row.brandKey).toBe('deborahduo');
        expect(freed.movedItems).toBe(1);
      }, 180_000);
    });

    describe('products follow the link', () => {
      it('writes the canonical id and label for a product printed with the spelling', async () => {
        const deborah = await register('Deborah');
        await brands.create({
          userId: OWNER,
          label: 'DEBORAH 48H',
          canonicalBrandId: deborah.id,
        });

        const created = await product('Crema', 'deborah 48 h');

        expect(created.brand).toBe('Deborah');
        const row = await itemRow(created.id);
        expect(row.brandId).toBe(deborah.id);
        // Its own key, not the canonical one: it is what an unlink reads.
        expect(row.brandKey).toBe('deborah48h');
      }, 180_000);

      it('moves every product of a brand when it is linked, and back when it is not', async () => {
        const printed = await product('Crema', 'DEBORAH 48H');
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        // A product that belongs to the spelling under a key that is not the
        // spelling's own. Attached by hand, because the rewrites in section 4.3
        // keep a brand's own products on its own key, so this is the residue of
        // an older arrangement rather than something the routes produce today. It
        // is the one case an unlink cannot undo, and the doc comment on the move
        // says so.
        const older = await product('Locion', 'Deborah 48');
        await dataSource.query(
          `UPDATE "items" SET "brandId" = $1 WHERE "id" = $2`,
          [spelling.id, older.id]
        );
        expect((await itemRow(older.id)).brandKey).toBe('deborah48');

        const linked = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        // Both, including the one carrying an older key.
        expect(linked.movedItems).toBe(2);
        expect((await itemRow(printed.id)).brandId).toBe(deborah.id);
        expect((await itemRow(printed.id)).brand).toBe('Deborah');
        expect((await itemRow(older.id)).brandId).toBe(deborah.id);

        const unlinked = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: null,
        });

        // Only the one carrying this brand's key comes back. The other joined
        // under a key nothing records any more, so it stays where it is.
        expect(unlinked.movedItems).toBe(1);
        expect((await itemRow(printed.id)).brandId).toBe(spelling.id);
        expect((await itemRow(printed.id)).brand).toBe('DEBORAH 48H');
        expect((await itemRow(older.id)).brandId).toBe(deborah.id);
      }, 180_000);

      it('moves the products carrying its key from one canonical brand to another', async () => {
        const printed = await product('Crema', 'DEBORAH 48H');
        const first = await register('Deborah');
        const second = await register('Deborah Cosmetics');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: first.id,
        });

        const relinked = await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: second.id,
        });

        expect(relinked.movedItems).toBe(1);
        const row = await itemRow(printed.id);
        expect(row.brandId).toBe(second.id);
        expect(row.brand).toBe('Deborah Cosmetics');
        expect(row.brandKey).toBe('deborah48h');
      }, 180_000);

      it('a rename of the canonical brand leaves a linked product’s key alone', async () => {
        const printed = await product('Crema', 'DEBORAH 48H');
        const own = await product('Perfume', 'Deborah');
        const deborah = await register('Deborah');
        await brands.create({
          userId: OWNER,
          label: 'DEBORAH 48H',
          canonicalBrandId: deborah.id,
        });

        const renamed = await brands.update({
          userId: OWNER,
          brandId: deborah.id,
          label: 'Deborah Milano',
        });

        expect(renamed.key).toBe('deborahmilano');
        // The product printed with the spelling reads the new label and keeps
        // its own key, which is what an unlink would need (section 4.3).
        const spelled = await itemRow(printed.id);
        expect(spelled.brand).toBe('Deborah Milano');
        expect(spelled.brandKey).toBe('deborah48h');
        // The brand's own product is rekeyed, as it always was.
        const ownRow = await itemRow(own.id);
        expect(ownRow.brand).toBe('Deborah Milano');
        expect(ownRow.brandKey).toBe('deborahmilano');
      }, 180_000);
    });

    describe('registering a suggestion', () => {
      it('creates one brand when the typed name keys to the spelling', async () => {
        const printed = await product('Cerveza', 'MAHOU');

        const answer = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'MAHOU',
          label: 'Mahou',
        });

        expect(answer.linked).toBeNull();
        expect(answer.canonicalCreated).toBe(true);
        expect(answer.linkedItems).toBe(1);
        expect(answer.brand.key).toBe('mahou');
        expect((await itemRow(printed.id)).brand).toBe('Mahou');
      }, 180_000);

      it('creates the typed name and links the spelling to it', async () => {
        const printed = await product('Crema', 'DEBORAH 48H');
        const plain = await product('Perfume', 'deborah');

        const answer = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'DEBORAH 48H',
          label: 'Deborah',
        });

        expect(answer.canonicalCreated).toBe(true);
        expect(answer.brand.key).toBe('deborah');
        expect(answer.linked?.key).toBe('deborah48h');
        expect(answer.linked?.canonicalBrandId).toBe(answer.brand.id);
        expect(answer.linked?.canonicalLabel).toBe('Deborah');
        // Both keys picked up their products, and both products read the
        // canonical label.
        expect(answer.linkedItems).toBe(2);
        expect(answer.brand.itemCount).toBe(2);
        expect((await itemRow(printed.id)).brandId).toBe(answer.brand.id);
        expect((await itemRow(printed.id)).brandKey).toBe('deborah48h');
        expect((await itemRow(plain.id)).brand).toBe('Deborah');
      }, 180_000);

      it('uses the brand the typed name already has', async () => {
        const deborah = await register('Deborah');

        const answer = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'DEBORAH 48H',
          label: 'deborah',
        });

        expect(answer.canonicalCreated).toBe(false);
        expect(answer.brand.id).toBe(deborah.id);
        // The label the registry holds, not the one that was typed.
        expect(answer.brand.label).toBe('Deborah');
        expect(answer.brand.linkCount).toBe(1);
      }, 180_000);

      it('resolves a typed name that is itself a spelling to the brand at the top', async () => {
        const deborah = await register('Deborah');
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        const answer = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'Deborah 72H',
          label: 'DEBORAH 48H',
        });

        expect(answer.brand.id).toBe(deborah.id);
        expect(answer.linked?.canonicalBrandId).toBe(deborah.id);
        expect(await chains()).toBe(0);
      }, 180_000);

      it('refuses a spelling somebody registered in between', async () => {
        await register('DEBORAH 48H');

        await expect(
          brands.registerSuggestion({
            userId: OWNER,
            spelling: 'deborah48h',
            label: 'Deborah',
          })
        ).rejects.toBeInstanceOf(BrandKeyTakenException);
      }, 180_000);

      it('never leaves a chain behind when the canonical brand is linked at the same time', async () => {
        const deborah = await register('Deborah');
        const other = await register('Deborah Cosmetics');

        // The register resolves `Deborah` and is about to point a new spelling at
        // it, while another request makes `Deborah` a spelling of a third brand.
        // Whichever lands first, the lock makes the second see it.
        const settled = await Promise.allSettled([
          brands.registerSuggestion({
            userId: OWNER,
            spelling: 'DEBORAH 48H',
            label: 'Deborah',
          }),
          brands.update({
            userId: OWNER,
            brandId: deborah.id,
            canonicalBrandId: other.id,
          }),
        ]);

        expect(settled.some((one) => one.status === 'fulfilled')).toBe(true);
        expect(await chains()).toBe(0);
      }, 180_000);
    });

    describe('what a brand view says', () => {
      it('answers the link, the canonical label and the link count', async () => {
        const chain = dataSource.getRepository(Supermarket);
        const mercadona = await chain.save(
          chain.create({
            name: { es: 'Testcadona' },
            logoUrl: null,
            websiteUrl: null,
            externalBrandKey: null,
          })
        );
        const deborah = await register('Deborah', mercadona.id);
        const spelling = await register('DEBORAH 48H');
        await brands.update({
          userId: OWNER,
          brandId: spelling.id,
          canonicalBrandId: deborah.id,
        });

        const canonical = await brands.get({
          userId: OWNER,
          brandId: deborah.id,
        });
        expect(canonical.canonicalBrandId).toBeNull();
        expect(canonical.canonicalLabel).toBeNull();
        expect(canonical.linkCount).toBe(1);

        const linked = await brands.get({
          userId: OWNER,
          brandId: spelling.id,
        });
        expect(linked.canonicalBrandId).toBe(deborah.id);
        expect(linked.canonicalLabel).toBe('Deborah');
        expect(linked.linkCount).toBe(0);

        // The list answers the same three, in one statement for the page.
        const listed = await brands.list({
          userId: OWNER,
          canonicalBrandId: deborah.id,
        });
        expect(listed.items.map((row) => row.key)).toEqual(['deborah48h']);
        expect(listed.items[0].canonicalLabel).toBe('Deborah');

        // And the chain filter reaches a spelling through the brand it points at,
        // which owns the chain for both of them.
        const byChain = await brands.list({
          userId: OWNER,
          privateLabelSupermarketId: mercadona.id,
        });
        expect(byChain.items.map((row) => row.key).sort()).toEqual([
          'deborah',
          'deborah48h',
        ]);
      }, 180_000);
    });

    describe('deleting a spelling', () => {
      it('puts its products back to unbranded, and lets a new registration pick them up', async () => {
        const printed = await product('Crema', 'DEBORAH 48H');
        const answer = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'DEBORAH 48H',
          label: 'Deborah',
        });
        const spellingId = answer.linked?.id as string;

        const deleted = await brands.remove({
          userId: OWNER,
          brandId: spellingId,
        });

        expect(deleted).toEqual({ id: spellingId, movedItems: 1 });
        // Exactly the state the product was in before the spelling was
        // registered: no brand, and the text the chain printed.
        const row = await itemRow(printed.id);
        expect(row.brandId).toBeNull();
        expect(row.brand).toBe('DEBORAH 48H');
        expect(row.brandKey).toBe('deborah48h');
        // So the key is a suggestion again, because the registry stops answering
        // it.
        const { keys } = await brands.keys({ userId: OWNER });
        expect(keys).toEqual(['deborah']);

        const again = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'DEBORAH 48H',
          label: 'Deborah',
        });
        expect(again.linkedItems).toBe(1);
        expect((await itemRow(printed.id)).brandId).toBe(answer.brand.id);
      }, 180_000);

      it('refuses a brand that is nobody’s spelling', async () => {
        const brand = await register('Deborah');

        await expect(
          brands.remove({ userId: OWNER, brandId: brand.id })
        ).rejects.toBeInstanceOf(BrandNotLinkedException);
      }, 180_000);

      it('refuses a canonical brand other brands are spellings of', async () => {
        const answer = await brands.registerSuggestion({
          userId: OWNER,
          spelling: 'DEBORAH 48H',
          label: 'Deborah',
        });

        await expect(
          brands.remove({ userId: OWNER, brandId: answer.brand.id })
        ).rejects.toBeInstanceOf(BrandNotLinkedException);
      }, 180_000);
    });
  }
);
