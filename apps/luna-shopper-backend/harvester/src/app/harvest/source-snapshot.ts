import {
  ItemSourceRefStatus,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { ItemSourceRef, SourceCatalogEntry } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { ItemMatchIndex } from './matching';

/**
 * The three things every catalog discovery does with what it fetched, whichever
 * chain it fetched from (plan 0038, section 6.2; plan 0085, section 9).
 *
 * They live here rather than on a runner because there are two runners now. A
 * Mercadona walk and a DEZA crawl differ entirely in how they enumerate a
 * chain's assortment and in what the source is able to say about a product; they
 * do **not** differ in what a snapshot row is, in when an `item_source_refs` row
 * may be re-derived, or in how the match index is loaded. Copying that into the
 * second runner is how the two would start disagreeing about a rule neither of
 * them owns.
 */

/** Everything an upsert writes, i.e. the snapshot minus what the row manages. */
export type SourceEntryFields = Omit<
  SourceCatalogEntry,
  'id' | 'createdAt' | 'updatedAt' | 'supermarketId'
>;

export interface UpsertOutcome {
  created?: number;
  updated?: number;
  unchanged?: number;
}

/**
 * Upsert one snapshot row.
 *
 * It is also what makes **resuming free** (plan 0038, section 6.3): an aborted
 * run leaves rows with a fresh `lastSeenAt`, so a re-run skips what it already
 * has by reading that timestamp. There is no checkpoint to replay, only a
 * snapshot that is already the answer.
 */
export async function upsertSourceEntry(
  entries: Repository<SourceCatalogEntry>,
  supermarketId: string,
  fields: SourceEntryFields
): Promise<UpsertOutcome> {
  const existing = await entries.findOne({
    where: { supermarketId, externalId: fields.externalId },
  });
  if (!existing) {
    await entries.save(entries.create({ supermarketId, ...fields }));
    return { created: 1 };
  }

  const changed =
    numeric(existing.price) !== numeric(fields.price) ||
    numeric(existing.unitPrice) !== numeric(fields.unitPrice) ||
    existing.name !== fields.name ||
    existing.sizeFormat !== fields.sizeFormat ||
    existing.ean !== fields.ean ||
    existing.brand !== fields.brand;

  Object.assign(existing, fields, { supermarketId });
  await entries.save(existing);
  return changed ? { updated: 1 } : { unchanged: 1 };
}

/**
 * Rung 1 of the matching ladder, then rungs 2 and 3 through the index.
 *
 * An existing ref is only **touched**, never re-derived: once the owner has
 * confirmed or rejected a link, a later run does not get to change its mind.
 *
 * Answers the item the source product resolved to, or null. A DEZA run needs
 * that answer to say anything at all about a shop, because per shop availability
 * is stated per catalog item and a product that matched nothing has no item to
 * state it for.
 */
export async function refreshItemSourceRef(
  refs: Repository<ItemSourceRef>,
  input: {
    supermarketId: string;
    externalId: string;
    externalUrl: string | null;
    candidate: Parameters<ItemMatchIndex['match']>[0];
    index: ItemMatchIndex;
    refByExternalId: Map<string, ItemSourceRef>;
    seenAt: Date;
  }
): Promise<string | null> {
  const existing = input.refByExternalId.get(input.externalId);
  if (existing) {
    existing.lastSeenAt = input.seenAt;
    existing.lastResolvedAt = input.seenAt;
    existing.externalUrl = input.externalUrl;
    await refs.save(existing);
    return existing.itemId;
  }

  const match = input.index.match(input.candidate);
  if (!match) {
    return null;
  }

  const created = await refs.save(
    refs.create({
      itemId: match.itemId,
      supermarketId: input.supermarketId,
      externalId: input.externalId,
      externalUrl: input.externalUrl,
      matchedBy: match.matchedBy,
      status: match.status,
      confidence: match.confidence,
      lastSeenAt: input.seenAt,
      lastResolvedAt:
        match.status === ItemSourceRefStatus.ACTIVE ? input.seenAt : null,
    })
  );
  input.refByExternalId.set(input.externalId, created);
  return created.itemId;
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
