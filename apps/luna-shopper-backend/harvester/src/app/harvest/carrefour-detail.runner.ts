import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CarrefourClient,
  isSkippable,
} from '@portfolio/luna-shopper/carrefour';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';

/**
 * The EAN backfill (plan 0090, section 12.1).
 *
 * A Carrefour listing card carries no EAN and the product page does, at
 * `pdp.product.ean`, and it is a real EAN-13. **That field matters more than
 * any other on the page**: an EAN is the top rung of plan 0086's ladder, so a
 * product that has one resolves to an existing item with no person in the loop,
 * and a product without one waits in the review queue, which is where DEZA sits
 * today.
 *
 * ## Why it is a run of its own
 *
 * A listing page carries 24 cards, so reading every product page is roughly
 * twenty times the crawl: an 851 load run becomes of the order of 18,000 loads,
 * which is most of a day at the pace the storefront tolerates. **Never block a
 * price crawl on that.** The crawl is the thing the product is for, it finishes
 * in an hour, and it is complete on its own terms.
 *
 * So this is **keyed on the product and not on the run**. An EAN does not
 * change, so a row that already holds one is never fetched again, and that is
 * the whole of its resume logic: stopping it costs nothing, because a row with
 * no EAN is exactly the state it started in, and starting it again picks up
 * where it stopped without a checkpoint to replay.
 *
 * ## What it reports, and what it refuses to report
 *
 * The EAN, on a product reported exactly as a walk reports one (plan 0103,
 * section 6.2). It used to load the rows itself, write the EAN itself and
 * promote the row itself, holding a repository and a `CatalogClient` for it.
 * The rows it reads pages for are prepared by the orchestrator now, and the
 * promotion is the ladder's: rung 1 promotes an undecided row when a new EAN
 * names a catalog item, which is plan 0086's rule stated in the one place that
 * writes rows. A `REJECTED` row, an `ACTIVE` one and anything carrying a
 * `decidedAt` are left exactly as they are.
 *
 * It reports **no price**. The prices are already on `source_entry_prices`,
 * written by the crawl, and the next crawl sends the ones these newly `ACTIVE`
 * rows are now owed. A backfill that wrote prices would be a second path into
 * the thing plan 0080 made one path.
 */
@Injectable()
export class CarrefourDetailRunner implements CatalogRunner {
  private readonly logger = new Logger(CarrefourDetailRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const client = this.createClient(context, source);

    try {
      await context.setStage('BACKFILL', 'Finding products with no EAN');
      // The rows this run has anything to do, prepared by the orchestrator: this
      // chain's rows that carry a product page and no EAN (plan 0103, 6.2).
      const pending = input.backfill ?? [];
      await context.setTotalPlanned(pending.length);
      this.logger.log(
        `Run ${context.runId}: ${pending.length} product(s) with no EAN yet`
      );
      if (pending.length === 0) {
        await context.flush();
        await context.setReport({ pending: 0, eansWritten: 0 });
        return;
      }

      await context.setStage(
        'DETAIL',
        `Reading ${pending.length} product page(s)`
      );
      const observedAt = new Date();
      let eansWritten = 0;
      let missing = 0;
      let skipped = 0;

      for (const row of pending) {
        if (context.signal.aborted) {
          // An aborted backfill keeps every EAN it already reported. There is
          // nothing to roll back and nothing to replay.
          break;
        }
        try {
          const detail = await client.readDetail(row.url);
          if (!detail?.ean) {
            // **A missing EAN is a value, not an error.** Some pages carry
            // none; the row stays as it is and the fuzzy rung does its job.
            missing += 1;
            await context.report({ processed: 1, notFound: 1 });
            continue;
          }
          // Reported exactly as a walk reports a product, minus the price. Rung
          // 1 rewrites the source group, which is where the EAN lands, and
          // promotes the row when that EAN names an item.
          report.product({
            externalId: row.externalId,
            // The row as the crawl described it, plus the one field this page
            // answers. The page carries no name, brand or size of its own.
            name: row.name,
            brand: row.brand,
            ean: detail.ean,
            unitSize: row.unitSize,
            sizeFormat: row.sizeFormat,
            categoryPath: row.categoryPath,
            url: row.url,
            observedAt,
            extra: null,
            // The crawl already wrote this chain's prices, and the next one
            // sends the ones these newly `ACTIVE` rows are owed.
            prices: [],
          });
          eansWritten += 1;
          await context.report({ processed: 1, updated: 1 });
        } catch (error) {
          this.logger.warn(
            `Run ${context.runId}: product ${row.externalId} ` +
              `(${row.url}) failed: ${String(error)}`
          );
          await context.report({ failed: 1 });
          // **An isolated refusal costs one product and nothing else**, and
          // here it costs even less than it does in the crawl: the row keeps no
          // EAN, which is the state it was already in, so the next backfill
          // picks it up for free. The storefront refuses an occasional page
          // with hundreds of clean loads either side, and a pass of thousands
          // that died on the first would never finish one.
          //
          // The block does stop it, because that one says every page after it
          // will fail too and be worse for having been asked.
          if (!isSkippable(error)) {
            throw error;
          }
          skipped += 1;
        }
      }

      await context.flush();
      await context.setReport({
        pending: pending.length,
        eansWritten,
        noEanOnTheirPage: missing,
        // Pages the storefront refused. Their rows keep no EAN, which is the
        // state they were already in, so the next backfill takes them again.
        refusedPages: skipped,
        pageLoads: client.loads,
      });
      // How many of those EANs resolved a row to an item is the ladder's answer
      // and no longer this runner's, so it is not counted here (plan 0103, D1).
      this.logger.log(
        `Run ${context.runId}: ${eansWritten} EAN(s) read, ${missing} ` +
          `page(s) printed none, ${skipped} refused`
      );
    } finally {
      await client.close();
    }
  }

  /**
   * The client this run drives. The same seam the price crawl has, for the same
   * reason: a test cannot have Chromium.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource
  ): CarrefourClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new CarrefourClient({
      baseUrl: readBaseUrl(source.config),
      userAgent: settings.userAgent,
      delayMs: readDelay(source.config),
      acquire: context.acquire,
      signal: context.signal,
    });
  }
}

/** The storefront, from the source row rather than the environment (plan 0083). */
function readBaseUrl(config: Record<string, unknown>): string | undefined {
  const baseUrl = config['baseUrl'];
  return typeof baseUrl === 'string' && baseUrl.trim() !== ''
    ? baseUrl.trim()
    : undefined;
}

/** Milliseconds between navigations. The client clamps it up and never down. */
function readDelay(config: Record<string, unknown>): number | undefined {
  const delay = Number(config['delayMs']);
  return Number.isFinite(delay) && delay > 0 ? Math.floor(delay) : undefined;
}

// `detailBudget`, the owner's cap on how many pages one backfill may read,
// moved to `run-executor.service.ts` with the row loading it bounds (plan 0103,
// section 6.2). It reads the same key of the same source row.
