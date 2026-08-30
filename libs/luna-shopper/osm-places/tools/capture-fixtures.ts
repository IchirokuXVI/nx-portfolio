/**
 * Refresh the checked in OpenStreetMap fixtures (plan 0038, section 9).
 *
 *   npx nx run luna-shopper/osm-places:capture-fixtures
 *
 * Run by hand, never by CI. Two requests total: one Nominatim geocode and one
 * Overpass query, at the pacing the client defaults to, which is inside both
 * services' usage policies (section 8.2). The data is ODbL; anything derived from
 * it that reaches a user carries "© OpenStreetMap contributors".
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OsmPlacesClient } from '../src/lib/osm-places.client';

const OUT_DIR = join(__dirname, '..', 'src', 'lib', '__fixtures__');

const USER_AGENT =
  process.env['HARVEST_USER_AGENT'] ??
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

const POSTAL_CODE = process.env['OSM_POSTAL_CODE'] ?? '14013';
const COUNTRY = process.env['OSM_COUNTRY'] ?? 'es';
/** Section 11's recommended default: 3 km returned 26 supermarkets around 14013. */
const RADIUS_METRES = Number(process.env['OSM_RADIUS_METRES'] ?? 3000);

async function main(): Promise<void> {
  const client = new OsmPlacesClient({
    userAgent: USER_AGENT,
    nominatimUrl: process.env['NOMINATIM_URL'],
    overpassUrl: process.env['OVERPASS_URL'],
  });

  // Captured through fetch directly rather than through the client, because the
  // fixture must keep the bounding box the client discards: the test asserts it
  // is ignored, and it cannot assert that if the capture drops it first.
  const query = new URLSearchParams({
    postalcode: POSTAL_CODE,
    country: COUNTRY,
    format: 'jsonv2',
    limit: '1',
  });
  const geocodeUrl = `${
    process.env['NOMINATIM_URL'] ?? 'https://nominatim.openstreetmap.org'
  }/search?${query.toString()}`;
  const geocode = await fetch(geocodeUrl, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  }).then((r) => r.json());
  write(`nominatim-${POSTAL_CODE}.json`, geocode);

  const centre = await client.geocodePostalCode(POSTAL_CODE, COUNTRY);
  if (!centre) {
    process.stderr.write(
      `Nominatim found no point for ${POSTAL_CODE} in ${COUNTRY}; ` +
        'the Overpass fixture was left as it was\n'
    );
    return;
  }
  process.stdout.write(
    `${POSTAL_CODE} -> ${centre.lat},${centre.lon}; querying ${RADIUS_METRES} m\n`
  );

  // The client normalizes, and the fixture must hold the RAW response, so the
  // Overpass call is made directly for the same reason as the geocode above.
  const overpassQuery =
    `[out:json][timeout:60];` +
    `nwr["shop"="supermarket"](around:${RADIUS_METRES},${centre.lat},${centre.lon});` +
    `out center tags;`;
  const raw = await fetch(
    process.env['OVERPASS_URL'] ?? 'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({ data: overpassQuery }).toString(),
    }
  ).then((r) => r.json());
  write('overpass-supermarkets.json', raw);
}

function write(file: string, payload: unknown): void {
  writeFileSync(
    join(OUT_DIR, file),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`wrote ${file}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
