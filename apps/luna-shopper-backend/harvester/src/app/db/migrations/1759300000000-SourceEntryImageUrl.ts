import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The adapter that kept a photo address in `extra` before this plan. Frozen
 * here on purpose, as `SourceEntryPriceKind1759200000000` freezes its lists:
 * a migration describes the rows that exist when it runs.
 */
const DIA_ADAPTER = 'dia-api';

/** The one host a DIA photo is on, which is the host list of its adapter. */
const DIA_PHOTO_PREFIX = 'https://www.dia.es/';

/**
 * A source row holds the photo address its chain prints (plan 0198, section 2).
 *
 * One nullable column in the source's group: a full read rewrites it, a
 * decision never does. It holds an address and nothing else. No server of
 * ours fetches it.
 *
 * ## What this does to the rows that exist
 *
 * **It copies the address the DIA runner already stored**, and changes
 * nothing else. That runner kept the absolute address under `extra.image`,
 * a bag nothing reads, so the rows of a DIA chain hold it already. The copy
 * takes it only when it is an `https` address on DIA's own host that fits the
 * column, which is the rule `photoAddress` of the DIA adapter applies to a
 * new read. `extra` is left as it is: the next full read rewrites it without
 * the key.
 *
 * The rows of every other chain stay null until a run reads them again.
 *
 * `down` drops the column. `extra.image` was never removed, so the rows of
 * DIA are as they were.
 */
export class SourceEntryImageUrl1759300000000 implements MigrationInterface {
  name = 'SourceEntryImageUrl1759300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" ADD "imageUrl" varchar(500)`
    );
    await queryRunner.query(
      `UPDATE "source_catalog_entries" e
          SET "imageUrl" = e."extra" ->> 'image'
         FROM "supermarket_sources" s
        WHERE s."supermarketId" = e."supermarketId"
          AND s."adapterKey" = $1
          AND jsonb_typeof(e."extra" -> 'image') = 'string'
          AND left(e."extra" ->> 'image', length($2)) = $2
          AND length(e."extra" ->> 'image') <= 500`,
      [DIA_ADAPTER, DIA_PHOTO_PREFIX]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN "imageUrl"`
    );
  }
}
