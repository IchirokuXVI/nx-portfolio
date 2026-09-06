/**
 * A harvest document, read in the browser (admin plan 0014, section 2).
 *
 * **This is the one place in this app where rule D4 applies in full.** Plan 0004
 * section 2 lets the gateway's own shapes be the view models, because the
 * OpenAPI document describes them and a stale one is a red test. A harvest
 * document is not one of those: it is a file an operator drops in, produced
 * outside this repository by an extractor, by a person typing a chain's prices,
 * or by the harvester's own export on another machine, and the gateway describes
 * it as `{ [key: string]: unknown }` and nothing more. So every field read here
 * is read off `unknown` and checked, and a document that disagrees produces an
 * empty cell rather than a crash halfway down a preview table.
 *
 * Nothing here validates. The versioned schema lives in
 * `libs/luna-shopper/contracts` and the gateway is what answers against it
 * (backend plan 0086, section 6.1). What this file does is read enough of a well
 * formed document to show the operator what they are about to send, and enough
 * of a malformed one to say which product the gateway objected to. A second copy
 * of the schema here would be a second thing to keep current, and the one that
 * drifted would be the one nothing exercises.
 *
 * The document is never edited and never stored. An edited document has a
 * different digest, and the digest is what the backend dedupes on.
 *
 * **One schema, whatever produced the file** (backend plan 0086, section 6). The
 * leaflet document this replaced carried a retailer block, a page count and a
 * promotion, loyalty and basis bag per offer, because the harvester's own rules
 * read them. Those rules moved to the producer, so the fields moved into `extra`,
 * which this app shows and never reads.
 */

import { formatCurrencyAmount } from '../resource/money';
import { toOfficialSourceKind, type OfficialSourceKind } from './source-enums';

/** Why a dropped file could not be read at all. */
export type HarvestDocumentRejection = 'not-json' | 'not-a-document';

/** A dropped file, read or refused. */
export type HarvestDocumentParse =
  | { readonly ok: true; readonly read: HarvestDocumentRead }
  | { readonly ok: false; readonly reason: HarvestDocumentRejection };

/** A document the page is holding, with what it needs already read off it. */
export interface HarvestDocumentRead {
  /** Exactly what was in the file, sent back byte for byte. */
  readonly document: Readonly<Record<string, unknown>>;
  readonly summary: HarvestDocumentSummary;
  readonly hints: HarvestDocumentHints;
  /**
   * The window every product without one of its own falls under.
   *
   * `null` when the document states none, which is what hides the two date
   * inputs: a storefront export has no window at all, and asking for one would
   * be asking for a fact the file never had.
   */
  readonly validity: HarvestValidity | null;
  readonly products: readonly HarvestProductRow[];
}

/**
 * What was read, shown before anything is chosen.
 *
 * Before the chain and the scope, on purpose: a wrong file is obvious from the
 * producer and the product count, and finding that out after picking a chain,
 * a scope and a source kind is finding it out too late.
 */
export interface HarvestDocumentSummary {
  /** The schema the file claims. Shown as text, because an unknown one is refused. */
  readonly schemaVersion: string;
  readonly sha256: string;
  readonly producerName: string;
  readonly producerVersion: string;
  readonly producedAt: string;
  readonly productCount: number;
  /** The producer's own dropped tiles, which the run carries through. */
  readonly warningCount: number;
}

/**
 * The three hints, which are the upload screen's and nobody else's.
 *
 * The harvester never reads them (backend plan 0086, section 6.1). They exist so
 * that a file produced by an export of the same deployment fills the three
 * inputs in, and they are ids rather than names, so a file that travelled
 * between environments names things this one does not have. That is why every
 * one of them is checked against the directory before it is used.
 */
export interface HarvestDocumentHints {
  /** `''` when the file states none. */
  readonly chainId: string;
  readonly priceScopeId: string;
  /** `null` when the file states none, or states one this app does not know. */
  readonly sourceKind: OfficialSourceKind | null;
}

/** A window, as the two `YYYY-MM-DD` days the date inputs take. */
export interface HarvestValidity {
  readonly from: string;
  readonly until: string;
}

/**
 * One row of the preview table.
 *
 * A view model rather than the raw product, because every cell is either already
 * formatted or already defaulted. The muting the leaflet preview did is gone
 * with the rules that justified it: a product with no `price` is not a row a
 * rule will drop, it is a row the producer stated no price for, and the queue is
 * where a person decides it.
 */
export interface HarvestProductRow {
  /** The product's own id, or its position, which is what a message names. */
  readonly id: string;
  readonly externalId: string;
  readonly name: string;
  readonly brand: string;
  readonly ean: string;
  /** The size as the source printed it, `label` first and `unit` behind it. */
  readonly size: string;
  /** Already formatted, with the product's own currency. `''` when it has none. */
  readonly price: string;
  /** The comparison figure with the label the source printed. `''` when none. */
  readonly unitPrice: string;
  /** This product's own window, where it states one. `''` otherwise. */
  readonly validFrom: string;
  readonly validUntil: string;
  readonly categoryPath: string;
}

/**
 * A dropped file, parsed.
 *
 * Two refusals rather than one, because they need different sentences. A file
 * that is not JSON is the wrong file; a JSON file with no `products` array is a
 * file from something other than a harvest producer, and telling the operator to
 * check their JSON would send them looking for a syntax error that is not there.
 */
export function parseHarvestDocument(
  text: string,
  locale?: string
): HarvestDocumentParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }

  const document = asRecord(parsed);
  if (document === null || !Array.isArray(document['products'])) {
    return { ok: false, reason: 'not-a-document' };
  }

  return {
    ok: true,
    read: {
      document,
      summary: readSummary(document),
      hints: readHints(document['hints']),
      validity: readValidity(document['validity']),
      products: document['products'].map((entry, index) =>
        readProduct(entry, index, locale)
      ),
    },
  };
}

/**
 * One row of the validation feedback (admin plan 0014, section 2).
 *
 * The gateway answers a 400 whose `errors` map is keyed on the JSON path. A
 * product with three failures is one row with three lines, so the operator reads
 * it as "this product is wrong in three ways" rather than as three unrelated
 * complaints.
 */
export interface HarvestFailureRow {
  /** The product these failures are about, or `''` outside `products`. */
  readonly productId: string;
  /** The section, for a failure outside `products`. `''` when there is a product. */
  readonly section: string;
  readonly messages: readonly string[];
}

/**
 * The gateway's per path messages, gathered by the product they are about.
 *
 * `productIds` is the document's own ids in document order, so a path of
 * `/products/3/...` can name the product even when the message carries no id of
 * its own, which is what happens when the failure is that the product has no
 * `id` at all. A product with neither is named by its position, which is the
 * plan's own second answer and the one the path already gives.
 */
export function harvestFailures(
  fieldErrors: Readonly<Record<string, readonly string[]>>,
  productIds: readonly string[]
): readonly HarvestFailureRow[] {
  const byProduct = new Map<string, string[]>();
  const sections = new Map<string, string[]>();

  for (const [path, messages] of Object.entries(fieldErrors)) {
    for (const message of messages) {
      const productId = productIdOf(path, message, productIds);
      if (productId === '') {
        const section = sectionOf(path);
        sections.set(section, [...(sections.get(section) ?? []), message]);
      } else {
        byProduct.set(productId, [
          ...(byProduct.get(productId) ?? []),
          message,
        ]);
      }
    }
  }

  return [
    ...[...byProduct].map(([productId, messages]) => ({
      productId,
      section: '',
      messages,
    })),
    ...[...sections].map(([section, messages]) => ({
      productId: '',
      section,
      messages,
    })),
  ];
}

/**
 * The two conflicts an import can be refused with, told apart.
 *
 * They are both a 409 and they need different sentences, because the next step
 * is different: a document already imported is imported again by reverting the
 * run that took it, and a chain already running something is imported by
 * waiting. Both carry the other run's id in the problem document's `detail`,
 * which is the only channel there is for it.
 *
 * Matching on the word `imported`, which is the one token in those two sentences
 * that distinguishes them. A substring of a server sentence is a weak contract,
 * and it is the contract on offer.
 */
export type ImportConflict = 'already-imported' | 'run-in-progress';

export interface ImportConflictNotice {
  readonly kind: ImportConflict;
  /** The run to link to, or `''` when the server named none. */
  readonly runId: string;
}

/** A uuid anywhere in a sentence, which is where the run id is. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function importConflict(error: {
  readonly status: number;
  readonly detail: string;
}): ImportConflictNotice | null {
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

/** Which of the three inputs one hint is about. */
export type HintField = 'chain' | 'scope' | 'sourceKind';

/** What one hint did, once the screen has checked it against the directory. */
export type HintOutcome = 'set' | 'kept' | 'unknown';

export interface HintResult {
  readonly field: HintField;
  readonly outcome: HintOutcome;
  /**
   * What the file carried, in words.
   *
   * The chain's or the scope's name where the directory knows it, and the bare
   * id where it does not, because an id is all there is to say about a hint that
   * resolves to nothing and the operator needs to see it to know what went
   * wrong.
   */
  readonly fileValue: string;
  /** What the operator had already chosen. `''` unless the outcome is `kept`. */
  readonly keptValue: string;
}

/**
 * What to say about a file's hints, every time a file is chosen (section 2).
 *
 * The whole point is that a disagreement is visible **before** the run starts. A
 * file that names a chain the operator did not pick is not an error and is not
 * silently obeyed either: the operator's choice stands and the notice says what
 * the file wanted, so somebody who dropped the wrong file sees it here rather
 * than in the queue afterwards.
 */
export interface HintNotice {
  /**
   * Which sentence heads the notice.
   *
   * `none` when no input was decided by a hint, which is both a file with no
   * hints at all and a file whose only hints named things this deployment does
   * not have. The second still shows a notice, from {@link HintNotice.unknown}.
   */
  readonly kind: 'none' | 'set' | 'kept' | 'mixed';
  readonly set: readonly HintResult[];
  readonly kept: readonly HintResult[];
  /** Hints naming an id this deployment does not have. */
  readonly unknown: readonly HintResult[];
  /** Whether there is anything at all to say. A hand written file says nothing. */
  readonly shown: boolean;
}

export function hintNotice(results: readonly HintResult[]): HintNotice {
  const set = results.filter((result) => result.outcome === 'set');
  const kept = results.filter((result) => result.outcome === 'kept');
  const unknown = results.filter((result) => result.outcome === 'unknown');

  const kind =
    set.length > 0 && kept.length > 0
      ? 'mixed'
      : set.length > 0
        ? 'set'
        : kept.length > 0
          ? 'kept'
          : 'none';

  return {
    kind,
    set,
    kept,
    unknown,
    shown: results.length > 0,
  };
}

/**
 * What a run's export is saved as (admin plan 0014, section 2).
 *
 * The chain, the scope and the day, because those are the three things somebody
 * looking at a folder of exports needs to tell them apart: the same chain is
 * walked repeatedly and one chain has several scopes. The run id is not in it on
 * purpose, since it means nothing on the machine the file is carried to.
 *
 * A part the caller could not name is left out rather than written as `unknown`,
 * so a file always reads as a list of facts.
 */
export function exportFileName(parts: {
  readonly chain: string;
  readonly scope: string;
  readonly day: string;
}): string {
  const stem = [parts.chain, parts.scope, parts.day]
    .map(slug)
    .filter((part) => part !== '')
    .join('-');

  return `harvest-${stem === '' ? 'export' : stem}.json`;
}

/** The first and last combining mark `normalize('NFD')` splits an accent into. */
const FIRST_MARK = 0x0300;
const LAST_MARK = 0x036f;

/**
 * A name as a file name can hold it: lower case, words joined by one dash.
 *
 * The accents come off through `NFD` and a code point test rather than through a
 * regular expression over the combining marks. The characters in that range are
 * invisible in an editor, so a character class holding them is a class nobody can
 * check by reading it, and the two numbers above say plainly what is being
 * dropped. Without the step `Córdoba` slugs as `c-rdoba`, which is a file name an
 * operator cannot recognise.
 */
function slug(value: string): string {
  return [...value.normalize('NFD')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < FIRST_MARK || code > LAST_MARK;
    })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readSummary(
  document: Readonly<Record<string, unknown>>
): HarvestDocumentSummary {
  const producer = asRecord(document['producer']) ?? {};
  const products = document['products'];
  const warnings = document['warnings'];
  const version = document['schema_version'];

  return {
    schemaVersion:
      typeof version === 'number' || typeof version === 'string'
        ? String(version)
        : '',
    sha256: asText(document['sha256']),
    producerName: asText(producer['name']),
    producerVersion: asText(producer['version']),
    producedAt: asText(producer['produced_at']),
    productCount: Array.isArray(products) ? products.length : 0,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
  };
}

/**
 * The three hints, each independently absent.
 *
 * A file may carry one, two or all three, and a hand written one carries none.
 * So this reads each on its own rather than treating `hints` as a block: a
 * document that names only a source kind is an ordinary document, and it fills
 * one input.
 */
function readHints(value: unknown): HarvestDocumentHints {
  const hints = asRecord(value) ?? {};

  return {
    chainId: asText(hints['chain_id']),
    priceScopeId: asText(hints['price_scope_id']),
    sourceKind: toOfficialSourceKind(hints['source_kind']),
  };
}

/**
 * The document's window, or nothing.
 *
 * **Both bounds or neither** (backend plan 0086, section 6.1: both are required
 * inside `validity`). A document carrying one is carrying a window nothing can
 * use, so it reads as none and the fields stay hidden, rather than as half a
 * window with one input the operator has to guess at.
 */
function readValidity(value: unknown): HarvestValidity | null {
  const validity = asRecord(value);
  if (validity === null) {
    return null;
  }

  const from = asDay(validity['from']);
  const until = asDay(validity['until']);
  return from === '' || until === '' ? null : { from, until };
}

function readProduct(
  entry: unknown,
  index: number,
  locale: string | undefined
): HarvestProductRow {
  const product = asRecord(entry) ?? {};
  const size = asRecord(product['size']) ?? {};
  const price = asRecord(product['price']);
  const unitPrice = asRecord(product['unit_price']);
  const validity = asRecord(product['validity']) ?? {};
  const categoryPath = product['category_path'];

  const label = asText(unitPrice?.['label']);
  const unit = formatCurrencyAmount(
    asAmount(unitPrice),
    asText(unitPrice?.['currency']) || null,
    locale
  );

  return {
    // A product with no id of its own is still a product: it is numbered from
    // its place in the document, which is what the gateway's JSON path names
    // anyway.
    id: asText(product['id']) || `products[${index}]`,
    externalId: asText(product['external_id']),
    name: asText(product['name']),
    brand: asText(product['brand']),
    ean: asText(product['ean']),
    size: asText(size['label']) || asText(size['unit']),
    price: formatCurrencyAmount(
      asAmount(price),
      asText(price?.['currency']) || null,
      locale
    ),
    unitPrice: unit === '' || label === '' ? unit : `${unit} / ${label}`,
    validFrom: asDay(validity['from']),
    validUntil: asDay(validity['until']),
    categoryPath: Array.isArray(categoryPath)
      ? categoryPath.filter((part) => typeof part === 'string').join(' / ')
      : '',
  };
}

/** The amount of a money object, or `null` when there is not one. */
function asAmount(value: unknown): number | null {
  const record = asRecord(value);
  const amount = record?.['amount'];
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

/**
 * The product a failure is about.
 *
 * The message's own `(product <id>)` suffix first, where the gateway puts one.
 * The path's index second, for a failure that is that the product has no id:
 * `/products/3/id` carries no suffix to read.
 */
function productIdOf(
  path: string,
  message: string,
  productIds: readonly string[]
): string {
  const named = /\(product ([^)]+)\)\s*$/.exec(message);
  if (named !== null) {
    return named[1];
  }

  const indexed = /^\/?products[/[](\d+)/.exec(path);
  if (indexed === null) {
    return '';
  }

  const index = Number(indexed[1]);
  return productIds[index] ?? `products[${index}]`;
}

/** The part of the document a failure outside `products` is about. */
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

/** A `YYYY-MM-DD` day, or `''`. The date inputs take exactly that shape. */
function asDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : '';
}
