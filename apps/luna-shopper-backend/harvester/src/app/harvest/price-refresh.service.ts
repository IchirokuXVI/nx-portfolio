import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  adapterCapabilities,
  HarvestRunStatus,
  HarvestRunStopReason,
  PriceRefreshRefusal,
  PriceRefreshStatus,
  type PriceRefreshCheckView,
  type PriceRefreshIdRequest,
  type PriceRefreshRequest,
  type PriceRefreshView,
  type PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import {
  describeError,
  NotFoundException,
  PRICE_REFRESH_REASON_DETAIL,
  PriceNotRefreshableException,
} from '@portfolio/luna-shopper/platform';
import { In, Not, Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import {
  HarvestRun,
  PriceRefresh,
  SourceEntryPrice,
  type SupermarketSource,
} from '../entities';
import { PriceRefreshCooldown } from './price-refresh.cooldown';
import {
  isRefusal,
  REFRESH_FETCHERS,
  type RefreshFetcher,
} from './price-refresh.fetchers';
import {
  copiesOfRows,
  PriceRefreshResolver,
  type RefreshScopes,
  type ResolvedRefresh,
} from './price-refresh.resolver';
import {
  PriceRefreshStore,
  type PriceRefreshOutcome,
} from './price-refresh.store';
import { sourceKindOf } from './run-source-kind';
import { HARVEST_CLOCK } from './schedule-slot';
import { SourceIngest, type PartialSourceObservation } from './source-ingest';
import { SupermarketSourceService } from './supermarket-source.service';

/** A fetch that does not finish in this long is `FAILED` (section 6). */
export const REFRESH_TIMEOUT_MS = 20_000;

/** A row still `PENDING` after this long was interrupted (section 4). */
export const REFRESH_INTERRUPTED_MS = 120_000;

/** Rows older than this are deleted (section 4). */
export const REFRESH_KEPT_DAYS = 90;

/** How often the timer of section 4 looks. */
const SWEEP_MS = 60_000;

/** Everything steps 1 to 6 settled for one pair, ready for step 7. */
interface Admitted {
  resolved: ResolvedRefresh;
  source: SupermarketSource;
  scopes: RefreshScopes;
}

/** Steps 1 to 6 refused, or answered `FRESH`, or admitted the pair. */
type Checked =
  | { kind: 'refused'; reason: PriceRefreshRefusal; observedAt: Date | null }
  | { kind: 'fresh'; resolved: ResolvedRefresh; freshForSeconds: number }
  | ({ kind: 'admitted' } & Admitted);

/**
 * A shopper refreshes the price of one product (plan 0216).
 *
 * **A refresh is not a run.** It has no `harvest_runs` row and takes no lock a
 * run takes, so a walk never blocks it and it never blocks a walk or a
 * schedule. It shares two things with a walk, and only two: the adapter client
 * that fetches, and the ingest write that stores.
 *
 * The request answers before the fetch, with the `PENDING` row, and the
 * client polls the status route (section 8).
 */
@Injectable()
export class PriceRefreshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceRefreshService.name);
  private sweep?: ReturnType<typeof setInterval>;
  /** The fetches in flight, so a spec can wait for one to finish. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly store: PriceRefreshStore,
    private readonly resolver: PriceRefreshResolver,
    private readonly cooldown: PriceRefreshCooldown,
    private readonly sources: SupermarketSourceService,
    private readonly ingest: SourceIngest,
    @InjectRepository(SourceEntryPrice)
    private readonly prices: Repository<SourceEntryPrice>,
    @InjectRepository(HarvestRun)
    private readonly runs: Repository<HarvestRun>,
    private readonly config: ConfigService,
    @Inject(REFRESH_FETCHERS)
    private readonly fetchers: Partial<Record<string, RefreshFetcher>>,
    @Inject(HARVEST_CLOCK) private readonly now: () => Date
  ) {}

  onModuleInit(): void {
    // The reaper's shape (`harvest-run.service.ts`): a timer that never keeps
    // the process alive on its own.
    this.sweep = setInterval(() => void this.tidy(), SWEEP_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweep) {
      clearInterval(this.sweep);
    }
  }

  /** Section 7.1: start a refresh, join one, or answer `FRESH`. */
  async request(req: PriceRefreshRequest): Promise<PriceRefreshView> {
    const checked = await this.check1to6(req.itemId, req.priceScopeId);
    if (checked.kind === 'fresh') {
      return {
        id: null,
        itemId: req.itemId,
        priceScopeId: req.priceScopeId,
        status: PriceRefreshStatus.FRESH,
        observedAt: iso(checked.resolved.observedAt),
        requestedAt: null,
        finishedAt: null,
      };
    }
    if (checked.kind === 'refused') {
      throw notRefreshable(checked.reason);
    }
    const { resolved, source, scopes } = checked;

    // Step 7: the shopper joins a refresh in flight, whoever started it.
    const pending = await this.store.findPending(
      resolved.entry.id,
      resolved.fetchScopeId
    );
    if (pending) {
      if (pending.requestedByUserId !== req.userId) {
        await this.cooldown.addViewer(pending.id, req.userId);
      }
      return this.viewOf(pending, req.priceScopeId);
    }

    // Step 8: the claims, which throw a 429 with the wait.
    await this.cooldown.claim({
      supermarketId: resolved.entry.supermarketId,
      entryId: resolved.entry.id,
      fetchScopeId: resolved.fetchScopeId,
    });

    // Step 9: the row, then the fetch in the background.
    const row = await this.store.insertPending({
      requestedByUserId: req.userId,
      supermarketId: resolved.entry.supermarketId,
      sourceId: source.id,
      entryId: resolved.entry.id,
      itemId: req.itemId,
      priceScopeId: req.priceScopeId,
      fetchScopeId: resolved.fetchScopeId,
    });
    const run = this.execute(row, { resolved, source, scopes }).finally(() =>
      this.inFlight.delete(run)
    );
    this.inFlight.add(run);
    return this.viewOf(row, req.priceScopeId, resolved.observedAt);
  }

  /** Section 7.2: steps 1 to 7, and the keys of step 8 read without a claim. */
  async check(req: PriceRefreshRequest): Promise<PriceRefreshCheckView> {
    const checked = await this.check1to6(req.itemId, req.priceScopeId);
    if (checked.kind === 'fresh') {
      return {
        refreshable: false,
        reason: PriceRefreshRefusal.FRESH,
        retryAfterSeconds: checked.freshForSeconds,
        pendingRefreshId: null,
        observedAt: iso(checked.resolved.observedAt),
      };
    }
    if (checked.kind === 'refused') {
      return {
        refreshable: false,
        reason: checked.reason,
        retryAfterSeconds: 0,
        pendingRefreshId: null,
        observedAt: iso(checked.observedAt),
      };
    }
    const { resolved } = checked;
    const pending = await this.store.findPending(
      resolved.entry.id,
      resolved.fetchScopeId
    );
    return {
      refreshable: true,
      reason: null,
      retryAfterSeconds: pending
        ? 0
        : await this.cooldown.remaining({
            supermarketId: resolved.entry.supermarketId,
            entryId: resolved.entry.id,
            fetchScopeId: resolved.fetchScopeId,
          }),
      pendingRefreshId: pending?.id ?? null,
      observedAt: iso(resolved.observedAt),
    };
  }

  /**
   * Section 7.3: a refresh this user requested, or joined in the last two
   * minutes. Any other id is a 404, so an id says nothing about another
   * shopper.
   */
  async get(req: PriceRefreshIdRequest): Promise<PriceRefreshView> {
    const row = await this.store.findById(req.refreshId);
    if (
      !row ||
      (row.requestedByUserId !== req.userId &&
        !(await this.cooldown.isViewer(row.id, req.userId)))
    ) {
      throw new NotFoundException('Price refresh not found');
    }
    return this.viewOf(row, row.priceScopeId);
  }

  /** Wait for every fetch in flight. For specs and for a clean shutdown. */
  async settled(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  /**
   * The timer of section 4: a row `PENDING` for two minutes becomes `FAILED`
   * as interrupted, and rows older than 90 days are deleted.
   */
  async tidy(): Promise<void> {
    const now = this.now();
    try {
      const reaped = await this.store.reapInterrupted(
        new Date(now.getTime() - REFRESH_INTERRUPTED_MS),
        now
      );
      const deleted = await this.store.deleteOlderThan(
        new Date(now.getTime() - REFRESH_KEPT_DAYS * 86_400_000)
      );
      if (reaped > 0 || deleted > 0) {
        this.logger.log(
          `Price refreshes: ${reaped} interrupted, ${deleted} older than ` +
            `${REFRESH_KEPT_DAYS} days deleted.`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Price refresh sweep failed: ${describeError(error).message}`
      );
    }
  }

  /** Steps 1 to 6 of section 7.1, the same for the request and the check. */
  private async check1to6(
    itemId: string,
    priceScopeId: string
  ): Promise<Checked> {
    const settings = this.settings();
    // Step 1.
    if (!settings.harvestEnabled || !settings.refreshEnabled) {
      return refusedBy(PriceRefreshRefusal.REFRESH_OFF, null);
    }

    // Step 2. The source is read once, for the kind its walk stamps and for
    // step 3.
    let source: SupermarketSource | null | undefined;
    const sourceOf = async (supermarketId: string) => {
      source = await this.sources.findBySupermarket(supermarketId);
      return source;
    };
    const resolved = await this.resolver.resolve(
      itemId,
      priceScopeId,
      async (supermarketId): Promise<PriceSourceKind | null> => {
        const found = await sourceOf(supermarketId);
        return found ? sourceKindOf(found.adapterKey) : null;
      }
    );
    if (resolved.refused !== null) {
      return refusedBy(resolved.refused, resolved.observedAt);
    }

    // Step 3.
    if (!source || !source.enabled) {
      return refusedBy(PriceRefreshRefusal.SOURCE_OFF, resolved.observedAt);
    }
    // Step 4.
    if (
      !adapterCapabilities(source.adapterKey).refreshesOneProduct ||
      !this.fetchers[source.adapterKey]
    ) {
      return refusedBy(
        PriceRefreshRefusal.NO_SINGLE_FETCH,
        resolved.observedAt
      );
    }
    // Step 5.
    if (await this.chainRefusing(source.supermarketId, settings)) {
      return refusedBy(PriceRefreshRefusal.CHAIN_REFUSING, resolved.observedAt);
    }
    // Section 3, step 3: the fetch scope's own key. A scope catalog holds no
    // key for is one nothing can fetch at, which is a price this harvester
    // cannot repeat.
    const scopes = await this.resolver.scopes(
      source.supermarketId,
      resolved.fetchScopeId
    );
    if (!scopes) {
      return refusedBy(PriceRefreshRefusal.NOT_HARVESTED, resolved.observedAt);
    }

    // Step 6.
    const windowMs = settings.refreshProductMinutes * 60_000;
    const age = resolved.observedAt
      ? this.now().getTime() - resolved.observedAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (age < windowMs) {
      return {
        kind: 'fresh',
        resolved,
        freshForSeconds: Math.max(1, Math.ceil((windowMs - age) / 1000)),
      };
    }
    return { kind: 'admitted', resolved, source, scopes };
  }

  /**
   * Step 5, with the owner's reading of 2026-11-06: the chain's newest
   * finished run ended with `stopReason: SOURCE_BLOCKED`, and it finished less
   * than `HARVEST_REFRESH_BLOCKED_MINUTES` ago. A run in flight is not read.
   */
  private async chainRefusing(
    supermarketId: string,
    settings: HarvesterConfig
  ): Promise<boolean> {
    const newest = await this.runs.findOne({
      where: {
        supermarketId,
        status: Not(In([HarvestRunStatus.PENDING, HarvestRunStatus.RUNNING])),
      },
      order: { finishedAt: { direction: 'DESC', nulls: 'LAST' } },
    });
    if (
      !newest?.finishedAt ||
      newest.stopReason !== HarvestRunStopReason.SOURCE_BLOCKED
    ) {
      return false;
    }
    const since = this.now().getTime() - new Date(newest.finishedAt).getTime();
    return since < settings.refreshBlockedMinutes * 60_000;
  }

  /** The background half: one fetch, one write, and the row's outcome. */
  private async execute(row: PriceRefresh, admitted: Admitted): Promise<void> {
    const { resolved, source, scopes } = admitted;
    const settings = this.settings();
    const fetcher = this.fetchers[source.adapterKey];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    timer.unref?.();
    let outcome: PriceRefreshOutcome;
    try {
      if (!fetcher) {
        throw new Error(`No refresh fetcher for ${source.adapterKey}`);
      }
      const read = await fetcher({
        entry: resolved.entry,
        source,
        fetchKey: scopes.fetchKey,
        signal: controller.signal,
        userAgent: settings.userAgent,
        mercadonaBaseUrl: settings.mercadonaBaseUrl,
      });
      outcome = read.found
        ? await this.write(resolved, source, scopes, read.observation)
        : { status: PriceRefreshStatus.NOT_STOCKED };
    } catch (error) {
      outcome = await this.failure(error, source, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
    try {
      await this.store.finish(row.id, outcome, this.now());
    } catch (error) {
      // The timer writes the row `FAILED` as interrupted two minutes on.
      this.logger.warn(
        `Price refresh ${row.id} could not record its outcome: ${describeError(error).message}`
      );
    }
    this.logger.log(
      `Price refresh ${row.id} of row ${resolved.entry.id} at scope ` +
        `${resolved.fetchScopeId}: ${outcome.status}` +
        (outcome.error ? ` (${outcome.error})` : '')
    );
  }

  /** The ingest write a walk makes, and what it says about the fetch scope. */
  private async write(
    resolved: ResolvedRefresh,
    source: SupermarketSource,
    scopes: RefreshScopes,
    observation: PartialSourceObservation
  ): Promise<PriceRefreshOutcome> {
    const written = await this.ingest.writeRefreshedPrices({
      entry: resolved.entry,
      sourceKind: sourceKindOf(source.adapterKey),
      observation,
      scopeIdFor: scopes.scopeIdFor,
      copiesOf: copiesOfRows(resolved.rows),
    });
    if (written.soldAnotherWay) {
      return {
        status: PriceRefreshStatus.FAILED,
        error:
          'The source sells this product another way than its row says, ' +
          'so nothing was written. The next walk settles it.',
      };
    }
    const readAtFetchScope = observation.prices.some(
      (price) =>
        price.scopeKey !== null &&
        scopes.scopeIdFor(price.scopeKey) === resolved.fetchScopeId
    );
    if (!readAtFetchScope) {
      // A LIDL page that no longer names the region asked about, or a detail
      // with no price. Whatever other region it named was still written.
      return {
        status: PriceRefreshStatus.NOT_STOCKED,
        pricesWritten: written.inserted,
        pricesConfirmed: written.confirmed,
      };
    }
    return {
      status: PriceRefreshStatus.DONE,
      pricesWritten: written.inserted,
      pricesConfirmed: written.confirmed,
    };
  }

  /** A refusal sets the blocked key; anything else is a failure of this fetch. */
  private async failure(
    error: unknown,
    source: SupermarketSource,
    timedOut: boolean
  ): Promise<PriceRefreshOutcome> {
    if (isRefusal(error)) {
      // A refresh 403 writes nothing to `consecutiveFailures` and nothing to
      // plan 0215's state (the owner's answer of 2026-11-06). The blocked key
      // is all it leaves.
      await this.cooldown.block(source.supermarketId);
      return {
        status: PriceRefreshStatus.BLOCKED,
        error: describeError(error).message,
      };
    }
    return {
      status: PriceRefreshStatus.FAILED,
      error: timedOut
        ? `The source did not answer within ${REFRESH_TIMEOUT_MS / 1000} s.`
        : describeError(error).message,
    };
  }

  /** The view of a row, with the stored observation time at its fetch scope. */
  private async viewOf(
    row: PriceRefresh,
    priceScopeId: string,
    known?: Date | null
  ): Promise<PriceRefreshView> {
    const observedAt =
      known !== undefined && row.status === PriceRefreshStatus.PENDING
        ? known
        : await this.observedAt(row);
    return {
      id: row.id,
      itemId: row.itemId,
      priceScopeId,
      status: row.status,
      observedAt: iso(observedAt),
      requestedAt: iso(row.requestedAt),
      finishedAt: iso(row.finishedAt),
    };
  }

  /** The newest stored observation of the row at its fetch scope. */
  private async observedAt(row: PriceRefresh): Promise<Date | null> {
    const held = await this.prices.find({
      where: { entryId: row.entryId, priceScopeId: row.fetchScopeId },
      order: { observedAt: 'DESC' },
      take: 1,
    });
    return held[0]?.observedAt ?? null;
  }

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }
}

function refusedBy(
  reason: PriceRefreshRefusal,
  observedAt: Date | null
): Checked {
  return { kind: 'refused', reason, observedAt };
}

function notRefreshable(
  reason: PriceRefreshRefusal
): PriceNotRefreshableException {
  return new PriceNotRefreshableException(
    `The price of this product cannot be refreshed: ${reason}`,
    { details: { [PRICE_REFRESH_REASON_DETAIL]: reason } }
  );
}

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}
