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
 * It is the start of rung 4's key ({@link siblingKey} adds the unit size) **and**,
 * hashed, the `externalId` of a source that has no product id of its own (plan
 * 0086, D2). Both halves of that sentence are the point: a DEZA listing and a
 * DEZA leaflet printing the same name and size land on one row through rung 1,
 * and a Mercadona product a leaflet named first is proposed to the walk that
 * later finds its id through rung 4.
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
  return createHash('sha1')
    .update(entryNameKey(name, sizeFormat))
    .digest('hex');
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

    const key = itemNameKey(
      candidate.name,
      candidate.brand,
      candidate.unitSize
    );
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
 * Rung 4's key: {@link entryNameKey}, a pipe, then the unit size (plan 0155).
 *
 * **The size is part of it because the size format alone is not a size.**
 * Mercadona states only the unit there (`l`), so a key of name and format put a
 * 0.33 l can and a 1 l bottle under one key, and 260 of 273 Mercadona
 * candidates pointed at another size of the same product. The number is
 * normalized, because Postgres answers a `numeric` column as text (`"0.3300"`).
 *
 * It is not {@link entryNameKey}, and that one must not change: hashed, it is
 * also the row identity of a source with no id of its own.
 */
export function siblingKey(
  name: string,
  sizeFormat: string | null,
  unitSize: number | string | null | undefined
): string {
  const size =
    unitSize === null || unitSize === undefined ? NaN : Number(unitSize);
  return `${entryNameKey(name, sizeFormat)}|${
    Number.isFinite(size) ? String(size) : ''
  }`;
}

/**
 * The chain's own rows, keyed by {@link siblingKey} (plan 0086, section 4,
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
    const key = siblingKey(row.name, row.sizeFormat, row.unitSize);
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
  match(
    name: string,
    sizeFormat: string | null,
    unitSize: number | string | null
  ): SiblingProposal | null {
    const siblings = (
      this.byNameKey.get(siblingKey(name, sizeFormat, unitSize)) ?? []
    ).filter((row) => row.status !== SourceEntryStatus.REJECTED);
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

/**
 * Which rows of one chain carry each EAN (plan 0155).
 *
 * Rung 2 binds by EAN only when exactly one row of the chain carries it.
 * Mercadona gives one EAN to five cuts of one fish, and binding all five to the
 * one product that holds the EAN wrote five prices onto it, and a shopper saw
 * whichever was written last.
 *
 * Keyed by `externalId`, the row identity, so a row counts once however often
 * it is observed. It holds the rows the session loaded, and every chunk
 * {@link note}s its observations **before** the ladder runs, so the first cut
 * in a chunk already sees the siblings that come after it in the same chunk.
 */
export class ChainEanIndex {
  private readonly holders = new Map<string, Set<string>>();
  private readonly eanOf = new Map<string, string>();

  constructor(rows: Iterable<Pick<SourceCatalogEntry, 'externalId' | 'ean'>>) {
    for (const row of rows) {
      this.note(row.externalId, row.ean);
    }
  }

  /**
   * The EAN a row carries now. Null takes the row out of the count, which is
   * what a full observation with no EAN writes onto the row.
   */
  note(externalId: string, ean: string | null): void {
    const previous = this.eanOf.get(externalId) ?? null;
    if (previous === ean) {
      return;
    }
    if (previous !== null) {
      this.holders.get(previous)?.delete(externalId);
      this.eanOf.delete(externalId);
    }
    if (ean) {
      this.eanOf.set(externalId, ean);
      const bucket = this.holders.get(ean);
      if (bucket) {
        bucket.add(externalId);
      } else {
        this.holders.set(ean, new Set([externalId]));
      }
    }
  }

  /** True when more than one row of the chain carries this EAN. */
  shared(ean: string | null): boolean {
    return ean !== null && (this.holders.get(ean)?.size ?? 0) > 1;
  }

  /** The external ids of the rows that carry this EAN. */
  holdersOf(ean: string): string[] {
    return [...(this.holders.get(ean) ?? [])];
  }
}

/** A catalog location, as the default shop match sees it (plan 0084, section 6). */
export interface LocationCandidate {
  id: string;
  label: LocalizedText | null;
  address: string | null;
  /** Read by {@link rankLocations} only. The exact match ignores it. */
  postalCode: string | null;
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

/** A location {@link rankLocations} proposes, and how well it fits. */
export interface RankedLocation {
  location: LocationCandidate;
  score: number;
  strong: boolean;
}

/** The lowest share of printed tokens a proposal may hold. */
export const LOCATION_CANDIDATE_MIN_SCORE = 0.5;

/** The most proposals one printed shop name gets. */
export const LOCATION_CANDIDATES_MAX = 3;

/**
 * Words a street name carries that say nothing about which street it is. A
 * printed "Avda. de Libia" and an address "Avenida de Libia" differ only in
 * these.
 */
const LOCATION_STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'c',
  'calle',
  'avda',
  'avenida',
]);

/** A street number: "48" in "Isla de Fuerteventura 48". A postal code is not one. */
const STREET_NUMBER = /^\d{1,4}$/;

/**
 * The chain's shops a printed shop name may be, best first (plan 0154, section 1).
 *
 * **This proposes and never maps.** The exact match in {@link LocationNameIndex}
 * is the only automated binding, and it is exact because a wrong binding writes
 * availability onto the wrong shop. What this returns goes into the queue for a
 * person, on the same rule plan 0081 states for printed product names.
 *
 * The score is the share of the printed name's tokens that the location's
 * label, address or postal code holds, after {@link normalizeName} and after
 * dropping stop words and street numbers from the printed name. A location
 * holding every token is `strong`. Anything under
 * {@link LOCATION_CANDIDATE_MIN_SCORE} is dropped, and ties fall to the
 * location id, so the same input always gives the same list.
 */
export function rankLocations(
  printedName: string,
  locations: readonly LocationCandidate[]
): RankedLocation[] {
  const wanted = [...new Set(printedTokens(printedName))];
  if (wanted.length === 0) {
    return [];
  }

  const ranked: RankedLocation[] = [];
  for (const location of locations) {
    const held = new Set(
      [...namesOf(location), location.postalCode ?? ''].flatMap(tokensOf)
    );
    const found = wanted.filter((token) => held.has(token)).length;
    const score = found / wanted.length;
    if (score >= LOCATION_CANDIDATE_MIN_SCORE) {
      ranked.push({ location, score, strong: found === wanted.length });
    }
  }

  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.location.id < b.location.id
          ? -1
          : a.location.id > b.location.id
            ? 1
            : 0)
    )
    .slice(0, LOCATION_CANDIDATES_MAX);
}

function printedTokens(printedName: string): string[] {
  return tokensOf(printedName).filter(
    (token) => !LOCATION_STOP_WORDS.has(token) && !STREET_NUMBER.test(token)
  );
}

function tokensOf(text: string): string[] {
  return normalizeName(text).split(' ').filter(Boolean);
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
