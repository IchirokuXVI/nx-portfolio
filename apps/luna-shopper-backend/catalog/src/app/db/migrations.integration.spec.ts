import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_ENTITIES, Supermarket } from '../entities';

/**
 * Real-Postgres integration test (plan 0010, section 1; plan 0015, section 3.3).
 * Runs only with LUNA_INTEGRATION=1 against the compose stack's catalog database,
 * after `nx run luna-shopper-backend-catalog:migration:run` has applied the
 * committed migrations. Catalog owns its own database and its own migrations, so
 * it carries the same schema risk auth and core do; this is the spec that puts it
 * inside the net rather than beside it.
 *
 * It proves the migrated schema matches the entities: the expected tables exist
 * and a Supermarket round-trips through the jsonb localized name column, which a
 * mocked repository cannot validate honestly.
 */
describeIntegration('catalog schema (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CATALOG_DB_URL'),
      entities: CATALOG_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('has the catalog tables the migration creates', async () => {
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(
      rows.map((r: { table_name: string }) => r.table_name)
    );
    for (const table of [
      'supermarkets',
      'supermarket_locations',
      'items',
      'supermarket_items',
      // Plan 0038.
      'price_scopes',
      'supermarket_location_items',
      // Plan 0048.
      'product_groups',
      // Plan 0060.
      'postal_code_points',
      // Plan 0075.
      'catalog_audit',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('ships the postal code centroids, loaded by the migration and not by a seed (plan 0060, section 4)', async () => {
    // The whole point of loading through a migration is that a fresh database
    // has the rows with no step beyond migration:run. Roughly eleven thousand
    // Spanish codes; a count near zero means the dataset module was not
    // bundled, which is the failure the plan's section 4 exists to prevent.
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS "count" FROM "postal_code_points" WHERE "country" = 'es'`
    );
    expect(count).toBeGreaterThan(10_000);

    const [cordoba] = await dataSource.query(
      `SELECT "latitude", "longitude" FROM "postal_code_points"
       WHERE "country" = 'es' AND "postalCode" = '14013'`
    );
    expect(cordoba.latitude).toBeCloseTo(37.89, 1);
    expect(cordoba.longitude).toBeCloseTo(-4.77, 1);

    // The bounding box read is what the btree index is for.
    const indexes = await dataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'postal_code_points'`
    );
    const names = new Set(
      indexes.map((i: { indexname: string }) => i.indexname)
    );
    expect(names.has('ix_postal_code_points_geo')).toBe(true);
  });

  it('carries the search columns, their indexes and pg_trgm (plan 0048, section 2)', async () => {
    const columns = await dataSource.query(
      `SELECT table_name, column_name, udt_name FROM information_schema.columns
       WHERE table_name IN ('items', 'product_groups')`
    );
    const vectors = new Set(
      columns
        .filter((c: { udt_name: string }) => c.udt_name === 'tsvector')
        .map(
          (c: { table_name: string; column_name: string }) =>
            `${c.table_name}.${c.column_name}`
        )
    );
    for (const column of [
      'items.search_es',
      'items.search_en',
      'product_groups.search_es',
      'product_groups.search_en',
    ]) {
      expect(vectors.has(column)).toBe(true);
    }

    // Without the extension the trigram half of every query is a syntax error,
    // so its absence would be a search that cannot spell rather than one that
    // spells badly.
    const [{ installed }] = await dataSource.query(
      `SELECT count(*)::int > 0 AS "installed" FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    expect(installed).toBe(true);

    // The triggers are what keep an item's document current when its group is
    // renamed. A column with no trigger behind it is a search that silently goes
    // stale, which is worse than one that is missing.
    const triggers = await dataSource.query(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`
    );
    const names = new Set(triggers.map((t: { tgname: string }) => t.tgname));
    expect(names.has('tg_items_search')).toBe(true);
    expect(names.has('tg_product_groups_search')).toBe(true);
    expect(names.has('tg_product_groups_members')).toBe(true);
  });

  it('has the enum types the item columns depend on', async () => {
    const rows = await dataSource.query(
      `SELECT typname FROM pg_type WHERE typtype = 'e'`
    );
    const names = new Set(rows.map((r: { typname: string }) => r.typname));
    expect(names.has('item_category')).toBe(true);
    expect(names.has('unit_of_measure')).toBe(true);
    expect(names.has('price_scope_kind')).toBe(true);
    expect(names.has('price_source_kind')).toBe(true);
  });

  it('keys prices on the scope and not on the store any more (plan 0038, section 5.2)', async () => {
    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'supermarket_items'`
    );
    const names = new Set(
      columns.map((c: { column_name: string }) => c.column_name)
    );
    expect(names.has('priceScopeId')).toBe(true);
    expect(names.has('unitPrice')).toBe(true);
    expect(names.has('unitPriceLabel')).toBe(true);
    expect(names.has('priceObservedAt')).toBe(true);
    expect(names.has('priceSourceKind')).toBe(true);
    // Both moved to supermarket_location_items.
    expect(names.has('supermarketLocationId')).toBe(false);
    expect(names.has('positionInStore')).toBe(false);
  });

  it('carries the chain’s fallback scope (plan 0049, section 3.1)', async () => {
    const columns = await dataSource.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'supermarkets' AND column_name = 'defaultPriceScopeId'`
    );
    expect(columns).toHaveLength(1);
    // Nullable, because most chains never need one: it is the last rung of the
    // ladder, reached only when a chain named with no location has no national
    // scope either.
    expect(columns[0].is_nullable).toBe('YES');
  });

  it('round-trips a Supermarket through the jsonb localized name column', async () => {
    const supermarkets = dataSource.getRepository(Supermarket);
    const saved = await supermarkets.save(
      supermarkets.create({
        name: { en: 'Integration Market', es: 'Mercado de Integración' },
        logoUrl: null,
        websiteUrl: null,
      })
    );
    try {
      const found = await supermarkets.findOneOrFail({
        where: { id: saved.id },
      });
      expect(found.name).toEqual({
        en: 'Integration Market',
        es: 'Mercado de Integración',
      });
      expect(found.logoUrl).toBeNull();
    } finally {
      await supermarkets.delete({ id: saved.id });
    }
  });
});
