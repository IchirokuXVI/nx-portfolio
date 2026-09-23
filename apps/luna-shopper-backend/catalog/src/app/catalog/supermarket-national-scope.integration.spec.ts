import { JwtService } from '@nestjs/jwt';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { CATALOG_ENTITIES, PriceScope, Supermarket } from '../entities';
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
  }
);
