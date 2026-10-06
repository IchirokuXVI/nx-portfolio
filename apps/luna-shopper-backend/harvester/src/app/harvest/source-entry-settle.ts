import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceSourceKind,
  SourceEntryStatus,
  type SettleItemAtChainResult,
  type SourceEntryPriceWithheld,
  type StatedItemPrice,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { SourceCatalogEntry } from '../entities';
import { CatalogClient } from './catalog-client.service';
import {
  SourceEntryPriceWriter,
  statementsOf,
  type StatedPrice,
} from './source-entry-write';

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
 * ## What it does, for one product and one chain
 *
 * It reads the rows of the chain that are `ACTIVE` and bound to the product,
 * and for each scope of the chain and each kind a run writes:
 *
 * - **No bound row holds an open price there.** The price rows of the
 *   product that a run wrote there are removed. A row a person typed is not.
 * - **The bound rows state one price there** (`decideArticles`). The rows
 *   observed at that statement's instant or later are removed, and the price
 *   is written again, so the current row is the one a bound row states. The
 *   earlier rows are history and stay.
 * - **The bound rows state two amounts there.** Nothing is removed and
 *   nothing is written: the price that was current before stays and ages
 *   (decision 2A), and the answer names the rows.
 *
 * Then, **only when no bound row of the chain names the product at all**, the
 * offers of the product in the scopes of the chain and the shop rows runs
 * wrote for it go. A chain that lists a product sells it (plan 0182), so one
 * bound row keeps every offer. Catalog decides each offer: a price, a
 * person's shop row or a person's own write keeps it.
 *
 * ## Catalog owns the deletes
 *
 * Two messages, `itemPrice.withdraw` and `supermarketItem.withdraw`. This
 * class writes to no catalog table. It decides what the bound rows state, and
 * that is all the harvester knows that catalog does not.
 *
 * ## It is safe to run twice
 *
 * A second call finds what the first left and agrees with it. A dry run asks
 * catalog the same two questions with `dryRun`, sends no price, and answers
 * the same shape.
 */
@Injectable()
export class SourceEntrySettler {
  private readonly logger = new Logger(SourceEntrySettler.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly catalog: CatalogClient,
    private readonly priceWriter: SourceEntryPriceWriter
  ) {}

  async settle(
    itemId: string,
    supermarketId: string,
    options: { dryRun?: boolean } = {}
  ): Promise<SettleItemAtChainResult> {
    const dryRun = options.dryRun === true;
    const bound = await this.entries.find({
      where: { supermarketId, itemId, status: SourceEntryStatus.ACTIVE },
      relations: { prices: true },
      order: { decidedAt: 'ASC', id: 'ASC' },
    });
    const scopeIds = (await this.catalog.listAllPriceScopes(supermarketId)).map(
      (scope) => scope.id
    );
    const known = new Set(scopeIds);

    // What the bound rows state, at the scopes catalog still holds. A scope
    // deleted since the price was read has nothing to settle and nowhere to
    // write to.
    const statements = statementsOf(bound, new Date()).filter((statement) =>
      known.has(statement.priceScopeId)
    );
    const stated: StatedItemPrice[] = [];
    const restate: { sourceKind: PriceSourceKind; price: StatedPrice }[] = [];
    const pricesWithheld: SourceEntryPriceWithheld[] = [];
    for (const { priceScopeId, sourceKind, verdict } of statements) {
      if (verdict.send === null) {
        stated.push({ priceScopeId, sourceKind, observedAt: null });
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
      stated.push({
        priceScopeId,
        sourceKind,
        observedAt: verdict.send.stated.observedAt.toISOString(),
      });
      restate.push({ sourceKind, price: verdict.send });
    }

    const withdrawn =
      scopeIds.length === 0
        ? { deleted: 0, removed: [], recomputed: 0 }
        : await this.catalog.withdrawPrices(
            itemId,
            scopeIds,
            RUN_WRITTEN_KINDS,
            stated,
            dryRun
          );

    // After the delete, so the row written is newer than everything left at
    // its scope and kind and is the current one whatever the ids say.
    if (!dryRun) {
      for (const { sourceKind, price } of restate) {
        await this.priceWriter.send(itemId, sourceKind, price.stated);
      }
    }

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
      pricesRestated: restate.length,
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
        `${result.pricesRestated} restated, ` +
        `${result.offersRemoved.length} offer(s) and ` +
        `${result.shopRowsRemoved + result.shopRowsCleared} shop row(s) removed.`
    );
    return result;
  }
}
