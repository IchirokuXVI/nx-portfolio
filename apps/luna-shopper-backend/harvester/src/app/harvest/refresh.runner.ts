import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceRefStatus,
  PriceSourceKind,
  type SupermarketItemBatchEntry,
} from '@portfolio/luna-shopper/contracts';
import { MercadonaClient } from '@portfolio/luna-shopper/mercadona';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { ItemSourceRef, SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';

export interface RefreshInput {
  supermarketId: string;
  priceScopeId: string;
}

/**
 * `REFRESH` (plan 0038, section 6.4): re-fetch detail for the items that already
 * have an ACTIVE ref and write their prices for the requested scope.
 *
 * **Cost is proportional to the items the owner actually tracks, not to the
 * chain's assortment**, which is the whole reason `item_source_refs` exists. A
 * chain with 4,232 products and twenty tracked items costs twenty requests.
 *
 * A CANDIDATE ref is deliberately excluded: it came from a fuzzy name match, and
 * writing a price through one would put a wrong number on a real product that
 * users then shop on.
 *
 * Section 6.5 is enforced on catalog's side, per entry, and the entries it
 * declined come back in `skipped` so the run reports the disagreement rather than
 * swallowing it.
 *
 * **The public version of this**, open to every user behind a platform wide cap
 * of one fetch per five minutes, is deferred to backlog 0006 until Redis exists.
 * Nothing here changes when it lands: it adds a caller and a gate in front of a
 * run mode that already exists.
 */
@Injectable()
export class RefreshRunner {
  private readonly logger = new Logger(RefreshRunner.name);

  constructor(
    @InjectRepository(ItemSourceRef)
    private readonly refs: Repository<ItemSourceRef>,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
    input: RefreshInput,
    source: SupermarketSource
  ): Promise<void> {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    if (!settings.mercadonaEnabled) {
      throw new Error(
        'MERCADONA_ENABLED is false, so this deployment does not fetch from ' +
          'Mercadona (plan 0038, section 8.1).'
      );
    }

    const warehouse = readWarehouse(source.config);
    const client = new MercadonaClient({
      warehouse,
      userAgent: settings.userAgent,
      baseUrl: settings.mercadonaBaseUrl,
      acquire: context.acquire,
      signal: context.signal,
    });

    await context.setStage('SELECT', 'Selecting the tracked items');
    const tracked = await this.refs.find({
      where: {
        supermarketId: input.supermarketId,
        status: ItemSourceRefStatus.ACTIVE,
      },
    });
    // A MANUAL ref is the owner's own link and is refreshed exactly like an
    // ACTIVE one; it is only the fuzzy CANDIDATEs that stay out.
    const manual = await this.refs.find({
      where: {
        supermarketId: input.supermarketId,
        status: ItemSourceRefStatus.MANUAL,
      },
    });
    const all = [...tracked, ...manual];

    await context.setTotalPlanned(all.length);
    this.logger.log(
      `Run ${context.runId}: refreshing ${all.length} tracked item(s) in ` +
        `warehouse ${warehouse}`
    );

    await context.setStage('FETCH', `Re-fetching ${all.length} item(s)`);
    const observedAt = new Date();
    const entries: SupermarketItemBatchEntry[] = [];
    const unavailable: string[] = [];

    await runWorkerPool({
      items: all,
      workers: source.workers,
      signal: context.signal,
      handle: async (ref) => {
        const product = await client.fetchProduct(ref.externalId, ['es'], {
          observedAt,
        });

        if (!product) {
          // Not stocked in this warehouse. That sets availability rather than
          // failing anything, and it deliberately carries no price: a stale
          // price on an unavailable product is worse than none.
          unavailable.push(ref.itemId);
          await context.report({ processed: 1, notFound: 1 });
          return;
        }

        entries.push({
          itemId: ref.itemId,
          price: product.price,
          currency: product.currency,
          unitPrice: product.unitPrice,
          unitPriceLabel: product.unitPriceLabel,
          available: true,
          priceObservedAt: observedAt.toISOString(),
        });
        ref.lastSeenAt = observedAt;
        ref.lastResolvedAt = observedAt;
        await this.refs.save(ref);
        await context.report({ processed: 1 });
      },
      onError: async (error, ref) => {
        this.logger.warn(
          `Run ${context.runId}: item ${ref.itemId} (${ref.externalUrl ?? ref.externalId}) failed: ${String(error)}`
        );
        await context.report({ failed: 1 });
      },
    });

    // Flush what was fetched, including after an abort: prices already fetched
    // are valid data (section 6.6).
    await context.setStage('WRITE', `Writing ${entries.length} price(s)`);
    await this.writePrices(context, input.priceScopeId, entries, unavailable);
    await context.flush();
  }

  private async writePrices(
    context: RunContext,
    priceScopeId: string,
    entries: SupermarketItemBatchEntry[],
    unavailable: string[]
  ): Promise<void> {
    const batches: SupermarketItemBatchEntry[][] = [];
    const all = [
      ...entries,
      ...unavailable.map((itemId) => ({ itemId, available: false })),
    ];
    for (let i = 0; i < all.length; i += 200) {
      batches.push(all.slice(i, i + 200));
    }

    for (const batch of batches) {
      const result = await this.catalog.upsertPrices(
        priceScopeId,
        batch,
        PriceSourceKind.OFFICIAL_API
      );
      await context.report({
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
      });
      for (const disagreement of result.skipped) {
        // Reported rather than silent: a price the owner typed in is left alone
        // (section 6.5), and a disagreement nobody can see is the same as having
        // no rule at all.
        this.logger.log(
          `Run ${context.runId}: item ${disagreement.itemId} kept its ` +
            `${disagreement.storedSourceKind} price of ${disagreement.storedPrice}; ` +
            `the source said ${disagreement.fetchedPrice}`
        );
      }
    }
  }
}

function readWarehouse(config: Record<string, unknown>): string {
  const warehouse = config['warehouse'];
  if (typeof warehouse === 'string' && warehouse.trim().length > 0) {
    return warehouse.trim();
  }
  throw new Error(
    'This source has no `warehouse` in its config. Resolve one from a postal ' +
      'code first (plan 0038, section 2.2) and set it with supermarketSource.upsert.'
  );
}
