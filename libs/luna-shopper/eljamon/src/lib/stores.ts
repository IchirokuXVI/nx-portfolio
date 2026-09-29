import { decodeText, sliceJsonObject, textOf } from './html';
import type {
  ElJamonDroppedRecord,
  ElJamonStore,
  ElJamonStoreList,
} from './types';

/**
 * The store locator's answer, read (plan 0169, section 3).
 *
 * The answer is HTML holding `var locations = {"center":…,"locations":[…]};`.
 * Each location is `{lat, lng, infowindow}`, and `infowindow` is itself HTML:
 * the name in `<h3>`, then `street<br/> town , province Spain postalCode` in a
 * `<p>`, then the hours after `Horario:`.
 *
 * Every record is accounted for: it is a shop, or it is in `dropped` with the
 * reason, so a count that moves between runs can be explained from the report.
 */
export function parseLocations(html: string): ElJamonStoreList {
  const marker = html.indexOf('var locations');
  const literal = marker === -1 ? null : sliceJsonObject(html, marker);
  if (!literal) {
    throw new Error(
      'The El Jamón store locator answered without a locations object.'
    );
  }
  const parsed = JSON.parse(literal) as { locations?: unknown };
  const records = Array.isArray(parsed.locations) ? parsed.locations : [];

  const stores: ElJamonStore[] = [];
  const dropped: ElJamonDroppedRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const read = readRecord(record);
    const drop = (reason: ElJamonDroppedRecord['reason']): void => {
      dropped.push({
        reason,
        name: read.name,
        street: read.street,
        city: read.city,
        postalCode: read.postalCode,
      });
    };
    if (!read.name || !isElJamon(read.name)) {
      drop('OTHER_BANNER');
      continue;
    }
    if (!read.postalCode || !read.street) {
      drop('NO_POSTAL_CODE');
      continue;
    }
    if (read.latitude === null || read.longitude === null) {
      drop('NO_COORDINATES');
      continue;
    }
    const externalRef = storeRef(read.postalCode, read.street);
    if (seen.has(externalRef)) {
      drop('DUPLICATE');
      continue;
    }
    seen.add(externalRef);
    stores.push({
      externalRef,
      name: read.name,
      latitude: read.latitude,
      longitude: read.longitude,
      street: read.street,
      city: read.city,
      province: read.province,
      postalCode: read.postalCode,
      openingHours: read.openingHours,
    });
  }
  return { recordsRead: records.length, stores, dropped };
}

/**
 * The shop's key: `<postalCode>:<normalized street>` (section 3).
 *
 * Normalized so that the spelling drift a hand kept plugin collects (`Avda.`
 * with and without the dot, an accent, a double space) does not turn one shop
 * into two between runs: lower case, no accents, anything that is not a letter
 * or a digit becomes a single space.
 */
export function storeRef(postalCode: string, street: string): string {
  return `${postalCode}:${normalizeStreet(street)}`;
}

function normalizeStreet(street: string): string {
  return street
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `Supermercados El Jamón`, with or without the line break the plugin adds. */
function isElJamon(name: string): boolean {
  return /\bel jamon\b/.test(
    name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  );
}

interface ReadRecord {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  street: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  openingHours: string | null;
}

/** `Lepe , Huelva Spain 21440`: town, province, country, postal code. */
const LOCALITY = /^(.*?)\s*,\s*(.*?)\s*\bSpain\b\s*(\d{5})?\s*$/i;

function readRecord(record: unknown): ReadRecord {
  const value = (record ?? {}) as Record<string, unknown>;
  const window =
    typeof value['infowindow'] === 'string' ? value['infowindow'] : '';

  const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(window);
  const address = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(window);
  const lines = (address?.[1] ?? '')
    .split(/<br\s*\/?>/i)
    .map((line) => textOf(line))
    .filter((line) => line !== '');
  const street = lines[0] ?? null;
  const locality = LOCALITY.exec(lines.slice(1).join(' '));

  // The hours are everything after `Horario:` up to the distance the plugin
  // appends, flattened to one line and otherwise untouched.
  const hours = /Horario:([\s\S]*?)(?:<div class="wpsl-distance"|$)/i.exec(
    window
  );
  const openingHours = hours
    ? textOf(hours[1].replace(/<br\s*\/?>/gi, ' '))
    : '';

  return {
    name: heading ? textOf(heading[1]) || null : null,
    latitude: coordinate(value['lat']),
    longitude: coordinate(value['lng']),
    street: street ? decodeText(street) : null,
    city: locality?.[1] ? locality[1] : null,
    province: locality?.[2] ? locality[2] : null,
    postalCode: locality?.[3] ?? null,
    openingHours: openingHours || null,
  };
}

function coordinate(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return typeof value !== 'boolean' &&
    value !== null &&
    value !== '' &&
    Number.isFinite(parsed)
    ? parsed
    : null;
}
