import {
  distanceMetres,
  type LatLon,
} from '@portfolio/luna-shopper/osm-places';
import { boundingBox } from '@portfolio/luna-shopper/postal-codes';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { postalCodeDeriveMaxMetres } from '../../config/postal-code-derivation';

/** One location the backfill may be able to answer. */
interface LocationRow {
  id: string;
  country: string | null;
  latitude: number;
  longitude: number;
}

/** A centroid, as the table holds it. */
interface CentroidRow {
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}

/**
 * `postalCodeSource`, and the postal codes it makes it possible to fill in
 * (plan 0061, sections 5 and 6).
 *
 * Two thirds of the supermarkets OpenStreetMap knows about carry no
 * `addr:postcode`, so two thirds of every location ever imported has a null
 * postal code. `ScopeResolverService`'s first rung matches on that column, so
 * those stores can never reach it: a user with a Mercadona 400 metres away is
 * shown a price labelled as somebody else's city, because we hold that store's
 * coordinates and not its postcode.
 *
 * **This changes prices that are already being shown**, and that is the point
 * rather than a side effect: locations that fell to the approximate rung start
 * matching rung one. It belongs in the release notes.
 *
 * **Re runnable, and it touches no row that already has a postcode.** Every
 * statement below is guarded on `"postalCode" IS NULL`, which is the same rule
 * the service obeys: a source postcode is never overridden, because the centroid
 * is an approximation of a boundary and the tag is somebody's observation of a
 * sign on a building.
 *
 * **The country comes from the centroid where the row has none.** Every location
 * imported before this plan has `country: null`, because `import()` hardcoded it,
 * so keying the lookup on the row's own country would make this backfill a no op
 * on exactly the rows it exists for. A coordinate answers which country's
 * centroid is nearest without ambiguity at a five kilometre scale, and the
 * winner's country is written beside its postal code. A row that already names a
 * country is searched within that country and no other.
 */
export class DerivedPostalCodes1756500000000 implements MigrationInterface {
  name = 'DerivedPostalCodes1756500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "postal_code_source" AS ENUM ('SOURCE', 'DERIVED', 'MANUAL')`
    );
    await queryRunner.query(`
      ALTER TABLE "supermarket_locations"
        ADD COLUMN "postalCodeSource" "postal_code_source"
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "supermarket_locations"."postalCodeSource" IS
        'Where the postal code came from (plan 0061). DERIVED is the review flag: catalog took the nearest centroid rather than being told. Null wherever the code is null.'
    `);

    // Every value in the column today came from a discovery source or from the
    // owner typing one, and nothing recorded which. SOURCE is the honest label
    // for the set: it is what the rows a run wrote are, and it is the value that
    // costs nothing if a hand entered row is mislabelled, since SOURCE and
    // MANUAL behave identically until re discovery starts overwriting.
    await queryRunner.query(`
      UPDATE "supermarket_locations"
        SET "postalCodeSource" = 'SOURCE'
        WHERE "postalCode" IS NOT NULL
    `);

    await backfillDerivedPostalCodes(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The derived codes go with the column that says they are derived. Leaving
    // them behind would turn a guess into an indistinguishable fact, which is
    // the one outcome this plan exists to prevent.
    await queryRunner.query(`
      UPDATE "supermarket_locations"
        SET "postalCode" = NULL
        WHERE "postalCodeSource" = 'DERIVED'
    `);
    await queryRunner.query(`
      ALTER TABLE "supermarket_locations" DROP COLUMN "postalCodeSource"
    `);
    await queryRunner.query(`DROP TYPE "postal_code_source"`);
  }
}

/**
 * Fill the postcode of every location that has coordinates and no code, from
 * the nearest centroid within the bound.
 *
 * Exported so a later dataset refresh can re run it as a migration of one line.
 *
 * **In TypeScript rather than in SQL**, because {@link distanceMetres} is the
 * one definition of distance in this system and a great circle formula written
 * again in SQL would be a second one, free to disagree with the service that
 * answers the same question at runtime. The whole centroid table is eleven
 * thousand rows, so it is read once into memory and every location is answered
 * from it.
 */
export async function backfillDerivedPostalCodes(
  queryRunner: QueryRunner
): Promise<void> {
  const maxDistanceMetres = postalCodeDeriveMaxMetres();

  const locations: LocationRow[] = await queryRunner.query(`
    SELECT "id", "country", "latitude", "longitude"
      FROM "supermarket_locations"
      WHERE "postalCode" IS NULL
        AND "latitude" IS NOT NULL
        AND "longitude" IS NOT NULL
  `);
  if (locations.length === 0) {
    return;
  }

  const centroids: CentroidRow[] = await queryRunner.query(`
    SELECT "country", "postalCode", "latitude", "longitude"
      FROM "postal_code_points"
  `);

  for (const location of locations) {
    const nearest = nearestCentroid(
      centroids,
      { lat: Number(location.latitude), lon: Number(location.longitude) },
      alpha2(location.country),
      maxDistanceMetres
    );
    if (!nearest) {
      // Beyond the bound, or in a country the shipped dataset does not cover.
      // The row keeps a null postcode and a null source, which is the answer.
      continue;
    }

    await queryRunner.query(
      `UPDATE "supermarket_locations"
         SET "postalCode" = $2,
             "postalCodeSource" = 'DERIVED',
             "country" = COALESCE("country", $3)
         WHERE "id" = $1`,
      [location.id, nearest.postalCode, nearest.country]
    );
  }
}

/**
 * The closest centroid to a point, within the bound, restricted to one country
 * when the caller knows one.
 *
 * A bounding box first, then the exact distance over its survivors, which is
 * how `PostalCodeService` answers the same question. Ties break on the code, so
 * a rerun over the three Córdoba codes that share one point in the GeoNames
 * export writes the same answer it wrote the first time.
 */
function nearestCentroid(
  centroids: readonly CentroidRow[],
  centre: LatLon,
  country: string | null,
  maxDistanceMetres: number
): CentroidRow | null {
  const box = boundingBox(centre.lat, centre.lon, maxDistanceMetres);
  let best: CentroidRow | null = null;
  let bestMetres = Number.POSITIVE_INFINITY;

  for (const candidate of centroids) {
    if (country !== null && candidate.country !== country) {
      continue;
    }
    const lat = Number(candidate.latitude);
    const lon = Number(candidate.longitude);
    if (
      lat < box.minLatitude ||
      lat > box.maxLatitude ||
      lon < box.minLongitude ||
      lon > box.maxLongitude
    ) {
      continue;
    }

    const metres = distanceMetres(centre, { lat, lon });
    if (metres > maxDistanceMetres) {
      continue;
    }
    if (
      metres < bestMetres ||
      (metres === bestMetres &&
        best !== null &&
        candidate.postalCode.localeCompare(best.postalCode) < 0)
    ) {
      best = candidate;
      bestMetres = metres;
    }
  }

  return best;
}

/** The country as `postal_code_points` spells it, or null for "any". */
function alpha2(country: string | null): string | null {
  const trimmed = (country ?? '').trim();
  return trimmed.length === 2 ? trimmed.toLowerCase() : null;
}
