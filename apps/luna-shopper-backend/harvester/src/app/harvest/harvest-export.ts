import {
  PriceSourceKind,
  type HarvestDocument,
  type HarvestDocumentHints,
  type HarvestDocumentProduct,
  type HarvestDocumentSize,
  type HarvestDocumentValidity,
} from '@portfolio/luna-shopper/contracts';
import { createHash } from 'node:crypto';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';

/**
 * A run, as a file (plan 0086, section 6.2).
 *
 * **The export and the import are the same shape on purpose.** A walk runs on
 * the compose stack where there is room for 4,383 requests, the file it produces
 * is uploaded to a cluster that is not allowed to crawl, and that cluster's
 * rows, ladder, queue and prices are exactly what a walk there would have
 * produced. That round trip is what makes the cluster switch of plan 0083 and
 * k8s 0008 livable, and it is why the harvester is a producer of the same
 * schema the leaflet extractor writes.
 *
 * **The source group only.** A decision is per environment: an `itemId` means
 * nothing on another cluster, while an EAN carries and resolves there through
 * rung 2. So nothing here writes `status`, `itemId`, `matchedBy` or
 * `confidence`, and an import of this file lands its rows in the importing
 * cluster's own queue.
 *
 * Building it is pure, so it is testable without a database and without a run:
 * the service loads the rows and hands them here.
 */

/** The Spanish civil timezone, as `leaflet-validity.ts` named it. */
const EXPORT_TIMEZONE = 'Europe/Madrid';

/** The three kinds a file may state, and the three a row may hold. */
const OFFICIAL_KINDS: Record<string, HarvestDocumentHints['source_kind']> = {
  [PriceSourceKind.OFFICIAL_API]: 'OFFICIAL_API',
  [PriceSourceKind.OFFICIAL_WEB]: 'OFFICIAL_WEB',
  [PriceSourceKind.OFFICIAL_LEAFLET]: 'OFFICIAL_LEAFLET',
};

export interface HarvestExportRun {
  id: string;
  supermarketId: string;
  /** The scope the run's prices were observed for, null for a run with none. */
  priceScopeId: string | null;
}

export interface HarvestExportInput {
  run: HarvestExportRun;
  /** Every row whose `lastRunId` is this run, with its `prices` loaded. */
  entries: SourceCatalogEntry[];
  producedAt: Date;
}

/** The export format's own version, which is not the service's. */
export const HARVEST_PRODUCER_VERSION = '1';

/**
 * What names the harvester and the run in a file it produced.
 *
 * **The run id rides in the name** because `producer` has three fields and none
 * of them is a run: the schema is `additionalProperties: false` and a field for
 * one producer's private handle is not a field a file schema should carry. The
 * run page shows this string as where the file came from, so it reads as a
 * sentence rather than as a key nobody but this backend could use.
 */
export function producerName(runId: string): string {
  return `luna-harvester run ${runId}`;
}

export function buildHarvestDocument(
  input: HarvestExportInput
): HarvestDocument {
  const products = input.entries.map((entry) =>
    toProduct(entry, priceFor(entry, input.run.priceScopeId))
  );
  const kind = dominantKind(input.entries);

  const document: HarvestDocument = {
    schema_version: 1,
    // Filled below, once the rest of the document is settled.
    sha256: '',
    producer: {
      name: producerName(input.run.id),
      version: HARVEST_PRODUCER_VERSION,
      produced_at: input.producedAt.toISOString(),
    },
    // The three hints, filled. They are for the upload screen and nothing here
    // depends on a reader honouring them: ids do not survive an environment
    // change, which is exactly what the screen tells the operator.
    hints: {
      chain_id: input.run.supermarketId,
      ...(input.run.priceScopeId
        ? { price_scope_id: input.run.priceScopeId }
        : {}),
      ...(kind ? { source_kind: kind } : {}),
    },
    products,
  };

  document.sha256 = digestOf(document);
  return document;
}

/**
 * The digest a re-import is refused by (plan 0081, section 7).
 *
 * Taken over the document with its own `sha256` emptied, because a value cannot
 * be part of what produces it. A reader that wants to check one does the same.
 */
export function digestOf(document: HarvestDocument): string {
  const withoutDigest = { ...document, sha256: '' };
  return createHash('sha256')
    .update(JSON.stringify(withoutDigest))
    .digest('hex');
}

/** That run's price for that run's scope, and nothing else's. */
function priceFor(
  entry: SourceCatalogEntry,
  priceScopeId: string | null
): SourceEntryPrice | null {
  if (!priceScopeId) {
    return null;
  }
  return (
    (entry.prices ?? []).find((row) => row.priceScopeId === priceScopeId) ??
    null
  );
}

function toProduct(
  entry: SourceCatalogEntry,
  price: SourceEntryPrice | null
): HarvestDocumentProduct {
  const size = sizeOf(entry);
  const validity = validityOf(price);
  return {
    id: entry.id,
    external_id: entry.externalId,
    name: entry.name,
    ...(entry.brand ? { brand: entry.brand } : {}),
    ...(entry.ean ? { ean: entry.ean } : {}),
    ...(size ? { size } : {}),
    ...(price && price.price !== null
      ? { price: { amount: Number(price.price), currency: price.currency } }
      : {}),
    ...(price && price.unitPrice !== null && price.unitPriceLabel
      ? {
          unit_price: {
            amount: Number(price.unitPrice),
            currency: price.currency,
            label: price.unitPriceLabel,
          },
        }
      : {}),
    ...(validity ? { validity } : {}),
    observed_at: (price?.observedAt ?? entry.lastSeenAt).toISOString(),
    ...(entry.categoryPath?.length
      ? { category_path: entry.categoryPath }
      : {}),
    ...(entry.url ? { url: entry.url } : {}),
    // Carried through untouched, which is the whole point of the bag: whatever
    // the producer of the original observation knew and the import does not
    // read survives the round trip.
    ...(entry.extra ? { extra: entry.extra } : {}),
  };
}

function sizeOf(entry: SourceCatalogEntry): HarvestDocumentSize | null {
  const quantity = entry.unitSize === null ? null : Number(entry.unitSize);
  if (!entry.sizeFormat && quantity === null) {
    return null;
  }
  return {
    ...(entry.sizeFormat ? { label: entry.sizeFormat } : {}),
    ...(quantity === null ? {} : { quantity }),
  };
}

/**
 * The window as local days in Spain, which is the shape the file states and the
 * import reads.
 *
 * `validUntil` is **exclusive**, the local midnight after the last valid day, so
 * the day the file names is the day before it: a window ending at midnight on
 * the 24th was printed as valid to the 23rd, and exporting the 24th would extend
 * every leaflet by a day on every round trip.
 */
function validityOf(
  price: SourceEntryPrice | null
): HarvestDocumentValidity | null {
  if (!price?.validFrom || !price?.validUntil) {
    return null;
  }
  return {
    from: localDay(price.validFrom),
    until: localDay(new Date(price.validUntil.getTime() - 1)),
  };
}

function localDay(instant: Date): string {
  // `en-CA` renders a date as YYYY-MM-DD, which is the format the file states
  // and the one JavaScript has no other way to ask for by name.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * What observed these rows, for the source kind hint.
 *
 * Every row of an export was observed by one run, so they agree in practice;
 * taking the commonest rather than the first means a mixed set still answers
 * something true of most of it rather than of whichever row sorted first. A kind
 * the file schema does not carry, which is any user kind, answers nothing: no
 * upload may write one, so no export may propose one either.
 */
function dominantKind(
  entries: SourceCatalogEntry[]
): HarvestDocumentHints['source_kind'] {
  const counts = new Map<PriceSourceKind, number>();
  for (const entry of entries) {
    counts.set(entry.sourceKind, (counts.get(entry.sourceKind) ?? 0) + 1);
  }
  let best: PriceSourceKind | null = null;
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best === null ? null : (OFFICIAL_KINDS[best] ?? null);
}
