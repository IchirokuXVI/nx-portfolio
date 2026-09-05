import {
  formatCurrencyAmount,
  toOfficialSourceKind,
  toSourceEntryMatch,
  toSourceEntryStatus,
  type OfficialSourceKind,
  type SourceEntryMatch,
  type SourceEntryStatus,
} from '@portfolio/luna-shopper-admin/models';
import { formatInstant } from './format-instant';

/**
 * One row of `source_catalog_entries`, as the one queue draws it (admin plan
 * 0014, sections 1 and 4).
 *
 * It replaces `alias-view.ts` and `ref-view.ts`, which is the whole of that
 * plan: `0086` folded `item_source_refs` and `source_aliases` into one table
 * with one status column, so the three view models over them are one.
 *
 * **Mapped from `unknown`, and this one really is** (rule D4). Plan 0004 section
 * 2 lets the gateway's shapes be this app's view models, and that exception
 * still stands for the pages that hand a wire row straight to a template. It
 * does not help here, because half of what the queue draws is a decision rather
 * than a column: which of the four badges a row wears, whether there is a
 * proposal and what kind, what a price line reads as, and whether `extra` has
 * anything in it. Those are computed once, here, where a spec can call them.
 *
 * It lives in this library rather than in `models`, which is where a view model
 * would normally go, because `formatInstant` lives here and a second copy of it
 * in `models` would be the one nothing exercises. `ShopRow` and `SourceAliasRow`
 * were both placed the same way.
 */
export interface SourceEntryRow {
  readonly id: string;
  readonly supermarketId: string;

  /**
   * The chain's own name for the product, verbatim and never rewritten.
   *
   * The owner's rule and the reason the column exists (backend plan 0086, D8):
   * accepting sets `itemId` and never touches this, so renaming the product does
   * not stop the next run resolving.
   */
  readonly name: string;
  readonly brand: string;
  readonly ean: string;
  readonly sizeFormat: string;
  /** The chain's own id for the product, or the key a keyless source gets. */
  readonly externalId: string;
  readonly categoryPath: string;
  readonly url: string;

  /**
   * API, web or leaflet.
   *
   * The one thing that tells a Mercadona product from a Mercadona leaflet tile
   * of the same product, and the two are two rows on purpose. `null` for a kind
   * this app does not know, which draws no badge rather than a wrong one.
   */
  readonly sourceKind: OfficialSourceKind | null;
  readonly status: SourceEntryStatus;
  readonly matchedBy: SourceEntryMatch | null;
  /** How sure the ladder was, 0 to 100. */
  readonly confidence: number;
  /** How many runs have observed this key. */
  readonly timesSeen: number;

  /**
   * The product the ladder proposed, or `''`.
   *
   * Preselected in the picker when there is one, so agreeing with a proposal is
   * one press.
   */
  readonly itemId: string;
  /**
   * A sibling row of this chain the fuzzy rung proposed instead, or `''`.
   *
   * When there is one the primary action is to open it rather than to accept
   * here, because the sibling is the one with the EAN and the one to create the
   * item from.
   */
  readonly candidateEntryId: string;

  /** One line per scope, newest window first. Empty is a statement, not a gap. */
  readonly prices: readonly SourceEntryPriceLine[];
  /** Whatever the producer put in the bag, as key and value. Folded by default. */
  readonly extra: readonly SourceEntryExtraLine[];

  readonly lastSeen: string;
  /** The run that last observed it, for a link. `''` when the row predates one. */
  readonly lastRunId: string;
}

/**
 * What one scope says this row costs (backend plan 0086, section 3.2).
 *
 * One line per scope rather than one price on the row, which is the change that
 * made the table worth splitting: two regional leaflets print the same product
 * and each price belongs to its own scope, and a single price column had to pick
 * one of them.
 */
export interface SourceEntryPriceLine {
  readonly scopeId: string;
  /** Already formatted, with the price's own currency. */
  readonly price: string;
  /** The comparison figure with the label the source printed. `''` when none. */
  readonly unitPrice: string;
  /** The window, as two dates. `''` for a storefront price, which has none. */
  readonly window: string;
  /** When the window closes, raw, which is what decides whether it still counts. */
  readonly validUntil: string | null;
}

/** One entry of the producer's own bag. */
export interface SourceEntryExtraLine {
  readonly key: string;
  /** A scalar as words, anything else as indented JSON. */
  readonly value: string;
}

/**
 * A row off the wire, or `null` when it is not a row at all.
 *
 * `null` rather than a throw: a mapper that throws inside a list read takes the
 * whole page down over one bad row, and a queue that shows nine rows and drops
 * the tenth is better than one that shows a failure. The caller filters.
 */
export function toSourceEntryRow(
  value: unknown,
  locale?: string
): SourceEntryRow | null {
  const entry = asRecord(value);
  if (entry === null || typeof entry['id'] !== 'string') {
    return null;
  }

  return {
    id: entry['id'],
    supermarketId: asText(entry['supermarketId']),
    name: asText(entry['name']),
    brand: asText(entry['brand']),
    ean: asText(entry['ean']),
    sizeFormat: asText(entry['sizeFormat']),
    externalId: asText(entry['externalId']),
    categoryPath: Array.isArray(entry['categoryPath'])
      ? entry['categoryPath']
          .filter((part): part is string => typeof part === 'string')
          .join(' / ')
      : '',
    url: asText(entry['url']),
    sourceKind: toOfficialSourceKind(entry['sourceKind']),
    status: toSourceEntryStatus(entry['status']),
    matchedBy: toSourceEntryMatch(entry['matchedBy']),
    confidence: percent(entry['confidence']),
    timesSeen: asCount(entry['timesSeen']),
    itemId: asText(entry['itemId']),
    candidateEntryId: asText(entry['candidateEntryId']),
    prices: readPrices(entry['prices'], locale),
    extra: readExtra(entry['extra']),
    lastSeen: formatInstant(asText(entry['lastSeenAt']) || null, locale),
    lastRunId: asText(entry['lastRunId']),
  };
}

/**
 * What the ladder proposed about this row, as one of three answers.
 *
 * Three rather than two because the primary action differs: a row with an item
 * proposal is confirmed here, a row with a sibling proposal sends the operator
 * to the sibling, and a row with neither needs a product picking first.
 */
export type EntryProposal = 'item' | 'sibling' | 'none';

export function proposalOf(row: SourceEntryRow): EntryProposal {
  if (row.itemId !== '') {
    return 'item';
  }
  return row.candidateEntryId === '' ? 'none' : 'sibling';
}

function readPrices(
  value: unknown,
  locale: string | undefined
): readonly SourceEntryPriceLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readPrice(entry, locale))
    .filter((line): line is SourceEntryPriceLine => line !== null);
}

function readPrice(
  value: unknown,
  locale: string | undefined
): SourceEntryPriceLine | null {
  const price = asRecord(value);
  if (price === null) {
    return null;
  }

  const currency = asText(price['currency']) || null;
  const label = asText(price['unitPriceLabel']);
  const unit = formatCurrencyAmount(
    asNumber(price['unitPrice']),
    currency,
    locale
  );
  const from = asText(price['validFrom']);
  const until = asText(price['validUntil']);

  return {
    scopeId: asText(price['priceScopeId']),
    price: formatCurrencyAmount(asNumber(price['price']), currency, locale),
    unitPrice: unit === '' || label === '' ? unit : `${unit} / ${label}`,
    window: formatWindow(from, until, locale),
    validUntil: until === '' ? null : until,
  };
}

/**
 * A window as two days, or one, or nothing.
 *
 * A leaflet states both bounds and a storefront price states neither, and the
 * cell is drawn only when there is something in it, which is the same rule the
 * run's own facts follow. The time of day is left off: a leaflet is valid for
 * days, and the minute its window opens is noise on a queue row.
 */
function formatWindow(
  from: string,
  until: string,
  locale: string | undefined
): string {
  const start = formatDay(from, locale);
  const end = formatDay(until, locale);

  if (start === '' && end === '') {
    return '';
  }
  if (start === '') {
    return end;
  }
  if (end === '') {
    return start;
  }
  return `${start} - ${end}`;
}

function formatDay(value: string, locale: string | undefined): string {
  if (value === '') {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

/**
 * The producer's bag, flattened one level.
 *
 * One level and no further, on purpose: a leaflet's `raw_text` is an array of
 * lines and a promotion is an object, and both read better as indented JSON
 * under their own key than as a tree this screen invented a shape for. The
 * harvester never reads any of it (backend plan 0086, section 6.1), so nothing
 * here may pretend to know what a key means.
 */
function readExtra(value: unknown): readonly SourceEntryExtraLine[] {
  const extra = asRecord(value);
  if (extra === null) {
    return [];
  }

  return Object.entries(extra).map(([key, entry]) => ({
    key,
    value:
      entry === null || typeof entry !== 'object'
        ? String(entry)
        : JSON.stringify(entry, null, 2),
  }));
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** A 0 to 1 confidence as whole percent, with anything else reading as none. */
function percent(value: unknown): number {
  const confidence = asNumber(value);
  return confidence === null
    ? 0
    : Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}
