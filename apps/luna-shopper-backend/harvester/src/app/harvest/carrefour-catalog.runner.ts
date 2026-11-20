import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CARREFOUR_CEILING,
  CARREFOUR_PAGE_SIZE,
  CarrefourClient,
  CarrefourHttpError,
  CarrefourShortCategoryError,
  photoAddressRead,
  type CarrefourCappedCategory,
  type CarrefourCategory,
  type CarrefourProduct,
} from '@portfolio/luna-shopper/carrefour';
import { HarvestWarningCode } from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { readDelistCountsCrawl } from './delisting';
import { photoOf } from './photo-address';
import { listingWarning, type RunContext } from './run-context';
import type { RunReport } from './run-report';
import type { SourceObservation } from './source-ingest';

/**
 * `CATALOG_DISCOVERY` against the `carrefour-web` adapter (plan 0090).
 *
 * The third adapter under one mode, and the second that renders a page rather
 * than answering JSON. **It writes prices**, which is what separates it from
 * DEZA: every card carries a price and a price per unit, and 0 of 192 sampled
 * products lacked one.
 *
 * The order (plan 0090, sections 7 and 12):
 *
 * 1. Walk the category tree and pick the frontier: the shallowest node under
 *    the paging ceiling on every branch. About 95 page loads.
 * 2. Page every category in the frontier, 756 loads for 17,135 category
 *    memberships, which deduplicate on the chain's product id as the run goes.
 * 3. Hand every product to {@link SourceIngest} as an observation carrying the
 *    price the card printed, at its first sighting (plan 0267). The sink writes
 *    a chunk each time `PRODUCT_CHUNK` products wait, so a walk that dies part
 *    way keeps the rows that were written, less what was still queued or in
 *    flight in the sink when it died.
 * 4. At the end of the walk, state every category path of each product (plan
 *    0268): the path of each frontier category that listed it, in walk order.
 *    They replace the stored paths only for a crawl declared whole, which
 *    paged every frontier category; any other crawl adds to them.
 *
 * **851 page loads, about 62 minutes.** The run is politeness bound and not
 * latency bound: the storefront tolerates one page every two seconds and
 * blocks on burst, so there is no worker pool here and adding one would buy a
 * block rather than a shorter run.
 *
 * **The browser is given back whatever happens.** A leaked Chromium is 300 MB
 * of resident memory in a pod sized for a Nest service, so `close` is in the
 * `finally` and not on the happy path.
 *
 * It reads no product page. The EAN lives there and is worth having, and
 * {@link CarrefourDetailRunner} is how: a backfill keyed on the product rather
 * than on the run, because a price crawl that waited for 18,000 loads is a
 * price crawl that never finishes.
 */
@Injectable()
export class CarrefourCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(CarrefourCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    requireScope(input.priceScopeId);
    // The plan is listings, so a listing paged is the unit of `processed` and
    // the ingest adds no products to it (plan 0217).
    context.countProgressItself();
    const client = this.createClient(context, source);

    try {
      // --- 1. The frontier ------------------------------------------------
      await context.setStage('FRONTIER', 'Finding the categories to page');
      const frontier = await client.walkCategories(readSeedPath(source.config));
      const planned = frontier.categories.reduce(
        (total, category) => total + category.totalResults,
        0
      );
      await context.setTotalPlanned(planned);
      /**
       * The plan as the run states it. It starts as the frontier's sum and is
       * raised when a category is found to have grown (owner decision 104b),
       * so growth alone does not take `processed` past `totalPlanned` (plan
       * 0217). Two things still can: a page that serves more cards than the
       * total it states, and a plan write that failed, which is logged and not
       * retried until the next category that grows.
       */
      const plan = { total: planned };
      this.logger.log(
        `Run ${context.runId}: ${frontier.categories.length} category(ies) ` +
          `holding ${planned} listing(s), found in ${frontier.loads} load(s)`
      );

      // --- 2. Every category, page by page --------------------------------
      await context.setStage(
        'ENUMERATE',
        `Paging ${frontier.categories.length} category(ies)`
      );
      /**
       * The id of every product the walk reported, in the order it was first
       * seen, with the path of each frontier category that listed it, in walk
       * order (plan 0268). The product itself went to the sink at its first
       * sighting (plan 0267), so this holds only what {@link declareListing},
       * {@link describeRun} and the paths call read at the end.
       */
      const products = new Map<string, string[][]>();
      const unreadable = [...frontier.unreadable];
      /**
       * Every frontier category that failed, by its url, in the order they
       * failed, and what cost it (plan 0251). One the end pass read stays
       * here with no error and leaves `unreadable`.
       */
      const lost = new Map<string, LostCategory>();
      /**
       * Every category the ceiling truncated: the frontier's capped nodes,
       * then each frontier category whose pages stated a total past the
       * ceiling while it was paged (owner decision 116b). Both are the same
       * fact, rows the storefront will not serve, so both land in the one
       * record and both keep the crawl from being declared whole.
       */
      const truncated: CarrefourCappedCategory[] = [...frontier.capped];
      let blocked: unknown = null;
      for (const category of frontier.categories) {
        // An abort, a person's or the refusal guard's (plan 0215), ends the
        // crawl and not the run: what was read is reported below.
        if (context.signal.aborted) {
          break;
        }
        const cursor: WalkCursor = {
          page: 0,
          total: category.totalResults,
          stated: null,
        };
        try {
          await this.pageCategory(
            context,
            client,
            report,
            category,
            products,
            cursor,
            plan
          );
        } catch (error) {
          // **The block is the one failure a category may not swallow** (plan
          // 0090, section 13). Refusals that have stopped being isolated say
          // the address is in the state section 4 describes, and every page
          // after that deepens it, so the crawl stops here and the run fails
          // once what it already read is written.
          if (error instanceof SourceBlockedError) {
            this.logger.warn(`Run ${context.runId}: ${String(error)}`);
            unreadable.push(category.url);
            await context.report({ failed: 1 });
            blocked = error;
            break;
          }
          // A person's abort cut this category short. Its products read so
          // far are in the map, and it is named as unread.
          if (context.signal.aborted) {
            unreadable.push(category.url);
            break;
          }
          // Anything else costs one category. It is counted, logged and named
          // in the report, which is the same shape an unreadable node produces
          // and reads the same way to an operator. A category the walk ended
          // early on a 5xx, a 404 or an empty page that still states rows
          // lands here too, so it is not counted as read. Only the end pass
          // can change that, for a refusal or a 5xx it reads the second time.
          this.logger.warn(
            `Run ${context.runId}: category ${category.id} (${category.name}) ` +
              `failed: ${String(error)}`
          );
          unreadable.push(category.url);
          // One the end pass will never ask is counted now. One it may ask
          // waits for {@link countUnread}, so a category it reads is never
          // counted and no count is taken back.
          const counted = !askable(error);
          lost.set(category.url, {
            category,
            page: cursor.page,
            total: cursor.total,
            stated: cursor.stated,
            error,
            askedAgain: false,
            counted,
          });
          if (counted) {
            await context.report({ failed: 1 });
          }
        } finally {
          // Whether the walk ended or failed: a page that stated a total past
          // the ceiling says rows go unserved however the walk ended.
          this.noteCeiling(context, truncated, category, cursor.stated);
        }
      }

      // --- 2b. Once more, at the end, for a refusal or a 5xx --------------
      if (blocked === null && !context.signal.aborted) {
        blocked = await this.askAgain(
          context,
          client,
          report,
          products,
          unreadable,
          lost,
          plan,
          truncated
        );
      }
      // After the pass, or in its place when a block, an abort or a refusal
      // in a row kept it from starting: every lost category still unread.
      await countUnread(context, lost);

      // --- 3. What only the whole walk can say -----------------------------
      // Every product was reported at its first sighting (plan 0267), and the
      // sink wrote a chunk each time one filled. What is left of the last
      // chunk is written when the run drains, so the stage says "writing".
      await context.setStage(
        'INGEST',
        `Finishing the walk: writing the last of ${products.size} product(s) read`
      );
      if (!context.signal.aborted) {
        warnUnread(context, unreadable, lost);
      }
      const whole = declareListing(report, products.keys(), {
        switchOn: readDelistCountsCrawl(source.config),
        seedPath: readSeedPath(source.config) !== undefined,
        blocked: blocked !== null,
        truncated: truncated.length > 0,
        unreadable: unreadable.length > 0,
        aborted: context.signal.aborted,
      });
      // Every path of every product, after the walk and before the drain (plan
      // 0268). Never on an observation: a streamed one was written at the
      // first sighting, before the later categories were paged.
      for (const [externalId, paths] of products) {
        if (paths.length > 0) {
          report.categoryPaths(externalId, paths, whole ? 'REPLACE' : 'ADD');
        }
      }

      await context.flush();
      await context.setReport(
        describeRun(
          frontier.categories,
          truncated,
          unreadable,
          [...lost.values()].filter((entry) => entry.askedAgain),
          products.size,
          client.loads,
          blocked
        )
      );
      // A blocked crawl returns here too, after the snapshot. The guard's stop
      // aborted the run, so the executor ends it FAILED with its reason and
      // keeps every product it read (plan 0215, section 6.2). Prices already
      // fetched are valid data (plan 0038, section 6.6); what a block costs is
      // the rest of the crawl, not the part that worked.
    } finally {
      // Including when the run aborted, and including when it never opened a
      // page (plan 0090, section 11).
      await client.close();
    }
  }

  /**
   * The client this run drives.
   *
   * **A seam and not a knob.** Chromium is the one thing about this run a test
   * cannot have, so a test hands back a client built on a fake page loader.
   * Nothing in the runtime overrides it.
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
      // The run's own bucket, so the rate the owner set on this row is a rate
      // the source sees on top of the floor the client already keeps.
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
  }

  /**
   * One category, every page of it, each product reported at its first
   * sighting (plan 0267).
   *
   * **17,135 is a count of category memberships and not of distinct products**
   * (plan 0090, section 7). A product filed in two frontier categories is
   * listed twice, and the first sighting is the one kept: a product genuinely
   * filed in two places has no one true category, and the first is as good an
   * answer as the last. The path of every sighting is kept for its category
   * paths (plan 0268).
   */
  private async pageCategory(
    context: RunContext,
    client: CarrefourClient,
    report: RunReport,
    category: CarrefourCategory,
    products: Map<string, string[][]>,
    cursor: WalkCursor,
    plan: { total: number }
  ): Promise<void> {
    let seen = 0;
    const before = cursor.total;
    // The page after the last one that answered is the page that failed, and
    // the one the end pass starts from (plan 0251). The total is the one that
    // bounds the walk's last page (owner decision 104b), and the stated one
    // is uncapped, so the caller can tell the ceiling bound (116b).
    const walk = client.walkCategory(
      category,
      (_listing, page, total, stated) => {
        cursor.page = page + 1;
        cursor.total = Math.max(cursor.total, total);
        cursor.stated = largerStated(cursor.stated, stated);
      }
    );
    let failure: { error: unknown } | null = null;
    try {
      for await (const product of walk) {
        seen += 1;
        reportFirstSighting(report, products, product);
      }
    } catch (error) {
      failure = { error };
    }
    // **Progress, and a heartbeat with it.** The first crawl reported nothing
    // between the frontier and the snapshot, so an hour of paging looked
    // identical to a run that had stopped, and it was a stopped run that
    // showed it. A category is the smallest unit worth a row: 86 of them over
    // an hour is a number that moves, without a write per page. A category
    // that failed part way counts the listings it did page.
    await this.settle(context, plan, before, cursor.total, seen, failure);
  }

  /**
   * The end of one walk of a category: the plan restated, then its progress,
   * then the walk's own error, if it threw.
   *
   * The plan is written before the progress, so a category that grew does not
   * take `processed` past it.
   *
   * **A failed plan write is logged and never thrown** (owner decision 122a).
   * It concerns a progress figure only. Thrown after a walk that read every
   * page, it reached the caller as the category's failure, and a category
   * read whole was counted unreadable and lost and kept the crawl from being
   * declared whole. It never skips the progress report either.
   *
   * **The walk's error wins.** A failed progress report may not replace an
   * error the walk is already throwing, because a caller tells a block from a
   * cut by that error's class: a `SourceBlockedError` that turned into a
   * database error would leave the run crawling a source that is blocking it.
   * So when the walk threw, a failed progress report is logged and the walk's
   * error is thrown. When the walk did not throw, a failed progress report is
   * thrown as it comes.
   */
  private async settle(
    context: RunContext,
    plan: { total: number },
    before: number,
    after: number,
    seen: number,
    failure: { error: unknown } | null
  ): Promise<void> {
    try {
      await restatePlan(context, plan, before, after);
    } catch (error) {
      this.logger.warn(
        `Run ${context.runId}: the planned total was not restated: ` +
          String(error)
      );
    }
    if (failure === null) {
      await context.report({ processed: seen });
      return;
    }
    try {
      await context.report({ processed: seen });
    } catch (error) {
      this.logger.warn(
        `Run ${context.runId}: the progress was not reported: ` + String(error)
      );
    }
    throw failure.error;
  }

  /**
   * Name a frontier category in `truncatedCategories` when a page of its walk
   * stated a total past the ceiling (owner decision 116b).
   *
   * The frontier keeps a node over the ceiling out of the paging and names it
   * `capped`. A category the frontier saw under the ceiling can still state
   * more while it is paged, 900 at the frontier and 1,100 on its pages; the
   * walk then reads its 1,008 rows and ends with no error. Counted as read
   * whole, it would let the crawl be declared whole, delist and replace
   * paths with rows unseen. So it gets the same record as a capped node, with
   * the total its pages stated, and the same consequence: the crawl is
   * `truncated` and not whole. The products it did read are reported as
   * every other category's are.
   *
   * Once per category: the end pass of the same category raises the recorded
   * total and adds no second entry.
   */
  private noteCeiling(
    context: RunContext,
    truncated: CarrefourCappedCategory[],
    category: CarrefourCategory,
    stated: number | null
  ): void {
    if (stated === null || stated <= CARREFOUR_CEILING) {
      return;
    }
    const known = truncated.find((entry) => entry.id === category.id);
    if (known) {
      known.totalResults = Math.max(known.totalResults, stated);
      return;
    }
    this.logger.warn(
      `Run ${context.runId}: category ${category.id} (${category.name}) ` +
        `states ${stated} results, past the paging ceiling of ` +
        `${CARREFOUR_CEILING}, so it is truncated: the rows past the ceiling ` +
        `were not read`
    );
    truncated.push({
      id: category.id,
      name: category.name,
      url: category.url,
      path: [...category.path],
      totalResults: stated,
    });
  }

  /**
   * The end pass of plan 0251 (D1 a): every category one isolated refusal
   * cost, asked for once more, after every other category, in the order they
   * failed. A category a 5xx cut short is asked in the same pass, in the same
   * order, by the same rules (owner decision 103b): a 5xx is usually a passing
   * blip, and the guard was never told of a refusal for it, so asking it again
   * minutes later costs no more than any other page.
   *
   * **Each category is asked once in the pass and no more.** `askedAgain` is
   * set before the ask, the list is fixed before the first one, and a
   * category the pass cuts short again stays unread. So the pass asks at most
   * one walk per lost category, each from the page that failed to at most the
   * ceiling's 42 pages.
   *
   * **This is not the retry plan 0090 section 13 forbids.** That retry asks
   * the refused page again at once, inside the paging loop, which is how a
   * refusal deepens into a block. This is one more walk per category, from
   * the page that failed, minutes later, through the same guard and pacing as
   * every other page. A category is paged from the page that failed, and the
   * products it gives are reported as the walk reports them.
   *
   * **A retry must never deepen a block** (plan 0090, section 13), and the
   * pass keeps two rules so that it cannot:
   *
   * - **It does not start while the guard counts a refusal in a row.** A walk
   *   that ended on a refusal hands the pass a guard one or two refusals from
   *   its stop, and the pass would ask the refused categories back to back.
   * - **It stops at its first refusal.** A category refused again says the
   *   refusal was not isolated after all, and the next ask is the request
   *   that reaches the stop.
   *
   * So a guard that stops on two or more refusals in a row, as
   * `CARREFOUR_REFUSAL_POLICY` does with three, never stops the run inside
   * the pass: the pass meets at most one refusal, after a count of none. A
   * guard with a window rule can still stop on that one refusal, when the walk
   * left enough refusals inside its window, and then the pass answers the
   * block. A stop there turns a completed walk into a `FAILED` run, sends the
   * refusal mail of plan 0218, counts toward the three failures that stop the
   * chain's schedules, and loses the `LISTING_UNREAD` warnings, which only a
   * run that was not stopped writes. A category the pass did not ask keeps
   * the warning the walk gave it, and the one refused again keeps its warning
   * with the offset of the second refusal.
   *
   * **It also stops after {@link END_PASS_FAILURES_IN_A_ROW} failures in a
   * row that are not refusals** (owner decision 118b). A storefront that is
   * down fails every ask, and the pass would otherwise walk every lost
   * category into it. A category read resets the count. A category the pass
   * did not ask keeps the warning the walk gave it, without "once more".
   *
   * Only a refusal and a 5xx are asked again ({@link askable}). A browser that
   * stopped answering is a different failure, and a node the frontier walk
   * could not open was never paged at all. Answers the block, when one stopped
   * the pass.
   */
  private async askAgain(
    context: RunContext,
    client: CarrefourClient,
    report: RunReport,
    products: Map<string, string[][]>,
    unreadable: string[],
    lost: ReadonlyMap<string, LostCategory>,
    plan: { total: number },
    truncated: CarrefourCappedCategory[]
  ): Promise<unknown> {
    const again = [...lost.values()].filter((entry) => askable(entry.error));
    if (again.length === 0) {
      return null;
    }
    const inARow = context.guard?.consecutiveRefusals ?? 0;
    if (inARow > 0) {
      this.logger.warn(
        `Run ${context.runId}: the walk ended on ${inARow} refusal(s) in a ` +
          `row, so ${again.length} category(ies) are not asked again`
      );
      return null;
    }
    await context.setStage(
      'ENUMERATE',
      `Asking once more for ${again.length} category(ies) the walk could not finish`
    );
    let failuresInARow = 0;
    for (const [index, entry] of again.entries()) {
      if (context.signal.aborted) {
        return null;
      }
      if (failuresInARow >= END_PASS_FAILURES_IN_A_ROW) {
        this.logger.warn(
          `Run ${context.runId}: the end pass failed ${failuresInARow} ` +
            `time(s) in a row, so ${again.length - index} category(ies) ` +
            `are not asked again`
        );
        return null;
      }
      entry.askedAgain = true;
      try {
        await this.pageFrom(context, client, report, entry, products, plan);
      } catch (error) {
        if (error instanceof SourceBlockedError) {
          this.logger.warn(`Run ${context.runId}: ${String(error)}`);
          return error;
        }
        if (context.signal.aborted) {
          return null;
        }
        // It stays unread, with what cost it the second time.
        this.logger.warn(
          `Run ${context.runId}: category ${entry.category.id} ` +
            `(${entry.category.name}) failed again: ${String(error)}`
        );
        entry.error = error;
        if (error instanceof CarrefourHttpError) {
          // Refused again: the pass ends here, and every category after this
          // one keeps the warning the walk gave it.
          return null;
        }
        // Cut short again, by a 5xx or anything else: it stays unread and is
        // not asked a third time, and the pass goes on to the next one,
        // unless this was the failure that ends it (owner decision 118b).
        failuresInARow += 1;
        continue;
      } finally {
        this.noteCeiling(context, truncated, entry.category, entry.stated);
      }
      // Read this time: it is no longer unread, and so it is never counted
      // in `failed`, which counts the categories the run did not read.
      failuresInARow = 0;
      entry.error = null;
      unreadable.splice(unreadable.indexOf(entry.category.url), 1);
    }
    return null;
  }

  /**
   * One category, from the page that failed to its last.
   *
   * The library's walk always starts at the first page, and a category of
   * 40 pages refused on its 30th need not ask for 29 again. It is the
   * library's walk from that page, so the pacing, the session handling, the
   * guard and the rule for a category cut short are the walk's own: a gap
   * here throws, and the category stays unread.
   */
  private async pageFrom(
    context: RunContext,
    client: CarrefourClient,
    report: RunReport,
    entry: LostCategory,
    products: Map<string, string[][]>,
    plan: { total: number }
  ): Promise<void> {
    const { category } = entry;
    let seen = 0;
    const before = entry.total;
    // The page after the last one that answered is the page that failed. The
    // walk starts bounded by the total the first walk learned, not only the
    // frontier's: the pages it now reads may state none, and a category that
    // grew must still be paged to the end that walk saw (owner decision 104b).
    const walk = client.walkCategory(
      category,
      (_listing, page, total, stated) => {
        entry.page = page + 1;
        entry.total = Math.max(entry.total, total);
        entry.stated = largerStated(entry.stated, stated);
      },
      { fromPage: entry.page, knownTotal: entry.total }
    );
    let failure: { error: unknown } | null = null;
    try {
      for await (const product of walk) {
        seen += 1;
        reportFirstSighting(report, products, product);
      }
    } catch (error) {
      failure = { error };
    }
    await this.settle(context, plan, before, entry.total, seen, failure);
  }
}

/**
 * A product at its first sighting, to the sink, and its id kept for the end of
 * the walk (plan 0267). A later sighting reports nothing.
 *
 * **17,135 is a count of category memberships and not of distinct products**
 * (plan 0090, section 7). The first sighting is the one kept, so its category
 * path is the one the observation carries.
 *
 * Every sighting keeps the path of its frontier category for the end of the
 * walk (plan 0268), once, so the first path is the one `categoryPath` holds.
 * The names are the chain's, verbatim.
 */
function reportFirstSighting(
  report: RunReport,
  products: Map<string, string[][]>,
  product: CarrefourProduct
): void {
  const path = product.categoryPath;
  const paths = products.get(product.externalId);
  if (paths) {
    if (path.length > 0 && !paths.some((other) => sameNames(other, path))) {
      paths.push([...path]);
    }
    return;
  }
  products.set(product.externalId, path.length > 0 ? [[...path]] : []);
  report.product(observationOf(product, new Date()));
}

/**
 * Raise the run's planned total by what one category was found to have grown
 * (owner decision 104b), and write it before the category's progress.
 *
 * The plan is the frontier's sum of totals, and a walk now reads past a total
 * that grew, so without this `processed` could pass `totalPlanned` (plan 0217,
 * section 4). Only ever raised: a category that shrank keeps its planned
 * share, as it did before.
 */
async function restatePlan(
  context: RunContext,
  plan: { total: number },
  before: number,
  after: number
): Promise<void> {
  if (after <= before) {
    return;
  }
  plan.total += after - before;
  await context.setTotalPlanned(plan.total);
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * One product as its card describes it, and the price the card printed.
 *
 * **A card with no readable price reports no price** (plan 0090, section 12).
 * Some products are priced by weight and print no figure, and a zero there is
 * a lie about a real product.
 *
 * The EAN is null on every observation, because the listing card carries
 * none. Until the backfill has run, every row resolves through the fuzzy rung
 * of plan 0086 and waits for a person, which is where DEZA sits today.
 *
 * It states no completeness here. A Carrefour crawl walks a frontier of
 * categories, and a product filed nowhere in it is unseen for a reason that
 * says nothing about stock. The crawl is handed over as a whole listing only
 * under the six conditions of {@link declareListing}.
 *
 * `observedAt` is the time the card was read (plan 0267). The price writer
 * needs no one value per run: it compares the values, and moves the clock of
 * a confirmed row only forward.
 */
function observationOf(
  product: CarrefourProduct,
  observedAt: Date
): SourceObservation {
  return {
    externalId: product.externalId,
    name: product.name,
    brand: product.brand,
    // The listing card has none. The detail pass fills it, keyed on the
    // product, and never from here.
    ean: null,
    unitSize: product.unitSize,
    sizeUnit: product.sizeUnit,
    sizeFormat: product.sizeFormat,
    packCount: product.packCount,
    categoryPath: product.categoryPath,
    url: product.path,
    // The card's `images.desktop`, else `images.mobile` (plan 0198).
    imageUrl: photoOf(photoAddressRead(product), product.externalId),
    observedAt,
    extra: null,
    // An empty array is a card with no readable price. Carrefour names no
    // scope of its own, so the one price it states falls to the run's
    // default (plan 0103, section 3.2).
    prices:
      product.priceCents === null && product.unitPriceCents === null
        ? []
        : [
            {
              scopeKey: null,
              price: centsToUnits(product.priceCents),
              currency: 'EUR',
              // Stored as printed and never recomputed. The field exists so
              // a shopper can compare, and a derivation that disagrees with
              // the chain in the last cent is worse than useless.
              unitPrice: centsToUnits(product.unitPriceCents),
              unitPriceLabel: product.unitPriceLabel,
              // A storefront price has no window: it is what the till
              // charges until the storefront says otherwise.
              validFrom: null,
              validUntil: null,
            },
          ],
  };
}

/**
 * How many asks of the end pass may fail in a row, with something other than
 * a refusal, before the pass stops (owner decision 118b).
 *
 * A refusal already ends the pass at once (plan 0251). A 5xx does not, so a
 * storefront that is down would be asked for every lost category, 86 in the
 * worst case, each one failing. Three in a row says the failures are no
 * longer isolated blips that a second ask repairs, and every ask after that
 * is load on a site that is not answering. One failure, or two, is still
 * what the pass exists to repair, which is why the number is not one.
 */
const END_PASS_FAILURES_IN_A_ROW = 3;

/** Where a walk of one category got to, as its pages told it. */
interface WalkCursor {
  /** The page after the last one that held cards. */
  page: number;
  /** The total that bounds the walk, never above the ceiling. */
  total: number;
  /**
   * The largest total a page stated, uncapped, or null while none stated
   * one. Past the ceiling, the category is truncated (owner decision 116b).
   */
  stated: number | null;
}

/** The larger of two stated totals, where null is a page that stated none. */
function largerStated(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.max(a, b);
}

/** A frontier category the crawl did not finish, and what cost it. */
interface LostCategory {
  category: CarrefourCategory;
  /** The page that failed, from 0. The end pass starts there. */
  page: number;
  /** The largest total a page of a walk of it stated, uncapped (116b). */
  stated: number | null;
  /**
   * The largest total a walk of it was bounded by: the frontier's, or larger
   * when a page stated that the category grew (owner decision 104b), and
   * never above the ceiling, so a category whose pages state 1,200 warns "of
   * 1008".
   */
  total: number;
  /** What it failed with, or null once the end pass read it. */
  error: unknown;
  /** Whether the end pass asked for it once more. */
  askedAgain: boolean;
  /**
   * Whether it is in `failed` yet. A category the end pass will never ask is
   * counted when it fails; one it may ask, when the pass has settled it.
   */
  counted: boolean;
}

/**
 * Count in `failed` every lost category the end pass left unread and that is
 * not counted yet, once (plan 0251).
 *
 * `failed` counts categories the run did not read, and it feeds the failure
 * ratio the executor reads when the run ends. A category the pass read is
 * not one of them, so the count of an askable category waits for the pass
 * rather than being taken back: the counters only ever add. A category the
 * pass did not reach, because a refusal, three failures in a row, an abort
 * or a block stopped it, is counted here as unread.
 */
async function countUnread(
  context: RunContext,
  lost: ReadonlyMap<string, LostCategory>
): Promise<void> {
  let unread = 0;
  for (const entry of lost.values()) {
    if (!entry.counted && entry.error !== null) {
      entry.counted = true;
      unread += 1;
    }
  }
  if (unread > 0) {
    await context.report({ failed: unread });
  }
}

/**
 * Whether the end pass asks a lost category once more (plan 0251, owner
 * decision 103b).
 *
 * A refusal, a 403 or a 429, and a category a 5xx cut short. A category a 404
 * or an empty page cut short is not asked: those are answers about the page
 * rather than a passing failure, and minutes later they are expected to answer
 * the same. A browser that stopped answering is not asked either.
 */
function askable(error: unknown): boolean {
  return (
    error instanceof CarrefourHttpError ||
    (error instanceof CarrefourShortCategoryError && error.transient)
  );
}

/**
 * One `LISTING_UNREAD` per category the crawl did not read (plan 0251).
 *
 * The run still ends `COMPLETED`, and these are what say it is partial. A
 * category that failed part way names the offset it failed at: the listings
 * before it were read and are kept. A node the frontier walk could not open
 * is named by its address, since its name and everything under it were never
 * seen.
 */
function warnUnread(
  context: RunContext,
  unreadable: readonly string[],
  lost: ReadonlyMap<string, LostCategory>
): void {
  for (const url of unreadable) {
    const entry = lost.get(url);
    if (!entry) {
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_UNREAD,
          url,
          `The category page ${url} did not answer while the tree was ` +
            `walked, so nothing filed under it was read.`
        )
      );
      continue;
    }
    const { category } = entry;
    const offset = entry.page * CARREFOUR_PAGE_SIZE;
    const cost =
      entry.error instanceof CarrefourHttpError
        ? `Carrefour answered ${entry.error.status}`
        : entry.error instanceof CarrefourShortCategoryError
          ? entry.error.cost
          : String(entry.error);
    const again = entry.askedAgain ? ', once more at the end of the run' : '';
    context.warn(
      listingWarning(
        HarvestWarningCode.LISTING_UNREAD,
        category.name,
        `Category ${category.id} ${category.name}: ${cost} at offset ` +
          `${offset}${again}. The listings from there on, of ` +
          `${entry.total}, were not read.`
      )
    );
  }
}

/**
 * The crawl as a whole listing of the default scope, or why it is not one
 * (plan 0220, section 15.4).
 *
 * Whole only when the chain's own `delistCountsCrawl` is on, no seed path
 * narrowed the walk, nothing blocked it, no category was capped at the paging
 * ceiling (by the frontier, or by a total its pages stated), no category was unreadable or cut short by a page that failed part
 * way through it, and the run was not aborted. The doubt
 * that remains is a product filed in no frontier category, which nobody has
 * measured: the switch stays off until two clean crawls were compared. A crawl
 * that is not whole declares nothing and is named with the first reason.
 *
 * Answers whether it declared the crawl whole. Only a whole crawl paged every
 * frontier category a product is filed in, so only then can its category
 * paths replace the stored ones (plan 0268).
 */
function declareListing(
  report: RunReport,
  products: Iterable<string>,
  crawl: {
    switchOn: boolean;
    seedPath: boolean;
    blocked: boolean;
    truncated: boolean;
    unreadable: boolean;
    aborted: boolean;
  }
): boolean {
  if (crawl.aborted) {
    return false;
  }
  const reason = !crawl.switchOn
    ? 'switch-off'
    : crawl.seedPath
      ? 'seed-path'
      : crawl.blocked
        ? 'blocked'
        : crawl.truncated
          ? 'truncated'
          : crawl.unreadable
            ? 'unreadable'
            : null;
  if (reason !== null) {
    report.listingNotWhole(null, reason);
    return false;
  }
  report.listingWhole(null, products);
  return true;
}

/** What a run has to say about itself beyond its counters. */
function describeRun(
  frontier: readonly CarrefourCategory[],
  capped: readonly CarrefourCappedCategory[],
  unreadable: readonly string[],
  askedAgain: readonly LostCategory[],
  products: number,
  loads: number,
  blocked: unknown
): Record<string, unknown> {
  return {
    frontierCategories: frontier.length,
    listingsInFrontier: frontier.reduce((t, c) => t + c.totalResults, 0),
    distinctProducts: products,
    pageLoads: loads,
    /**
     * **The honest artifact** (plan 0090, section 7). A category over the
     * ceiling with no children cannot be enumerated, none was found on
     * 2026-09-06, and that is a measurement rather than a guarantee. Named
     * rather than counted: "3 categories truncated" tells an operator that
     * something is missing and nothing about what. A frontier category whose
     * pages stated a total past the ceiling while it was paged is named here
     * too, with that stated total (owner decision 116b).
     */
    truncatedCategories: capped.map((category) => ({
      id: category.id,
      name: category.name,
      totalResults: category.totalResults,
      path: category.path,
    })),
    unreadableCategories: [...unreadable],
    /**
     * The categories one refusal or one 5xx cost, asked for once more at the
     * end (plan 0251, owner decision 103b), and whether that read them. A
     * category read the second time is no longer in `unreadableCategories`.
     */
    askedAgain: askedAgain.map((entry) => ({
      id: entry.category.id,
      name: entry.category.name,
      read: entry.error === null,
    })),
    /**
     * Set when the run stopped because the refusals stopped being isolated. It
     * is the difference between a crawl that read the whole frontier and one
     * that read part of it, and no count on this object says which.
     */
    blockedAfter: blocked ? String(blocked) : null,
  };
}

/**
 * Cents to the units `source_entry_prices` stores.
 *
 * The library reads cents because that is what a display string converts to
 * without a rounding decision; the column is a decimal of currency units, as
 * every other source writes.
 */
function centsToUnits(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/**
 * The storefront, from the source row rather than the environment.
 *
 * Plan 0083 deleted the per chain environment variable and put the per chain
 * switch in this same jsonb, for the same reason: a chain that needed a new
 * variable threaded through `app-config.ts`, the config map, `_env.tpl` and
 * both `luna-slot` scripts is a chain nobody can turn on without a deploy.
 */
function readBaseUrl(config: Record<string, unknown>): string | undefined {
  const baseUrl = config['baseUrl'];
  return typeof baseUrl === 'string' && baseUrl.trim() !== ''
    ? baseUrl.trim()
    : undefined;
}

/** Where the walk starts. Any listing page names the first level. */
function readSeedPath(config: Record<string, unknown>): string | undefined {
  const seed = config['seedPath'];
  return typeof seed === 'string' && seed.trim() !== ''
    ? seed.trim()
    : undefined;
}

/**
 * Milliseconds between navigations, overridable per chain on the same row.
 *
 * **The client clamps it up and never down** (plan 0090, section 13). The block
 * escalates and is not instant to clear, so a smaller number here buys a longer
 * outage rather than a shorter run.
 */
function readDelay(config: Record<string, unknown>): number | undefined {
  const delay = Number(config['delayMs']);
  return Number.isFinite(delay) && delay > 0 ? Math.floor(delay) : undefined;
}

/** The scope the prices are written for (plan 0086, section 9). */
function requireScope(priceScopeId: string | undefined): string {
  if (!priceScopeId) {
    throw new Error(
      'This crawl reads a price from every card and has no price scope to ' +
        'write them for. Start it again with one.'
    );
  }
  return priceScopeId;
}
