import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  type HarvestRunIdRequest,
  type HarvestRunPage,
  type HarvestRunView,
  type ListHarvestRunsRequest,
  type SpawnHarvestRunRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotConfiguredException,
  ValidationException,
  clampPageSize,
  decodeCursor,
  encodeCursor,
  getRequestContext,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import {
  ActiveRunExistsError,
  DocumentAlreadyImportedError,
  HarvestRunStore,
} from './harvest-run.store';
import { toHarvestRunView } from './harvest.mappers';
import { readLeafletDocument } from './leaflet-document.reader';
import { resolveLeafletWindow } from './leaflet-validity';
import { PlatformAdminService } from './platform-admin.service';
import { RunExecutor } from './run-executor.service';
import { SupermarketSourceService } from './supermarket-source.service';

interface RunCursor {
  value: string;
  id: string;
}

/**
 * The run surface (plan 0038, section 7), platform admin gated like everything
 * else here.
 *
 * `spawn` answers with the PENDING run immediately and does **not** wait for it:
 * a catalog discovery takes tens of minutes and a request/reply that waited would
 * time out many times over. Live progress is polling `harvest.run.get`, per
 * section 6.6's phase one; the realtime `admin:harvest` room stays deferred, and
 * there is deliberately no second push path in the gateway.
 */
@Injectable()
export class HarvestRunService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HarvestRunService.name);
  private reaperTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: HarvestRunStore,
    private readonly executor: RunExecutor,
    private readonly sources: SupermarketSourceService,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  onModuleInit(): void {
    const settings = this.settings();
    if (!settings.harvestEnabled) {
      this.logger.log(
        'HARVEST_ENABLED is false: this instance will answer reads and refuse ' +
          'to spawn. Nothing will be fetched from any third party.'
      );
    }
    // A plain timer rather than @nestjs/schedule: one interval does not earn a
    // dependency, and this plan adds none (section 3.4). `unref` so a pending
    // tick never keeps the process alive during a shutdown drain.
    this.reaperTimer = setInterval(() => void this.reapStale(), 60_000);
    this.reaperTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
    }
  }

  async spawn(req: SpawnHarvestRunRequest): Promise<HarvestRunView> {
    await this.admin.requireAdmin(req);
    const settings = this.settings();
    if (!settings.harvestEnabled) {
      // A statement about the server, not about the request: nothing the caller
      // changes makes this succeed, and nothing is broken. That is exactly what
      // NotConfiguredException means, and it renders as 501.
      throw new NotConfiguredException(
        'Harvesting is disabled on this deployment (HARVEST_ENABLED is false).'
      );
    }

    const { supermarketId, priceScopeId, payload, documentSha256 } =
      this.validate(req);
    const source = supermarketId
      ? await this.sources.findBySupermarket(supermarketId)
      : null;
    // A LEAFLET_IMPORT needs no source and must not be refused for wanting one
    // (plan 0081, section 1). `SupermarketSource` is fetching configuration, an
    // upload fetches nothing, and a chain that publishes only leaflets has no
    // row at all. The run still carries `sourceId: null` where the chain does
    // have one, because no source was used.
    const needsSource = req.mode !== HarvestRunMode.LEAFLET_IMPORT;
    if (needsSource && supermarketId && !source) {
      throw new ValidationException(
        'That supermarket has no configured source. Create one with ' +
          'supermarketSource.upsert before starting a run.'
      );
    }
    if (needsSource && source && !source.enabled) {
      throw new ValidationException(
        'That source is disabled. Enable it with supermarketSource.setEnabled.'
      );
    }

    try {
      const run = await this.store.create({
        mode: req.mode,
        trigger: HarvestRunTrigger.MANUAL,
        supermarketId,
        sourceId: needsSource ? (source?.id ?? null) : null,
        priceScopeId,
        requestedByUserId: req.userId,
        correlationId: getRequestContext()?.correlationId ?? null,
        payload,
        documentSha256,
      });
      // The reaper compares heartbeats, so a run gets one the moment it exists
      // rather than when it starts working: a process that dies in between would
      // otherwise hold the lock forever.
      await this.store.seedHeartbeat(run.id);
      this.executor.start(run.id);
      return toHarvestRunView(run);
    } catch (error) {
      if (error instanceof DocumentAlreadyImportedError) {
        // A different sentence from the one below, because the next step is
        // different: this file is already imported, and importing it again
        // means reverting that run first (plan 0081, section 7).
        throw new ConflictException(
          error.existingRunId
            ? `That document has already been imported for this chain by run ` +
                `${error.existingRunId}. Revert that run to import it again.`
            : 'That document has already been imported for this chain'
        );
      }
      if (error instanceof ActiveRunExistsError) {
        // A 409 carrying the active run's id, so the caller can watch that one
        // instead of guessing (section 7).
        throw new ConflictException(
          error.activeRunId
            ? `A run is already in progress: ${error.activeRunId}`
            : 'A run is already in progress'
        );
      }
      throw error;
    }
  }

  /**
   * Ask a run to stop. Graceful and idempotent: it records the request, and the
   * executor cancels the in flight requests if this process is the one running
   * it. On another replica the run's own abort poll picks it up within seconds.
   */
  async abort(req: HarvestRunIdRequest): Promise<HarvestRunView> {
    await this.admin.requireAdmin(req);
    const run = await this.store.requestAbort(req.runId);
    this.executor.cancel(req.runId);
    return toHarvestRunView(run);
  }

  async get(req: HarvestRunIdRequest): Promise<HarvestRunView> {
    await this.admin.requireAdmin(req);
    return toHarvestRunView(await this.store.load(req.runId));
  }

  async list(req: ListHarvestRunsRequest): Promise<HarvestRunPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as RunCursor | undefined;

    const qb = this.store
      .repository()
      .createQueryBuilder('r')
      .orderBy('r.requestedAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(limit + 1);
    if (req.supermarketId) {
      qb.andWhere('r."supermarketId" = :sid', { sid: req.supermarketId });
    }
    if (req.mode) {
      qb.andWhere('r.mode = :mode', { mode: req.mode });
    }
    if (req.status) {
      qb.andWhere('r.status = :status', { status: req.status });
    }
    if (cursor) {
      qb.andWhere('(r."requestedAt", r.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toHarvestRunView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.requestedAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * The stale reaper (section 6.6). Runs every minute and marks any PENDING or
   * RUNNING run whose heartbeat is older than `HARVEST_STALE_AFTER` as STALE,
   * which releases the lock the partial unique index holds.
   *
   * This is the **only** recovery path designed for a force killed harvester. A
   * lost run costs one refresh cycle, and building resumption for that is how a
   * twenty minute job grows a checkpoint log.
   */
  async reapStale(): Promise<void> {
    try {
      const reaped = await this.store.reapStale(this.settings().staleAfterSeconds);
      if (reaped > 0) {
        this.logger.warn(`Reaped ${reaped} stale harvest run(s)`);
      }
    } catch (error) {
      // The reaper must never take the process down: it runs on a timer with no
      // caller to return an error to.
      this.logger.error(`Stale reaper failed: ${String(error)}`);
    }
  }

  /**
   * Which fields a mode actually needs, checked once here rather than in three
   * runners. A STORE_DISCOVERY belongs to a postal code and a radius; the other
   * two belong to a chain and a scope.
   */
  private validate(req: SpawnHarvestRunRequest): {
    supermarketId: string | null;
    priceScopeId: string | null;
    payload: Record<string, unknown>;
    documentSha256: string | null;
  } {
    if (req.mode === HarvestRunMode.LEAFLET_IMPORT) {
      return this.validateLeaflet(req);
    }
    if (req.mode === HarvestRunMode.STORE_DISCOVERY) {
      if (!req.postalCode) {
        throw new ValidationException(
          'A store discovery run needs a postal code to centre on.'
        );
      }
      return {
        supermarketId: null,
        priceScopeId: null,
        documentSha256: null,
        payload: {
          postalCode: req.postalCode,
          country: req.country ?? 'es',
          // Section 11's recommendation: 3 km returned 26 supermarkets around
          // 14013 while the wider box returned 75. The review step makes a small
          // over-fetch cheap and a large one tedious.
          radiusMetres: req.radiusMetres ?? 3000,
          brandKeys: req.brandKeys ?? [],
        },
      };
    }

    if (!req.supermarketId) {
      throw new ValidationException(`A ${req.mode} run needs a supermarketId.`);
    }
    if (req.mode === HarvestRunMode.REFRESH && !req.priceScopeId) {
      throw new ValidationException(
        'A refresh run needs the price scope to write the prices for.'
      );
    }
    return {
      supermarketId: req.supermarketId,
      priceScopeId: req.priceScopeId ?? null,
      documentSha256: null,
      payload: {
        supermarketId: req.supermarketId,
        priceScopeId: req.priceScopeId ?? null,
      },
    };
  }

  /**
   * A leaflet import needs a chain, a scope and a document (plan 0081, section
   * 1), and its validity has to resolve before the run exists.
   *
   * The document is validated **here**, in the harvester, because the harvester
   * owns the schema version and a broker message is not a trusted input: the
   * gateway's own validation is the first of the two the plan asks for, not the
   * only one.
   *
   * The window is resolved here too, so a run with a null bound is refused
   * before it is inserted rather than failing eighteen offers in, and so the
   * instants are stored on the run for an alias accept to write with later
   * (section 3).
   */
  private validateLeaflet(req: SpawnHarvestRunRequest): {
    supermarketId: string | null;
    priceScopeId: string | null;
    payload: Record<string, unknown>;
    documentSha256: string | null;
  } {
    if (!req.supermarketId) {
      throw new ValidationException(
        'A leaflet import needs the chain the leaflet is from. `chain_id` in ' +
          'the document is a hint the upload screen shows, never a lookup key.'
      );
    }
    if (!req.priceScopeId) {
      throw new ValidationException(
        'A leaflet import needs the price scope to write the prices for. Most ' +
          'leaflets are nationwide, so that is usually the chain NATIONAL scope.'
      );
    }
    if (!req.document) {
      throw new ValidationException('A leaflet import needs a document.');
    }

    const document = readLeafletDocument(req.document);
    const window = resolveLeafletWindow({
      documentStartsOn: document.validity.starts_on,
      documentEndsOn: document.validity.ends_on,
      overrideFrom: req.validFrom,
      overrideUntil: req.validUntil,
    });

    return {
      supermarketId: req.supermarketId,
      priceScopeId: req.priceScopeId,
      documentSha256: document.source.sha256,
      payload: {
        supermarketId: req.supermarketId,
        priceScopeId: req.priceScopeId,
        // The resolved instants, not the local days: the runner writes them
        // onto every price row and an accept reads them back to decide whether
        // this import is still open.
        validFrom: window.validFrom.toISOString(),
        validUntil: window.validUntil.toISOString(),
        document,
      },
    };
  }
}

/** Re-exported for the module's provider list. */
export { HarvestRunStatus };
