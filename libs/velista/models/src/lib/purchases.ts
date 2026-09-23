/**
 * What one person bought, with or without a basket (velista `0095`, backend `0142`).
 *
 * The history used to be a list of baskets, so a person who shops from the basket that
 * is always there, or straight from a zone list, had an empty one. These are the shapes
 * of the history that replaced it: a finished basket is a named entry, and every other
 * purchase is grouped into a **session** by a six hour silence. The "Bought" tab of the
 * shopping lists page draws them.
 */

/**
 * `BASKET` or `SESSION`, upper case on the wire.
 *
 * Unknown falls back to `SESSION`: a session is labelled by its date alone, so a kind
 * this build has never heard of still draws a label that claims nothing about a basket.
 */
export const PURCHASE_ENTRY_KINDS = ['BASKET', 'SESSION'] as const;
export type PurchaseEntryKind = (typeof PURCHASE_ENTRY_KINDS)[number];
export const PURCHASE_ENTRY_KIND_FALLBACK: PurchaseEntryKind = 'SESSION';

/**
 * What an entry cost, and what the amount does not cover.
 *
 * **Never a total that pretends to be complete.** A screen prints the amount beside
 * {@link unpricedCount} whenever that number is above zero.
 */
export interface PurchaseSpend {
  /** The sum of unit price times quantity over the purchases that had a price. */
  readonly cents: number;
  readonly currency: string;
  /** Bought lines with no recorded price. The amount above says nothing about them. */
  readonly unpricedCount: number;
}

/** One entry of the history: a finished basket, or a session. */
export interface PurchaseEntry {
  /** A basket's id, or the id of a session's earliest purchase. */
  readonly id: string;
  readonly kind: PurchaseEntryKind;
  /** A finished basket's name. Null for a session and for an unnamed basket. */
  readonly name: string | null;
  readonly startedAt: Date;
  /** How many purchases the entry holds: the lines it bought something of. */
  readonly purchaseCount: number;
  /**
   * Null when no purchase of the entry had a price, and also when the server could
   * not add its prices up (two currencies). Either way there is no amount to print.
   */
  readonly spend: PurchaseSpend | null;
  /**
   * Bought lines with no recorded price, served even when {@link spend} is null, so an
   * entry with no amount can still say why.
   */
  readonly unpricedCount: number;
}

/** One row of an entry: what was bought, how many, and at what price each. */
export interface PurchaseEntryRow {
  readonly id: string;
  /** Null when the reader can no longer read the list it was on (backend `0142`). */
  readonly content: string | null;
  readonly itemId: string | null;
  readonly quantity: number;
  /** What **one unit** cost, or null when nothing recorded it. */
  readonly unitPriceCents: number | null;
  /** Null exactly when {@link unitPriceCents} is. */
  readonly currency: string | null;
  /** Served only for a list the reader can still read. */
  readonly listName: string | null;
}

/** A page of entries, newest first. */
export interface PurchaseEntryPage {
  readonly items: readonly PurchaseEntry[];
  readonly nextCursor: string | null;
}

/**
 * An entry's identity on the page.
 *
 * The kind is part of it, because a basket id and a settlement id are drawn from two
 * tables and nothing promises they never meet.
 */
export function purchaseEntryKey(
  entry: Pick<PurchaseEntry, 'kind' | 'id'>
): string {
  return `${entry.kind}:${entry.id}`;
}

/** The `:kind` segment of the rows route, which is lower case. */
export function purchasePathKind(
  kind: PurchaseEntryKind
): 'basket' | 'session' {
  return kind === 'BASKET' ? 'basket' : 'session';
}

/**
 * An amount in a currency's minor unit, as the major unit `Intl` formats.
 *
 * The number of minor digits is the currency's own, read from `Intl`, so a yen amount
 * is not divided by a hundred. An unknown code falls back to two digits.
 */
export function fromMinorUnits(cents: number, currency: string): number {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  return cents / 10 ** digits;
}

/** How many entries a page asks for. */
export const PURCHASES_PAGE_SIZE = 20;

/** How many rows one read of an entry asks for. */
export const PURCHASE_ROWS_PAGE_SIZE = 100;

/** How long a burst of settles gathers before the first page is read again. */
export const PURCHASES_REFETCH_QUIET_MS = 1500;
