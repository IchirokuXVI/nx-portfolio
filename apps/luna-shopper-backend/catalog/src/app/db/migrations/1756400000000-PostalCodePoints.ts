import { ALL_POSTAL_CODE_CENTROIDS } from '@portfolio/luna-shopper/postal-codes/dataset';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rows per INSERT. Four parameters each, so a batch is 2,000 placeholders,
 * well inside Postgres' limit of 65,535 and small enough that no single
 * statement carries eleven thousand tuples (plan 0060, section 4).
 */
export const POSTAL_CODE_BATCH_SIZE = 500;

/**
 * The postal code centroids, as a table (plan 0060, sections 2 and 4).
 *
 * **The dataset ships as a migration**, because the migration Job is the one
 * thing that runs automatically in every environment: compose, a dev slot,
 * staging and a brand new VPS all get the table with no extra line in any
 * runbook. The `seed` targets do not run anywhere.
 *
 * **The data is imported, not read from disk.** `migrate.js` is a webpack
 * bundle and the image is assembled from `dist`, so a file beside the source
 * is simply not there; importing the dataset module makes webpack inline it.
 *
 * **Idempotent by construction**: truncate, then reload. A dataset refresh is
 * a new migration running {@link loadPostalCodePoints} against a newer module,
 * and re running it is harmless.
 *
 * No PostGIS and no `earthdistance`: at eleven thousand rows a btree on the
 * two coordinates serves the bounding box instantly (section 5).
 */
export class PostalCodePoints1756400000000 implements MigrationInterface {
  name = 'PostalCodePoints1756400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "postal_code_points" (
        "country" character varying(2) NOT NULL,
        "postalCode" character varying(16) NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        CONSTRAINT "pk_postal_code_points" PRIMARY KEY ("country", "postalCode")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_postal_code_points_geo"
        ON "postal_code_points" ("latitude", "longitude")
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "postal_code_points" IS
        'One point per postal code, from the GeoNames export (plan 0060). A centroid, never a boundary. Reference data replaced wholesale by a migration; no service writes it. CC BY 4.0: show GEONAMES_ATTRIBUTION wherever a code resolved through it is shown.'
    `);

    await loadPostalCodePoints(queryRunner, ALL_POSTAL_CODE_CENTROIDS);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "postal_code_points"`);
  }
}

/**
 * Replace the table's contents with a dataset, in batches. Exported so the
 * next dataset refresh is a migration of one line, and so the batching can be
 * tested against a fake runner without a database.
 */
export async function loadPostalCodePoints(
  queryRunner: QueryRunner,
  centroids: readonly {
    country: string;
    postalCode: string;
    latitude: number;
    longitude: number;
  }[]
): Promise<void> {
  await queryRunner.query(`TRUNCATE TABLE "postal_code_points"`);

  for (
    let start = 0;
    start < centroids.length;
    start += POSTAL_CODE_BATCH_SIZE
  ) {
    const batch = centroids.slice(start, start + POSTAL_CODE_BATCH_SIZE);
    const placeholders = batch
      .map(
        (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      )
      .join(', ');
    const parameters = batch.flatMap((c) => [
      c.country,
      c.postalCode,
      c.latitude,
      c.longitude,
    ]);
    await queryRunner.query(
      `INSERT INTO "postal_code_points" ("country", "postalCode", "latitude", "longitude") VALUES ${placeholders}`,
      parameters
    );
  }
}
