import { categoryPathOf, resolveCategory } from './categories';
import {
  asString,
  isRecord,
  readArray,
  readBoolean,
  readDate,
  readNumber,
  readRecord,
  readString,
  type Json,
} from './json';
import { parseSize } from './size';
import {
  LIDL_BASE_URL,
  type LidlListRow,
  type LidlProduct,
  type LidlRegion,
  type LidlRegionPrice,
  type LidlStore,
} from './types';

/**
 * Raw JSON in, plain records out (plan 0089, section 6). Pure, and where the
 * tests live.
 *
 * Nothing here fetches, and nothing here decides what a run does with what it
 * reads. Every function takes a value nobody promised us and answers with a
 * shape the harvester can write, treating a missing or wrongly typed field as
 * absent rather than throwing part way through a run.
 */

/** What the index answered: the rows of one page, and the size of the whole. */
export interface LidlListPage {
  rows: LidlListRow[];
  /** `numFound`: how many rows the whole query holds. Null when unstated. */
  total: number | null;
  offset: number | null;
  fetchsize: number | null;
}

/** One page of `/q/api/search`. */
export function normalizeListPage(payload: Json): LidlListPage {
  const rows: LidlListRow[] = [];
  for (const item of readArray(payload, 'items')) {
    // Every row is wrapped in the component the storefront renders it with, so
    // a row of any other kind carries no `gridbox` and is skipped rather than
    // read as an empty product.
    const data = readRecord(readRecord(item, 'gridbox'), 'data');
    const row = normalizeListRow(data);
    if (row) {
      rows.push(row);
    }
  }
  return {
    rows,
    total: readNumber(payload, 'numFound'),
    offset: readNumber(payload, 'offset'),
    fetchsize: readNumber(payload, 'fetchsize'),
  };
}

/** One row of the index, or null when it carries no id to join on. */
export function normalizeListRow(data: Json): LidlListRow | null {
  const externalId =
    readString(data, 'productId') ?? readString(data, 'itemId');
  if (!externalId) {
    return null;
  }
  const keyfacts = readRecord(data, 'keyfacts');
  const price = readRecord(data, 'price');
  const name =
    readString(keyfacts, 'title') ??
    readString(data, 'fullTitle') ??
    readString(keyfacts, 'fullTitle') ??
    readString(data, 'title');
  return {
    externalId,
    name: name ?? '',
    brand: brandOf(readString(readRecord(data, 'brand'), 'name')),
    siteCategory: readString(data, 'category') ?? '',
    categoryPath: categoryPathOf(readString(keyfacts, 'wonCategoryPrimary')),
    path: readString(data, 'canonicalPath'),
    sizeFormat: readString(readRecord(price, 'packaging'), 'text'),
    listPrice: readNumber(price, 'price'),
    ian: firstString(readArray(data, 'ians')),
  };
}

export interface NormalizeProductOptions {
  /** The index row this product was reached from. It carries the brand. */
  row: LidlListRow;
  observedAt: Date;
  /** Where relative paths are resolved against. */
  baseUrl?: string;
}

/**
 * One product, from the state its own page carries.
 *
 * The page is where `eans` and `regionsV2` live, and they are the two fields
 * that make this source worth a request per product: the EAN resolves a product
 * with no admin, and the region map is what a price belongs to.
 */
export function normalizeProduct(
  state: Json,
  options: NormalizeProductOptions
): LidlProduct | null {
  if (!isRecord(state)) {
    return null;
  }
  const { row } = options;
  const baseUrl = (options.baseUrl ?? LIDL_BASE_URL).replace(/\/+$/, '');
  const keyfacts = readRecord(state, 'keyfacts');
  const storeFacts = readRecord(state, 'storeFacts');
  const path = readString(state, 'canonicalPath') ?? row.path;
  const categoryPath = pickPath(
    categoryPathOf(readString(keyfacts, 'wonCategoryPrimary')),
    row.categoryPath
  );
  const identifiers = readIdentifiers(readArray(state, 'eans'));
  const sizeFormat =
    readString(readRecord(readRecord(state, 'price'), 'packaging'), 'text') ??
    row.sizeFormat;
  const size = parseSize(sizeFormat);

  return {
    externalId: row.externalId,
    name:
      readString(keyfacts, 'title') ??
      readString(keyfacts, 'fullTitle') ??
      row.name,
    brand:
      brandOf(readString(readRecord(readRecord(state, 'info'), 'brand'), 'name')) ??
      row.brand,
    ean: identifiers.ean,
    shortCode: identifiers.shortCode,
    ian: firstString(readArray(state, 'ians')) ?? row.ian,
    siteCategory: readString(state, 'category') ?? row.siteCategory,
    categoryPath,
    category: resolveCategory(categoryPath),
    unitSize: size?.unitSize ?? null,
    unit: size?.unit ?? null,
    sizeFormat,
    url: path ? `${baseUrl}${path}` : null,
    // Section 5's clean predicate. Both halves are read, because the first is
    // true of every in-store row and it is the second that removes the online
    // shop a shop happens to stock.
    inStore:
      readBoolean(storeFacts, 'retail') === true &&
      readBoolean(storeFacts, 'online') === false,
    prices: normalizeRegionPrices(state),
    observedAt: options.observedAt,
  };
}

/**
 * Every price the product publishes, one entry per distinct price, with the
 * regions that pay it (section 4).
 *
 * **A region whose price id has no current price is dropped.** It is an
 * observation of absence and not a price of zero: most products publish nothing
 * for the five Canary regions, and writing the mainland figure there would show
 * a shopper in Las Palmas a price the chain never published.
 */
export function normalizeRegionPrices(state: Json): LidlRegionPrice[] {
  const regionsV2 = readRecord(state, 'regionsV2');
  const regionsPrices = readRecord(state, 'regionsPrices');

  const byPriceId = new Map<string, LidlRegion[]>();
  for (const [regionId, meta] of Object.entries(regionsV2)) {
    const priceId = readString(meta, 'regionPriceId');
    if (!priceId) {
      continue;
    }
    const region: LidlRegion = {
      id: regionId,
      name: readString(meta, 'regionName'),
    };
    const held = byPriceId.get(priceId);
    if (held) {
      held.push(region);
    } else {
      byPriceId.set(priceId, [region]);
    }
  }

  const prices: LidlRegionPrice[] = [];
  for (const [priceId, regions] of byPriceId) {
    const current = readRecord(readRecord(regionsPrices, priceId), 'currentPrice');
    const price = readNumber(current, 'price');
    if (price === null) {
      continue;
    }
    prices.push({
      priceId,
      regions,
      price,
      oldPrice: readNumber(current, 'oldPrice'),
      currency: readString(current, 'currencyCode') ?? 'EUR',
      // Next week's window is already published, and it is written with the
      // date it starts on rather than held back: plan 0080 decides on read
      // whether a price applies.
      validFrom: readDate(current, 'startDate'),
      validUntil: readDate(current, 'endDate'),
      sizeFormat: readString(readRecord(current, 'packaging'), 'text'),
    });
  }
  return prices;
}

/** What the store service answered: the shops of one page, and the total. */
export interface LidlStorePage {
  stores: LidlStore[];
  total: number | null;
}

export function normalizeStorePage(payload: Json): LidlStorePage {
  const stores: LidlStore[] = [];
  for (const item of readArray(payload, 'items')) {
    const store = normalizeStore(item);
    if (store) {
      stores.push(store);
    }
  }
  return { stores, total: readNumber(readRecord(payload, 'meta'), 'total') };
}

/** One shop, or null when it states no position: a place needs one to exist. */
export function normalizeStore(item: Json): LidlStore | null {
  const externalRef = readString(item, 'objectNumber');
  const address = readRecord(item, 'address');
  const latitude = readNumber(address, 'latitude');
  const longitude = readNumber(address, 'longitude');
  if (!externalRef || latitude === null || longitude === null) {
    return null;
  }
  const marketing = readRecord(item, 'marketingData');
  return {
    externalRef,
    name: readString(item, 'storeName'),
    street: joinStreet(
      readString(address, 'streetName'),
      readString(address, 'streetNumber')
    ),
    city: readString(address, 'city'),
    postalCode: readString(address, 'zip'),
    state: readString(address, 'state'),
    latitude,
    longitude,
    regionId: readString(marketing, 'offerRegion'),
    regionName: readString(marketing, 'offerRegionName'),
    zone: readString(marketing, 'zone'),
    openingHours: openingHoursLine(readRecord(item, 'openingHours')),
  };
}

/**
 * The week's opening hours as one line, in the shape OSM writes them:
 * `Mo-Sa 09:00-21:30; Su off`.
 *
 * The service answers with the next seven dated days rather than a weekly rule,
 * which is one of each weekday, so the days are read back as weekdays and runs
 * of identical hours are collapsed. A shop whose week is irregular keeps every
 * day it stated; nothing is invented and nothing is averaged.
 */
export function openingHoursLine(openingHours: Json): string | null {
  const days: { day: number; hours: string }[] = [];
  for (const item of readArray(openingHours, 'items')) {
    const date = readString(item, 'date');
    if (!date) {
      continue;
    }
    const at = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(at.getTime())) {
      continue;
    }
    const ranges = readArray(item, 'timeRanges')
      .map((range) => {
        const from = clockOf(readString(range, 'from'));
        const to = clockOf(readString(range, 'to'));
        return from && to ? `${from}-${to}` : null;
      })
      .filter((range): range is string => range !== null);
    days.push({
      day: at.getUTCDay(),
      hours: ranges.length > 0 ? ranges.join(',') : 'off',
    });
  }
  if (days.length === 0) {
    return null;
  }

  // Monday first, which is how a week is written, and one entry per weekday: a
  // seven day window that repeated a day would otherwise write it twice.
  const byDay = new Map<number, string>();
  for (const { day, hours } of days) {
    const index = (day + 6) % 7;
    if (!byDay.has(index)) {
      byDay.set(index, hours);
    }
  }
  const ordered = [...byDay.entries()].sort(([a], [b]) => a - b);

  const parts: string[] = [];
  let run: { from: number; to: number; hours: string } | null = null;
  for (const [index, hours] of ordered) {
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

/** `2026-09-07T09:00:00` to `09:00`. The service prints local wall clock time. */
function clockOf(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const match = /T(\d{2}:\d{2})/.exec(raw);
  return match ? match[1] : null;
}

/**
 * The EAN and the code that is not one (section 7).
 *
 * **The rule is a length check.** 15% of products carry an eight digit code
 * such as `20603373`, which is LIDL's own number for a weight item. Writing it
 * into the EAN column would collide with a real EAN-8 from another chain, so it
 * is kept beside the row for an admin to look at and never written as an EAN.
 */
function readIdentifiers(eans: readonly Json[]): {
  ean: string | null;
  shortCode: string | null;
} {
  let ean: string | null = null;
  let shortCode: string | null = null;
  for (const raw of eans) {
    const value = asString(raw);
    if (!value || !/^\d+$/.test(value)) {
      continue;
    }
    if (value.length === 13) {
      ean ??= value;
    } else {
      shortCode ??= value;
    }
  }
  return { ean, shortCode };
}

/** A path the product page states, else the one the index stated. */
function pickPath(fromPage: string[], fromRow: string[]): string[] {
  return fromPage.length > 0 ? fromPage : fromRow;
}

/** `-` is how the index prints "no brand", and it is not a brand. */
function brandOf(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed === '' || trimmed === '-' ? null : trimmed;
}

function firstString(values: readonly Json[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function joinStreet(name: string | null, number: string | null): string | null {
  const street = [name, number]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    // The service prints `Avda. Madrid,` with the comma the number follows.
    .replace(/,\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return street.length > 0 ? street : null;
}
