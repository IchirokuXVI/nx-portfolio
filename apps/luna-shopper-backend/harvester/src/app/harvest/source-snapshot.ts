import type { ItemView, PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry } from '../entities';
import type { CatalogClient } from './catalog-client.service';

/**
 * The source's half of a row, and how a run writes it (plan 0086, section 3.1).
 *
 * `source_catalog_entries` carries two groups of columns. **A run rewrites the
 * first group and never the second**: what the chain printed or answered is the
 * run's to state, and `itemId`, `status`, `matchedBy`, `confidence` and
 * `decidedAt` belong to a person or to the EAN rung. That split is the whole
 * reason one table can hold both without a run undoing a decision.
 *
 * This file used to hold three functions for two runners. The ladder and the
 * upsert moved into `source-ingest.ts` when plan 0086 made every run's second
 * half one piece of code; what stayed is the shape of the source group, the
 * comparison that decides `updated` against `unchanged`, and the one read of the
 * catalog's items.
 */

/** Every column of 3.1's first group, as an observation states it. */
export interface SourceEntryFields {
  externalId: string;
  sourceKind: PriceSourceKind;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  categoryPath: string[];
  url: string | null;
  /** The last observation's free bag. Stored and shown, never read (D6). */
  extra: Record<string, unknown> | null;
}

/**
 * Whether this observation says anything new about the product.
 *
 * The same rule `upsertSourceEntry` used before plan 0086, minus the two price
 * columns, which are not on the row any more. A run that saw only a new price
 * therefore reports the row `unchanged` and the price separately, which is the
 * honest reading: the chain's description of the product did not move.
 */
export function sourceGroupChanged(
  existing: SourceCatalogEntry,
  fields: SourceEntryFields
): boolean {
  return (
    existing.name !== fields.name ||
    existing.brand !== fields.brand ||
    existing.ean !== fields.ean ||
    existing.sizeFormat !== fields.sizeFormat ||
    numeric(existing.unitSize) !== numeric(fields.unitSize) ||
    existing.url !== fields.url ||
    existing.sourceKind !== fields.sourceKind
  );
}

/**
 * Write the source group onto a row, leaving the decision group alone.
 *
 * Assigning field by field rather than `Object.assign` is deliberate: the second
 * group is what a person decided, and a spread of a wider object is exactly how a
 * later edit would quietly take it with it.
 */
export function applySourceGroup(
  row: SourceCatalogEntry,
  fields: SourceEntryFields
): void {
  row.externalId = fields.externalId;
  row.sourceKind = fields.sourceKind;
  row.name = fields.name;
  row.brand = fields.brand;
  row.ean = fields.ean;
  row.unitSize = fields.unitSize;
  row.sizeFormat = fields.sizeFormat;
  row.categoryPath = fields.categoryPath;
  row.url = fields.url;
  row.extra = fields.extra;
}

/** The whole catalog item index, paged once. See {@link ItemMatchIndex}'s doc. */
export async function loadCatalogItems(
  catalog: CatalogClient
): Promise<ItemView[]> {
  const items: ItemView[] = [];
  let cursor: string | undefined;
  do {
    const page = await catalog.searchItems(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

function numeric(value: number | string | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}
