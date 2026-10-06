import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceSourceKind,
  SourceEntryStatus,
  type HeldItemPrice,
  type SettleItemAtChainResult,
  type SourceEntryPriceWithheld,
  type StatedItemPrice,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import {
  HarvestRun,
  SourceCatalogEntry,
  SupermarketSource,
  type SourceEntryPrice,
} from '../entities';
import { CatalogClient } from './catalog-client.service';
import { sourceKindsOfRuns } from './run-source-kind';
import { priceValuesOf, statementsOf } from './source-entry-write';

/**
 * The kinds a harvest run writes a price as. Catalog refuses any other kind
 * on a withdraw, `ADMIN` first of all.
 */
const RUN_WRITTEN_KINDS: PriceSourceKind[] = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

/**
 * Settle a product at a chain (plan 0191): make catalog agree with the rows
 * of the chain that are bound to the product now.
 *
 * ## Why it exists
 *
 * A bound row writes on its product: a price per scope, an offer in every
 * scope that falls through to one of those, and a row per shop. Catalog names
 * the product, the scope, the kind and the run on what it holds, and never
 * the queue row. So when a person moves the row to another product, or
 * rejects it, the new product gets the prices and the old one keeps
 * everything, and no later run takes any of it back: a run speaks only for
 * the products its bound rows name, and after the move no row names the old
 * one.
 *
 * ## The rule for every doubt: the row stays
 *
 * The catalog this runs on was curated by hand. A price that stays when it
 * could have gone is a leftover a person can see and remove. A price that
 * goes when it should have stayed is gone, with its page and its text. So the
 * settle removes **only what no bound row accounts for**.
 *
 * ## What it does, for one product and one chain
 *
 * It reads the rows of the chain that are `ACTIVE` and bound to the product,
 * with every price row they hold, and tells catalog two things:
 *
 * - **What the bound rows hold** (`held`): each price row, open or closed, by
 *   scope, kind and run. Catalog removes nothing at such a scope and kind. A
 *   leaflet that ended last week keeps its rows.
 * - **What they state now** (`stated`): for a scope and kind at which the
 *   open prices come to one price (`decideArticles`), that price. Catalog
 *   removes the rows there that contradict it from its instant on, and makes
 *   it the current row, in one transaction.
 *
 * At every other scope and kind of the chain, the price rows of the product
 * that a run wrote are removed. A row a person typed is not.
 *
 * ## The kind of a price is its run's
 *
 * `entry.sourceKind` is rewritten by every full observation, and a row that a
 * website and a leaflet both print is one shared row (plan 0190). A leaflet
 * price on a row that says `OFFICIAL_WEB` today is still a leaflet price, and
 * catalog holds it as one. So each price is read under the kind of the run in
 * its `runId` ({@link sourceKindsOfRuns}), never under the row's.
 *
 * **A price whose run cannot be told has no kind**, and then every kind at
 * its scope is spared and nothing is stated there.
 *
 * ## When nothing is stated at a scope and kind that has open prices
 *
 * - The bound rows state two amounts (decision 2A). The answer names them.
 * - A bound row holds a **closed** price there that was observed at the
 *   statement's instant or later. Stating the open price would remove that
 *   row, and it is a bound row's own history.
 *
 * In both cases the scope and kind are still held, so nothing is removed.
 *
 * Then, **only when no bound row of the chain names the product at all**, the
 * offers of the product in the scopes of the chain and the shop rows runs
 * wrote for it go. A chain that lists a product sells it (plan 0182), so one
 * bound row keeps every offer. Catalog decides each offer: a price, a
 * person's shop row or a person's own write keeps it.
 *
 * ## Catalog owns the deletes and the write
 *
 * Two messages, `itemPrice.withdraw` and `supermarketItem.withdraw`. This
 * class writes to no catalog table and sends no price of its own: the price
 * that is stated travels inside the withdraw, so the removal and the write
 * cannot come apart.
 *
 * ## A second call does nothing
 *
 * It sends the same two lists, catalog finds every row saying what is stated,
 * and no row, no id and no trail row changes. A dry run asks catalog the same
 * with `dryRun` and answers the same shape.
 */
@Injectable()
export class SourceEntrySettler {
  private readonly logger = new Logger(SourceEntrySettler.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(HarvestRun)
    private readonly runs: Repository<HarvestRun>,
    @InjectRepository(SupermarketSource)
    private readonly sources: Repository<SupermarketSource>,
    private readonly catalog: CatalogClient
  ) {}

  async settle(
    itemId: string,
    supermarketId: string,
    options: { dryRun?: boolean } = {}
  ): Promise<SettleItemAtChainResult> {
    const dryRun = options.dryRun === true;
    const now = new Date();
    const bound = await this.entries.find({
      where: { supermarketId, itemId, status: SourceEntryStatus.ACTIVE },
      relations: { prices: true },
      order: { decidedAt: 'ASC', id: 'ASC' },
    });
    const scopeIds = (await this.catalog.listAllPriceScopes(supermarketId)).map(
      (scope) => scope.id
    );
    const known = new Set(scopeIds);

    // Every price row a bound row holds, at the scopes catalog still holds.
    // A scope deleted since the price was read has nothing to settle.
    const prices = bound.flatMap((entry) =>
      (entry.prices ?? []).filter((price) => known.has(price.priceScopeId))
    );
    const runKinds = await sourceKindsOfRuns(
      this.runs,
      this.sources,
      prices.map((price) => price.runId).filter((id): id is string => !!id)
    );
    const kindOf = (price: SourceEntryPrice): PriceSourceKind | null =>
      (price.runId ? runKinds.get(price.runId) : undefined) ?? null;

    const held = new Map<string, HeldItemPrice>();
    /** Scopes at which a bound row holds a price of no known kind. */
    const unknownAt = new Set<string>();
    for (const price of prices) {
      const sourceKind = kindOf(price);
      if (sourceKind === null) {
        unknownAt.add(price.priceScopeId);
      }
      const each: HeldItemPrice = {
        priceScopeId: price.priceScopeId,
        sourceKind,
        sourceRunId: price.runId ?? null,
      };
      held.set(`${each.priceScopeId}|${sourceKind}|${each.sourceRunId}`, each);
    }

    const stated: StatedItemPrice[] = [];
    const pricesWithheld: SourceEntryPriceWithheld[] = [];
    const statements = statementsOf(bound, now, {
      kindOf: (_entry, price) => kindOf(price),
    });
    for (const { priceScopeId, sourceKind, verdict } of statements) {
      if (!known.has(priceScopeId)) {
        continue;
      }
      if (verdict.send === null) {
        const ids = verdict.conflict.map((each) => each.entryId);
        for (const entryId of ids) {
          pricesWithheld.push({
            entryId,
            priceScopeId,
            otherEntryIds: ids.filter((id) => id !== entryId),
          });
        }
        continue;
      }
      const price = verdict.send.stated;
      if (price.runId === null || unknownAt.has(priceScopeId)) {
        continue;
      }
      // A closed price of a bound row, as new as the statement or newer: the
      // statement would remove its row. It stays, and nothing is stated.
      const closedNewer = prices.some(
        (other) =>
          other.priceScopeId === priceScopeId &&
          kindOf(other) === sourceKind &&
          other.validUntil !== null &&
          other.validUntil <= now &&
          other.observedAt.getTime() >= price.observedAt.getTime()
      );
      if (closedNewer) {
        continue;
      }
      stated.push({
        priceScopeId,
        sourceKind,
        sourceRunId: price.runId,
        copiedFromScopeId: price.copiedFromScopeId ?? null,
        price: priceValuesOf(price),
      });
    }

    const withdrawn =
      scopeIds.length === 0
        ? {
            deleted: 0,
            removed: [],
            inserted: 0,
            confirmed: 0,
            keptAsWritten: [],
            recomputed: 0,
          }
        : await this.catalog.withdrawPrices(
            itemId,
            scopeIds,
            RUN_WRITTEN_KINDS,
            [...held.values()],
            stated,
            dryRun
          );

    // A chain that lists a product sells it: one bound row keeps every offer.
    const offers =
      bound.length > 0
        ? null
        : await this.catalog.withdrawOffers(
            itemId,
            supermarketId,
            scopeIds,
            dryRun ? { assumePricesWithdrawn: RUN_WRITTEN_KINDS } : null
          );

    const result: SettleItemAtChainResult = {
      itemId,
      supermarketId,
      dryRun,
      boundEntryIds: bound.map((entry) => entry.id),
      pricesWithdrawn: withdrawn.deleted,
      pricesWithdrawnAt: withdrawn.removed,
      pricesRestated: stated.length - withdrawn.keptAsWritten.length,
      pricesWritten: withdrawn.inserted,
      pricesKeptAsWritten: withdrawn.keptAsWritten,
      pricesWithheld,
      offersRemoved: offers?.offersRemoved ?? [],
      offersKept: offers?.offersKept ?? [],
      shopRowsRemoved: offers?.shopRowsRemoved ?? 0,
      shopRowsCleared: offers?.shopRowsCleared ?? 0,
      shopRowConflicts: offers?.conflicts ?? [],
    };
    this.logger.log(
      `${dryRun ? 'Dry run: settling' : 'Settled'} item ${itemId} at chain ` +
        `${supermarketId} against ${bound.length} bound row(s): ` +
        `${result.pricesWithdrawn} price row(s) withdrawn, ` +
        `${result.pricesRestated} stated, ${result.pricesWritten} written, ` +
        `${result.offersRemoved.length} offer(s) and ` +
        `${result.shopRowsRemoved + result.shopRowsCleared} shop row(s) removed.`
    );
    return result;
  }
}
