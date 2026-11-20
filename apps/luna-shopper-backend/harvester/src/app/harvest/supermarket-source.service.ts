import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SOURCE_ADAPTER_KEYS,
  type AdapterKey,
  type ListSupermarketSourcesRequest,
  type SetSupermarketSourceEnabledRequest,
  type SourceAdapterKey,
  type SupermarketSourceIdRequest,
  type SupermarketSourcePage,
  type SupermarketSourceView,
  type UpsertSupermarketSourceRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { SupermarketSource } from '../entities';
import { HarvestRunStore } from './harvest-run.store';
import { toSupermarketSourceView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { toSourceProbeSummary } from './probes/source-probe.mappers';
import { SourceProbeStore } from './probes/source-probe.store';

interface SourceCursor {
  value: string;
  id: string;
}

/**
 * Per chain fetching configuration (plan 0038, section 7). Platform admin gated,
 * like everything else here.
 *
 * A source is created **disabled**, and `setEnabled` is a separate call on
 * purpose: turning fetching on for a third party is a decision someone makes
 * explicitly, never a side effect of describing the chain.
 */
@Injectable()
export class SupermarketSourceService {
  constructor(
    @InjectRepository(SupermarketSource)
    private readonly sources: Repository<SupermarketSource>,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService,
    private readonly runs: HarvestRunStore,
    // Plan 0219: the newest probe of each row, for its view. Optional, so a
    // spec that builds this service without probes still can.
    private readonly probes?: SourceProbeStore
  ) {}

  private defaults(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  async upsert(
    req: UpsertSupermarketSourceRequest
  ): Promise<SupermarketSourceView> {
    await this.admin.requireAdmin(req);
    // OpenStreetMap is asked for every postal code whatever the rows say
    // (plan 0153), so a row for it switches nothing on. An existing one can
    // still be disabled and deleted, which are separate calls.
    if (!isSourceAdapterKey(req.adapterKey)) {
      throw new ValidationException(
        `${req.adapterKey} cannot be a source row. OpenStreetMap is asked ` +
          'for every postal code without one.'
      );
    }
    const defaults = this.defaults();

    const existing = await this.sources.findOne({
      where: { supermarketId: req.supermarketId },
    });
    const row =
      existing ??
      this.sources.create({
        supermarketId: req.supermarketId,
        adapterKey: req.adapterKey,
        enabled: false,
        // Untrusted, like `enabled` and for the same reason (plan 0107, D2):
        // describing a chain says nothing about whether its shops may reach the
        // catalog unreviewed.
        autoImportPlaces: false,
        config: {},
        workers: defaults.defaultWorkers,
        maxRequestsPerSecond: defaults.defaultMaxRequestsPerSecond,
      });

    row.adapterKey = req.adapterKey;
    if (req.enabled !== undefined) {
      row.enabled = req.enabled;
    }
    if (req.autoImportPlaces !== undefined) {
      row.autoImportPlaces = req.autoImportPlaces;
    }
    if (req.config !== undefined) {
      row.config = req.config;
    }
    if (req.workers !== undefined) {
      row.workers = req.workers;
    }
    if (req.maxRequestsPerSecond !== undefined) {
      row.maxRequestsPerSecond = req.maxRequestsPerSecond;
    }

    return this.withLastProbe(await this.sources.save(row));
  }

  async get(req: SupermarketSourceIdRequest): Promise<SupermarketSourceView> {
    await this.admin.requireAdmin(req);
    return this.withLastProbe(await this.load(req.supermarketId));
  }

  async setEnabled(
    req: SetSupermarketSourceEnabledRequest
  ): Promise<SupermarketSourceView> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.supermarketId);
    row.enabled = req.enabled;
    return this.withLastProbe(await this.sources.save(row));
  }

  /**
   * Take a chain's row away.
   *
   * **The only way back from a row on the wrong chain.** The row is keyed on
   * the chain it belongs to, so a source described against the wrong one cannot
   * be moved: `upsert` keys on the same column and would write a second row
   * beside the first. Without this, one wrong pick in the create panel was
   * permanent.
   *
   * A run in flight for that chain refuses it, because the run reads its worker
   * count and its rate from the row while it works. Finished runs are left
   * alone and keep their `sourceId`: they are what this chain's fetching did,
   * and a history that forgets it because the configuration was deleted is a
   * worse answer than an id pointing at a row that is gone.
   */
  async delete(req: SupermarketSourceIdRequest): Promise<{ id: string }> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.supermarketId);

    const active = await this.runs.findActiveBySupermarket(req.supermarketId);
    if (active) {
      throw new ConflictException(
        `A run is in progress for this chain: ${active.id}. Abort it first, ` +
          'then delete the source.'
      );
    }

    await this.sources.delete({ id: row.id });
    return { id: row.id };
  }

  async list(
    req: ListSupermarketSourcesRequest
  ): Promise<SupermarketSourcePage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as SourceCursor | undefined;

    const qb = this.sources
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(s."createdAt", s.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.withLastProbes(page),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** One row's view with its newest probe that is not ABORTED (plan 0219). */
  private async withLastProbe(
    row: SupermarketSource
  ): Promise<SupermarketSourceView> {
    const [view] = await this.withLastProbes([row]);
    return view;
  }

  /** Every row's newest probe in one query, never one query per row. */
  private async withLastProbes(
    rows: SupermarketSource[]
  ): Promise<SupermarketSourceView[]> {
    if (!this.probes) {
      return rows.map((row) => toSupermarketSourceView(row));
    }
    const latest = await this.probes.latestBySources(rows.map((row) => row.id));
    return rows.map((row) => {
      const probe = latest.get(row.id);
      return toSupermarketSourceView(
        row,
        probe ? toSourceProbeSummary(probe) : null
      );
    });
  }

  /** The row a run reads its knobs from. Used by the runners, not the surface. */
  async load(supermarketId: string): Promise<SupermarketSource> {
    const row = await this.sources.findOne({ where: { supermarketId } });
    if (!row) {
      throw new NotFoundException(
        'That supermarket has no configured source. Create one with supermarketSource.upsert.'
      );
    }
    return row;
  }

  async findBySupermarket(
    supermarketId: string
  ): Promise<SupermarketSource | null> {
    return this.sources.findOne({ where: { supermarketId } });
  }

  /**
   * Every chain a run may fetch right now, oldest row first.
   *
   * No admin gate and no paging: the caller is the postal code worker deciding
   * which sources to ask about one code, not a screen. A chain whose row says
   * false is absent from the answer, which is plan 0083's rule unchanged and is
   * why this plan adds no second switch beside it.
   */
  async listEnabled(): Promise<SupermarketSource[]> {
    return this.sources.find({
      where: { enabled: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * A run started on this chain. Writes `lastRunAt` and nothing else.
   *
   * **Never `save` the object a run holds.** The run read it when it started,
   * and the owner may switch the chain off or change its rate, workers or
   * config from the back office while the run works. A whole row save then
   * puts the old values back, and a chain switched off during a run comes back
   * on. Both run writes thus name their own columns only.
   */
  async recordRunStarted(source: SupermarketSource): Promise<void> {
    const at = new Date();
    await this.sources.update({ id: source.id }, { lastRunAt: at });
    source.lastRunAt = at;
  }

  /**
   * A finished run's verdict: `lastSuccessAt` and `consecutiveFailures`, and
   * no other column (see {@link recordRunStarted}). A failure is counted in
   * the database, so a count the object read at the start of the run is never
   * written back. The object takes the stored count, for a caller that reads
   * it afterwards.
   */
  async recordRunFinished(
    source: SupermarketSource,
    succeeded: boolean
  ): Promise<void> {
    if (succeeded) {
      const at = new Date();
      await this.sources.update(
        { id: source.id },
        { lastSuccessAt: at, consecutiveFailures: 0 }
      );
      source.lastSuccessAt = at;
      source.consecutiveFailures = 0;
      return;
    }
    const result = await this.sources
      .createQueryBuilder()
      .update(SupermarketSource)
      .set({ consecutiveFailures: () => '"consecutiveFailures" + 1' })
      .where('id = :id', { id: source.id })
      .returning(['consecutiveFailures'])
      .execute();
    const counted = (result.raw as { consecutiveFailures?: unknown }[])[0]
      ?.consecutiveFailures;
    source.consecutiveFailures =
      counted === undefined ? source.consecutiveFailures + 1 : Number(counted);
  }
}

function isSourceAdapterKey(key: AdapterKey): key is SourceAdapterKey {
  return (SOURCE_ADAPTER_KEYS as readonly AdapterKey[]).includes(key);
}
