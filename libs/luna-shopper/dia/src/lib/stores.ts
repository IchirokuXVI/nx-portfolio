import { gunzipSync } from 'node:zlib';
import type { DiaStoreDetail, DiaStoreFile, DiaStoreRecord } from './types';

/** `tipoTienda` of a DIA shop. 1 is Clarel, a perfumery banner. */
const TIPO_DIA = 0;

/** How far from a postal code's centroid a candidate shop may sit. */
export const DIA_DEFAULT_POSTAL_CODE_RADIUS_METRES = 5_000;

/**
 * The name of the current shop file, read from the store finder page (plan
 * 0174, section 5.1).
 *
 * The page holds a hidden input `#gz` whose value names the file, for example
 * `https://www.dia.es/clubdia/ES/tiendas.v2749.json.gz`. The version changes,
 * so it is never hard coded. Answers an absolute URL, or null.
 */
export function parseStoreFileUrl(
  html: string,
  baseUrl: string
): string | null {
  const input = /<input\b[^>]*\bid=["']gz["'][^>]*>/i.exec(html);
  const value = input ? /\bvalue=["']([^"']+)["']/i.exec(input[0]) : null;
  if (!value) {
    return null;
  }
  const name = value[1].trim();
  if (/^https?:\/\//i.test(name)) {
    return name;
  }
  return name.startsWith('/')
    ? `${baseUrl}${name}`
    : `${baseUrl}/clubdia/ES/${name}`;
}

/**
 * The shop file: one gzip document of every DIA and Clarel shop.
 *
 * It is unpacked while it still starts with the gzip magic bytes. The server
 * sends a `.gz` file with `content-encoding: gzip`, so a client that undoes the
 * transfer encoding still holds a gzip file, and one that does not holds two.
 *
 * Clarel records are dropped and counted. `posicionX` is the latitude and
 * `posicionY` the longitude.
 */
export function parseStoreFile(payload: Uint8Array | string): DiaStoreFile {
  const records: unknown = JSON.parse(unpack(payload));
  if (!Array.isArray(records)) {
    throw new Error('The DIA shop file is not a list of records.');
  }
  const stores: DiaStoreRecord[] = [];
  const unreadable: string[] = [];
  let clarelDropped = 0;
  for (const raw of records) {
    const record = asRecord(raw);
    if (number(record['tipoTienda']) !== TIPO_DIA) {
      clarelDropped += 1;
      continue;
    }
    const idTienda = idOf(record['idTienda']);
    const codigoTienda = idOf(record['codigoTienda']);
    const latitude = coordinate(record['posicionX']);
    const longitude = coordinate(record['posicionY']);
    const province = number(record['codigoProvincia']);
    if (
      !idTienda ||
      !codigoTienda ||
      latitude === null ||
      longitude === null ||
      province === null
    ) {
      unreadable.push(idTienda ?? codigoTienda ?? JSON.stringify(raw));
      continue;
    }
    stores.push({
      idTienda,
      codigoTienda,
      tipoTienda: TIPO_DIA,
      provinceCode: String(province).padStart(2, '0'),
      latitude,
      longitude,
    });
  }
  return { stores, total: records.length, clarelDropped, unreadable };
}

/**
 * One shop's detail, from
 * `/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id=<idTienda>`
 * (section 5.2). Null when the answer names no shop code.
 */
export function parseStoreDetail(json: unknown): DiaStoreDetail | null {
  const detail = asRecord(json);
  const storeCode = idOf(detail['tiendaCodigo']);
  if (!storeCode) {
    return null;
  }
  const holidays = {
    festivosTienda: detail['festivosTienda'],
    horariosAperturaFestivo: detail['horariosAperturaFestivo'],
  };
  const fresh = Array.isArray(detail['toolTipsPerecederos'])
    ? detail['toolTipsPerecederos'].filter(
        (entry): entry is string => typeof entry === 'string' && entry !== ''
      )
    : [];
  const leaflet = {
    folletoId: detail['folletoId'],
    documentoFolletoId: detail['documentoFolletoId'],
    validezFolleto2: detail['validezFolleto2'],
  };
  const hours = asRecord(detail['horariosTienda']);
  return {
    storeCode,
    street: text(detail['direccionPostal']),
    postalCode: postalCode(detail['codigoPostal']),
    city: text(detail['localidad']),
    phone: idOf(detail['telefono']),
    hours: Object.fromEntries(
      Object.entries(hours).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
    holidays:
      Array.isArray(holidays.festivosTienda) &&
      holidays.festivosTienda.length > 0
        ? JSON.stringify(holidays)
        : null,
    fresh: fresh.length > 0 ? fresh.join('; ') : null,
    homeDelivery:
      detail['servicioDomicilio'] === 1 || detail['servicioDomicilio'] === true,
    leaflet: leaflet.folletoId !== undefined ? JSON.stringify(leaflet) : null,
    reopensOn: isoDate(detail['fechaApertura']),
    closedFrom: text(detail['inicioCierreTemp']),
    closedUntil: text(detail['finCierreTemp']),
  };
}

/**
 * Whether a detail says the shop is temporarily closed (section 5.4): it names
 * a `fechaApertura` after `today`. The three city hubs read this way all year.
 */
export function isTemporarilyClosed(
  detail: DiaStoreDetail,
  today: Date
): boolean {
  return (
    detail.reopensOn !== null &&
    detail.reopensOn > today.toISOString().slice(0, 10)
  );
}

/**
 * The shops that may sit on a postal code, before any detail is read (section
 * 5.3).
 *
 * The file has no postal code and the server offers no search, so the file is
 * narrowed by two things it does hold: the province, which equals the first two
 * digits of a postal code, and the distance from the code's centroid. The
 * survivors are candidates only. The caller reads each detail and keeps the
 * shops whose own postal code is the requested one, exactly.
 */
export function candidatesNear(
  stores: readonly DiaStoreRecord[],
  postalCode: string,
  centroid: { latitude: number; longitude: number },
  radiusMetres: number = DIA_DEFAULT_POSTAL_CODE_RADIUS_METRES
): DiaStoreRecord[] {
  const province = postalCode.slice(0, 2);
  return stores.filter(
    (store) =>
      store.provinceCode === province &&
      distanceMetres(centroid, store) <= radiusMetres
  );
}

/** Great circle distance, in metres. */
export function distanceMetres(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function unpack(payload: Uint8Array | string): string {
  if (typeof payload === 'string') {
    return payload;
  }
  let bytes: Uint8Array = payload;
  // At most twice: once for the file, once for a transfer encoding left on.
  for (
    let pass = 0;
    pass < 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    pass += 1
  ) {
    bytes = gunzipSync(bytes);
  }
  return Buffer.from(bytes).toString('utf8');
}

/** `31/12/2026` as `2026-12-31`, or null. */
function isoDate(value: unknown): string | null {
  const match =
    typeof value === 'string'
      ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
      : null;
  return match
    ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
    : null;
}

function postalCode(value: unknown): string | null {
  const code = idOf(value);
  return code && /^\d{4,5}$/.test(code) ? code.padStart(5, '0') : null;
}

/** A number or a string, as a trimmed string. Ids arrive as either. */
function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return text(value);
}

function coordinate(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed !== 0
    ? parsed
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
