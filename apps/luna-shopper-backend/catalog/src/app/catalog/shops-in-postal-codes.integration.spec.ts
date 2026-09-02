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
 * `supermarketLocation.summarizeByChain` and `supermarketLocation.search`
 * against real Postgres (plan 0068).
 *
 * Both reads are SQL and nothing else: a grouped count with a filtered count
 * beside it, and a five field substring over a set narrowed by postal code.
 * Doubles would assert the shape of a query builder rather than the answer, so
 * these run against the database, like the count of plan 0063 next door.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0068_shops_test';
const OWNER = 'owner';

/** Córdoba, Madrid, and a Sevilla code nobody in these tests holds. */
const CORDOBA = '14010';
const MADRID = '28001';
const SEVILLA = '41001';

describeIntegration('the shops in your postal codes (real Postgres)', () => {
  let dataSource: DataSource;
  let locations: SupermarketLocationService;
  let scopes: PriceScopeService;

  /** Chain ids, filled by the seed and read by name from the tests. */
  const chains: Record<string, string> = {};
  /** Location ids, keyed by the label the seed gave them. */
  const shops: Record<string, string> = {};

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
      // schema has to be on the connection's search_path rather than only in
      // the options. `public` follows it for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService({
      getOrThrow: () => ({ platformAdminUserIds: [OWNER] }),
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

  async function chain(
    key: string,
    name: { en: string; es: string },
    externalBrandKey: string | null
  ): Promise<string> {
    const supermarkets = dataSource.getRepository(Supermarket);
    const row = await supermarkets.save(
      supermarkets.create({ name, externalBrandKey })
    );
    const scope = await scopes.create({
      userId: OWNER,
      supermarketId: row.id,
      kind: PriceScopeKind.NATIONAL,
      externalKey: null,
    });
    chains[key] = row.id;
    // One scope per chain, so a shop below only has to name its chain.
    chains[`${key}:scope`] = scope.id;
    return row.id;
  }

  async function shop(
    label: string,
    chainKey: string,
    postalCode: string,
    extra: { address?: string; city?: string } = {}
  ): Promise<string> {
    const created = await locations.create({
      userId: OWNER,
      supermarketId: chains[chainKey],
      priceScopeId: chains[`${chainKey}:scope`],
      label: { en: label, es: label },
      address: extra.address ?? null,
      city: extra.city ?? null,
      country: 'es',
      postalCode,
    });
    shops[label] = created.id;
    return created.id;
  }

  /**
   * Two chains across two distant codes, one chain only in a third, and forty
   * one shop independents, which is the shape plan 0038 measured in a real city
   * radius: 35 of 75 places had no brand at all.
   */
  async function seed(): Promise<void> {
    await chain('mercadona', { en: 'Mercadona', es: 'Mercadona' }, 'Q377705');
    await chain(
      'corner',
      // Deliberately different words per locale, so a match on one proves the
      // read does not care which the caller is reading in.
      { en: 'The Corner Grocer', es: 'La Tienda de la Esquina' },
      'Q999001'
    );
    await chain('sevilla-only', { en: 'Solo', es: 'Solo' }, 'Q999002');

    await shop('mercadona-cordoba-1', 'mercadona', CORDOBA, {
      address: 'Ronda de los Tejares 12',
      city: 'Córdoba',
    });
    await shop('mercadona-cordoba-2', 'mercadona', CORDOBA, {
      address: 'Avenida del Aeropuerto 3',
      city: 'Córdoba',
    });
    await shop('mercadona-madrid', 'mercadona', MADRID, {
      address: 'Gran Vía 40',
      city: 'Madrid',
    });
    await shop('corner-cordoba', 'corner', CORDOBA, {
      address: 'Calle Cruz Conde 8',
      city: 'Córdoba',
    });
    // The one shop with a literal wildcard in its name, so a search for `%` has
    // a right answer that is neither everything nor nothing.
    await shop('corner-100% descuento', 'corner', CORDOBA, {
      address: 'Calle Alfaros 2',
      city: 'Córdoba',
    });
    await shop('solo-sevilla', 'sevilla-only', SEVILLA, {
      address: 'Calle Sierpes 1',
      city: 'Sevilla',
    });

    for (let index = 0; index < 40; index += 1) {
      const key = `independent-${index}`;
      // What the harvester writes for an unbranded place: a chain named after
      // the shop, carrying no brand key (plan 0068, section 4).
      await chain(
        key,
        { en: `Frutería ${index}`, es: `Frutería ${index}` },
        null
      );
      await shop(key, key, CORDOBA, { city: 'Córdoba' });
    }
  }

  /** The two codes a profile in these tests holds. */
  const CODES = [CORDOBA, MADRID];

  describe('summarizeByChain', () => {
    it('answers one row per chain in the codes, and nothing for a chain outside them', async () => {
      const { chains: rows } = await locations.summarizeByChain({
        userId: OWNER,
        postalCodes: CODES,
      });

      const mercadona = rows.find(
        (row) => row.supermarketId === chains['mercadona']
      );
      expect(mercadona).toEqual({
        supermarketId: chains['mercadona'],
        name: { en: 'Mercadona', es: 'Mercadona' },
        logoUrl: null,
        externalBrandKey: 'Q377705',
        // Two in Córdoba and one in Madrid: the profile holds both codes and
        // gets the shops in both.
        locations: 3,
        excluded: 0,
      });
      // Absent rather than a zero row: a chain with no shop in these codes is
      // not a button the screen can draw.
      expect(
        rows.some((row) => row.supermarketId === chains['sevilla-only'])
      ).toBe(false);
    });

    it('reports forty independents as forty chains with no brand key', async () => {
      const { chains: rows } = await locations.summarizeByChain({
        userId: OWNER,
        postalCodes: [CORDOBA],
      });

      const keyless = rows.filter((row) => row.externalBrandKey === null);
      expect(keyless).toHaveLength(40);
      // Each of them is a chain with one shop, because
      // `SupermarketLocation.supermarketId` is not nullable and the import
      // names a chain after the shop. Nothing here calls them OTHER.
      expect(keyless.every((row) => row.locations === 1)).toBe(true);
    });

    it('counts the refused shops beside the total, which is the "some refused" button', async () => {
      const { chains: rows } = await locations.summarizeByChain({
        userId: OWNER,
        postalCodes: CODES,
        excludedSupermarketLocationIds: [shops['mercadona-cordoba-1']],
      });

      const mercadona = rows.find(
        (row) => row.supermarketId === chains['mercadona']
      );
      // The three states of the franchise button, from this one row: the chain
      // is not refused, `excluded` is neither zero nor everything.
      expect(mercadona?.locations).toBe(3);
      expect(mercadona?.excluded).toBe(1);
    });

    it('drops a refused chain by default and returns it with includeExcluded', async () => {
      const refused = { excludedSupermarketIds: [chains['corner']] };

      const offered = await locations.summarizeByChain({
        userId: OWNER,
        postalCodes: CODES,
        ...refused,
      });
      expect(
        offered.chains.some((row) => row.supermarketId === chains['corner'])
      ).toBe(false);

      const editing = await locations.summarizeByChain({
        userId: OWNER,
        postalCodes: CODES,
        ...refused,
        includeExcluded: true,
      });
      const corner = editing.chains.find(
        (row) => row.supermarketId === chains['corner']
      );
      // Present, with its shops still counted: the screen that edits the
      // refusal is the one caller that needs to see what it is refusing.
      expect(corner?.locations).toBe(2);
    });

    it('answers no chains for no codes rather than the country', async () => {
      await expect(
        locations.summarizeByChain({ userId: OWNER, postalCodes: [] })
      ).resolves.toEqual({ chains: [] });
    });
  });

  describe('search', () => {
    it('returns the shops in every code the caller holds and none from a code they do not', async () => {
      const page = await locations.search({
        userId: OWNER,
        postalCodes: CODES,
        limit: 100,
      });

      const codes = new Set(page.items.map((item) => item.location.postalCode));
      expect(codes).toEqual(new Set(CODES));
      expect(
        page.items.some((item) => item.location.id === shops['solo-sevilla'])
      ).toBe(false);
    });

    it('names the chain on every row, so an address does not have to identify a shop', async () => {
      const page = await locations.search({
        userId: OWNER,
        postalCodes: [MADRID],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].supermarket).toMatchObject({
        id: chains['mercadona'],
        name: { en: 'Mercadona', es: 'Mercadona' },
        externalBrandKey: 'Q377705',
      });
    });

    it('narrows to one chain when asked', async () => {
      const page = await locations.search({
        userId: OWNER,
        postalCodes: CODES,
        supermarketId: chains['mercadona'],
        limit: 100,
      });

      expect(page.items).toHaveLength(3);
      expect(
        page.items.every(
          (item) => item.location.supermarketId === chains['mercadona']
        )
      ).toBe(true);
    });

    /** Section 3.1 of `apps/velista/plans/0059`: the five fields, one test each. */
    describe('matching', () => {
      const found = async (query: string) => {
        const page = await locations.search({
          userId: OWNER,
          postalCodes: CODES,
          query,
          limit: 100,
        });
        return page.items.map((item) => item.location.id);
      };

      it('matches the shop name', async () => {
        expect(await found('mercadona-madrid')).toEqual([
          shops['mercadona-madrid'],
        ]);
      });

      it('matches the chain name', async () => {
        // Both of that chain's shops, because the match is on the chain.
        expect(new Set(await found('corner grocer'))).toEqual(
          new Set([shops['corner-cordoba'], shops['corner-100% descuento']])
        );
      });

      it('matches the address', async () => {
        expect(await found('ronda de los tejares')).toEqual([
          shops['mercadona-cordoba-1'],
        ]);
      });

      it('matches the city', async () => {
        expect(await found('madrid')).toEqual([shops['mercadona-madrid']]);
      });

      it('matches the postal code', async () => {
        expect(await found(MADRID)).toEqual([shops['mercadona-madrid']]);
      });

      it('matches the chain name in a locale the caller is not reading', async () => {
        // Somebody typing "Esquina" means that chain whatever language their
        // phone is in, and the alternative is a search that fails on a name the
        // user is looking straight at.
        expect(new Set(await found('esquina'))).toEqual(
          new Set([shops['corner-cordoba'], shops['corner-100% descuento']])
        );
      });

      it('treats a wildcard as a character somebody typed', async () => {
        // Unescaped, `%` would match every shop in the codes and read as a
        // search that had quietly stopped working. Escaped, it finds the one
        // shop whose name actually contains it.
        expect(await found('%')).toEqual([shops['corner-100% descuento']]);
        expect(await found('100%')).toEqual([shops['corner-100% descuento']]);
      });
    });

    it('leaves out a refused shop, and returns it flagged with includeExcluded', async () => {
      const refusals = {
        excludedSupermarketLocationIds: [shops['mercadona-cordoba-1']],
      };

      const offered = await locations.search({
        userId: OWNER,
        postalCodes: CODES,
        supermarketId: chains['mercadona'],
        ...refusals,
        limit: 100,
      });
      expect(
        offered.items.some(
          (item) => item.location.id === shops['mercadona-cordoba-1']
        )
      ).toBe(false);

      const editing = await locations.search({
        userId: OWNER,
        postalCodes: CODES,
        supermarketId: chains['mercadona'],
        ...refusals,
        includeExcluded: true,
        limit: 100,
      });
      const refused = editing.items.find(
        (item) => item.location.id === shops['mercadona-cordoba-1']
      );
      // Flagged rather than merely present, so the row can be drawn switched
      // off without the client comparing the page against its own profile.
      expect(refused?.excluded).toBe(true);
      expect(refused?.excludedChain).toBe(false);
      expect(
        editing.items.find(
          (item) => item.location.id === shops['mercadona-madrid']
        )?.excluded
      ).toBe(false);
    });

    it('hides a refused chain’s shops, and flags them as the chain’s with includeExcluded', async () => {
      const refusals = { excludedSupermarketIds: [chains['corner']] };

      const offered = await locations.search({
        userId: OWNER,
        postalCodes: CODES,
        ...refusals,
        limit: 100,
      });
      expect(
        offered.items.some(
          (item) => item.location.id === shops['corner-cordoba']
        )
      ).toBe(false);

      const editing = await locations.search({
        userId: OWNER,
        postalCodes: CODES,
        ...refusals,
        includeExcluded: true,
        limit: 100,
      });
      const corner = editing.items.find(
        (item) => item.location.id === shops['corner-cordoba']
      );
      expect(corner?.excludedChain).toBe(true);
      expect(corner?.excluded).toBe(false);
    });

    it('walks the whole set through the cursor without repeating or skipping a shop', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await locations.search({
          userId: OWNER,
          postalCodes: CODES,
          limit: 10,
          cursor: cursor ?? undefined,
        });
        seen.push(...page.items.map((item) => item.location.id));
        cursor = page.nextCursor;
      } while (cursor);

      // Three Mercadonas, two corner shops and forty independents.
      expect(seen).toHaveLength(45);
      expect(new Set(seen).size).toBe(45);
    });

    it('answers an empty page for no codes', async () => {
      await expect(
        locations.search({ userId: OWNER, postalCodes: [] })
      ).resolves.toEqual({ items: [], nextCursor: null });
    });
  });
});
