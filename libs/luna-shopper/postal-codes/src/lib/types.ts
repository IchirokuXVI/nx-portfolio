/**
 * One postal code reduced to one point (plan 0060, section 2).
 *
 * **A centroid, never a boundary** (section 6). A postal code covers an area,
 * sometimes a large and strangely shaped one, and this is that area reduced to
 * a single point. Everything computed from it is approximate in a way the
 * callers have to say out loud rather than assume away.
 */
export interface PostalCodeCentroid {
  /** ISO 3166-1 alpha-2, lowercase. */
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}

/**
 * The rectangle a btree index can serve (plan 0060, section 5): the survivors
 * of this filter get an exact distance, and nothing outside it is looked at.
 */
export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/**
 * The shape of a committed dataset file: one row per postal code, in this
 * order, with no keys so that eleven thousand rows are a few hundred kilobytes
 * rather than a megabyte. The country is the file name.
 */
export type DatasetRow = [
  postalCode: string,
  latitude: number,
  longitude: number,
];
