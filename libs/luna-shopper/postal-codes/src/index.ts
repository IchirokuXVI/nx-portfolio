/**
 * Postal code centroids we ship (plan 0060), and the arithmetic that turns them
 * into "which code is this point in" and "which codes are near this one".
 *
 * Framework free by the same hard constraint as `mercadona` and `osm-places`:
 * no TypeORM, no Nest, no database. The data itself is behind the `dataset`
 * entry point (`@portfolio/luna-shopper/postal-codes/dataset`), so a service
 * that only needs the bounding box does not carry eleven thousand rows in its
 * bundle; the migration that loads the table is the one importer of the data.
 *
 * **Attribution is an obligation, not a nicety.** The data is CC BY 4.0, so
 * anywhere a code resolved through it is shown must carry
 * {@link GEONAMES_ATTRIBUTION}.
 */

export {
  GEONAMES_ATTRIBUTION,
  GEONAMES_LICENSE_URL,
  GEONAMES_POSTAL_CODES_URL,
  GEONAMES_URL,
} from './lib/attribution';
export {
  METRES_PER_DEGREE,
  boundingBox,
  containsPoint,
} from './lib/bounding-box';
export {
  COORDINATE_DECIMALS,
  decodeDataset,
  parseGeoNamesExport,
  reduceToCentroids,
  serializeDataset,
} from './lib/reduce';
export type { GeoNamesPostalCodeRow } from './lib/reduce';
export type { BoundingBox, DatasetRow, PostalCodeCentroid } from './lib/types';
