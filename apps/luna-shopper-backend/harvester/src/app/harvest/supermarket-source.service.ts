import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  ListSupermarketSourcesRequest,
  SetSupermarketSourceEnabledRequest,
  SupermarketSourceIdRequest,
  SupermarketSourcePage,
  SupermarketSourceView,
  UpsertSupermarketSourceRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { SupermarketSource } from '../entities';
import { toSupermarketSourceView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';

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
    private readonly config: ConfigService
  ) {}

  private defaults(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  async upsert(
    req: UpsertSupermarketSourceRequest
  ): Promise<SupermarketSourceView> {
    this.admin.requireAdmin(req.userId);
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
        config: {},
        workers: defaults.defaultWorkers,
        maxRequestsPerSecond: defaults.defaultMaxRequestsPerSecond,
      });

    row.adapterKey = req.adapterKey;
    if (req.enabled !== undefined) {
      row.enabled = req.enabled;
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

    return toSupermarketSourceView(await this.sources.save(row));
  }

  async get(req: SupermarketSourceIdRequest): Promise<SupermarketSourceView> {
    this.admin.requireAdmin(req.userId);
    return toSupermarketSourceView(await this.load(req.supermarketId));
  }

  async setEnabled(
    req: SetSupermarketSourceEnabledRequest
  ): Promise<SupermarketSourceView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.supermarketId);
    row.enabled = req.enabled;
    return toSupermarketSourceView(await this.sources.save(row));
  }

  async list(
    req: ListSupermarketSourcesRequest
  ): Promise<SupermarketSourcePage> {
    this.admin.requireAdmin(req.userId);
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
      items: page.map(toSupermarketSourceView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
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

  async recordRunStarted(source: SupermarketSource): Promise<void> {
    source.lastRunAt = new Date();
    await this.sources.save(source);
  }

  /**
   * A finished run's verdict. `consecutiveFailures` is what a future scheduler
   * would back off on; nothing reads it yet, and it is one column rather than the
   * schedule block section 4.1 refuses to add before anything needs it.
   */
  async recordRunFinished(
    source: SupermarketSource,
    succeeded: boolean
  ): Promise<void> {
    if (succeeded) {
      source.lastSuccessAt = new Date();
      source.consecutiveFailures = 0;
    } else {
      source.consecutiveFailures += 1;
    }
    await this.sources.save(source);
  }
}
