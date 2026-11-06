import type { CarrefourFormat, CarrefourStore } from './stores';

/**
 * The online sale points (plan 0223, section 3): every shop of the chain with
 * an online service, 179 of them, all hypermarkets or Markets.
 *
 * `GET /cloud-api/salepoints/v1/drives` answers
 * `{ groups: [{ name, sale_points: [...] }] }`. The `salepoint` cookie the walk
 * keeps names one of them, so the walk's prices are the online prices of that
 * one shop. This module only says which shop each sale point is.
 */
export interface CarrefourDrive {
  salePointId: string;
  storeId: string;
  name: string;
  latitude: number;
  longitude: number;
  postalCode: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An id as text, from a string or a number, or null. */
function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The drive list, read from `unknown`. An element whose id or coordinates are
 * missing is skipped, because a sale point with no position cannot be joined
 * to a shop and one with no id cannot be named.
 */
export function parseDrives(json: unknown): CarrefourDrive[] {
  const groups =
    isRecord(json) && Array.isArray(json['groups']) ? json['groups'] : [];
  const drives: CarrefourDrive[] = [];
  for (const group of groups) {
    const points =
      isRecord(group) && Array.isArray(group['sale_points'])
        ? group['sale_points']
        : [];
    for (const point of points) {
      if (!isRecord(point)) {
        continue;
      }
      const salePointId = idOf(point['sale_point_id']);
      const latitude = numberOf(point['latitude']);
      const longitude = numberOf(point['longitude']);
      if (salePointId === null || latitude === null || longitude === null) {
        continue;
      }
      drives.push({
        salePointId,
        storeId: idOf(point['store_id']) ?? '',
        name: textOf(point['name']) ?? '',
        latitude,
        longitude,
        postalCode: textOf(point['postal_code']),
      });
    }
  }
  return drives;
}

/** The formats that have drives. A petrol station of the same site is never one. */
const FORMATS_WITH_DRIVES: ReadonlySet<CarrefourFormat> = new Set([
  'HIPERMERCADO',
  'MARKET',
  'BIO',
]);

/** 107 m is the farthest measured drive, and no second shop is this close. */
const DEFAULT_MAX_METRES = 150;

const EARTH_RADIUS_METRES = 6_371_000;

function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h));
}

/**
 * The sale point of each shop, by the shop's `externalRef`: the drive whose
 * coordinates are nearest the shop, within `maxMetres`, among the shops of the
 * `HIPERMERCADO`, `MARKET` and `BIO` formats.
 *
 * **The join is by position because nothing else joins** (plan 0223, section
 * 3.2). The drive's `store_id` is neither `codsa` nor `codat`, and the
 * coordinates agree. Each drive takes its nearest shop, and a shop two drives
 * reach keeps the nearer one.
 */
export function salePointsByShop(
  stores: readonly CarrefourStore[],
  drives: readonly CarrefourDrive[],
  maxMetres: number = DEFAULT_MAX_METRES
): Map<string, CarrefourDrive> {
  const candidates = stores.filter((store) =>
    FORMATS_WITH_DRIVES.has(store.format)
  );
  const nearest = new Map<string, { drive: CarrefourDrive; metres: number }>();
  for (const drive of drives) {
    let best: { store: CarrefourStore; metres: number } | null = null;
    for (const store of candidates) {
      const metres = metresBetween(drive, store);
      if (metres <= maxMetres && (best === null || metres < best.metres)) {
        best = { store, metres };
      }
    }
    if (best === null) {
      continue;
    }
    const held = nearest.get(best.store.externalRef);
    if (!held || best.metres < held.metres) {
      nearest.set(best.store.externalRef, { drive, metres: best.metres });
    }
  }
  return new Map(
    [...nearest].map(([externalRef, { drive }]) => [externalRef, drive])
  );
}
