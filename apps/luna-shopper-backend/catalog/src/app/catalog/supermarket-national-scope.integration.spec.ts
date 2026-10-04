import { JwtService } from '@nestjs/jwt';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  PriceScope,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import {
  AuditedWrite,
  CatalogAuditService,
  type AuditFields,
} from './catalog-audit.service';
import { EffectivePriceService } from './effective-price.service';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { SupermarketService } from './supermarket.service';

/**
 * A chain starts with a national scope, on real Postgres (plan 0153).
 *
 * The unit spec proves the three writes happen inside one call to the audit
 * service. This proves that call is one transaction: when the scope insert
 * fails, the chain row inserted before it in the same transaction is gone too.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0153_national_scope_test';
const OWNER = 'ac790000-0000-4000-a000-000000000153';

/** An audit service whose transaction fails on the price scope insert. */
class FailingScopeAudit extends CatalogAuditService {
  override write<T>(
    actor: Parameters<CatalogAuditService['write']>[0],
    work: (tx: AuditedWrite) => Promise<T>
  ): Promise<T> {
    return super.write(actor, (tx) => {
      const create = tx.create.bind(tx);
      tx.create = (async (target: unknown, draft: AuditFields) => {
        if (target === PriceScope) {
          throw new Error('scope insert failed');
        }
        return create(target as never, draft);
      }) as AuditedWrite['create'];
      return work(tx);
    });
  }
}

describeIntegration(
  'a chain starts with a national scope (real Postgres)',
  () => {
    let dataSource: DataSource;
    let admin: PlatformAdminService;

    const chainsWith = (audit: CatalogAuditService) =>
      new SupermarketService(
        dataSource.getRepository(Supermarket),
        new PriceScopeService(
          dataSource.getRepository(PriceScope),
          dataSource.getRepository(Supermarket),
          admin,
          audit,
          {} as EffectivePriceService
        ),
        admin,
        audit
      );

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

      admin = new PlatformAdminService(new JwtService(), {
        getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
      } as never);
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    it('creates the chain with a NATIONAL default of its own', async () => {
      const chains = chainsWith(new CatalogAuditService(dataSource));

      const view = await chains.create({
        userId: OWNER,
        name: { es: 'Dia' },
      });

      const scopes = await dataSource
        .getRepository(PriceScope)
        .find({ where: { supermarketId: view.id } });
      expect(scopes).toHaveLength(1);
      expect(scopes[0]).toMatchObject({
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
        label: { es: 'Dia' },
      });
      const row = await dataSource
        .getRepository(Supermarket)
        .findOneByOrFail({ id: view.id });
      expect(row.defaultPriceScopeId).toBe(scopes[0].id);
    });

    it('leaves no chain behind when the scope insert fails', async () => {
      const chains = chainsWith(new FailingScopeAudit(dataSource));
      const before = await dataSource.getRepository(Supermarket).count();

      await expect(
        chains.create({ userId: OWNER, name: { es: 'Deza' } })
      ).rejects.toThrow('scope insert failed');

      expect(await dataSource.getRepository(Supermarket).count()).toBe(before);
    });

    /**
     * The shop count of a chain (admin plan 0042, section 2).
     *
     * What a fake cannot prove is here: that the grouped query counts each
     * chain's own shops and not its neighbour's, that a chain with no shop comes
     * back as zero rather than missing, and that a page of chains costs one
     * count rather than one per row.
     */
    describe('locationCount', () => {
      let many: string;
      let one: string;
      let none: string;

      beforeAll(async () => {
        const chains = chainsWith(new CatalogAuditService(dataSource));
        const chain = async (name: string): Promise<string> => {
          const view = await chains.create({
            userId: OWNER,
            name: { es: name },
          });
          // A chain made a moment ago holds no shop.
          expect(view.locationCount).toBe(0);
          return view.id;
        };
        many = await chain('Con tres tiendas');
        one = await chain('Con una tienda');
        none = await chain('Sin tiendas');

        const locations = dataSource.getRepository(SupermarketLocation);
        await locations.save(
          [many, many, many, one].map((supermarketId) =>
            locations.create({ supermarketId })
          )
        );
      });

      it('counts the shops of each chain on a page, in one query', async () => {
        const chains = chainsWith(new CatalogAuditService(dataSource));
        // The count is the one raw query the service sends through its
        // repository; the page itself is a query builder and does not pass here.
        const repository = dataSource.getRepository(Supermarket);
        const query = jest.spyOn(repository, 'query');

        try {
          const page = await new SupermarketService(
            repository,
            {} as PriceScopeService,
            admin,
            new CatalogAuditService(dataSource)
          ).list({ userId: OWNER, limit: 100 });

          const countOf = (id: string) =>
            page.items.find((row) => row.id === id)?.locationCount;
          expect(countOf(many)).toBe(3);
          expect(countOf(one)).toBe(1);
          expect(countOf(none)).toBe(0);
          // Every chain of the page carries a number, the ones the tests above
          // made included.
          expect(
            page.items.every((row) => typeof row.locationCount === 'number')
          ).toBe(true);
          expect(page.items.length).toBeGreaterThanOrEqual(3);
          expect(query).toHaveBeenCalledTimes(1);
        } finally {
          query.mockRestore();
        }

        // The same numbers one chain at a time.
        expect(
          (await chains.get({ userId: OWNER, supermarketId: many }))
            .locationCount
        ).toBe(3);
        expect(
          (await chains.get({ userId: OWNER, supermarketId: none }))
            .locationCount
        ).toBe(0);
      });

      it('carries the count on the answer of an update', async () => {
        const chains = chainsWith(new CatalogAuditService(dataSource));

        const view = await chains.update({
          userId: OWNER,
          supermarketId: one,
          websiteUrl: 'https://example.test',
        });

        expect(view.locationCount).toBe(1);
      });

      it('follows a shop that is removed', async () => {
        const chains = chainsWith(new CatalogAuditService(dataSource));
        const locations = dataSource.getRepository(SupermarketLocation);
        const [shop] = await locations.find({
          where: { supermarketId: many },
          take: 1,
        });
        await locations.delete({ id: shop.id });

        expect(
          (await chains.get({ userId: OWNER, supermarketId: many }))
            .locationCount
        ).toBe(2);
      });
    });
  }
);
