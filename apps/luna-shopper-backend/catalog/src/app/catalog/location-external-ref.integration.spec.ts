import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LocationExternalRefTakenException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  PostalCodePoint,
  PriceScope,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { EffectivePriceService } from './effective-price.service';
import { LocationScopeService } from './location-scopes';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';
import { SupermarketLocationService } from './supermarket-location.service';
import { SupermarketService } from './supermarket.service';

/**
 * One shop for each external reference, on real Postgres (plan 0194).
 *
 * The unit spec proves which answer the service gives. Only a database proves
 * the three things that answer rests on: that `uq_locations_external_ref`
 * refuses a second shop across chains and providers, that TypeORM hands the
 * refusal over with the code and the constraint the service reads, and that
 * the transaction leaves nothing behind, not the shop and not its store scope.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=location-external-ref
 */
const SCHEMA = 'plan0194_location_ref_test';
const OWNER = 'ac790000-0000-4000-a000-000000000194';
const REF = 'node/1156230891';

describeIntegration(
  'a shop reference that another shop holds (real Postgres)',
  () => {
    let dataSource: DataSource;
    let locations: SupermarketLocationService;
    let dia: string;
    let lidl: string;
    let holder: string;

    /** The rows a refused write must leave exactly as they were. */
    const counts = async () => ({
      shops: await dataSource.getRepository(SupermarketLocation).count(),
      scopes: await dataSource.getRepository(PriceScope).count(),
    });

    /**
     * The check before the write answers "nobody holds it", which is what it
     * answers to the write that loses a race. The statement then reaches the
     * index, and the answer under test is the one made from its refusal.
     */
    const loseTheRace = () =>
      jest
        .spyOn(
          locations as unknown as { requireFreeRef: () => Promise<void> },
          'requireFreeRef'
        )
        .mockResolvedValue(undefined);

    async function refusalOf(
      write: Promise<unknown>
    ): Promise<LocationExternalRefTakenException> {
      const error = await write.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(LocationExternalRefTakenException);
      return error as LocationExternalRefTakenException;
    }

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

      const config = {
        getOrThrow: () => ({
          authJwtPublicKey: '',
          adminJwtPublicKey: '',
          serviceActorIds: [OWNER],
          postalCodeDeriveMaxMetres: 5_000,
        }),
      } as unknown as ConfigService;
      const admin = new PlatformAdminService(new JwtService(), config);
      const audit = new CatalogAuditService(dataSource);
      const effective = new EffectivePriceService();
      const scopes = new PriceScopeService(
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(Supermarket),
        admin,
        audit,
        effective
      );
      const chains = new SupermarketService(
        dataSource.getRepository(Supermarket),
        scopes,
        admin,
        audit
      );
      locations = new SupermarketLocationService(
        dataSource.getRepository(SupermarketLocation),
        dataSource.getRepository(Supermarket),
        scopes,
        admin,
        audit,
        new PostalCodeService(dataSource.getRepository(PostalCodePoint)),
        effective,
        new LocationScopeService(),
        config
      );

      dia = (await chains.create({ userId: OWNER, name: { es: 'Dia' } })).id;
      lidl = (await chains.create({ userId: OWNER, name: { es: 'LIDL' } })).id;
      holder = (
        await locations.create({
          userId: OWNER,
          supermarketId: dia,
          label: { es: 'Dia Gran Vía' },
          address: 'Gran Vía 1',
          city: 'Córdoba',
          externalRef: REF,
          externalProvider: 'OSM',
        })
      ).id;
    }, 120_000);

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    const HELD_BY = () => ({
      supermarketLocationId: holder,
      supermarketId: dia,
      supermarketName: { es: 'Dia' },
      label: { es: 'Dia Gran Vía' },
      address: 'Gran Vía 1',
      city: 'Córdoba',
      externalProvider: 'OSM',
    });

    it('refuses a second shop before the write, across chains and providers', async () => {
      const before = await counts();

      const refused = await refusalOf(
        locations.create({
          userId: OWNER,
          supermarketId: lidl,
          externalRef: REF,
          externalProvider: 'LIDL',
        })
      );

      expect(refused.code).toBe('location_external_ref_taken');
      expect(refused.details).toEqual({ externalRef: REF, heldBy: HELD_BY() });
      expect(await counts()).toEqual(before);
    });

    it('answers the same code when the index refuses a create, and rolls the store scope back', async () => {
      const before = await counts();
      loseTheRace();

      const refused = await refusalOf(
        locations.create({
          userId: OWNER,
          supermarketId: lidl,
          externalRef: REF,
          externalProvider: 'LIDL',
        })
      );

      expect(refused.code).toBe('location_external_ref_taken');
      expect(refused.details).toEqual({ externalRef: REF, heldBy: HELD_BY() });
      // The store scope is created in the same transaction, before the shop.
      expect(await counts()).toEqual(before);
    });

    it('answers the same code when the index refuses an edit, and leaves the row', async () => {
      const shop = await locations.create({
        userId: OWNER,
        supermarketId: lidl,
        address: 'Hand made 7',
      });

      // First by the check, which here reads the real table.
      const checked = await refusalOf(
        locations.update({
          userId: OWNER,
          supermarketLocationId: shop.id,
          externalRef: REF,
          city: 'Sevilla',
        })
      );
      expect(checked.details).toEqual({ externalRef: REF, heldBy: HELD_BY() });

      // Then by the index, for the write that lost a race.
      loseTheRace();
      const raced = await refusalOf(
        locations.update({
          userId: OWNER,
          supermarketLocationId: shop.id,
          externalRef: REF,
          city: 'Sevilla',
        })
      );
      expect(raced.code).toBe('location_external_ref_taken');
      expect(raced.details).toEqual({ externalRef: REF, heldBy: HELD_BY() });

      const row = await dataSource
        .getRepository(SupermarketLocation)
        .findOneByOrFail({ id: shop.id });
      expect(row.externalRef).toBeNull();
      expect(row.city).toBeNull();
    });

    it('lets the holder keep its own reference through an edit', async () => {
      const view = await locations.update({
        userId: OWNER,
        supermarketLocationId: holder,
        externalRef: REF,
        city: 'Córdoba',
        address: 'Gran Vía 1',
      });

      expect(view.externalRef).toBe(REF);
    });

    it('holds any number of shops with no reference', async () => {
      const first = await locations.create({
        userId: OWNER,
        supermarketId: lidl,
      });
      const second = await locations.create({
        userId: OWNER,
        supermarketId: lidl,
      });

      expect(first.externalRef).toBeNull();
      expect(second.externalRef).toBeNull();
    });

    it('gives the reference to the next shop once the holder lets it go', async () => {
      const other = 'node/2';
      const first = await locations.create({
        userId: OWNER,
        supermarketId: lidl,
        externalRef: other,
      });
      await locations.update({
        userId: OWNER,
        supermarketLocationId: first.id,
        externalRef: null,
      });

      const second = await locations.create({
        userId: OWNER,
        supermarketId: dia,
        externalRef: other,
      });

      expect(second.externalRef).toBe(other);
    });
  }
);
