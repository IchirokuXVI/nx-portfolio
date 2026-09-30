import {
  validateShopMapV2,
  type AreaColour,
  type ShopperArea,
  type ShopperNote,
  type ShopperView,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  shopMapDocumentOf,
  type LocalizedName,
  type ShopDetail,
  type ShopMap,
  type ShopMapRead,
  type ShopMapSection,
} from '@portfolio/velista/models';
import {
  date,
  isRecord,
  mapArray,
  nullableNum,
  nullableStr,
  str,
} from './primitives';
import { toShopSectionNames } from './shop-section-mappers';

/**
 * From `SupermarketLocationView` (`GET /v1/catalog/locations/:id`), with the
 * chain's name from a second read (velista `0121`, target 2). Null without an id
 * or a chain id, which is a shop nobody can name.
 *
 * `footprintM2` is kept only when it is a positive number: a size of nothing is
 * no size. `hasMap` is true only when the wire says exactly that, so a server that
 * predates backend `0168` offers no map rather than one it cannot serve.
 */
export function toShopDetail(
  raw: unknown,
  chain: LocalizedName | null
): ShopDetail | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const supermarketId = str(raw['supermarketId']);
  if (id === null || id === '' || supermarketId === null) {
    return null;
  }
  const footprint = nullableNum(raw['footprintM2']);
  return {
    id,
    supermarketId,
    chain,
    label: readableName(raw['label']),
    address: nullableStr(raw['address']),
    city: nullableStr(raw['city']),
    postalCode: nullableStr(raw['postalCode']),
    footprintM2: footprint !== null && footprint > 0 ? footprint : null,
    hasMap: raw['hasMap'] === true,
    sections: toShopSectionNames(raw['sections']),
  };
}

/** A `LocalizedText` with at least one language, else null. */
function readableName(raw: unknown): LocalizedName | null {
  if (!isRecord(raw)) {
    return null;
  }
  const en = str(raw['en']) ?? '';
  const es = str(raw['es']) ?? '';
  return en.trim() === '' && es.trim() === '' ? null : { en, es };
}

/**
 * From `LocationShopMapView` (`GET /v1/catalog/locations/:id/map`), rule D4
 * applied to a map (velista `0121`).
 *
 * `{ map: null }` is an answer: the shop has no map, which is `none`. A map that
 * cannot be read, or whose rebuilt document `validateShopMapV2` refuses, is
 * `failed` and never drawn: a canvas handed a map with shelves on top of each
 * other would draw a shop that is not there, and somebody would walk to it.
 *
 * An area of a kind this build does not know is left out rather than guessed at,
 * because a guess would draw a wall or a door where there is none.
 */
export function toShopMapRead(raw: unknown): ShopMapRead {
  if (!isRecord(raw) || !('map' in raw)) {
    return { kind: 'failed' };
  }
  if (raw['map'] === null) {
    return { kind: 'none' };
  }
  const map = toShopMap(raw['map']);
  return map === null ? { kind: 'failed' } : { kind: 'map', map };
}

/** From `ShopMapView`, or null when it cannot be drawn. */
export function toShopMap(raw: unknown): ShopMap | null {
  if (!isRecord(raw)) {
    return null;
  }
  const walkId = str(raw['walkId']);
  const view = toShopperView(raw['view']);
  if (walkId === null || view === null) {
    return null;
  }
  const document = shopMapDocumentOf(view);
  if (validateShopMapV2(document).length > 0) {
    return null;
  }
  return {
    walkId,
    savedAt: date(raw['savedAt']),
    document,
    notes: view.notes,
    sections: mapArray(raw['sections'], toShopMapSection),
  };
}

function toShopMapSection(raw: unknown): ShopMapSection | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str(raw['name']);
  const sectionId = str(raw['sectionId']);
  return name === null || name.trim() === '' || sectionId === null
    ? null
    : { name, sectionId };
}

const AREA_KINDS: readonly ShopperArea['kind'][] = [
  'shelf',
  'counter',
  'checkout',
  'entrance',
  'blocked',
];

function metres(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toPoint(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) {
    return null;
  }
  const x = metres(raw[0]);
  const y = metres(raw[1]);
  return x === null || y === null ? null : [x, y];
}

/** A ring with an unreadable point is not a ring: the walkway around it would be wrong. */
function toRing(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 3) {
    return null;
  }
  const points = raw.map(toPoint);
  return points.every((point) => point !== null)
    ? (points as [number, number][])
    : null;
}

function toColour(raw: unknown): AreaColour {
  if (isRecord(raw)) {
    if (raw['mode'] === 'category') {
      return { mode: 'category' };
    }
    const value = str(raw['value']);
    if (raw['mode'] === 'custom' && value !== null) {
      return { mode: 'custom', value };
    }
  }
  return { mode: 'default' };
}

function toShopperArea(raw: unknown): ShopperArea | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const kind = AREA_KINDS.find((one) => one === raw['kind']);
  const x = metres(raw['x']);
  const y = metres(raw['y']);
  const w = metres(raw['w']);
  const h = metres(raw['h']);
  if (
    id === null ||
    kind === undefined ||
    x === null ||
    y === null ||
    w === null ||
    h === null
  ) {
    return null;
  }
  const section = str(raw['section']);
  const label = str(raw['label']);
  return {
    id,
    kind,
    x,
    y,
    w,
    h,
    ...(section !== null && section.trim() !== '' ? { section } : {}),
    ...(label !== null && label.trim() !== '' ? { label } : {}),
    colour: toColour(raw['colour']),
  };
}

function toShopperNote(raw: unknown): ShopperNote | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const x = metres(raw['x']);
  const y = metres(raw['y']);
  const text = str(raw['text']);
  return id === null || x === null || y === null || text === null
    ? null
    : { id, x, y, text };
}

function toShopperView(raw: unknown): ShopperView | null {
  if (!isRecord(raw) || !Array.isArray(raw['walkway'])) {
    return null;
  }
  const rings = raw['walkway'].map(toRing);
  if (rings.some((ring) => ring === null)) {
    return null;
  }
  const bounds = isRecord(raw['bounds']) ? raw['bounds'] : {};
  return {
    walkway: rings as [number, number][][],
    areas: mapArray(raw['areas'], toShopperArea),
    notes: mapArray(raw['notes'], toShopperNote),
    bounds: {
      x: metres(bounds['x']) ?? 0,
      y: metres(bounds['y']) ?? 0,
      w: metres(bounds['w']) ?? 0,
      h: metres(bounds['h']) ?? 0,
    },
  };
}
