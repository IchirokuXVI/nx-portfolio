import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestDetailFetch,
  HarvestWarningCode,
} from '@portfolio/luna-shopper/contracts';
import {
  ELJAMON_DEFAULT_POSTAL_CODE,
  ElJamonClient,
  ElJamonTimeoutError,
  createElJamonFetch,
  isElJamonSessionStart,
  photoAddressRead,
  splitSize,
  type ElJamonCategory,
  type ElJamonListingRow,
  type ElJamonProduct,
} from '@portfolio/luna-shopper/eljamon';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import {
  DETAIL_FAILED_KEY,
  type CatalogDiscoveryInput,
  type CatalogRunner,
} from './catalog-runner';
import { photoOf } from './photo-address';
import { listingWarning, type RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  PartialSourceObservation,
  ReportedObservation,
  SourceObservation,
  SourceObservationPrice,
} from './source-ingest';

/**
 * How many silent attempts in a row, across every worker of the pool, stop the
 * detail stage (plan 0253, D1). An attempt is one request the transport sent,
 * a retry included, and it is silent when it timed out. With six workers and a
 * 30 second idle timeout, 20 is about 100 seconds of a chain that answers
 * nothing. An attempt that gets an answer, a 404 included, starts the count
 * again, except an answer to a session start (the `/` and postal code
 * requests), which leaves the count as it is; a session start that times out
 * still counts. A reset connection, a socket hang up or a DNS failure is no
 * answer and no silence, so it leaves the count as it is.
 */
export const DETAIL_TIMEOUTS_IN_A_ROW = 20;

/**
 * The silent attempts in a row of one run, counted at the transport, below the
 * client's retries, so a page that timed out on every retry counts each one.
 */
export class SilentAttempts {
  /** Silent attempts since the last answer. */
  inARow = 0;
  /** Every silent attempt since the count was armed. On the report. */
  total = 0;

  /** Starts counting from nothing, at the start of the detail stage. */
  reset(): void {
    this.inARow = 0;
    this.total = 0;
  }

  /** Whether the chain has been silent long enough to stop asking. */
  get exhausted(): boolean {
    return this.inARow >= DETAIL_TIMEOUTS_IN_A_ROW;
  }

  /**
   * `fetchImpl`, counted: a `Response` resets, a timeout counts.
   *
   * **An answer to a session start resets nothing** (plan 0169, notes of
   * 2026-11-26). A session is dropped after a page with no answer and a fresh
   * one is started before the next page, so a chain that answers its home
   * page and never a product page would otherwise reset the count on every
   * fresh session and never stop the stage. A session start that times out
   * still counts.
   */
  watch(fetchImpl: typeof fetch): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      try {
        const response = await fetchImpl(input, init);
        // The transport resolves only once the whole body arrived, so any
        // status is an answer.
        if (!isElJamonSessionStart(urlOf(input))) {
          this.inARow = 0;
        }
        return response;
      } catch (error) {
        if (isTimeout(error)) {
          this.inARow += 1;
          this.total += 1;
        }
        throw error;
      }
    }) as typeof fetch;
  }
}

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

/**
 * One El Jamón session per detail worker (plan 0169, notes of 2026-11-25).
 *
 * The shop draws the breadcrumb and the heading of a product page from a
 * current product it keeps in the session, so two pages asked at the same time
 * in one session can each come back with the other's breadcrumb. **A client
 * here is used by one page at a time**: a page takes an idle client, or opens
 * a new one with its own session, and gives it back when it is done. So the
 * pool never holds more clients than pages were ever in flight at once, which
 * is the source's `workers`, and no session ever has two requests in flight.
 *
 * Every client is opened with the run's one `acquire`, so the rate the owner
 * set on the source row bounds all of them together, as it bounded one.
 *
 * **A client whose work met a request with no answer is dropped** (plan 0169,
 * notes of 2026-11-26): a timeout, a reset connection or a socket hang up,
 * retries included, even when a retry then answered. The shop may still
 * answer that request late and move the session's current product, so the
 * next page opens a fresh session rather than read on that one. So the pool
 * holds at most `workers` clients at once.
 *
 * **A dropped client is let go**: its requests are added to a total the pool
 * keeps, and the pool holds no reference to it. Each client keeps the home
 * page it read, so a chain that resets many pages would otherwise keep a
 * dropped client per reset alive until the run ends.
 */
export class SessionPool {
  private readonly idle: ElJamonClient[] = [];
  /** The clients not dropped, idle or in use. */
  private readonly live = new Set<ElJamonClient>();
  /** Clients ever opened, the listing's and the dropped ones included. */
  private openedCount = 0;
  /** Requests of the clients already dropped, retries included. */
  private droppedRequests = 0;
  /** Sessions dropped after a request with no answer. On the report. */
  dropped = 0;

  /**
   * `first` is the listing's client, whose session is idle once the listing is
   * read, so the first page reuses it rather than starting another.
   */
  constructor(
    private readonly open: () => ElJamonClient,
    first?: ElJamonClient
  ) {
    if (first) {
      this.track(first);
      this.idle.push(first);
    }
  }

  /** `work` on a client no other page is using, for as long as it runs. */
  async use<T>(work: (client: ElJamonClient) => Promise<T>): Promise<T> {
    const client = this.idle.pop() ?? this.openOne();
    const failuresBefore = client.transportFailures;
    try {
      return await work(client);
    } finally {
      if (client.transportFailures > failuresBefore) {
        // Its requests stay on the report through the total; the client
        // itself is let go.
        this.droppedRequests += client.requests;
        this.live.delete(client);
        this.dropped += 1;
      } else {
        this.idle.push(client);
      }
    }
  }

  /** How many sessions the run used, the listing's included. */
  get size(): number {
    return this.openedCount;
  }

  /** How many clients the pool still holds, idle or in use. */
  get held(): number {
    return this.live.size;
  }

  /** Every request of every client, retries and session starts included. */
  get requests(): number {
    let sum = this.droppedRequests;
    for (const client of this.live) {
      sum += client.requests;
    }
    return sum;
  }

  private openOne(): ElJamonClient {
    const client = this.open();
    this.track(client);
    return client;
  }

  private track(client: ElJamonClient): void {
    this.openedCount += 1;
    this.live.add(client);
  }
}

/**
 * `CATALOG_DISCOVERY` against the `eljamon-web` adapter (plan 0169, section 5).
 *
 * **One price list for every shop** (section 2). Five postal codes in five
 * provinces and one pickup shop showed the same prices and the same
 * assortment, so a run writes one price per product with `scopeKey: null`, into
 * the default scope the spawn gives it, which is the chain's `NATIONAL` scope
 * (plan 0153). It declares no scope: the seeded national scope has no
 * `externalKey`, and a declared one would be created a second time beside it.
 *
 * **It writes no availability, positive or negative.** The site publishes none
 * per shop, and the JSON-LD `availability` is a template constant (section 2.3).
 * It does hand over its national listing when the walk read it whole (plan
 * 0220, section 2.3), and the delisting counter writes a negative only after
 * several such walks did not list a product.
 *
 * The order (section 8):
 *
 * 1. `LIST`. Walk the eleven top level categories, page by page. A category is
 *    serial, because page N is a POST of the filters page N - 1 carried.
 * 2. `DETAIL`. One product page per product this chain has no row for, for the
 *    category path. A known product skips it (plan 0119, section 3).
 * 3. `INGEST`. Report what is left, with its listing price.
 *
 * **Each product goes to the sink as soon as its observation is whole** (plan
 * 0267): a known one when it is listed, a new one when its page answers or
 * fails. The sink writes a chunk each time `PRODUCT_CHUNK` products wait, so a
 * walk that ends part way keeps the chunks that were written. An abort by a
 * person or a deploy also writes the chunk that was not full, at the drain. A
 * runner that throws loses that chunk, and a process that dies loses it too,
 * with what was still queued or in flight (plan 0267, notes of 2026-11-20).
 * Only a row whose page the walk did not read waits for the end, because only
 * the end knows whether its page will be read.
 *
 * **Every category path of a product is stated at the end** (plan 0268): the
 * breadcrumb of its page when this run read it, and each top level category
 * that listed it. It replaces the stored paths only when this run read the
 * page and the whole listing; otherwise it adds to them, so a breadcrumb read
 * on an earlier walk is never cleared by a walk that did not read the page.
 *
 * **`processed` counts products**, the unit of `totalPlanned` (plan 0217,
 * section 4), and this runner counts it itself (plan 0253, section 2): a known
 * product when the detail stage starts, a new one when its page is read or
 * fails, and one whose page was never asked for when the ingest records it.
 * So the counter moves during the hour of product pages and not only at the
 * end, and it ends at `totalPlanned` once.
 *
 * **The detail stage stops when the chain stops answering** (plan 0253,
 * section 3, D1 (b)): {@link DETAIL_TIMEOUTS_IN_A_ROW} silent attempts in a
 * row across the pool, retries included, about 100 seconds of six workers with
 * nothing answered, and no new page is asked. The run still records every
 * listed row and ends `COMPLETED` with one `DETAIL_UNREAD` warning. On a `NEW`
 * walk a new product whose page was not read is written with
 * {@link DETAIL_FAILED_KEY}, so the next walk asks for it. An `ALL` walk was
 * handed no ids, so it reports every product whose page it never asked for
 * from the listing alone, and the ingest creates no row from that for a
 * product the chain does not hold yet.
 *
 * **Each detail worker has its own session** ({@link SessionPool}), and a page
 * whose breadcrumb names another product than its JSON-LD is read again once
 * in that session. One that still disagrees keeps every field the JSON-LD
 * gave and states no category path, so the stored one stays; it is counted on
 * the report and marked for the next walk (plan 0169, notes of 2026-11-25).
 * A page that states another article code than its row is read again the
 * same way, and one that still does fails as a page with no product. A
 * session whose request got no answer is dropped (plan 0169, notes of
 * 2026-11-26).
 *
 * **No number here claims the catalog is complete.** The sum of the counts
 * the categories printed is what the site said, and the report says it in those
 * words.
 */
@Injectable()
export class ElJamonCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(ElJamonCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const postalCode =
      readString(source.config, 'postalCode') ?? ELJAMON_DEFAULT_POSTAL_CODE;
    const silence = new SilentAttempts();
    const client = this.createClient(context, source, postalCode, silence);
    // The listing is serial, so it needs one session; the detail stage opens
    // one more for each page in flight beyond it.
    const sessions = new SessionPool(
      () => this.createClient(context, source, postalCode, silence),
      client
    );
    const walk = new Walk();
    context.countProgressItself();
    const known = knownIds(input);
    const holdsRow = rowsHeld(input);

    // --- 1. The listing ----------------------------------------------------
    await context.setStage('LIST', 'Reading the top level categories');
    const categories = await client.topCategories();
    for (const category of categories) {
      // An abort, a person's or the refusal guard's (plan 0215), ends the
      // listing and not the run: every row listed so far is reported below.
      if (context.signal.aborted) {
        break;
      }
      await this.listCategory(context, client, report, walk, known, category);
    }
    await context.setTotalPlanned(walk.rows.size);
    this.logger.log(
      `Run ${context.runId}: ${walk.rows.size} product(s) listed in ` +
        `${categories.length} categories`
    );

    // --- 2. One product page per new product -------------------------------
    const fresh = [...walk.rows.values()].filter(
      (listed) => !known.has(listed.row.code)
    );
    await context.setStage(
      'DETAIL',
      `Reading ${fresh.length} product page(s), ` +
        `${walk.rows.size - fresh.length} product(s) already known`
    );
    // A known product needs no page, so its share of the plan is done now.
    await context.report({ processed: walk.rows.size - fresh.length });
    const detail = await this.readDetails(
      context,
      sessions,
      report,
      walk,
      fresh,
      source,
      silence,
      holdsRow
    );
    for (const disagreement of walk.priceDisagreements) {
      // The listing wins: it is what a shopper sees with the session's postal
      // code (section 5.2). The disagreement is named on the report.
      this.logger.warn(
        `Run ${context.runId}: product ${disagreement.code} lists at ` +
          `${disagreement.listing} and its page says ${disagreement.productPage}`
      );
    }

    // --- 3. Report what is left --------------------------------------------
    // A known product was reported when it was listed, and a new one when its
    // page answered or failed (plan 0267). What is left is a row whose page
    // the walk did not read, because of an abort or the stop of plan 0253.
    // It is reported here, by the rule below, and a walk that dies before
    // this point reports it not at all, which clears nothing.
    await context.setStage(
      'INGEST',
      `Finishing the walk: ${walk.rows.size - walk.reported.size} of ` +
        `${walk.rows.size} product(s) left to record`
    );
    const observedAt = new Date();
    const failed = new Set(walk.failedProducts.map((product) => product.code));
    // The pages never asked for, or cut short by an abort, were counted by
    // nobody: they count as their rows are recorded here.
    await context.report({
      processed: fresh.filter(
        (listed) =>
          !walk.details.has(listed.row.code) && !failed.has(listed.row.code)
      ).length,
    });
    const pagesNotRead = context.signal.aborted || detail.stopped;
    for (const listed of walk.rows.values()) {
      const code = listed.row.code;
      if (walk.reported.has(code)) {
        continue;
      }
      // An aborted walk still reports every listed row (plan 0215, section
      // 6.1), and so does one whose detail stage stopped (plan 0253). A row
      // whose page it never read, and that the chain may already hold, is
      // reported from the listing alone, as a known one is: a full
      // observation would state no photo and the top level category, and the
      // ingest would clear the stored photo and category path with them.
      const unread =
        pagesNotRead && !walk.details.has(code) && !failed.has(code);
      if (unread && holdsRow(code)) {
        // What the listing said and nothing else, as a known product is
        // reported (see {@link listingOnly}).
        report.product(listingOnly(listed.row, observedAt));
      } else {
        // A page that was read was reported then, so no page is at hand here.
        // A row the chain may hold states no category path, as a failed page
        // does (plan 0169, notes of 2026-11-25).
        report.product(
          observationOf(listed, undefined, observedAt, holdsRow(code))
        );
      }
    }

    const whole = declareListing(report, walk, context.signal);
    // Every path of every product, after the walk and before the drain (plan
    // 0268). Never on an observation: a streamed one was written at the first
    // sighting, before the later categories were listed.
    for (const listed of walk.rows.values()) {
      const code = listed.row.code;
      report.categoryPaths(
        code,
        walk.pathsOf(code),
        // A page whose breadcrumb named another product read no path, so it
        // replaces nothing (plan 0169, notes of 2026-11-25).
        whole && walk.details.has(code) && !walk.untrustedBreadcrumbs.has(code)
          ? 'REPLACE'
          : 'ADD'
      );
    }
    warnShortCategories(context, walk);
    warnDetailUnread(context, walk, detail, fresh.length);

    await context.flush();
    await context.setReport(
      walk.toReport(postalCode, fresh.length, sessions.requests, detail)
    );
  }

  /**
   * One product page per new product, over the source's workers (section 8).
   *
   * Each page read or failed is one product of `processed`. The pool runs on
   * a signal of its own, which the run's abort reaches too, so this stage can
   * stop alone: {@link DETAIL_TIMEOUTS_IN_A_ROW} silent attempts in a row,
   * across every worker and every retry, and no new page is asked. `silence`
   * counts them at the transport; the pool reads it as each page fails. A
   * page already in flight finishes or fails as it would have, its retries
   * included. What stopping costs is on the report, and in the
   * `DETAIL_UNREAD` warning the run writes.
   *
   * Each page runs on a session no other page is using at that moment (plan
   * 0169, notes of 2026-11-25). A page whose breadcrumb names another product
   * is read once more on the same session; a second answer that still
   * disagrees is kept without its breadcrumb (see {@link observationOf}).
   */
  private async readDetails(
    context: RunContext,
    sessions: SessionPool,
    report: RunReport,
    walk: Walk,
    fresh: readonly ListedRow[],
    source: SupermarketSource,
    silence: SilentAttempts,
    holdsRow: (id: string) => boolean
  ): Promise<DetailStage> {
    const stage: DetailStage = {
      pages: 0,
      failed: 0,
      timeouts: 0,
      silentAttempts: 0,
      rereads: 0,
      untrustedBreadcrumbs: 0,
      otherProductPages: 0,
      sessions: 0,
      droppedSessions: 0,
      stopped: false,
    };
    // A listing that ended in silence is not this stage's to count.
    silence.reset();
    const pool = new AbortController();
    const stopPool = (): void => pool.abort();
    if (context.signal.aborted) {
      pool.abort();
    } else {
      context.signal.addEventListener('abort', stopPool, { once: true });
    }
    try {
      await runWorkerPool({
        items: fresh,
        workers: source.workers,
        signal: pool.signal,
        handle: async (listed) => {
          stage.pages += 1;
          const product = await sessions.use(async (client) => {
            const first = await productPage(client, listed.row);
            if (!first.contaminated && first.otherProductCode === null) {
              return first;
            }
            // Read again on the same session, which nothing else is using
            // now, so the shop's current product is this one.
            stage.rereads += 1;
            return productPage(client, listed.row);
          });
          if (product.otherProductCode !== null) {
            // Its JSON-LD is another product's too, so nothing on it is this
            // product's: it fails as a page with no product does (plan 0169,
            // notes of 2026-11-26).
            stage.otherProductPages += 1;
            throw new Error(
              `The page states product ${product.otherProductCode}, not ` +
                `${listed.row.code}, twice.`
            );
          }
          walk.details.add(listed.row.code);
          if (product.contaminated) {
            stage.untrustedBreadcrumbs += 1;
            walk.untrustedBreadcrumbs.add(listed.row.code);
            this.logger.warn(
              `Run ${context.runId}: product ${listed.row.code}'s page drew ` +
                'its breadcrumb for another product twice; its path is not stated'
            );
          } else if (product.categoryPath.length > 0) {
            walk.breadcrumbs.set(listed.row.code, product.categoryPath);
          }
          if (product.price !== null && product.price !== listed.row.price) {
            walk.priceDisagreements.push({
              code: listed.row.code,
              listing: listed.row.price,
              productPage: product.price,
            });
          }
          // Its observation is whole now (plan 0267). It carries the listing
          // price, which the walk read before any page.
          walk.report(
            report,
            observationOf(listed, product, new Date(), true),
            listed.row.code
          );
          await context.report({ processed: 1 });
        },
        onError: async (error, listed) => {
          // The page the abort cut short is not a failed page: it was not
          // read, and is reported below as the pages never asked for are.
          if (context.signal.aborted) {
            return;
          }
          // One page costs one product's category path, never the product:
          // it is still reported, with its top level category (section 5.3).
          this.logger.warn(
            `Run ${context.runId}: product ${listed.row.code} failed: ${String(error)}`
          );
          walk.failedProducts.push({
            code: listed.row.code,
            url: listed.row.url,
            error: String(error),
          });
          // Reported now, with `DETAIL_FAILED_KEY`, so the next walk reads
          // its page again (plan 0267). It states no category path when the
          // chain may hold a row for it, so a stored breadcrumb stays (plan
          // 0169, notes of 2026-11-25); only a row the chain surely holds none
          // of starts with the top level category. A page that was read
          // before the failure was reported then, and is not reported twice.
          if (!walk.reported.has(listed.row.code)) {
            walk.report(
              report,
              observationOf(
                listed,
                undefined,
                new Date(),
                holdsRow(listed.row.code)
              ),
              listed.row.code
            );
          }
          stage.failed += 1;
          if (isTimeout(error)) {
            stage.timeouts += 1;
          }
          if (silence.exhausted && !stage.stopped) {
            stage.stopped = true;
            this.logger.warn(
              `Run ${context.runId}: ${silence.inARow} attempts in a row got ` +
                'no answer; no new page is asked, and the listing is recorded'
            );
            pool.abort();
          }
          await context.report({ failed: 1, processed: 1 });
        },
      });
    } finally {
      context.signal.removeEventListener('abort', stopPool);
    }
    stage.silentAttempts = silence.total;
    stage.sessions = sessions.size;
    stage.droppedSessions = sessions.dropped;
    return stage;
  }

  /**
   * One top level category, every page of it. Every page that fails, retries
   * included, is named on the report. One after the first is skipped and the
   * walk goes on to the next page; page 1, or a second failure in a row, ends
   * the category and the walk moves to the next one.
   *
   * A product the walk reads no page for is reported at its first sighting
   * here (plan 0267): what the listing says is all its observation will ever
   * carry.
   */
  private async listCategory(
    context: RunContext,
    client: ElJamonClient,
    report: RunReport,
    walk: Walk,
    known: ReadonlySet<string>,
    category: ElJamonCategory
  ): Promise<void> {
    const summary = {
      code: category.code,
      name: category.name,
      printedCount: null as number | null,
      rowsRead: 0,
      rowsRepeated: 0,
    };
    /** Every row the pages printed, the repeated ones included. */
    let rowsPrinted = 0;
    walk.categories.push(summary);
    let page = 0;
    /** Every page that failed, named on the report, in the order they failed. */
    const skipped: Array<{ page: number; error: unknown }> = [];
    try {
      for await (const row of client.walkCategory(
        category,
        (read, index) => {
          page = index;
          rowsPrinted += read.rows.length;
          if (index === 1) {
            summary.printedCount = read.articleCount;
          }
        },
        (index, error) => {
          // A page after the first is skipped rather than ending the
          // category: the next one is asked for with the last filters read.
          page = index;
          skipped.push({ page: index, error });
        }
      )) {
        summary.rowsRead += 1;
        if (walk.record(category, row) && known.has(row.code)) {
          walk.report(report, listingOnly(row, new Date()), row.code);
        }
        await context.heartbeat();
      }
    } catch (error) {
      // The page the abort cut short is not a failed page, and the rows read
      // before it stay in the walk.
      if (context.signal.aborted) {
        return;
      }
      skipped.push({ page: page + 1, error });
    }
    // The rows a page printed again after an earlier page of this category
    // printed them (plan 0253, section 1): the walk keeps going past them, and
    // the count says how often the chain's order shifted under the walk. A
    // last page that repeats in full is how a clamping server ends a category.
    summary.rowsRepeated = rowsPrinted - summary.rowsRead;
    for (const failure of skipped) {
      this.logger.warn(
        `Run ${context.runId}: ${category.path} page ${failure.page} failed: ` +
          String(failure.error)
      );
      walk.failedPages.push({
        category: category.code,
        path: category.path,
        page: failure.page,
        error: String(failure.error),
      });
      await context.report({ failed: 1 });
    }
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it. The
   * fetch goes through `silence`, which is how the detail stage knows the
   * chain stopped answering, so an override wraps its fake the same way.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource,
    postalCode: string,
    silence: SilentAttempts
  ): ElJamonClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new ElJamonClient({
      userAgent: settings.userAgent,
      baseUrl: readString(source.config, 'baseUrl'),
      postalCode,
      fetchImpl: silence.watch(createElJamonFetch()),
      // The run's own bucket, so the rate the owner set on this row is the rate
      // the source sees, whatever the number of workers.
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
  }
}

/**
 * The national listing, whole or not (plan 0220, section 2.3).
 *
 * Whole needs three things: no page failed, the run was not aborted, and every
 * category read at least the rows it printed. The client ends a category
 * quietly on an empty page or on a page that repeats a code it read, with no
 * failed page, so the printed count is what tells a whole category from a
 * short one. A category that printed no count is short too: to count too few
 * walks is the safe error. A product filed in two categories is read twice,
 * so a category may read more than it printed, never fewer.
 *
 * The key is the chain's product code, so a renamed product keeps its key.
 *
 * Answers whether it declared the listing whole. Only a whole listing met
 * every category a product is listed in, so only then can its category paths
 * replace the stored ones (plan 0268).
 */
function declareListing(
  report: RunReport,
  walk: Walk,
  signal: AbortSignal
): boolean {
  if (signal.aborted) {
    return false;
  }
  const listed = walk.rows.keys();
  if (walk.failedPages.length > 0) {
    report.listingNotWhole(
      null,
      'failed-page',
      walk.failedPages.map((page) => ({
        category: page.category,
        page: page.page,
      })),
      listed
    );
    return false;
  }
  const short = walk.categories.filter(
    (category) =>
      category.printedCount === null ||
      category.rowsRead < category.printedCount
  );
  if (short.length > 0) {
    report.listingNotWhole(
      null,
      'short-category',
      short.map((category) => ({
        category: category.code,
        printedCount: category.printedCount,
        rowsRead: category.rowsRead,
      })),
      listed
    );
    return false;
  }
  report.listingWhole(null, listed);
  return true;
}

/**
 * One warning per category that read fewer rows than it printed (plan 0251).
 *
 * The run still ends `COMPLETED`, and these are what say it is partial. Why a
 * category comes back short is plan 0253's; this only names it, with both
 * numbers. A category that printed no count and gave no row is a category
 * whose first page never answered, which is a part not read at all rather
 * than a short one. One that printed no count and gave rows answered without
 * the count, and is short: what it read is named, against nothing.
 * An aborted walk writes none: it does not end `COMPLETED`, and every
 * category after the abort would read as short.
 */
function warnShortCategories(context: RunContext, walk: Walk): void {
  if (context.signal.aborted) {
    return;
  }
  for (const category of walk.categories) {
    if (category.printedCount === null && category.rowsRead === 0) {
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_UNREAD,
          category.name,
          `Category ${category.code} ${category.name} printed no count: its ` +
            `first page did not answer, and 0 row(s) were read.`
        )
      );
    } else if (category.printedCount === null) {
      // The first page answered and printed no count, so there is nothing to
      // read the rows against: a part read, not a part never reached.
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_SHORT,
          category.name,
          `Category ${category.code} ${category.name}: ` +
            `${category.rowsRead} row(s) read, no count printed.`
        )
      );
    } else if (category.rowsRead < category.printedCount) {
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_SHORT,
          category.name,
          `Category ${category.code} ${category.name}: ${category.rowsRead} ` +
            `of ${category.printedCount} row(s) read.`
        )
      );
    }
  }
}

/**
 * The one warning of a detail stage that stopped on silence (plan 0253, D1
 * (b)). The run ends `COMPLETED`, so this is what says the products listed in
 * it have no page yet. An aborted walk writes none: it does not end
 * `COMPLETED`, and its own reason says why.
 *
 * The words hold on both kinds of walk. A page that failed is written from the
 * listing, marked for the next walk, on either. A page never asked for is
 * written the same way on a `NEW` walk; an `ALL` walk reports it from the
 * listing alone, and the ingest creates no row from that for a product the
 * chain does not hold. Either way the next walk asks for its page.
 */
function warnDetailUnread(
  context: RunContext,
  walk: Walk,
  detail: DetailStage,
  planned: number
): void {
  if (!detail.stopped || context.signal.aborted) {
    return;
  }
  const withoutPage = planned - walk.details.size;
  context.warn({
    code: HarvestWarningCode.DETAIL_UNREAD,
    offerId: null,
    page: null,
    name: null,
    message:
      `Product pages stopped after ${DETAIL_TIMEOUTS_IN_A_ROW} attempts in a ` +
      `row got no answer: ${detail.pages} of ${planned} page(s) asked, ` +
      `${detail.failed} failed, ${detail.timeouts} timed out. ` +
      `${withoutPage} product(s) had no page; the next walk asks for them ` +
      'again.',
  });
}

/**
 * The lines of the report's `warnings` (plan 0169, notes of 2026-11-26): one
 * when the session guard still read another product's breadcrumb after the
 * second read, so a person knows the paths of those products were not stated.
 */
function detailWarnings(detail: DetailStage): string[] {
  if (detail.untrustedBreadcrumbs === 0) {
    return [];
  }
  return [
    `${detail.untrustedBreadcrumbs} product page(s) drew their breadcrumb ` +
      'for another product on both reads, so their category path was not ' +
      'stated; the next NEW walk reads them again.',
  ];
}

/**
 * One product page, read against the code its row asked for, or a failure for
 * a page that carries no product.
 */
async function productPage(
  client: ElJamonClient,
  row: ElJamonListingRow
): Promise<ElJamonProduct> {
  const product = await client.getProduct(row.url, row.code);
  if (!product) {
    throw new Error('The page carried no product JSON-LD.');
  }
  return product;
}

/**
 * Whether a product page failed because the chain said nothing: the
 * transport's idle timeout, or a socket that timed out below it.
 */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof ElJamonTimeoutError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ETIMEDOUT')
  );
}

/**
 * The products a walk skips the page of (plan 0119, section 3).
 *
 * The executor splits the chain's rows into the ids that carry an EAN and the
 * ids that do not, because for Mercadona the page is where the EAN comes from.
 * **This source has no EAN**, so every row it wrote is in the second set, and
 * reading the page again would answer the same category path. So a row in
 * either set is known here. `ALL` reads every page, as it does for Mercadona.
 *
 * **Except a row written from a page that failed**, which carries
 * {@link DETAIL_FAILED_KEY} (section 5.3). Counting it as known would keep the
 * listing's top level category forever, so its page is read again, which is
 * how a failed detail is retried here, as the missing EAN is for Mercadona. A
 * page that was read and whose breadcrumb has one level is not a failure, and
 * is not read again.
 */
function knownIds(input: CatalogDiscoveryInput): ReadonlySet<string> {
  if ((input.details ?? HarvestDetailFetch.ALL) !== HarvestDetailFetch.NEW) {
    return new Set();
  }
  const failed = input.externalIdsWithFailedDetail ?? new Set<string>();
  return new Set(
    [
      ...(input.knownExternalIds ?? []),
      ...(input.externalIdsWithoutEan ?? []),
    ].filter((id) => !failed.has(id))
  );
}

/**
 * Whether the chain may already hold a row for a product (plan 0215).
 *
 * A `NEW` walk was handed every id the chain holds, so the answer is exact. Any
 * other walk was handed none, so the answer is yes for every product: reading
 * an unread one from the listing alone costs a new product its first row until
 * the next walk, and the other answer could clear what a stored one holds.
 */
function rowsHeld(input: CatalogDiscoveryInput): (id: string) => boolean {
  if ((input.details ?? HarvestDetailFetch.ALL) !== HarvestDetailFetch.NEW) {
    return () => true;
  }
  const known = input.knownExternalIds ?? new Set<string>();
  const withoutEan = input.externalIdsWithoutEan ?? new Set<string>();
  return (id) => known.has(id) || withoutEan.has(id);
}

/**
 * One product as the listing and, when it was read, its page describe it.
 *
 * A missing detail is a page that failed (section 5.3), or on an aborted walk
 * a page never read of a product the chain holds no row for (plan 0215). The
 * observation says so in its `extra` for the next walk to read the page again.
 * An unread page of a row the chain may hold never reaches here, because this
 * states no photo and the top level category, and the ingest would write both.
 *
 * **A page whose breadcrumb named another product states no category path**
 * (plan 0169, notes of 2026-11-25), so the ingest keeps the stored one and a
 * new row starts with none. Everything else the page gives comes from its
 * JSON-LD, which is the asked product's, and is kept. It is marked like a
 * failed page, so the next `NEW` walk reads its page again for the path.
 *
 * **A page that failed states no category path either when `held`**, that is
 * when the chain may already hold a row for the product (plan 0169, notes of
 * 2026-11-25). The top level category it used to state replaced a stored
 * breadcrumb on every `ALL` walk. Only a row the chain surely holds none of
 * starts with the top level category. Its photo is still stated as null: an
 * observation must state one (plan 0198), so a failed page of an `ALL` walk
 * still clears a stored photo.
 */
function observationOf(
  listed: ListedRow,
  detail: ElJamonProduct | undefined,
  observedAt: Date,
  held: boolean
): SourceObservation {
  const size = splitSize(listed.row.description);
  const extra: Record<string, unknown> = {};
  if (listed.row.previousPrice !== null) {
    extra['previousPrice'] = listed.row.previousPrice;
  }
  if (!detail || detail.contaminated) {
    extra[DETAIL_FAILED_KEY] = true;
  }
  const categoryPath =
    detail?.contaminated || (!detail && held)
      ? {}
      : {
          categoryPath:
            detail && detail.categoryPath.length > 0
              ? detail.categoryPath
              : [listed.category.name],
        };
  return {
    externalId: listed.row.code,
    name: size.name,
    brand: listed.row.brand ?? detail?.brand ?? null,
    // The product pages carry none, and the basket's "barcode" argument repeats
    // the article code (section 1), which is not an EAN.
    ean: null,
    unitSize: size.unitSize,
    sizeUnit: size.sizeUnit,
    // A bare `kg` after the comma (plan 0181): the row is weighed at the till
    // and the price the chain prints for it is already the price of a kilo, so
    // nothing about the price changes here.
    soldByWeight: size.soldByWeight,
    sizeFormat: size.sizeFormat,
    packCount: size.packCount,
    ...categoryPath,
    url: listed.row.url,
    // The `image` of the product page's JSON-LD (plan 0198). A page that
    // failed states none.
    imageUrl: detail
      ? photoOf(photoAddressRead(detail), listed.row.code)
      : null,
    observedAt,
    extra: Object.keys(extra).length > 0 ? extra : null,
    prices: pricesOf(listed.row),
  };
}

/**
 * What the listing said and nothing else, for a product whose page the walk
 * does not read: a known one (plan 0119, section 3), or on a walk whose pages
 * stopped, one the chain may already hold (plan 0215).
 *
 * So the stored name, brand and category path stay what the last full read
 * wrote (plan 0119, section 6). The photo address is on the product page
 * alone (plan 0198), so it is not stated here and the stored one stays too. A
 * row held from a page that failed keeps its `DETAIL_FAILED_KEY`, so the next
 * `NEW` walk reads it.
 */
function listingOnly(
  row: ElJamonListingRow,
  observedAt: Date
): PartialSourceObservation {
  return {
    externalId: row.code,
    detailFetched: false,
    observedAt,
    prices: pricesOf(row),
  };
}

/**
 * One price, with no scope key, so it lands in the run's default scope, the
 * chain's `NATIONAL` one (section 2). The site states no offer dates, so the
 * window is open at both ends.
 */
function pricesOf(row: ElJamonListingRow): SourceObservationPrice[] {
  if (row.price === null) {
    return [];
  }
  return [
    {
      scopeKey: null,
      price: row.price,
      currency: 'EUR',
      unitPrice: row.unitPrice,
      unitPriceLabel: row.unitPriceLabel,
      validFrom: null,
      validUntil: null,
    },
  ];
}

interface ListedRow {
  category: ElJamonCategory;
  row: ElJamonListingRow;
}

/** What the detail stage did, on the report as `detail` (plan 0253). */
interface DetailStage {
  /** Product pages asked for, each once, retries not counted. */
  pages: number;
  /** Pages that failed, timeouts included. */
  failed: number;
  /** Failed pages whose last attempt timed out. */
  timeouts: number;
  /** Attempts that timed out, retries included: what the stop counts. */
  silentAttempts: number;
  /**
   * Pages read a second time because their breadcrumb named another product
   * than their JSON-LD (plan 0169, notes of 2026-11-25).
   */
  rereads: number;
  /** Of those, the pages whose second answer disagreed too: no path stated. */
  untrustedBreadcrumbs: number;
  /**
   * Pages that stated another article code than their row twice, counted as
   * failed pages too (plan 0169, notes of 2026-11-26).
   */
  otherProductPages: number;
  /**
   * The sessions the run used, the listing's included: at most `workers`, plus
   * one for each dropped session.
   */
  sessions: number;
  /**
   * Sessions dropped because a request on them got no answer (plan 0169,
   * notes of 2026-11-26).
   */
  droppedSessions: number;
  /** Whether the silent attempts in a row stopped the stage. Not on the report. */
  stopped: boolean;
}

/**
 * What one run accumulates. Shared by every detail worker, which is safe
 * because the pool is concurrency rather than parallelism.
 */
class Walk {
  /** Article code -> the first category that listed it, and its row. */
  readonly rows = new Map<string, ListedRow>();
  /**
   * The article codes whose page was read. Only the code is kept: the product
   * was reported when its page answered (plan 0267).
   */
  readonly details = new Set<string>();
  readonly categories: Array<{
    code: string;
    name: string;
    printedCount: number | null;
    rowsRead: number;
    rowsRepeated: number;
  }> = [];
  readonly failedPages: Array<{
    category: string;
    path: string;
    page: number;
    error: string;
  }> = [];
  readonly failedProducts: Array<{ code: string; url: string; error: string }> =
    [];
  readonly priceDisagreements: Array<{
    code: string;
    listing: number | null;
    productPage: number | null;
  }> = [];
  /**
   * Every article code already handed to the sink (plan 0267), so no product
   * is reported twice and the end of the walk reports only what is left.
   */
  readonly reported = new Set<string>();
  /**
   * Article code -> the breadcrumb of its page, for a page read this run whose
   * breadcrumb named a level (plan 0268).
   */
  readonly breadcrumbs = new Map<string, string[]>();
  /**
   * Article codes whose page was read and whose breadcrumb named another
   * product twice, so it states no path (plan 0169, notes of 2026-11-25).
   * Named on the report.
   */
  readonly untrustedBreadcrumbs = new Set<string>();
  /**
   * Article code -> every top level category that listed it, in walk order
   * (plan 0268). The first is the one {@link rows} keeps.
   */
  private readonly listedUnder = new Map<string, ElJamonCategory[]>();
  private repeated = 0;

  /**
   * One listing row. A product filed under two top level categories keeps the
   * first as its row and its category path, and keeps each later one for its
   * category paths. The repeat is counted so the listed total reads against
   * the printed one. Answers whether this was the first sighting.
   */
  record(category: ElJamonCategory, row: ElJamonListingRow): boolean {
    const under = this.listedUnder.get(row.code);
    if (under) {
      this.repeated += 1;
      if (!under.some((other) => other.code === category.code)) {
        under.push(category);
      }
      return false;
    }
    this.rows.set(row.code, { category, row });
    this.listedUnder.set(row.code, [category]);
    return true;
  }

  /**
   * Every path this walk met for one product (plan 0268): the breadcrumb of
   * its page when this run read it, then `[name]` of each top level category
   * that listed it, in walk order. So the first path is the one
   * `categoryPath` holds. The names are the chain's, verbatim: a breadcrumb
   * level and a category name that differ only in case are two paths.
   */
  pathsOf(code: string): string[][] {
    const breadcrumb = this.breadcrumbs.get(code);
    return [
      ...(breadcrumb ? [breadcrumb] : []),
      ...(this.listedUnder.get(code) ?? []).map((category) => [category.name]),
    ];
  }

  /** One product to the sink, once. */
  report(
    report: RunReport,
    observation: ReportedObservation,
    code: string
  ): void {
    this.reported.add(code);
    report.product(observation);
  }

  toReport(
    postalCode: string,
    detailPlanned: number,
    requests: number,
    detail: DetailStage
  ): Record<string, unknown> {
    const listed = [...this.rows.values()];
    return {
      postalCode,
      categories: this.categories,
      /**
       * The sum of the counts the categories printed. What the site said, not
       * a proof that the walk saw everything it sells.
       */
      printedArticleCountSum: this.categories.reduce(
        (sum, category) => sum + (category.printedCount ?? 0),
        0
      ),
      listed: listed.length,
      listedInMoreThanOneCategory: this.repeated,
      onOffer: listed.filter((item) => item.row.previousPrice !== null).length,
      unpriced: listed.filter((item) => item.row.price === null).length,
      detailPlanned,
      detailRead: this.details.size,
      detailFailed: this.failedProducts.length,
      /** The detail stage's own counts (plan 0253, section 3). */
      detail: {
        pages: detail.pages,
        failed: detail.failed,
        timeouts: detail.timeouts,
        silentAttempts: detail.silentAttempts,
        rereads: detail.rereads,
        untrustedBreadcrumbs: detail.untrustedBreadcrumbs,
        otherProductPages: detail.otherProductPages,
        sessions: detail.sessions,
        droppedSessions: detail.droppedSessions,
      },
      /**
       * Lines a person should read, as the El Jamón store discovery report
       * carries them. Not a `HarvestRunWarning`: no code of that list names
       * this, and a new code is a contract change.
       */
      warnings: detailWarnings(detail),
      /** Named, never only counted. */
      failedPages: this.failedPages,
      failedProducts: this.failedProducts,
      untrustedBreadcrumbs: [...this.untrustedBreadcrumbs],
      priceDisagreements: this.priceDisagreements,
      requests,
    };
  }
}

/** A setting from the source row rather than the environment (plan 0083). */
function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
