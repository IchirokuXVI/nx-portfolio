import {
  decodeDataset,
  parseGeoNamesExport,
  reduceToCentroids,
  serializeDataset,
} from './reduce';

/**
 * Six lines in the shape of the real export (tab separated, twelve columns),
 * built to exercise every rule the reducer has:
 *
 * - `04002` appears three times: two rows on the same point and one on
 *   another, so the centroid is the mean of two distinct points, not three.
 * - `04001` appears once.
 * - a row with a coordinate that does not parse, which is dropped.
 * - a row with too few columns, which is dropped.
 * - `04001` again but for a second country, to prove the key is (country, code).
 */
const EXPORT = [
  'ES\t04002\tAlmeria\tAndalucia\tAN\tAlmería\tAL\tAlmería\t04013\t36.8381\t-2.4597\t4',
  'ES\t04002\tEl Palmer\tAndalucia\tAN\tAlmería\tAL\tAlmería\t04013\t36.8381\t-2.4597\t3',
  'ES\t04002\tLa Cañada\tAndalucia\tAN\tAlmería\tAL\tAlmería\t04013\t36.8501\t-2.4401\t4',
  'ES\t04001\tAlmeria\tAndalucia\tAN\tAlmería\tAL\tAlmería\t04013\t36.8381\t-2.4597\t4',
  'ES\t04003\tBroken\tAndalucia\tAN\tAlmería\tAL\tAlmería\t04013\tnorth\t-2.4597\t4',
  'ES\t04004\tShort',
  'PT\t04001\tElsewhere\t\t\t\t\t\t\t38.7\t-9.1\t4',
  '',
].join('\n');

describe('parseGeoNamesExport', () => {
  it('keeps the rows with a country, a code and two finite coordinates', () => {
    const rows = parseGeoNamesExport(EXPORT);

    expect(rows.map((r) => `${r.country}/${r.postalCode}`)).toEqual([
      'es/04002',
      'es/04002',
      'es/04002',
      'es/04001',
      'pt/04001',
    ]);
    expect(rows[0]).toEqual({
      country: 'es',
      postalCode: '04002',
      placeName: 'Almeria',
      latitude: 36.8381,
      longitude: -2.4597,
    });
  });

  it('accepts CRLF line endings, because a Windows checkout of the raw file has them', () => {
    expect(parseGeoNamesExport(EXPORT.replace(/\n/g, '\r\n'))).toHaveLength(5);
  });
});

describe('reduceToCentroids', () => {
  it('takes the mean of the distinct points per (country, code), sorted', () => {
    const centroids = reduceToCentroids(parseGeoNamesExport(EXPORT));

    expect(centroids).toEqual([
      {
        country: 'es',
        postalCode: '04001',
        latitude: 36.8381,
        longitude: -2.4597,
      },
      // (36.8381 + 36.8501) / 2 and (-2.4597 + -2.4401) / 2: the repeated
      // point counts once. The second point is chosen so the mean lands on a
      // fourth decimal exactly rather than on a half, where rounding would
      // depend on the float representation and prove nothing.
      {
        country: 'es',
        postalCode: '04002',
        latitude: 36.8441,
        longitude: -2.4499,
      },
      { country: 'pt', postalCode: '04001', latitude: 38.7, longitude: -9.1 },
    ]);
  });

  it('is independent of input order', () => {
    const rows = parseGeoNamesExport(EXPORT);
    const reversed = reduceToCentroids([...rows].reverse());
    expect(reversed).toEqual(reduceToCentroids(rows));
  });
});

describe('serializeDataset and decodeDataset', () => {
  it('writes one row per line with LF endings and a trailing newline, and reads it back', () => {
    const centroids = reduceToCentroids(parseGeoNamesExport(EXPORT)).filter(
      (c) => c.country === 'es'
    );
    const text = serializeDataset(centroids);

    expect(text).toBe(
      '[\n["04001",36.8381,-2.4597],\n["04002",36.8441,-2.4499]\n]\n'
    );
    expect(decodeDataset('es', JSON.parse(text))).toEqual(centroids);
  });

  it('serializes an empty dataset as a valid empty array', () => {
    expect(JSON.parse(serializeDataset([]))).toEqual([]);
  });

  it('refuses a row that is not [postalCode, latitude, longitude], naming the row', () => {
    expect(() =>
      decodeDataset('es', [
        ['04001', 36.8, -2.4],
        ['04002', '36.8', -2.4],
      ])
    ).toThrow(/row 1/);
    expect(() => decodeDataset('es', { rows: [] })).toThrow(/not an array/);
  });
});
