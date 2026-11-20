import {
  LINE_UNIT_FALLBACK,
  LINE_UNITS,
  PURCHASE_ENTRY_KIND_FALLBACK,
  PURCHASE_ENTRY_KINDS,
  type LineUnit,
  type PurchaseEntry,
  type PurchaseEntryPage,
  type PurchaseEntryRow,
  type PurchaseSpend,
} from '@portfolio/velista/models';
import {
  date,
  isRecord,
  mapArray,
  nullableStr,
  numOr,
  oneOf,
  str,
} from '../mapping/primitives';

/**
 * From `PurchaseEntryView` (backend `0142`, section 3). Rule D4: from `unknown`.
 *
 * The id and the date are required, because an entry without an id cannot open and one
 * without a date cannot be labelled or ordered. An unknown kind is a session.
 */
export function toPurchaseEntry(raw: unknown): PurchaseEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const startedAt = date(raw['startedAt']);
  if (id === null || id === '' || startedAt === null) {
    return null;
  }

  const kind = oneOf(
    raw['kind'],
    PURCHASE_ENTRY_KINDS,
    PURCHASE_ENTRY_KIND_FALLBACK
  );
  const unpricedCount = count(raw['unpricedCount']);

  return {
    id,
    kind,
    name: kind === 'BASKET' ? nullableStr(raw['name']) : null,
    startedAt,
    // `anyBoughtLineCount` since backend 0159, which renamed it from
    // `boughtLineCount` because a trip counts something else under that name.
    purchaseCount: count(raw['anyBoughtLineCount']),
    bought: toBoughtByUnit(raw['bought']),
    // Only a JSON `true` is an estimate (velista `0182`): a server before backend
    // `0246` priced counts alone.
    spend: toSpend(raw['spent'], unpricedCount, raw['estimated'] === true),
    unpricedCount,
  };
}

/** From `PurchaseEntryPage`. A malformed entry is dropped, not the page. */
export function toPurchaseEntryPage(raw: unknown): PurchaseEntryPage {
  if (!isRecord(raw)) {
    return { items: [], nextCursor: null };
  }

  return {
    items: mapArray(raw['items'], toPurchaseEntry),
    nextCursor: nullableStr(raw['nextCursor']),
  };
}

/**
 * From `PurchaseRowView` (backend `0142`, section 4).
 *
 * The id is required, because it is the row's identity. A price with no currency is no
 * price: an amount in no currency cannot be printed honestly.
 */
export function toPurchaseEntryRow(raw: unknown): PurchaseEntryRow | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  if (id === null || id === '') {
    return null;
  }

  const price = toMoney(raw['pricePaid']);
  return {
    id,
    content: nullableStr(raw['content']),
    itemId: nullableStr(raw['itemId']),
    quantity: count(raw['quantity']),
    unit: oneOf(raw['unit'], LINE_UNITS, LINE_UNIT_FALLBACK),
    estimated: raw['estimated'] === true,
    unitPriceCents: price?.cents ?? null,
    currency: price?.currency ?? null,
    listName: nullableStr(raw['listName']),
  };
}

/** An amount and its currency, or null when either is missing. */
function toMoney(raw: unknown): { cents: number; currency: string } | null {
  if (!isRecord(raw)) {
    return null;
  }

  const cents = raw['cents'];
  const currency = str(raw['currency']);
  if (
    typeof cents !== 'number' ||
    !Number.isFinite(cents) ||
    currency === null ||
    currency.trim() === ''
  ) {
    return null;
  }
  return { cents: Math.round(cents), currency };
}

function toSpend(
  raw: unknown,
  unpricedCount: number,
  estimated: boolean
): PurchaseSpend | null {
  const money = toMoney(raw);
  return money === null ? null : { ...money, unpricedCount, estimated };
}

/**
 * What an entry bought, per unit (velista `0182`, backend `0246` section 3.5).
 * A unit this build does not know, a count that is not a number and a zero are
 * left out, so an entry that bought nothing is `{}`.
 */
function toBoughtByUnit(raw: unknown): Partial<Record<LineUnit, number>> {
  if (!isRecord(raw)) {
    return {};
  }
  const bought: Partial<Record<LineUnit, number>> = {};
  for (const unit of LINE_UNITS) {
    const amount = count(raw[unit]);
    if (amount > 0) {
      bought[unit] = amount;
    }
  }
  return bought;
}

function count(raw: unknown): number {
  return Math.max(0, Math.trunc(numOr(raw, 0)));
}
