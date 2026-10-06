import {
  PriceSourceKind,
  type ItemView,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';
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
  /** The brand's key, derived and written beside it (plan 0115, section 6). */
  brandKey: string | null;
  ean: string | null;
  unitSize: number | null;
  /**
   * The catalog unit `unitSize` is in (plan 0177), and null whenever
   * `unitSize` is. Written with the size on every observation, so the two
   * cannot describe different reads of the source.
   */
  sizeUnit: SourceSizeUnit | null;
  /**
   * Whether the product is sold by weight (plan 0181). When it is, `unitSize`
   * and `sizeUnit` are both null: the weight is not the same on every pack,
   * so it is not a size.
   */
  soldByWeight: boolean;
  sizeFormat: string | null;
  /**
   * How many units the pack holds, or null (plan 0162).
   *
   * **Absent means the source does not read counts at all**, which is the
   * leaflet import: it leaves the stored count alone rather than blanking one a
   * walk of the same chain read. Null is a statement, and is written.
   */
  packCount?: number | null;
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
    (fields.packCount !== undefined &&
      (existing.packCount ?? null) !== fields.packCount) ||
    numeric(existing.unitSize) !== numeric(fields.unitSize) ||
    // A row written before plan 0177 holds no unit, so the first run to see it
    // again reports it `updated`, which is true: the row now says something it
    // did not say before.
    (existing.sizeUnit ?? null) !== fields.sizeUnit ||
    (existing.soldByWeight ?? false) !== fields.soldByWeight ||
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
  // The key follows the brand and is never compared on its own, which is why
  // {@link sourceGroupChanged} above says nothing about it.
  row.brandKey = fields.brandKey;
  row.ean = fields.ean;
  row.unitSize = fields.unitSize;
  row.sizeUnit = fields.sizeUnit;
  row.soldByWeight = fields.soldByWeight;
  row.sizeFormat = fields.sizeFormat;
  if (fields.packCount !== undefined) {
    row.packCount = fields.packCount;
  }
  row.categoryPath = fields.categoryPath;
  row.url = fields.url;
  row.extra = fields.extra;
}

/**
 * The kinds that are a walk: a run that reads the fields of a product from the
 * chain's own API or website (plan 0190).
 */
const WALK_KINDS: readonly PriceSourceKind[] = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
];

/** Whether a run of this kind is a walk. */
export function isWalkKind(sourceKind: PriceSourceKind): boolean {
  return WALK_KINDS.includes(sourceKind);
}

/**
 * **A walk owns the text of a row. Any other source adds to it** (plan 0190,
 * the owner's decision 2C). Answers whether an observation of this kind
 * writes the source group of this row.
 *
 * A website and a leaflet of one chain can print one product with the same
 * name and format. A source with no product id keys its row on exactly those
 * two (`entryKey`), so both land on one row, and that is intended: a person
 * decides once and both sources resolve through the row (plans 0085 and
 * 0086). What the row says about the product is still one text, and before
 * the plan it was the text of whichever run came last. Eight rows of the
 * first catalog changed their name, their brand and their size twice in
 * three days.
 *
 * So the group has one owner. A walk reads fields, and a leaflet is read by a
 * model from a picture:
 *
 * - **An observation of the kind the row holds writes the group**, as every
 *   run did before the plan.
 * - **A walk writes the group of any row.** A row that only a leaflet has
 *   described is taken over: it gets the walk's text and the walk's kind.
 *   That happens once for a row, because from then on a walk owns it.
 * - **An observation that is not a walk leaves a row that a walk owns alone.**
 *   The caller still moves the seen fields and writes the prices, each under
 *   the kind of its own run, which is where the kind of a price lives now
 *   (`source_entry_prices.sourceKind`).
 *
 * The cost, which the plan accepts: a size that a leaflet prints and the
 * website does not is not on the row. A person types it on the create.
 */
export function writesSourceGroup(
  row: Pick<SourceCatalogEntry, 'sourceKind'>,
  sourceKind: PriceSourceKind
): boolean {
  return (
    row.sourceKind === sourceKind ||
    isWalkKind(sourceKind) ||
    !isWalkKind(row.sourceKind)
  );
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
