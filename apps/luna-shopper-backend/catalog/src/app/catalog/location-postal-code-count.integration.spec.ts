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
  PostalCodePoint,
  PriceScope,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';
import { SupermarketLocationService } from './supermarket-location.service';

/**
 * `supermarketLocation.countByPostalCode` against real Postgres (plan 0063,
 * section 5).
 *
 * It is one grouped count and its answer decides whether we spend two requests
 * on somebody else's servers, so the thing worth checking is the SQL rather than
 * the decision around it: that a code with shops is not reported as unknown,
 * that a code with none comes back as a zero rather than as an absence, and that
 * a location recorded before the country column existed still counts.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0063_location_count_test';
const OWNER = 'owner';

describeIntegration('locations counted by postal code (real Postgres)', () => {
  let dataSource: DataSource;
  let locations: SupermarketLocationService;
  let scopes: PriceScopeService;

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
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path rather than only in the
      // options. `public` follows it for the extensions the migrations use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService(new JwtService(), {
      // The owner writes as a configured SERVICE here (plan 0072): these specs
      // are about catalog's behaviour, not about which door the caller used, and
      // the service path needs no keypair to set up.
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const config = {
      getOrThrow: () => ({ postalCodeDeriveMaxMetres: 5000 }),
    } as never;
    scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      admin
    );
    locations = new SupermarketLocationService(
      dataSource.getRepository(SupermarketLocation),
      dataSource.getRepository(Supermarket),
      scopes,
      admin,
      new PostalCodeService(dataSource.getRepository(PostalCodePoint)),
      config
    );

    await seed();
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /**
   * Two shops in one code, one in another, one in a third with no country
   * recorded, and nothing at all in a fourth.
   */
  async function seed(): Promise<void> {
    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
    );
    const scope = await scopes.create({
      userId: OWNER,
      supermarketId: chain.id,
      kind: PriceScopeKind.NATIONAL,
      externalKey: null,
    });

    const rows: Array<[string, string | null]> = [
      ['14013', 'es'],
      ['14013', 'es'],
      ['14010', 'es'],
      ['14004', null],
    ];
    for (const [postalCode, country] of rows) {
      await dataSource.query(
        `INSERT INTO "supermarket_locations"
           ("supermarketId", "priceScopeId", "label", "postalCode", "country",
            "postalCodeSource")
         VALUES ($1, $2, $3, $4, $5, 'SOURCE')`,
        [
          chain.id,
          scope.id,
          JSON.stringify({
            en: `Shop ${postalCode}`,
            es: `Tienda ${postalCode}`,
          }),
          postalCode,
          country,
        ]
      );
    }
  }

  it('counts the shops in each code and answers a zero for the empty ones', async () => {
    const view = await locations.countByPostalCode({
      country: 'es',
      postalCodes: ['14013', '14010', '14011'],
    });

    expect(view.country).toBe('es');
    expect(view.counts).toEqual([
      { postalCode: '14013', locations: 2 },
      { postalCode: '14010', locations: 1 },
      // The zero is the whole point: without it the caller cannot tell a code
      // with no shops from a code it did not ask about.
      { postalCode: '14011', locations: 0 },
    ]);
  });

  it('counts a location recorded before the country column existed', async () => {
    // Every location that predates plan 0061 has a null country and was found
    // by a Spanish run. Excluding them would report a code we serve as unknown
    // and spend a discovery run finding shops already in the catalog.
    const view = await locations.countByPostalCode({
      country: 'es',
      postalCodes: ['14004'],
    });

    expect(view.counts).toEqual([{ postalCode: '14004', locations: 1 }]);
  });

  it('does not count another country as this one', async () => {
    await dataSource.query(
      `INSERT INTO "supermarket_locations"
         ("supermarketId", "priceScopeId", "label", "postalCode", "country")
       SELECT "supermarketId", "priceScopeId",
              '{"en":"Portuguese shop","es":"Tienda portuguesa"}'::jsonb,
              '14013', 'pt'
         FROM "supermarket_locations" LIMIT 1`
    );

    const view = await locations.countByPostalCode({
      country: 'pt',
      postalCodes: ['14010'],
    });

    // 14010's two Spanish rows are not Portuguese, and the null country row is
    // in 14004, so nothing here counts.
    expect(view.counts).toEqual([{ postalCode: '14010', locations: 0 }]);
  });

  it('normalizes the country and deduplicates the codes asked about', async () => {
    const view = await locations.countByPostalCode({
      country: ' ES ',
      postalCodes: ['14013', ' 14013 ', ''],
    });

    expect(view.country).toBe('es');
    expect(view.counts).toEqual([{ postalCode: '14013', locations: 2 }]);
  });

  it('asks the database nothing when there are no codes', async () => {
    const view = await locations.countByPostalCode({
      country: 'es',
      postalCodes: [],
    });

    expect(view.counts).toEqual([]);
  });
});
