import type {
  LocalizedText,
  LocationSectionNameView,
} from '@portfolio/luna-shopper/contracts';
import { isUuid } from '@portfolio/luna-shopper/platform';

/**
 * The sections of **several shops in one statement** (plan 0170, section 2, as
 * plan 0200 left it). `$1` is the shops (`uuid[]`).
 *
 * Each shop's own rows of `shop_sections`, in its order. Nothing is inherited:
 * a shop with no rows has no sections, whatever its chain is. One row per
 * section, ordered by shop and then by `position`, carrying the section's
 * columns so a caller needs no second read; a shop that exists and has no
 * section answers one row with the section columns null, so a shop that does
 * not exist is the only one absent.
 *
 * **The one query both reads use.** `section.forLocation` asks it for one shop
 * and `section.namesForLocations` and every location view ask it for a page,
 * so a shop row and the per shop read cannot disagree about which sections a
 * shop has, or in what order.
 *
 * Exported so an integration spec can run exactly this text.
 */
export const PRESENT_SECTIONS_SQL = `
  SELECT loc."id"::text AS "locationId",
         s."id"::text AS "id",
         s."slug" AS "slug",
         s."name" AS "name",
         s."position" AS "position"
    FROM "supermarket_locations" loc
    LEFT JOIN "shop_sections" s ON s."supermarketLocationId" = loc."id"
   WHERE loc."id" = ANY($1::uuid[])
   ORDER BY loc."id", s."position", s."id"
`;

/** A section of {@link PRESENT_SECTIONS_SQL}'s answer. */
export interface PresentSectionRow {
  id: string;
  supermarketLocationId: string;
  slug: string;
  name: LocalizedText;
  position: number;
}

/**
 * One row of {@link PRESENT_SECTIONS_SQL}: a section of a shop, or, for a shop
 * that exists and has none, the shop alone with every section column null.
 */
interface PresentSectionQueryRow {
  locationId: string;
  id: string | null;
  slug: string | null;
  name: LocalizedText | null;
  position: number | string | null;
}

/**
 * Anything that runs raw SQL: a repository, an entity manager, or the manager
 * of a transaction. Typed this narrowly so a spec double needs one method.
 */
export interface SqlRunner {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/**
 * Every shop's sections in its order, keyed by lower cased shop id, in one
 * statement.
 *
 * Every shop that exists has an entry, with no rows when it has no sections;
 * a shop that does not exist has none. An id that is not a uuid names nothing
 * and is left out before the cast would fail the statement. No ids asks
 * nothing.
 */
export async function presentSectionsOf(
  runner: SqlRunner,
  locationIds: readonly string[]
): Promise<Map<string, PresentSectionRow[]>> {
  const byLocation = new Map<string, PresentSectionRow[]>();
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
      entry = [];
      byLocation.set(key, entry);
    }
    if (row.id !== null) {
      entry.push({
        id: row.id,
        supermarketLocationId: row.locationId,
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
        entry.map((row) => ({ id: row.id, name: row.name }))
      );
    }
  }
  return names;
}
