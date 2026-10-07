import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceSourceKind,
  SourceEntryStatus,
  type HeldItemPrice,
  type LeftItemPrice,
  type SettleItemAtChainResult,
  type SourceEntryPriceWithheld,
  type StatedItemPrice,
  type WithdrawItemPricesResult,
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
import {
  priceValuesOf,
  sameStatement,
  statementsOf,
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
 * with every price row they hold, and tells catalog three things:
 *
 * - **What the bound rows hold** (`held`): each price row, open or closed, by
 *   scope, kind and run.
 * - **What they state now** (`stated`): for a scope and kind at which the
 *   open prices come to one price (`decideArticles`), that price.
 * - **Which runs the row that left names** (`left`): the run of each price
 *   the leaving row holds. A decision knows the row it moved or rejected.
 *   The route a person calls knows of none.
 *
 * Catalog then removes, in one transaction with the write of what is stated:
 *
 * - Every run written price row at a scope where no bound row holds a price.
 * - At a scope where one does, only the rows of a run the leaving row names
 *   and no bound row names, and the rows of a statement's own run that
 *   contradict the statement from its instant on.
 *
 * ## Why a held scope is spared whole
 *
 * A source row holds one price per scope, and that price names one run. It
 * does not say what the row wrote before. A row a website and a leaflet both
 * print wrote under two kinds (plan 0190). A file import of last week's
 * document leaves the row holding an older observation than the one catalog
 * shows. So "no bound row states this" does not make a row of catalog a
 * leftover. Only the run of the row that left does.
 *
 * ## The kind of a price is on the price
 *
 * A leaflet price on a row that says `OFFICIAL_WEB` is still a leaflet price,
 * and catalog holds it as one. So each price is read under the kind on its
 * own row (`source_entry_prices.sourceKind`, plan 0190), never under the kind
 * of the source row, which says who owns the text.
 *
 * A price from before plan 0190 can have no kind, when the migration could
 * not read one. For such a price the run in its `runId` is asked once more
 * ({@link sourceKindsOfRuns}): the run can be readable now, for example when
 * the chain has a source row again.
 *
 * **A price that neither names a kind has no kind**, and then nothing is
 * stated at its scope.
 *
 * ## When nothing is stated at a scope and kind that has open prices
 *
 * - The bound rows state two amounts (decision 2A). The answer names them.
 * - The bound rows agree on the amount and differ in a label, a currency or
 *   a window. Catalog holds those as two rows, and stating one would remove
 *   the other.
 * - A bound row holds a **closed** price there that was observed at the
 *   statement's instant or later. Stating the open price would remove it.
 *
 * ## A statement is not always the current price
 *
 * Catalog can hold a newer row at the scope and kind, written by a run that
 * nobody names. It stays, and the answer names the statement in
 * `pricesNotCurrent` and does not count it in `pricesRestated`.
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
 * It sends the same lists, catalog finds every row saying what is stated,
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
    options: {
      dryRun?: boolean;
      /**
       * The prices of the row a decision just took off the product. Absent
       * on the route a person calls, which knows of no such row.
       */
      leaving?: readonly SourceEntryPrice[];
    } = {}
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
    // The kind on the price row. The run is asked only for a price that has
    // none, which is a row from before plan 0190.
    const runKinds = await sourceKindsOfRuns(
      this.runs,
      this.sources,
      prices
        .filter((price) => !price.sourceKind)
        .map((price) => price.runId)
        .filter((id): id is string => !!id)
    );
    const kindOf = (price: SourceEntryPrice): PriceSourceKind | null =>
      price.sourceKind ??
      (price.runId ? runKinds.get(price.runId) : undefined) ??
      null;

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
    for (const { priceScopeId, sourceKind, verdict, articles } of statements) {
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
      // Rows of one amount that are a label or a window apart are two rows
      // in catalog. Stating one would remove the other, so neither is.
      const variants =
        !verdict.send.soldByWeight &&
        articles.some((other) => !sameStatement(other.stated, price));
      if (variants) {
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

    // The runs the row that left names, one per scope it priced.
    const left = new Map<string, LeftItemPrice>();
    for (const price of options.leaving ?? []) {
      if (price.runId && known.has(price.priceScopeId)) {
        left.set(`${price.priceScopeId}|${price.runId}`, {
          priceScopeId: price.priceScopeId,
          sourceRunId: price.runId,
        });
      }
    }

    const withdrawn: WithdrawItemPricesResult =
      scopeIds.length === 0
        ? {
            deleted: 0,
            removed: [],
            inserted: 0,
            confirmed: 0,
            keptAsWritten: [],
            notWritable: [],
            notCurrent: [],
            recomputed: 0,
          }
        : await this.catalog.withdrawPrices(
            itemId,
            scopeIds,
            RUN_WRITTEN_KINDS,
            { held: [...held.values()], stated, left: [...left.values()] },
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
      // What is stated and is what catalog shows: not a statement catalog
      // did not apply, and not one a newer row of another run outranks.
      pricesRestated:
        stated.length -
        withdrawn.keptAsWritten.length -
        withdrawn.notWritable.length -
        withdrawn.notCurrent.length,
      pricesNotCurrent: withdrawn.notCurrent,
      pricesNotWritable: withdrawn.notWritable,
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
