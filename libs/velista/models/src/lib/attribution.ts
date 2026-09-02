/**
 * The credit this app owes for the shops it draws (plan 0059, section 5).
 *
 * Every shop on the supermarkets screen came from OpenStreetMap, whose data is ODbL, and
 * every postal code that was derived rather than observed came from GeoNames, which is
 * CC BY 4.0. Both obligations were written down beside the data that carries them, as
 * exported constants, precisely so they would travel rather than live in a comment
 * somebody later deletes. **This is where they finally land**, because the supermarkets
 * screen is the first place a person sees the data.
 *
 * ## Why a re-export rather than an import at the point of use
 *
 * So there is exactly one place that decides velista may reach into those two libraries,
 * and one place a reader can check what the app renders against what the licence asks
 * for. The obligation is a fact about the data, and this library is where velista keeps
 * facts about data.
 *
 * ## Why importing them here is safe
 *
 * `@portfolio/luna-shopper/osm-places` and `@portfolio/luna-shopper/postal-codes` are
 * framework free by hard constraint: no TypeORM, no Nest, no database, and no node
 * builtin in either entry point. That is what separates them from
 * `@portfolio/luna-shopper/contracts` and `@portfolio/luna-shopper/platform`, which pull
 * NestJS into anything that imports them and are restated by hand in this library for
 * that reason (see `problem.ts` and `PROFILE_LIMITS`). The postal code dataset itself,
 * eleven thousand rows, sits behind a second entry point that nothing here touches.
 *
 * The strings are re-exported under the names the licences are argued about, not renamed
 * to something app shaped: a reader chasing "who has to say © OpenStreetMap contributors"
 * finds the same identifier at both ends.
 */

export { OSM_ATTRIBUTION } from '@portfolio/luna-shopper/osm-places';
export {
  GEONAMES_ATTRIBUTION,
  GEONAMES_LICENSE_URL,
  GEONAMES_URL,
} from '@portfolio/luna-shopper/postal-codes';

/** The credit link ODbL asks for, beside the sentence. */
export const OSM_URL = 'https://www.openstreetmap.org/copyright';
