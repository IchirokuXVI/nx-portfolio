import type {
  LocalizedText,
  LocationSectionNameView,
  LocationSectionsSource,
} from '@portfolio/luna-shopper/contracts';
import { isUuid } from '@portfolio/luna-shopper/platform';

/**
 * Step 1 of the rule of plan 0167, section 3, for **several shops in one
 * statement** (plan 0170, section 2). `$1` is the shops (`uuid[]`).
 *
 * Each shop's own rows in its order, else every section of its chain in
 * `position` order; `own` says which. One row per present section, ordered by
 * shop and then by the shop's order, carrying the section's columns so a
 * caller needs no second read; a shop that exists and has no section answers
 * one row with the section columns null, so a shop that does not exist is the
 * only one absent.
 *
 * **The one query both reads use.** `section.forLocation` asks it for one shop
 * and `section.namesForLocations` and every location view ask it for a page,
 * so a shop row and the per shop read cannot disagree about which sections a
 * shop has, or in what order.
 *
 * Exported so an integration spec can run exactly this text.
 */
export const PRESENT_SECTIONS_SQL = `
  WITH "loc" AS (
    SELECT l."id", l."supermarketId"
      FROM "supermarket_locations" l
     WHERE l."id" = ANY($1::uuid[])
  ),
  "own" AS (
    SELECT ls."supermarketLocationId" AS "locationId",
           ls."sectionId",
           ls."position"::bigint AS "rank"
      FROM "location_sections" ls
     WHERE ls."supermarketLocationId" = ANY($1::uuid[])
  ),
  "present" AS (
    SELECT o."locationId", o."sectionId", o."rank", true AS "own"
      FROM "own" o
    UNION ALL
    SELECT loc."id", s."id",
           row_number() OVER (PARTITION BY loc."id" ORDER BY s."position", s."id"),
           false
      FROM "loc"
      JOIN "supermarket_sections" s ON s."supermarketId" = loc."supermarketId"
     WHERE NOT EXISTS (SELECT 1 FROM "own" o WHERE o."locationId" = loc."id")
  )
  SELECT loc."id"::text AS "locationId",
         coalesce(pr."own", false) AS "own",
         s."id"::text AS "id",
         s."supermarketId"::text AS "supermarketId",
         s."slug" AS "slug",
         s."name" AS "name",
         s."position" AS "position"
    FROM "loc"
    LEFT JOIN "present" pr ON pr."locationId" = loc."id"
    LEFT JOIN "supermarket_sections" s ON s."id" = pr."sectionId"
   ORDER BY loc."id", pr."rank", s."id"
`;

/** A section of {@link PRESENT_SECTIONS_SQL}'s answer. */
export interface PresentSectionRow {
  id: string;
  supermarketId: string;
  slug: string;
  name: LocalizedText;
  position: number;
}

/**
 * One row of {@link PRESENT_SECTIONS_SQL}: a present section of a shop, or,
 * for a shop that exists and has none, the shop alone with every section
 * column null.
 */
interface PresentSectionQueryRow {
  locationId: string;
  own: boolean;
  id: string | null;
  supermarketId: string | null;
  slug: string | null;
  name: LocalizedText | null;
  position: number | string | null;
}

/** A shop's present sections, in its order, and where the list comes from. */
export interface PresentSections {
  rows: PresentSectionRow[];
  source: LocationSectionsSource;
}

/**
 * Anything that runs raw SQL: a repository, an entity manager, or the manager
 * of a transaction. Typed this narrowly so a spec double needs one method.
 */
export interface SqlRunner {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/**
 * Every shop's present sections, keyed by lower cased shop id, in one
 * statement.
 *
 * Every shop that exists has an entry, with no rows when its chain has no
 * sections; a shop that does not exist has none. An id that is not a uuid
 * names nothing and is left out before the cast would fail the statement. No
 * ids asks nothing.
 */
export async function presentSectionsOf(
  runner: SqlRunner,
  locationIds: readonly string[]
): Promise<Map<string, PresentSections>> {
  const byLocation = new Map<string, PresentSections>();
  const ids = [
    ...new Set(
      locationIds.filter((id) => isUuid(id)).map((id) => id.toLowerCase())
    ),
  ];
  if (ids.length === 0) {
    return byLocation;
  }
  const rows = (await runner.query(PRESENT_SECTIONS_SQL, [
    ids,
  ])) as PresentSectionQueryRow[];
  for (const row of rows) {
    const key = row.locationId.toLowerCase();
    let entry = byLocation.get(key);
    if (!entry) {
      entry = { rows: [], source: row.own ? 'LOCATION' : 'CHAIN' };
      byLocation.set(key, entry);
    }
    if (row.id !== null) {
      entry.rows.push({
        id: row.id,
        supermarketId: row.supermarketId as string,
        slug: row.slug as string,
        name: row.name as LocalizedText,
        position: Number(row.position),
      });
    }
  }
  return byLocation;
}

/**
 * Every existing shop's section names in its order, keyed by shop id as the
 * caller gave it (plan 0170), in one statement. A shop with none maps to an
 * empty list and a shop that does not exist is absent, so a caller mapping a
 * page of shops it just read reads every row's entry with `?? []`.
 */
export async function sectionNamesOf(
  runner: SqlRunner,
  locationIds: readonly string[]
): Promise<Map<string, LocationSectionNameView[]>> {
  const present = await presentSectionsOf(runner, locationIds);
  const names = new Map<string, LocationSectionNameView[]>();
  for (const id of locationIds) {
    const entry = present.get(id.toLowerCase());
    if (entry) {
      names.set(
        id,
        entry.rows.map((row) => ({ id: row.id, name: row.name }))
      );
    }
  }
  return names;
}
