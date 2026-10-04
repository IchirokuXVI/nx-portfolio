import { productGtin, readGtin } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';

/**
 * The cases `readGtin` itself is tested with. The copy in the migration is the
 * same rule written in SQL, and this file is what holds the two together. Read
 * from disk, as the curation tool reads it, because it is a fixture of the
 * contracts library and not one of its exports.
 */
const GTIN_CASES = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../../../libs/luna-shopper/contracts/src/lib/barcodes/gtin.cases.json'
    ),
    'utf8'
  )
) as [string | null, unknown][];

/**
 * The barcode table's migration against real Postgres (plan 0185).
 *
 * Claims about the database rather than about the service:
 *
 * - **Every product whose `items.ean` is a real barcode has exactly one row,
 *   and no other product has any.** An in-store code, an invalid code and a
 *   product with no EAN get no row. This is the plan's first acceptance
 *   criterion with the constraint beside it applied: an in-store code is never
 *   a row of `item_eans`, so "every product with an EAN" reads "every product
 *   with a real barcode". The exact rule is `productGtin(ean) === ean`.
 * - `items.ean` and `uq_items_ean` are exactly as they were, in both
 *   directions.
 * - The table refuses an in-store code, a second product for one barcode and
 *   a product that does not exist, and loses a product's rows with the
 *   product.
 * - `down` takes the table away and leaves every product behind.
 *
 * **It stops at the migration under test by name**, not by undoing whichever
 * migration happens to be last, so the next catalog migration does not break
 * it.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-eans-migration.integration.spec.ts
 */
const SCHEMA = 'plan0185_migration_test';

/** The migration under test, and therefore the one `down` is run back to. */
const UNDER_TEST = 'ItemEans1758800000000';

/** What the first catalog holds on `items.ean`, one product each. */
const REAL_13 = '8402001002083';
const REAL_13_OTHER = '8402001047251';
const REAL_8 = '96385074';
const REAL_12 = '036000291452';
const REAL_14 = '10012345678902';
const IN_STORE = '2204500000000';
const IN_STORE_THAT_ADDS_UP = '2000000000008';
const ELEVEN_DIGITS = '84100100012';
const BAD_CHECK_DIGIT = '4006381333932';
const PADDED = ' 4006381333931 ';

describeIntegration('the item barcodes migration (real Postgres)', () => {
  let dataSource: DataSource;

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
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // The barcode rows go with the products, by the cascade.
    await dataSource.query(`DELETE FROM "items"`);
  });

  const product = async (name: string, ean: string | null): Promise<string> => {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "items" ("name", "ean") VALUES ($1::jsonb, $2) RETURNING "id"`,
      [JSON.stringify({ es: name }), ean]
    );
    return id as string;
  };

  const barcodeRows = (): Promise<{ ean: string; itemId: string }[]> =>
    dataSource.query(
      `SELECT "ean", "itemId" FROM "item_eans" ORDER BY "ean" ASC`
    );

  const eansOnItems = (): Promise<{ id: string; ean: string | null }[]> =>
    dataSource.query(`SELECT "id", "ean" FROM "items" ORDER BY "id" ASC`);

  const tableExists = async (): Promise<boolean> => {
    const [{ table }] = await dataSource.query(
      `SELECT to_regclass('"${SCHEMA}"."item_eans"') AS "table"`
    );
    return table !== null;
  };

  const eanIndex = async (): Promise<string | null> => {
    const [row] = await dataSource.query(
      `SELECT "indexdef" FROM "pg_indexes"
        WHERE "schemaname" = $1 AND "indexname" = 'uq_items_ean'`,
      [SCHEMA]
    );
    return (row?.indexdef as string | undefined) ?? null;
  };

  /** Undo migrations, newest first, until the one under test is gone. */
  async function undoThroughUnderTest(): Promise<void> {
    for (;;) {
      const [last] = await dataSource.query(
        `SELECT "name" FROM "migrations" ORDER BY "id" DESC LIMIT 1`
      );
      await dataSource.undoLastMigration();
      if (!last || last.name === UNDER_TEST) {
        return;
      }
    }
  }

  it('is newer than every other catalog migration', () => {
    const stamps = CATALOG_MIGRATIONS.map((migration) =>
      Number(/(\d{13})$/.exec(migration.name)?.[1])
    );
    const own = Number(/(\d{13})$/.exec(UNDER_TEST)?.[1]);
    const before = stamps.slice(0, stamps.indexOf(own));

    expect(before.length).toBeGreaterThan(0);
    expect(before.every((stamp) => stamp < own)).toBe(true);
  });

  it('gives every product with a real barcode one row, and no row to an in-store code, an invalid code or no EAN', async () => {
    await undoThroughUnderTest();
    let ids: Record<string, string> = {};
    let before: { id: string; ean: string | null }[] = [];
    const indexBefore = await eanIndex();
    try {
      expect(await tableExists()).toBe(false);
      ids = {
        real13: await product('Leche entera', REAL_13),
        real13Other: await product('Leche semidesnatada', REAL_13_OTHER),
        real8: await product('Chicle', REAL_8),
        real12: await product('Refresco', REAL_12),
        real14: await product('Caja', REAL_14),
        inStore: await product('Queso al corte', IN_STORE),
        inStoreThatAddsUp: await product(
          'Jamón al corte',
          IN_STORE_THAT_ADDS_UP
        ),
        elevenDigits: await product('Mantequilla', ELEVEN_DIGITS),
        badCheckDigit: await product('Galletas', BAD_CHECK_DIGIT),
        padded: await product('Arroz', PADDED),
        none: await product('Novedad', null),
      };
      before = await eansOnItems();
    } finally {
      await dataSource.runMigrations();
    }

    // The criterion, with the in-store constraint applied: one row for each
    // product that holds a real barcode, and none for anything else.
    expect(await barcodeRows()).toEqual(
      [
        { ean: REAL_13, itemId: ids.real13 },
        { ean: REAL_13_OTHER, itemId: ids.real13Other },
        { ean: REAL_8, itemId: ids.real8 },
        { ean: REAL_12, itemId: ids.real12 },
        { ean: REAL_14, itemId: ids.real14 },
      ].sort((a, b) => (a.ean < b.ean ? -1 : 1))
    );
    const perProduct = await dataSource.query(
      `SELECT i."id", count(ie."ean")::int AS "rows"
         FROM "items" i
         LEFT JOIN "item_eans" ie ON ie."itemId" = i."id"
        GROUP BY i."id"`
    );
    const rowsOf = new Map<string, number>(
      perProduct.map((row: { id: string; rows: number }) => [row.id, row.rows])
    );
    for (const key of ['real13', 'real13Other', 'real8', 'real12', 'real14']) {
      expect([key, rowsOf.get(ids[key])]).toEqual([key, 1]);
    }
    for (const key of [
      'inStore',
      'inStoreThatAddsUp',
      'elevenDigits',
      'badCheckDigit',
      'padded',
      'none',
    ]) {
      expect([key, rowsOf.get(ids[key])]).toEqual([key, 0]);
    }

    // The copy only adds. `items.ean` reads what it read before, the in-store
    // and invalid codes included, and its unique index is the same index.
    expect(await eansOnItems()).toEqual(before);
    expect(await eanIndex()).toBe(indexBefore);
    expect(indexBefore).toContain('UNIQUE');
  }, 180_000);

  it('copies exactly the codes readGtin calls a real barcode, as they are written', async () => {
    const codes = GTIN_CASES.map(([code]) => code).filter(
      (code): code is string => typeof code === 'string'
    );

    await undoThroughUnderTest();
    try {
      for (const [index, code] of codes.entries()) {
        await product(`Caso ${index}`, code);
      }
    } finally {
      await dataSource.runMigrations();
    }

    // A code with spaces around it is a barcode to `readGtin`, which trims.
    // The column is compared as it is stored, so such a code is not copied:
    // the row has to equal `items.ean`, or it is not the product's first
    // barcode. Hence the rule is `productGtin(code) === code`.
    const expected = codes.filter((code) => productGtin(code) === code).sort();
    expect((await barcodeRows()).map((row) => row.ean)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    // And no in-store code among them, whatever its check digit.
    for (const code of expected) {
      expect(readGtin(code).kind).toBe('GTIN');
    }
  }, 180_000);

  it('keeps an in-store code out of the table, whatever writes to it', async () => {
    const id = await product('Queso al corte', null);

    await expect(
      dataSource.query(
        `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2)`,
        [IN_STORE, id]
      )
    ).rejects.toThrow(/ck_item_eans_real/);
    await expect(
      dataSource.query(
        `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2)`,
        [ELEVEN_DIGITS, id]
      )
    ).rejects.toThrow(/ck_item_eans_real/);
    await expect(
      dataSource.query(
        `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2)`,
        ['4006381 333931', id]
      )
    ).rejects.toThrow(/ck_item_eans_real/);
  }, 180_000);

  it('lets one product hold several barcodes, and one barcode name one product', async () => {
    const milk = await product('Leche entera', REAL_13);
    const other = await product('Leche semidesnatada', null);
    const add = (ean: string, itemId: string) =>
      dataSource.query(
        `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2)`,
        [ean, itemId]
      );

    await add(REAL_13, milk);
    await add(REAL_13_OTHER, milk);
    await expect(add(REAL_13_OTHER, other)).rejects.toThrow(/pk_item_eans/);
    await expect(
      add(REAL_8, '99999999-9999-4999-8999-999999999999')
    ).rejects.toThrow(/fk_item_eans_item/);

    expect((await barcodeRows()).map((row) => row.itemId)).toEqual([
      milk,
      milk,
    ]);

    // The rows go with the product.
    await dataSource.query(`DELETE FROM "items" WHERE "id" = $1`, [milk]);
    expect(await barcodeRows()).toEqual([]);
  }, 180_000);

  it('goes down to a schema with no barcode table and every product still there, and up again', async () => {
    const real = await product('Leche entera', REAL_13);
    await product('Queso al corte', IN_STORE);
    await product('Novedad', null);
    await dataSource.query(
      `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2), ($3, $2)`,
      [REAL_13, real, REAL_13_OTHER]
    );
    const before = await eansOnItems();
    const indexBefore = await eanIndex();

    await undoThroughUnderTest();
    try {
      expect(await tableExists()).toBe(false);
      // Nothing is deleted or rewritten on the way down.
      expect(await eansOnItems()).toEqual(before);
      expect(await eanIndex()).toBe(indexBefore);
    } finally {
      await dataSource.runMigrations();
    }

    expect(await tableExists()).toBe(true);
    // Up again copies the first barcodes. The second barcode lived only in the
    // table, so it went with the table, which is what `down` means.
    expect(await barcodeRows()).toEqual([{ ean: REAL_13, itemId: real }]);
    expect(await eansOnItems()).toEqual(before);
  }, 180_000);
});
