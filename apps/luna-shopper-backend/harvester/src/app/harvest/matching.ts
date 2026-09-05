import {
  ItemSourceMatch,
  SourceEntryStatus,
  type ItemView,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import { createHash } from 'node:crypto';
import type { SourceCatalogEntry } from '../entities';

/**
 * The indexes the one ladder of plan 0086 section 4 climbs, and nothing else.
 *
 * The ladder itself lives in `source-ingest.ts`, because it is a sequence of
 * decisions about a row rather than a lookup. What is here is the two lookups it
 * makes: the catalog's items, for rungs 2 and 3, and the chain's own rows, for
 * rung 4.
 *
 * **A fuzzy rung never writes a price.** Only an EAN or a person makes a row
 * `ACTIVE`, and that has been the rule since backlog 0001 section 6.2 for the
 * same reason every time: a bad match writes a wrong price onto a real product
 * that people then shop on, which is worse than having no price.
 */

export interface MatchCandidate {
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
}

export interface MatchResult {
  itemId: string;
  matchedBy: ItemSourceMatch;
  status: SourceEntryStatus;
  confidence: number;
}

/** The confidence a fuzzy proposal carries, on either fuzzy rung. */
export const FUZZY_CONFIDENCE = 0.6;

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
 * The string a nameless product is identified by: its normalized name, a pipe,
 * then its normalized size text.
 *
 * It is rung 4's key **and**, hashed, the `externalId` of a source that has no
 * product id of its own (plan 0086, D2). Both halves of that sentence are the
 * point: a DEZA listing and a DEZA leaflet printing the same name and size land
 * on one row through rung 1, and a Mercadona product a leaflet named first is
 * proposed to the walk that later finds its id through rung 4.
 */
export function entryNameKey(name: string, sizeFormat: string | null): string {
  return `${normalizeName(name)}|${normalizeName(sizeFormat ?? '')}`;
}

/**
 * The identity of a product from a source that supplies no id (plan 0085,
 * section 6, generalized by plan 0086 D2).
 *
 * **The consequence, stated because it is real: a reworded description is a new
 * candidate and orphans the old one.** There is no id to notice that they are
 * the same product. The previous row stops being seen and ages out on
 * `lastSeenAt`, and an operator who had already accepted it sees a new candidate
 * for a product the catalog holds, which rung 4 then proposes a match for.
 */
export function entryKey(name: string, sizeFormat: string | null): string {
  return createHash('sha1').update(entryNameKey(name, sizeFormat)).digest('hex');
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
      // The Spanish name, because what a Spanish chain states is Spanish (plan
      // 0038, section 6.2). An English only item (plan 0079) lands in a bucket a
      // Spanish observation rarely hits, which is right: a name match is a
      // candidate at best, and this one is a weaker candidate than most.
      const key = itemNameKey(
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
   * Rungs 2 and 3. Rung 1 is not here: it is a lookup by `externalId` among the
   * chain's own rows, which the ingest already holds and which needs no index.
   */
  match(candidate: MatchCandidate): MatchResult | null {
    if (candidate.ean) {
      const byEan = this.byEan.get(candidate.ean);
      if (byEan) {
        return {
          itemId: byEan.id,
          matchedBy: ItemSourceMatch.EAN,
          status: SourceEntryStatus.ACTIVE,
          confidence: 1,
        };
      }
    }

    const key = itemNameKey(candidate.name, candidate.brand, candidate.unitSize);
    const bucket = this.byNameKey.get(key);
    // Exactly one item under the key, or it is not a match: two products that
    // normalize the same are precisely the case where guessing does harm.
    if (bucket && bucket.length === 1) {
      return {
        itemId: bucket[0].id,
        matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
        status: SourceEntryStatus.CANDIDATE,
        confidence: FUZZY_CONFIDENCE,
      };
    }
    return null;
  }
}

/** What rung 4 proposes: an item a sibling row resolved to, or the sibling. */
export interface SiblingProposal {
  itemId: string | null;
  entryId: string | null;
}

/**
 * The chain's own rows, keyed by {@link entryNameKey} (plan 0086, section 4,
 * rung 4).
 *
 * This is the rung that makes the one table worth having. The row this chain
 * already holds under the same name and size is, for a leaflet, the Mercadona
 * product the walk found, and for a DEZA leaflet the web listing. Two
 * observations of one product through two source kinds stay two rows and resolve
 * to one item, which is the many names per product per chain plan 0081 section 2
 * required and the old ref index forbade.
 *
 * A `REJECTED` sibling proposes nothing: the owner said that string is not a
 * product he tracks, and proposing it back through a neighbour reopens a
 * decision a run does not get to reopen.
 */
export class SiblingEntryIndex {
  private readonly byNameKey = new Map<string, SourceCatalogEntry[]>();

  constructor(rows: Iterable<SourceCatalogEntry>) {
    for (const row of rows) {
      this.add(row);
    }
  }

  /** Rows this run created are siblings too, from the moment they exist. */
  add(row: SourceCatalogEntry): void {
    const key = entryNameKey(row.name, row.sizeFormat);
    const bucket = this.byNameKey.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      this.byNameKey.set(key, [row]);
    }
  }

  /**
   * The proposal, or null when the chain holds no usable sibling.
   *
   * An `ACTIVE` sibling proposes its item, which is the answer the queue wants:
   * the admin sees a product the catalog already holds. Failing that, a lone
   * sibling with no item is proposed through `candidateEntryId`, so the admin can
   * create the item from whichever of the two rows carries the EAN and let both
   * resolve. Two siblings disagreeing about the item propose nothing, on the
   * same rule rung 3 uses: the ambiguous case is exactly where guessing harms.
   */
  match(name: string, sizeFormat: string | null): SiblingProposal | null {
    const siblings = (this.byNameKey.get(entryNameKey(name, sizeFormat)) ?? [])
      .filter((row) => row.status !== SourceEntryStatus.REJECTED);
    if (siblings.length === 0) {
      return null;
    }

    const itemIds = new Set(
      siblings
        .filter((row) => row.status === SourceEntryStatus.ACTIVE && row.itemId)
        .map((row) => row.itemId as string)
    );
    if (itemIds.size === 1) {
      return { itemId: [...itemIds][0], entryId: null };
    }
    if (itemIds.size > 1) {
      return null;
    }
    return siblings.length === 1
      ? { itemId: null, entryId: siblings[0].id }
      : null;
  }
}

/** A catalog location, as the default shop match sees it (plan 0084, section 6). */
export interface LocationCandidate {
  id: string;
  label: LocalizedText | null;
  address: string | null;
}

/**
 * The chain's shops, indexed by every name they answer to.
 *
 * **The default is an exact name match and nothing cleverer.** A source's
 * printed shop name is compared, normalized, against the chain's location labels
 * and addresses through the same {@link normalizeName} everything else uses.
 * Exactly one hit maps the shop; zero hits or more than one leaves it
 * `UNMAPPED`, where a person decides.
 *
 * Two names of one location that normalize alike still count once, which is why
 * the buckets hold a set of ids rather than a list: "Ronda del Marrubial" as
 * both the label and the address is one shop, not an ambiguity.
 */
export class LocationNameIndex {
  private readonly byName = new Map<string, Set<string>>();

  constructor(locations: LocationCandidate[]) {
    for (const location of locations) {
      for (const name of namesOf(location)) {
        const key = normalizeName(name);
        if (!key) {
          continue;
        }
        const bucket = this.byName.get(key);
        if (bucket) {
          bucket.add(location.id);
        } else {
          this.byName.set(key, new Set([location.id]));
        }
      }
    }
  }

  /** The one location this name is, or null when it is none or several. */
  match(printedName: string): string | null {
    const key = normalizeName(printedName);
    if (!key) {
      return null;
    }
    const bucket = this.byName.get(key);
    if (!bucket || bucket.size !== 1) {
      return null;
    }
    return [...bucket][0];
  }
}

function namesOf(location: LocationCandidate): string[] {
  const label = location.label;
  return [label?.es, label?.en, location.address].filter(
    (name): name is string => typeof name === 'string' && name.trim() !== ''
  );
}

function itemNameKey(
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
