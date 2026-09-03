import type { DatasetRow, PostalCodeCentroid } from './types';

/**
 * One line of a GeoNames postal code export, the columns this system reads.
 * The file carries twelve; the place name is kept only so a failure message
 * can say which village a bad coordinate belonged to.
 */
export interface GeoNamesPostalCodeRow {
  country: string;
  postalCode: string;
  placeName: string;
  latitude: number;
  longitude: number;
}

/**
 * Decimal places kept in a reduced coordinate. GeoNames publishes four, which
 * is about eleven metres, and a mean of four decimal inputs printed at four
 * decimals is what makes the reduction reproduce byte for byte.
 */
export const COORDINATE_DECIMALS = 4;

/**
 * Column positions in the tab separated export, from GeoNames' own readme:
 * country code, postal code, place name, three admin name/code pairs, latitude,
 * longitude, accuracy.
 */
const COLUMN = {
  country: 0,
  postalCode: 1,
  placeName: 2,
  latitude: 9,
  longitude: 10,
} as const;

/**
 * The raw export, one row per line (plan 0060, section 3).
 *
 * Lenient about what it skips and strict about what it keeps: a line with too
 * few columns or a coordinate that does not parse is dropped, because one
 * broken row must not stop eleven thousand good ones from shipping, and a row
 * that is kept always has a country, a code and two finite numbers.
 */
export function parseGeoNamesExport(text: string): GeoNamesPostalCodeRow[] {
  const rows: GeoNamesPostalCodeRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const cells = line.split('\t');
    if (cells.length <= COLUMN.longitude) {
      continue;
    }
    const country = cells[COLUMN.country].trim().toLowerCase();
    const postalCode = cells[COLUMN.postalCode].trim();
    const latitude = Number(cells[COLUMN.latitude]);
    const longitude = Number(cells[COLUMN.longitude]);
    if (
      country.length !== 2 ||
      postalCode.length === 0 ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }
    rows.push({
      country,
      postalCode,
      placeName: cells[COLUMN.placeName].trim(),
      latitude,
      longitude,
    });
  }
  return rows;
}

/**
 * One point per postal code (plan 0060, section 3).
 *
 * The export carries one row per place name per code, so a code covering six
 * villages appears six times, very often with the same coordinates repeated.
 * The centroid is the **mean of the distinct points** listed for the code:
 * distinct, so that a village named three ways does not weigh three times; the
 * mean, so that a code spanning several villages lands between them rather
 * than on whichever was listed first.
 *
 * Output is sorted by country then postal code, and coordinates are rounded to
 * {@link COORDINATE_DECIMALS}, which together are what make a fresh download
 * reduce to the same bytes.
 */
export function reduceToCentroids(
  rows: readonly GeoNamesPostalCodeRow[]
): PostalCodeCentroid[] {
  const points = new Map<string, Map<string, [number, number]>>();
  for (const row of rows) {
    const key = `${row.country}\t${row.postalCode}`;
    let distinct = points.get(key);
    if (!distinct) {
      distinct = new Map();
      points.set(key, distinct);
    }
    distinct.set(`${row.latitude},${row.longitude}`, [
      row.latitude,
      row.longitude,
    ]);
  }

  const centroids: PostalCodeCentroid[] = [];
  for (const [key, distinct] of points) {
    const [country, postalCode] = key.split('\t');
    let latitude = 0;
    let longitude = 0;
    for (const [lat, lon] of distinct.values()) {
      latitude += lat;
      longitude += lon;
    }
    centroids.push({
      country,
      postalCode,
      latitude: round(latitude / distinct.size),
      longitude: round(longitude / distinct.size),
    });
  }

  return centroids.sort(
    (a, b) =>
      compare(a.country, b.country) || compare(a.postalCode, b.postalCode)
  );
}

/**
 * The committed file's bytes (plan 0060, section 3): a JSON array, one row per
 * line, LF line endings, a trailing newline. Every choice here is about the
 * diff a refresh produces: one changed code is one changed line.
 */
export function serializeDataset(
  centroids: readonly PostalCodeCentroid[]
): string {
  const lines = centroids.map((point) =>
    JSON.stringify([point.postalCode, point.latitude, point.longitude])
  );
  return `[\n${lines.join(',\n')}\n]\n`;
}

/**
 * A committed file read back as centroids, checked row by row. It runs once
 * per process, at import, over eleven thousand rows, which is cheap; what it
 * buys is that a hand edit that breaks the shape fails at startup with the
 * row number rather than as a `NaN` in a distance months later.
 */
export function decodeDataset(
  country: string,
  rows: unknown
): PostalCodeCentroid[] {
  if (!Array.isArray(rows)) {
    throw new TypeError(`postal code dataset for ${country} is not an array`);
  }
  return rows.map((row: unknown, index) => {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      typeof row[0] !== 'string' ||
      typeof row[1] !== 'number' ||
      typeof row[2] !== 'number'
    ) {
      throw new TypeError(
        `postal code dataset for ${country}: row ${index} is not [postalCode, latitude, longitude]`
      );
    }
    const [postalCode, latitude, longitude] = row as DatasetRow;
    return { country, postalCode, latitude, longitude };
  });
}

function round(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Code point order, which is what sorts `04001` before `04002` everywhere. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
