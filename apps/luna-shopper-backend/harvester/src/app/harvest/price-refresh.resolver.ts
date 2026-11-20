import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceRefreshRefusal,
  SourceEntryStatus,
  type PriceScopeView,
  type PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { CatalogClient } from './catalog-client.service';

/** The pair resolved to one row of the chain (section 3, steps 1, 2 and 4). */
export interface ResolvedRefresh {
  entry: SourceCatalogEntry;
  /** The scope the shopper asked about. */
  priceScopeId: string;
  /** The scope the price was read at: the origin of a copy, or the scope itself. */
  fetchScopeId: string;
  /** The stored observation time at the fetch scope, or null when unknown. */
  observedAt: Date | null;
  /** Every price row of the entry, which the copies of step 4 are read from. */
  rows: readonly SourceEntryPrice[];
}

/** Why the pair did not resolve, or the resolution. */
export type RefreshResolution =
  | { refused: PriceRefreshRefusal; observedAt: Date | null }
  | ({ refused: null } & ResolvedRefresh);

/** The fetch key and the scopes a page may name (section 3, step 3). */
export interface RefreshScopes {
  /** The `externalKey` of the fetch scope: a warehouse, or a region. */
  fetchKey: string;
  /** A source's own key to a scope of the same kind as the fetch scope. */
  scopeIdFor: (scopeKey: string) => string | null;
}

/**
 * Which product and which scope (plan 0216, section 3), from the harvester's
 * own tables and with no call to core.
 *
 * The same resolution answers the status read and the request, so a client is
 * never told "refreshable" for a pair that the request then refuses for a
 * reason the read did not state.
 */
@Injectable()
export class PriceRefreshResolver {
  constructor(
    @InjectRepository(SourceEntryPrice)
    private readonly prices: Repository<SourceEntryPrice>,
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly catalog: CatalogClient
  ) {}

  /**
   * Steps 1, 2 and 4: the `ACTIVE` row of this item with a price at this
   * scope, the scope the price was read at, and the rows its copies are on.
   *
   * `sourceKind` is the kind a walk of the chain stamps. A row of that kind at
   * the scope is preferred, because it is the row a refresh rewrites. A price
   * of another kind at the scope (a leaflet's) still proves that the harvester
   * priced the product there.
   */
  async resolve(
    itemId: string,
    priceScopeId: string,
    sourceKindFor: (supermarketId: string) => Promise<PriceSourceKind | null>
  ): Promise<RefreshResolution> {
    const atScope = await this.prices
      .createQueryBuilder('price')
      .innerJoin(SourceCatalogEntry, 'entry', 'entry.id = price."entryId"')
      .where('price."priceScopeId" = :priceScopeId', { priceScopeId })
      .andWhere('entry."itemId" = :itemId', { itemId })
      .andWhere('entry.status = :status', { status: SourceEntryStatus.ACTIVE })
      .getMany();
    const entryIds = [...new Set(atScope.map((row) => row.entryId))];
    if (entryIds.length === 0) {
      return { refused: PriceRefreshRefusal.NOT_HARVESTED, observedAt: null };
    }
    if (entryIds.length > 1) {
      // A walk settles between them; a refresh fetches one product.
      return { refused: PriceRefreshRefusal.AMBIGUOUS, observedAt: null };
    }
    const entry = await this.entries.findOne({ where: { id: entryIds[0] } });
    if (!entry) {
      return { refused: PriceRefreshRefusal.NOT_HARVESTED, observedAt: null };
    }

    const kind = await sourceKindFor(entry.supermarketId);
    const rows = await this.prices.find({ where: { entryId: entry.id } });
    const asked = pick(
      atScope.filter((row) => row.entryId === entry.id),
      kind
    );
    const fetchScopeId = asked?.copiedFromScopeId ?? priceScopeId;
    const atFetch = pick(
      rows.filter((row) => row.priceScopeId === fetchScopeId),
      kind
    );
    return {
      refused: null,
      entry,
      priceScopeId,
      fetchScopeId,
      observedAt: (atFetch ?? asked)?.observedAt ?? null,
      rows: kind === null ? [] : rows.filter((row) => row.sourceKind === kind),
    };
  }

  /**
   * Step 3: the fetch scope's own key, read from catalog, and the scopes of the
   * same kind a page may name beside it. Null when catalog holds no key for the
   * fetch scope, which nothing can fetch.
   */
  async scopes(
    supermarketId: string,
    fetchScopeId: string
  ): Promise<RefreshScopes | null> {
    const held = await this.catalog.listAllPriceScopes(supermarketId);
    const fetchScope = held.find((scope) => scope.id === fetchScopeId);
    if (!fetchScope?.externalKey) {
      return null;
    }
    const byKey = new Map<string, string>();
    for (const scope of held) {
      if (sameTier(scope, fetchScope) && scope.externalKey) {
        byKey.set(scope.externalKey, scope.id);
      }
    }
    return {
      fetchKey: fetchScope.externalKey,
      scopeIdFor: (scopeKey) => byKey.get(scopeKey) ?? null,
    };
  }
}

/**
 * The copy targets of a scope that the row already has (section 3, step 4): the
 * rows of the entry whose `copiedFromScopeId` is that scope. A refresh adds no
 * copy target the row does not already have.
 */
export function copiesOfRows(
  rows: readonly SourceEntryPrice[]
): (priceScopeId: string) => readonly string[] {
  return (priceScopeId) =>
    rows
      .filter((row) => row.copiedFromScopeId === priceScopeId)
      .map((row) => row.priceScopeId);
}

/** The row of the walk's kind, or else the newest row of any kind. */
function pick(
  rows: readonly SourceEntryPrice[],
  kind: PriceSourceKind | null
): SourceEntryPrice | undefined {
  return (
    rows.find((row) => kind !== null && row.sourceKind === kind) ??
    [...rows].sort(
      (a, b) =>
        new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
    )[0]
  );
}

/** A source's key names a scope of the tier it was read at, and no other. */
function sameTier(scope: PriceScopeView, fetchScope: PriceScopeView): boolean {
  return scope.kind === fetchScope.kind;
}
