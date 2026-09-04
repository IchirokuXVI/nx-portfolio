import {
  ItemSourceMatch,
  ItemSourceRefStatus,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';

/**
 * The matching ladder (plan 0038, section 6.2), a shortened backlog 0001 section
 * 6.2 with only the steps possible here.
 *
 * 1. `item_source_refs.externalId` already recorded, giving ACTIVE.
 * 2. `ean` equal to a catalog item's, giving ACTIVE.
 * 3. Normalized name plus brand plus size, giving **CANDIDATE**.
 *
 * Steps 1 and 2 are used immediately. **Step 3 is never used to write a price
 * until the owner confirms it**: a bad fuzzy match writes a wrong price onto a
 * real product that users then shop on, which is worse than having no price.
 *
 * Text search is not a rung, because the API has none.
 */

export interface MatchCandidate {
  externalId: string;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
}

export interface MatchResult {
  itemId: string;
  matchedBy: ItemSourceMatch;
  status: ItemSourceRefStatus;
  confidence: number;
}

/** Case, accent and punctuation insensitive; the source's casing is not stable. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * An in memory index of the catalog's items, built once per run.
 *
 * Catalog is owner curated and small by construction, so the whole index fits in
 * memory. Asking catalog per product would be 4,232 NATS round trips on top of
 * 4,232 HTTP ones, which would make the broker, not the source, the thing this
 * run is impolite to.
 */
export class ItemMatchIndex {
  private readonly byEan = new Map<string, ItemView>();
  private readonly byNameKey = new Map<string, ItemView[]>();

  constructor(items: ItemView[]) {
    for (const item of items) {
      if (item.ean) {
        this.byEan.set(item.ean, item);
      }
      // The Spanish name, because the discovery snapshot is Spanish (plan 0038,
      // section 6.2). An English only item (plan 0079) lands in a bucket a
      // Spanish snapshot rarely hits, which is right: a name match is a
      // candidate at best, and this one is a weaker candidate than most.
      const key = nameKey(
        item.name.es ?? item.name.en ?? '',
        item.brand,
        item.unitSize
      );
      const bucket = this.byNameKey.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        this.byNameKey.set(key, [item]);
      }
    }
  }

  /**
   * Rungs 2 and 3. Rung 1 is not here: it is a lookup in `item_source_refs`,
   * which the runner already holds and which does not need an index.
   */
  match(candidate: MatchCandidate): MatchResult | null {
    if (candidate.ean) {
      const byEan = this.byEan.get(candidate.ean);
      if (byEan) {
        return {
          itemId: byEan.id,
          matchedBy: ItemSourceMatch.EAN,
          status: ItemSourceRefStatus.ACTIVE,
          confidence: 1,
        };
      }
    }

    const key = nameKey(candidate.name, candidate.brand, candidate.unitSize);
    const bucket = this.byNameKey.get(key);
    // Exactly one item under the key, or it is not a match: two products that
    // normalize the same are precisely the case where guessing does harm.
    if (bucket && bucket.length === 1) {
      return {
        itemId: bucket[0].id,
        matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
        status: ItemSourceRefStatus.CANDIDATE,
        confidence: 0.6,
      };
    }
    return null;
  }
}

function nameKey(
  name: string,
  brand: string | null,
  unitSize: number | null
): string {
  return [
    normalizeName(name),
    brand ? normalizeName(brand) : '',
    unitSize === null ? '' : String(Number(unitSize)),
  ].join('|');
}
