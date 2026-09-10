import {
  HARVEST_DOCUMENT_CURRENT_VERSION,
  PriceSourceKind,
  type HarvestDocument,
  type HarvestDocumentHints,
  type HarvestDocumentPrice,
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
  /**
   * The scope the operator chose at the spawn, and null for a run given none.
   *
   * It is a **hint** for the upload screen and no longer what the export reads
   * its prices by. A LIDL run is given none and writes 59 regions' prices, and
   * asking for one scope is why its export came out with no price in it at all
   * (plan 0103, section 1.1).
   */
  priceScopeId: string | null;
  /** What produced the file, so the upload screen can preselect (section 4.3). */
  adapterKey?: string | null;
}

/** A scope some price of this run was observed for, as catalog holds it. */
export interface HarvestExportScope {
  id: string;
  /** The source's own key. A scope with none cannot be exported by key. */
  externalKey: string | null;
  kind: string;
  name: string | null;
}

export interface HarvestExportInput {
  run: HarvestExportRun;
  /**
   * Every row whose `lastRunId` is this run, with its `prices` loaded and
   * **filtered to this run** (`source_entry_prices.runId = run.id`).
   */
  entries: SourceCatalogEntry[];
  /**
   * The scopes those price rows name, by id.
   *
   * A run that wrote no price passes none, which is every DEZA crawl and every
   * store discovery.
   */
  scopes?: readonly HarvestExportScope[];
  producedAt: Date;
}

/** The export format's own version, which is not the service's. */
export const HARVEST_PRODUCER_VERSION = '2';

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
  // The scopes this run's price rows actually name, by id, and only the ones a
  // key can address: a scope with no `externalKey` is one nothing on another
  // cluster could match, so a price for it is exported without a scope and
  // falls to whatever the importing operator chooses.
  const byId = new Map(
    (input.scopes ?? [])
      .filter((scope) => scope.externalKey)
      .map((scope) => [scope.id, scope])
  );
  const used = new Set<string>();
  const products = input.entries.map((entry) => toProduct(entry, byId, used));
  const kind = dominantKind(input.entries);

  const document: HarvestDocument = {
    schema_version: HARVEST_DOCUMENT_CURRENT_VERSION,
    // Filled below, once the rest of the document is settled.
    sha256: '',
    producer: {
      name: producerName(input.run.id),
      version: HARVEST_PRODUCER_VERSION,
      produced_at: input.producedAt.toISOString(),
    },
    // The hints, filled. They are for the upload screen and nothing here
    // depends on a reader honouring them: ids do not survive an environment
    // change, which is exactly what the screen tells the operator.
    hints: {
      chain_id: input.run.supermarketId,
      ...(input.run.priceScopeId
        ? { price_scope_id: input.run.priceScopeId }
        : {}),
      ...(input.run.adapterKey ? { adapter_key: input.run.adapterKey } : {}),
      ...(kind ? { source_kind: kind } : {}),
    },
    // Only the scopes some price of this run was written for, in the order the
    // products named them. A run that wrote no price declares none.
    ...(used.size > 0
      ? {
          scopes: [...used].map((id) => {
            const scope = byId.get(id) as HarvestExportScope;
            return {
              key: scope.externalKey as string,
              kind: scope.kind as
                | 'NATIONAL'
                | 'REGION'
                | 'POSTAL_CODE'
                | 'STORE',
              ...(scope.name ? { name: scope.name } : {}),
            };
          }),
        }
      : {}),
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

/**
 * One row, with **every** price this run wrote for it.
 *
 * The rows arrive already filtered to this run, so what is here is what this
 * run observed and nothing an earlier one did. Before plan 0103 this asked for
 * one scope's row, which is why a LIDL export carried no price at all: the run
 * was refused a scope, so the lookup matched nothing, and 59 regions' worth of
 * correct rows were dropped on the way out.
 */
function toProduct(
  entry: SourceCatalogEntry,
  scopes: ReadonlyMap<string, HarvestExportScope>,
  used: Set<string>
): HarvestDocumentProduct {
  const size = sizeOf(entry);
  const rows = (entry.prices ?? []).filter(
    (price) => price.price !== null || price.unitPrice !== null
  );
  for (const price of rows) {
    if (scopes.has(price.priceScopeId)) {
      used.add(price.priceScopeId);
    }
  }
  return {
    id: entry.id,
    external_id: entry.externalId,
    name: entry.name,
    ...(entry.brand ? { brand: entry.brand } : {}),
    ...(entry.ean ? { ean: entry.ean } : {}),
    ...(size ? { size } : {}),
    prices: rows.map((price) => toPrice(price, scopes)),
    observed_at: (rows[0]?.observedAt ?? entry.lastSeenAt).toISOString(),
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

/** One `source_entry_prices` row, as a price of the file. */
function toPrice(
  price: SourceEntryPrice,
  scopes: ReadonlyMap<string, HarvestExportScope>
): HarvestDocumentPrice {
  const validity = validityOf(price);
  const scope = scopes.get(price.priceScopeId);
  return {
    // The source's own key, never the uuid: an id does not survive a move to
    // another cluster and `PriceScope.externalKey` does (plan 0103, D3).
    ...(scope ? { scope: scope.externalKey as string } : {}),
    amount: price.price === null ? null : Number(price.price),
    currency: price.currency,
    ...(price.unitPrice !== null && price.unitPriceLabel
      ? {
          unit_price: {
            amount: Number(price.unitPrice),
            label: price.unitPriceLabel,
          },
        }
      : {}),
    ...(validity ? { validity } : {}),
    observed_at: price.observedAt.toISOString(),
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
