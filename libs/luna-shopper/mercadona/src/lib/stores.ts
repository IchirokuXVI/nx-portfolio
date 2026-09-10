import { isRecord, readNumber, readString, type Json } from './json';

/**
 * Mercadona's own store finder, which publishes every shop it has in one static
 * document (plan 0106).
 *
 * Plan 0038 section 2.8 concluded that a store list had to come from a radius
 * over OpenStreetMap. **That finding was about OpenStreetMap and it stays true
 * of OpenStreetMap.** It was never a finding about Mercadona's own data, and
 * Mercadona's has no such gaps: checked against the live document on 2026-09-11,
 * all 1,675 records carry a postal code and coordinates.
 *
 * The document is a JavaScript assignment rather than JSON, because the store
 * finder loads it with a `<script>` tag. A companion document states the counts
 * the chain believes it published, which is what lets a run check that it read
 * the whole file rather than assume it.
 */

/** Where the store finder reads its shops from. No key and no session. */
export const MERCADONA_STORES_URL =
  'https://storage.googleapis.com/pro-bucket-wcorp-files/json/data.js';

/** The companion document, holding one count per country. */
export const MERCADONA_STORES_TOTAL_URL =
  'https://storage.googleapis.com/pro-bucket-wcorp-files/json/data_total.js';

/**
 * One shop, as the chain states it.
 *
 * Every field is the source's own. There is **no store name in the document**,
 * so there is none here: a run that invented one from the town would be writing
 * a name the chain never published.
 */
export interface MercadonaStore {
  /** `id`, the chain's own store id, and therefore the `externalRef`. */
  externalRef: string;
  /** `cp`. Present on every record, five digits in Spain, `1234-567` in Portugal. */
  postalCode: string;
  /** `p`, lowercased: `es` or `pt`. */
  country: string;
  /** `dr`, the street line as printed. */
  street: string | null;
  /** `lc`, the town. */
  city: string | null;
  /** `pv`, the province, in the chain's own upper case. */
  province: string | null;
  latitude: number;
  longitude: number;
  /** `tf`. */
  phone: string | null;
  /** `pk`: whether the shop has parking. */
  parking: boolean | null;
  /** `lpc`: whether the shop has the ready to eat counter. */
  readyToEat: boolean | null;
  /** `fap`, the day the shop opened, verbatim as `DD/MM/YYYY`. */
  openedOn: string | null;
  /** `fs`, the special dates, verbatim. Never interpreted here. */
  specialDates: string | null;
  /**
   * The seven days of {@link MercadonaStoreList.publishedOn}'s window, as one
   * line in the shape OpenStreetMap writes them: `Mo-Sa 09:00-21:30; Su off`.
   *
   * **It is a dated window and not a weekly rule**, which is the same thing
   * LIDL's store list publishes. The document holds seven opening times and
   * seven closing times with no dates on them, and the first one belongs to the
   * day the document was written: on 2026-09-11, a Friday and Catalonia's
   * national day, 234 of the 235 Catalan shops were closed in the first slot
   * and no other province was. So a holiday inside the window reads here as a
   * weekday the shop closes, and an admin looking at the row is the one who
   * knows better. Nothing downstream may treat this as the shop's timetable.
   */
  openingHours: string | null;
}

/** Every shop the chain publishes, with the counts to check them against. */
export interface MercadonaStoreList {
  /** `fechaCreacion`, verbatim as `DD-MM-YYYY`, so a report can say how fresh it was. */
  publishedOn: string | null;
  stores: MercadonaStore[];
  /**
   * What the companion document says the counts are, per country, upper case.
   *
   * **A count that disagrees is a warning and not a failure.** The two documents
   * are written by different jobs, and a run that read 1,598 of a declared 1,599
   * has still found 1,598 real shops.
   */
  declared: Record<string, number>;
}

/**
 * The store document, parsed.
 *
 * A record with no id, no postal code or no position is dropped: a place needs
 * somewhere to be, and a shop with no postal code cannot be asked what it is
 * priced by. Not one of the 1,675 records was missing any of them.
 */
export function parseStoreDocument(text: string): {
  publishedOn: string | null;
  stores: MercadonaStore[];
} {
  const document = parseJsAssignment(text);
  const publishedOn = readString(document, 'fechaCreacion');
  const raw = isRecord(document) ? document['tiendasFull'] : null;
  const stores: MercadonaStore[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const store = normalizeStore(item, publishedOn);
    if (store) {
      stores.push(store);
    }
  }
  return { publishedOn, stores };
}

/** The companion document's counts, keyed by the country codes it uses. */
export function parseStoreTotals(text: string): Record<string, number> {
  const document = parseJsAssignment(text);
  const stores = isRecord(document) ? document['stores'] : null;
  const declared: Record<string, number> = {};
  if (isRecord(stores)) {
    for (const [country, count] of Object.entries(stores)) {
      const value = typeof count === 'number' ? count : Number(count);
      if (Number.isFinite(value)) {
        declared[country.trim().toUpperCase()] = value;
      }
    }
  }
  return declared;
}

/** One record, or null when it states no id, no postal code or no position. */
export function normalizeStore(
  item: Json,
  publishedOn: string | null
): MercadonaStore | null {
  const externalRef = readString(item, 'id');
  const postalCode = readString(item, 'cp');
  const latitude = readNumber(item, 'lt');
  const longitude = readNumber(item, 'lg');
  if (!externalRef || !postalCode || latitude === null || longitude === null) {
    return null;
  }
  return {
    externalRef,
    postalCode,
    country: (readString(item, 'p') ?? '').toLowerCase(),
    street: readString(item, 'dr'),
    city: readString(item, 'lc'),
    province: readString(item, 'pv'),
    latitude,
    longitude,
    phone: readString(item, 'tf'),
    parking: readFlag(item, 'pk'),
    readyToEat: readFlag(item, 'lpc'),
    openedOn: readString(item, 'fap'),
    specialDates: readString(item, 'fs'),
    openingHours: openingHoursLine(
      publishedOn,
      readString(item, 'in'),
      readString(item, 'fi')
    ),
  };
}

/**
 * The window as one line, `Mo-Sa 09:00-21:30; Su off`.
 *
 * The two strings hold seven `#` separated slots each, an opening time and a
 * closing time in local wall clock `HHMM`, and `C` for a day the shop does not
 * open. They carry no dates, so the weekday of each slot is counted from the
 * day the document was written; without that date there is nothing to count
 * from and this answers null rather than guessing Monday.
 */
export function openingHoursLine(
  publishedOn: string | null,
  opens: string | null,
  closes: string | null
): string | null {
  const first = parsePublishedOn(publishedOn);
  if (first === null || !opens) {
    return null;
  }
  const opening = opens.split('#');
  const closing = (closes ?? '').split('#');

  // Monday first, which is how a week is written, and the first slot the window
  // holds for a weekday wins: a window of seven days holds each one once.
  const byDay = new Map<number, string>();
  for (let slot = 0; slot < opening.length; slot += 1) {
    const hours = hoursOf(opening[slot], closing[slot]);
    if (hours === null) {
      continue;
    }
    const date = new Date(first.getTime() + slot * 86_400_000);
    const index = (date.getUTCDay() + 6) % 7;
    if (!byDay.has(index)) {
      byDay.set(index, hours);
    }
  }
  if (byDay.size === 0) {
    return null;
  }

  const parts: string[] = [];
  let run: { from: number; to: number; hours: string } | null = null;
  for (const [index, hours] of [...byDay.entries()].sort(([a], [b]) => a - b)) {
    if (run && run.hours === hours && index === run.to + 1) {
      run.to = index;
      continue;
    }
    if (run) {
      parts.push(formatRun(run));
    }
    run = { from: index, to: index, hours };
  }
  if (run) {
    parts.push(formatRun(run));
  }
  return parts.join('; ');
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function formatRun(run: { from: number; to: number; hours: string }): string {
  const label =
    run.from === run.to
      ? WEEKDAYS[run.from]
      : `${WEEKDAYS[run.from]}-${WEEKDAYS[run.to]}`;
  return `${label} ${run.hours}`;
}

/** `0900` and `2130` to `09:00-21:30`. `C` on either side is a closed day. */
function hoursOf(
  open: string | undefined,
  close: string | undefined
): string | null {
  const from = clockOf(open);
  const to = clockOf(close);
  if (open?.trim() === 'C' || close?.trim() === 'C') {
    return 'off';
  }
  return from && to ? `${from}-${to}` : null;
}

function clockOf(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return /^\d{4}$/.test(value)
    ? `${value.slice(0, 2)}:${value.slice(2)}`
    : null;
}

/** `11-09-2026` as a UTC day, which is all the weekday count needs. */
function parsePublishedOn(published: string | null): Date | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(published?.trim() ?? '');
  if (!match) {
    return null;
  }
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The chain's own booleans, `S` and `N`. Anything else is unstated. */
function readFlag(item: Json, key: string): boolean | null {
  const value = readString(item, key)?.toUpperCase();
  if (value === 'S') {
    return true;
  }
  return value === 'N' ? false : null;
}

/**
 * `var dataJson={...}` to the object it assigns.
 *
 * The store finder loads the document with a `<script>` tag, so it is a
 * JavaScript statement and not JSON. Only the assignment is stripped and the
 * rest is parsed as JSON: nothing here evaluates the file, because a document
 * fetched from a third party is not code this process may run.
 *
 * The companion document is plain JSON with no assignment at all, which is why
 * the prefix is optional.
 */
function parseJsAssignment(text: string): Json {
  const body = text
    .trim()
    .replace(/^(?:var|let|const)?\s*[A-Za-z_$][\w$]*\s*=\s*/, '')
    .replace(/;\s*$/, '');
  try {
    return JSON.parse(body) as Json;
  } catch {
    throw new Error(
      "Mercadona's store document did not parse as JSON. The store finder " +
        'assigns one object and this reader strips only that assignment, so a ' +
        'failure here means the document changed shape.'
    );
  }
}
