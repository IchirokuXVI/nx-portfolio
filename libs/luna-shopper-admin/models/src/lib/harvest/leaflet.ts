/**
 * A leaflet document, read in the browser (admin plan 0010, section 2).
 *
 * **This is the one place in this app where rule D4 applies in full.** Plan 0004
 * section 2 lets the gateway's own shapes be the view models, because the
 * OpenAPI document describes them and a stale one is a red test. A leaflet is
 * not one of those: it is a file an operator drops in, produced outside this
 * repository by `tmp/leaflet`, and the gateway describes it as
 * `{ [key: string]: unknown }` and nothing more. So every field read here is
 * read off `unknown` and checked, and a document that disagrees produces an
 * empty cell rather than a crash halfway down a preview table.
 *
 * Nothing here validates. The versioned schema lives in
 * `libs/luna-shopper/contracts` and the gateway is what answers against it
 * (backend plan 0081, section 4). What this file does is read enough of a
 * well formed document to show the operator what they are about to send, and
 * enough of a malformed one to say which offer the gateway objected to. A
 * second copy of the schema here would be a second thing to keep current, and
 * the one that drifted would be the one nothing exercises.
 *
 * The document is never edited and never stored. An edited document has a
 * different digest, and the digest is what the backend dedupes on.
 */

import { formatCurrencyAmount } from '../resource/money';

/** Why a dropped file could not be read at all. */
export type LeafletRejection = 'not-json' | 'not-a-document';

/** A dropped file, read or refused. */
export type LeafletParse =
  | { readonly ok: true; readonly leaflet: Leaflet }
  | { readonly ok: false; readonly reason: LeafletRejection };

/** A document the page is holding, with what it needs already read off it. */
export interface Leaflet {
  /** Exactly what was in the file, sent back byte for byte. */
  readonly document: Readonly<Record<string, unknown>>;
  readonly summary: LeafletSummary;
  readonly offers: readonly LeafletOfferRow[];
}

/**
 * What was read, shown before anything is chosen (section 2, step 2).
 *
 * Before the chain and the scope, on purpose: a wrong file is obvious from the
 * retailer's name and the page count, and finding that out after picking a
 * chain and two dates is finding it out too late.
 */
export interface LeafletSummary {
  readonly retailerName: string;
  /**
   * The extractor's own slug for the chain.
   *
   * **Displayed and never used to pick anything** (backend plan 0081, section
   * 4). Two extractors spell one chain two ways, and a slug in a file is not an
   * identity, so the operator picks the chain and this sits beside the picker
   * for them to disagree with.
   */
  readonly chainId: string;
  readonly file: string;
  readonly sha256: string;
  readonly pageCount: number;
  readonly offerCount: number;
  /** The extractor's own dropped tiles, which the run carries through. */
  readonly warningCount: number;
  /** `YYYY-MM-DD`, or `''` where the document states none. */
  readonly startsOn: string;
  readonly endsOn: string;
}

/**
 * One row of the preview table (section 2, step 6).
 *
 * A view model rather than the raw offer, and the two computed fields are why:
 * whether the import's rules will drop or queue this row is a decision, and a
 * decision made in a template is one no spec can call.
 */
export interface LeafletOfferRow {
  readonly id: string;
  readonly page: number;
  readonly name: string;
  readonly format: string;
  readonly brand: string;
  readonly basis: string;
  /** Already formatted, with the offer's own currency. `''` when it has none. */
  readonly price: string;
  readonly promotionType: string;
  readonly loyalty: boolean;
  /**
   * Whether a rule of the import will drop or queue this row.
   *
   * Drawn muted, so the operator sees it before submitting rather than in the
   * run's warnings afterwards.
   */
  readonly muted: boolean;
  /** Which rule, as a translation key. `null` on a row that will be written. */
  readonly noteKey: string | null;
}

/**
 * The promotion types whose headline price is not what one unit costs.
 *
 * Backend plan 0081, section 6.2: for these the number printed large is the
 * second unit's, or the per unit price at a quantity, so the import writes
 * `promotion.single_unit_price` instead and queues the offer when there is
 * none. A row with one of these and no single unit price writes nothing, which
 * is what the preview says before it is sent.
 */
const CONDITIONAL_PROMOTIONS: readonly string[] = [
  'second_unit_discount',
  'multibuy_unit_price',
  'multibuy_total',
  'buy_n_get_free',
];

/**
 * A dropped file, parsed.
 *
 * Two refusals rather than one, because they need different sentences. A file
 * that is not JSON is the wrong file; a JSON file with no `offers` array is a
 * file from something other than the extractor, and telling the operator to
 * check their JSON would send them looking for a syntax error that is not
 * there.
 */
export function parseLeaflet(text: string, locale?: string): LeafletParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }

  const document = asRecord(parsed);
  if (document === null || !Array.isArray(document['offers'])) {
    return { ok: false, reason: 'not-a-document' };
  }

  return {
    ok: true,
    leaflet: {
      document,
      summary: readSummary(document),
      offers: readOffers(document['offers'], locale),
    },
  };
}

/**
 * The rows by page, ascending or descending.
 *
 * The only sort the table offers, and the only one worth offering: a leaflet is
 * read page by page, so an operator checking a preview against the PDF in front
 * of them wants the order the pages are in. Stable within a page, so two offers
 * on one page keep the order the extractor emitted, which is the order they are
 * printed.
 */
export function sortOffersByPage(
  rows: readonly LeafletOfferRow[],
  direction: 'asc' | 'desc'
): readonly LeafletOfferRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) =>
      left.row.page === right.row.page
        ? left.index - right.index
        : sign * (left.row.page - right.row.page)
    )
    .map((entry) => entry.row);
}

/**
 * One row of the validation feedback (section 2.1).
 *
 * The gateway answers a 400 whose `errors` map is keyed on the JSON path, with
 * the offer id in the text (backend plan 0081, section 4). An offer with three
 * failures is one row with three lines, so the operator reads it as "this tile
 * is wrong in three ways" rather than as three unrelated complaints.
 */
export interface LeafletFailureRow {
  /** The offer these failures are about, or `''` outside `offers`. */
  readonly offerId: string;
  /** The section, for a failure outside `offers`. `''` when there is an offer. */
  readonly section: string;
  readonly messages: readonly string[];
}

/**
 * The gateway's per path messages, gathered by the offer they are about.
 *
 * `offerIds` is the document's own offer ids in document order, so a path of
 * `/offers/3/...` can name the tile even when the message's own `(offer ...)`
 * suffix is missing, which is what happens when the failure is that the offer
 * has no `id` at all.
 */
export function leafletFailures(
  fieldErrors: Readonly<Record<string, readonly string[]>>,
  offerIds: readonly string[]
): readonly LeafletFailureRow[] {
  const byOffer = new Map<string, string[]>();
  const sections = new Map<string, string[]>();

  for (const [path, messages] of Object.entries(fieldErrors)) {
    for (const message of messages) {
      const offerId = offerIdOf(path, message, offerIds);
      if (offerId === '') {
        const section = sectionOf(path);
        sections.set(section, [...(sections.get(section) ?? []), message]);
      } else {
        byOffer.set(offerId, [...(byOffer.get(offerId) ?? []), message]);
      }
    }
  }

  return [
    ...[...byOffer].map(([offerId, messages]) => ({
      offerId,
      section: '',
      messages,
    })),
    ...[...sections].map(([section, messages]) => ({
      offerId: '',
      section,
      messages,
    })),
  ];
}

/**
 * The two conflicts an upload can be refused with, told apart.
 *
 * They are both a 409 and they need different sentences, because the next step
 * is different: a document already imported is imported again by reverting the
 * run that took it, and a chain already running something is imported by
 * waiting. Both carry the other run's id in the problem document's `detail`,
 * which is the only channel there is for it.
 *
 * Matching on the word `imported`, which is the one token in those two
 * sentences that distinguishes them. That is the same bargain
 * {@link failureBlockReason} already takes with `HARVEST_ENABLED`: a substring
 * of a server sentence is a weak contract, and it is the contract on offer.
 */
export type LeafletConflict = 'already-imported' | 'run-in-progress';

export interface LeafletConflictNotice {
  readonly kind: LeafletConflict;
  /** The run to link to, or `''` when the server named none. */
  readonly runId: string;
}

/** A uuid anywhere in a sentence, which is where the run id is. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function leafletConflict(error: {
  readonly status: number;
  readonly detail: string;
}): LeafletConflictNotice | null {
  if (error.status !== 409) {
    return null;
  }

  return {
    kind: error.detail.toLowerCase().includes('imported')
      ? 'already-imported'
      : 'run-in-progress',
    runId: UUID.exec(error.detail)?.[0] ?? '',
  };
}

function readSummary(document: Readonly<Record<string, unknown>>): {
  retailerName: string;
  chainId: string;
  file: string;
  sha256: string;
  pageCount: number;
  offerCount: number;
  warningCount: number;
  startsOn: string;
  endsOn: string;
} {
  const retailer = asRecord(document['retailer']) ?? {};
  const source = asRecord(document['source']) ?? {};
  const validity = asRecord(document['validity']) ?? {};
  const offers = document['offers'];
  const warnings = document['warnings'];

  return {
    retailerName: asText(retailer['name']),
    chainId: asText(retailer['chain_id']),
    file: asText(source['file']),
    sha256: asText(source['sha256']),
    pageCount: asCount(source['page_count']),
    offerCount: Array.isArray(offers) ? offers.length : 0,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
    startsOn: asDay(validity['starts_on']),
    endsOn: asDay(validity['ends_on']),
  };
}

function readOffers(
  offers: readonly unknown[],
  locale: string | undefined
): readonly LeafletOfferRow[] {
  return offers.map((entry, index) => readOffer(entry, index, locale));
}

function readOffer(
  entry: unknown,
  index: number,
  locale: string | undefined
): LeafletOfferRow {
  const offer = asRecord(entry) ?? {};
  const product = asRecord(offer['product']) ?? {};
  const format = asRecord(product['format']) ?? {};
  const pricing = asRecord(offer['pricing']) ?? {};
  const promotion = asRecord(offer['promotion']);
  const loyalty = asRecord(offer['loyalty']);

  const promotionType = asText(promotion?.['type']);
  const gated = loyalty?.['required'] === true;
  // A conditional promotion writes `single_unit_price` and queues without one.
  const conditional =
    CONDITIONAL_PROMOTIONS.includes(promotionType) &&
    asAmount(promotion?.['single_unit_price']) === null;

  return {
    // A row with no id of its own is still a row: it is numbered from its place
    // in the document, which is what the gateway's JSON path names anyway.
    id: asText(offer['id']) || `offers[${index}]`,
    page: asCount(offer['page']),
    name: asText(product['name']),
    format: asText(format['raw']),
    brand: asText(product['brand']),
    basis: asText(pricing['basis']),
    price: money(pricing['price'], locale),
    promotionType,
    loyalty: gated,
    muted: gated || conditional,
    noteKey: gated
      ? 'harvest.leaflets.note.loyalty'
      : conditional
        ? 'harvest.leaflets.note.conditional'
        : null,
  };
}

/**
 * A money object as words.
 *
 * The currency comes off the offer, which is why a symbol is drawn here and not
 * on the source entries queue: that screen is shown a bare number by a
 * storefront that never says what currency it is in, and a euro sign it
 * invented would be a claim it cannot support. A leaflet states its currency on
 * every price.
 */
function money(value: unknown, locale: string | undefined): string {
  const record = asRecord(value);
  return formatCurrencyAmount(
    asAmount(record),
    asText(record?.['currency']) || null,
    locale
  );
}

/** The amount of a money object, or `null` when there is not one. */
function asAmount(value: unknown): number | null {
  const record = asRecord(value);
  const amount = record?.['amount'];
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

/**
 * The offer a failure is about.
 *
 * The message's own `(offer <id>)` suffix first, because the gateway puts it
 * there for exactly this. The path's index second, for a failure that is that
 * the offer has no id: `/offers/3/id` carries no suffix to read.
 */
function offerIdOf(
  path: string,
  message: string,
  offerIds: readonly string[]
): string {
  const named = /\(offer ([^)]+)\)\s*$/.exec(message);
  if (named !== null) {
    return named[1];
  }

  const indexed = /^\/?offers[/[](\d+)/.exec(path);
  if (indexed === null) {
    return '';
  }

  const index = Number(indexed[1]);
  return offerIds[index] ?? `offers[${index}]`;
}

/** The part of the document a failure outside `offers` is about. */
function sectionOf(path: string): string {
  const segment = /^\/?([A-Za-z_]+)/.exec(path);
  return segment === null ? path : segment[1];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** A `YYYY-MM-DD` day, or `''`. The date inputs take exactly that shape. */
function asDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : '';
}
