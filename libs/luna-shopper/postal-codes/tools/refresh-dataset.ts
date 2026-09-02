/**
 * Regenerate the committed postal code dataset from GeoNames (plan 0060,
 * section 3).
 *
 *   npx nx run luna-shopper/postal-codes:refresh-dataset
 *
 * Run by hand, never by CI. One download of `<CC>.zip` from GeoNames, which is
 * a few hundred kilobytes; the raw export is not committed, only the reduction.
 * The reduction is deterministic (sorted, rounded), so a refresh against an
 * unchanged upstream file is a no op in git, and a changed one is a readable
 * diff of the codes that moved.
 *
 *   GEONAMES_COUNTRY   ISO alpha-2 of the export to fetch, default ES
 *   GEONAMES_FILE      path to an already downloaded `<CC>.txt`, skips the fetch
 *   GEONAMES_ZIP_URL   overrides the download URL entirely
 *
 * The data is CC BY 4.0: anywhere a code resolved through it is shown must
 * carry `GEONAMES_ATTRIBUTION`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { GEONAMES_POSTAL_CODES_URL } from '../src/lib/attribution';
import {
  parseGeoNamesExport,
  reduceToCentroids,
  serializeDataset,
} from '../src/lib/reduce';

const OUT_DIR = join(__dirname, '..', 'src', 'data');

async function main(): Promise<void> {
  const country = (process.env['GEONAMES_COUNTRY'] ?? 'ES').toUpperCase();
  const text = await loadExport(country);

  const rows = parseGeoNamesExport(text);
  const centroids = reduceToCentroids(rows);
  const foreign = centroids.filter((c) => c.country !== country.toLowerCase());
  if (foreign.length > 0) {
    throw new Error(
      `the ${country} export carries rows for ${[
        ...new Set(foreign.map((c) => c.country)),
      ].join(', ')}; a dataset file holds one country`
    );
  }

  const outFile = join(OUT_DIR, `${country.toLowerCase()}.json`);
  writeFileSync(outFile, serializeDataset(centroids), 'utf8');
  process.stdout.write(
    `${country}: ${rows.length} rows reduced to ${centroids.length} postal codes -> ${outFile}\n`
  );
}

async function loadExport(country: string): Promise<string> {
  const file = process.env['GEONAMES_FILE'];
  if (file) {
    process.stdout.write(`reading ${file}\n`);
    return readFileSync(file, 'utf8');
  }
  const url =
    process.env['GEONAMES_ZIP_URL'] ??
    `${GEONAMES_POSTAL_CODES_URL}/${country}.zip`;
  process.stdout.write(`downloading ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const zip = Buffer.from(await response.arrayBuffer());
  const entry = readZipEntry(zip, `${country}.txt`);
  if (!entry) {
    throw new Error(`${url} holds no ${country}.txt`);
  }
  return entry.toString('utf8');
}

/**
 * The one file out of a ZIP archive, by name. Node has no archive reader of
 * its own and the alternative is a dependency for a script run twice a year,
 * so this is the format's central directory read by hand: enough for a
 * GeoNames export (deflate or stored, well under 4 GB, no encryption) and
 * nothing more.
 */
function readZipEntry(zip: Buffer, name: string): Buffer | null {
  const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  const CENTRAL_FILE_HEADER = 0x02014b50;
  const LOCAL_FILE_HEADER = 0x04034b50;

  // The end record is the last thing in the file, followed only by a comment
  // of at most 65535 bytes, so scan backwards for its signature.
  let end = -1;
  for (
    let i = zip.length - 22;
    i >= Math.max(0, zip.length - 22 - 65535);
    i--
  ) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error('not a ZIP archive: no end of central directory');
  }
  const entryCount = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new Error(`corrupt central directory at ${offset}`);
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;

    if (entryName !== name) {
      continue;
    }
    if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`corrupt local header for ${name}`);
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) {
      return Buffer.from(data);
    }
    if (method === 8) {
      return inflateRawSync(data);
    }
    throw new Error(`${name} uses compression method ${method}`);
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
