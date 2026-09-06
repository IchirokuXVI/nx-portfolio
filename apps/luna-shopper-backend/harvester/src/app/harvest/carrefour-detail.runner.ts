import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CarrefourClient,
  isSkippable,
} from '@portfolio/luna-shopper/carrefour';
import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import { IsNull, Not, Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { SourceCatalogEntry, type SupermarketSource } from '../entities';
import { CatalogClient } from './catalog-client.service';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { ItemMatchIndex } from './matching';
import type { RunContext } from './run-context';
import { loadCatalogItems } from './source-snapshot';

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
 * ## What it writes, and what it refuses to write
 *
 * The EAN, and a decision only where nobody has made one. A row that is
 * `UNRESOLVED` or a fuzzy `CANDIDATE` that no person has judged is promoted to
 * `ACTIVE` when its new EAN names a catalog item, because plan 0086 says an EAN
 * or a person is what makes a row `ACTIVE` and this is the EAN. A `REJECTED`
 * row, an `ACTIVE` one and anything carrying a `decidedAt` are left exactly as
 * they are: a run does not reopen a decision a person made.
 *
 * It writes **no price**. The prices are already on `source_entry_prices`,
 * written by the crawl, and the next crawl sends the ones these newly `ACTIVE`
 * rows are now owed. A backfill that wrote prices would be a second path into
 * the thing plan 0080 made one path.
 */
@Injectable()
export class CarrefourDetailRunner implements CatalogRunner {
  private readonly logger = new Logger(CarrefourDetailRunner.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const client = this.createClient(context, source);

    try {
      await context.setStage('BACKFILL', 'Finding products with no EAN');
      // The rows this run has anything to do: this chain's web rows that carry
      // a product page and no EAN. Everything else is already answered.
      const pending = await this.entries.find({
        where: {
          supermarketId: input.supermarketId,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          ean: IsNull(),
          url: Not(IsNull()),
        },
        order: { createdAt: 'ASC' },
        take: readBudget(source.config),
      });
      await context.setTotalPlanned(pending.length);
      this.logger.log(
        `Run ${context.runId}: ${pending.length} product(s) with no EAN yet`
      );
      if (pending.length === 0) {
        await context.flush();
        await context.setReport({ pending: 0, eansWritten: 0, resolved: 0 });
        return;
      }

      // One index for the whole run. Asking catalog per product would be a NATS
      // round trip on top of every one of thousands of page loads.
      const items = new ItemMatchIndex(await loadCatalogItems(this.catalog));

      await context.setStage(
        'DETAIL',
        `Reading ${pending.length} product page(s)`
      );
      let eansWritten = 0;
      let resolved = 0;
      let missing = 0;
      let skipped = 0;

      for (const row of pending) {
        if (context.signal.aborted) {
          // An aborted backfill keeps every EAN it already wrote. There is
          // nothing to roll back and nothing to replay.
          break;
        }
        try {
          const detail = await client.readDetail(row.url as string);
          if (!detail?.ean) {
            // **A missing EAN is a value, not an error.** Some pages carry
            // none; the row stays as it is and the fuzzy rung does its job.
            missing += 1;
            await context.report({ processed: 1, notFound: 1 });
            continue;
          }
          const promoted = await this.write(row, detail.ean, items);
          eansWritten += 1;
          if (promoted) {
            resolved += 1;
          }
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
        resolved,
        noEanOnTheirPage: missing,
        // Pages the storefront refused. Their rows keep no EAN, which is the
        // state they were already in, so the next backfill takes them again.
        refusedPages: skipped,
        pageLoads: client.loads,
      });
      this.logger.log(
        `Run ${context.runId}: ${eansWritten} EAN(s) written, ${resolved} ` +
          `row(s) resolved to an item, ${missing} page(s) printed none, ` +
          `${skipped} refused`
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

  /**
   * Write the EAN, and resolve the row only when nobody has decided it.
   *
   * The two groups of `source_catalog_entries` are the contract (plan 0086,
   * section 3.1): the source's columns, which every run rewrites, and the
   * decision columns, which a run only reads. This writes one of the first
   * group always, and one of the second **only** for a row that carries no
   * decision at all, which is the case the EAN rung exists for.
   */
  private async write(
    row: SourceCatalogEntry,
    ean: string,
    items: ItemMatchIndex
  ): Promise<boolean> {
    row.ean = ean;
    const undecided =
      row.decidedAt === null &&
      (row.status === SourceEntryStatus.UNRESOLVED ||
        row.status === SourceEntryStatus.CANDIDATE);
    const match = undecided
      ? items.match({
          ean,
          name: row.name,
          brand: row.brand,
          unitSize: row.unitSize === null ? null : Number(row.unitSize),
        })
      : null;
    // Only the EAN rung promotes here. A name match on this pass would be a
    // fuzzy proposal made by a run whose whole reason for existing is that it
    // now has the identifier that makes fuzziness unnecessary.
    const promoted = match?.matchedBy === ItemSourceMatch.EAN;
    if (promoted && match) {
      row.itemId = match.itemId;
      row.status = SourceEntryStatus.ACTIVE;
      row.matchedBy = ItemSourceMatch.EAN;
      row.confidence = match.confidence;
      row.decidedAt = new Date();
    }
    // `lastSeenAt`, `lastRunId` and `timesSeen` are deliberately untouched.
    // This run did not observe the product in the assortment, it read one field
    // off its page, and a revert of this run must find nothing of its own to
    // delete.
    await this.entries.save(row);
    return promoted;
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

/**
 * How many product pages one backfill run may read, **the owner's number**.
 *
 * Unset means every row that still needs one, which is the overnight run
 * section 12.1 describes. A number is how an operator takes a bite instead: the
 * chain holds one run at a time, so a bounded backfill is what leaves room for
 * tomorrow's price crawl without anybody having to abort anything.
 */
function readBudget(config: Record<string, unknown>): number | undefined {
  const budget = Number(config['detailBudget']);
  return Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : undefined;
}
