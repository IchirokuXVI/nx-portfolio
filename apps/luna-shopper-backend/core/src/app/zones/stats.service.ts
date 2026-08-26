import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ZoneStatus, type CoreStats } from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { Zone } from '../entities';

/**
 * Core's half of the platform totals (plan 0017, section 8). A plain `count(*)`
 * over its own table and nothing else: there is no shared table, no scheduled
 * snapshot and no cross database join, because the two databases behind these
 * numbers belong to two services and the architecture rests on them never being
 * joined. The gateway composes core's answer with auth's.
 *
 * Reporting only `zones` would mislead, so `activeZones` is reported beside it
 * and the client picks which one its page means.
 *
 * `count(*)` scans the visible tuples. At the size this product will plausibly
 * reach that is a millisecond, and the gateway's one minute cache absorbs the
 * rest. If the table ever grows past the point where a cache miss is noticeable,
 * the replacement is the planner's estimate (`pg_class.reltuples`), which is
 * free and accurate to within a percent for a vanity figure. Noted rather than
 * built, so the fix is not rediscovered under pressure (section 8.3).
 */
@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Zone) private readonly zones: Repository<Zone>
  ) {}

  async core(): Promise<CoreStats> {
    const row = await this.zones
      .createQueryBuilder('z')
      .select('count(*)::int', 'zones')
      .addSelect(`count(*) FILTER (WHERE z.status = :active)::int`, 'active')
      .setParameter('active', ZoneStatus.ACTIVE)
      .getRawOne<{ zones: number; active: number }>();

    return { zones: row?.zones ?? 0, activeZones: row?.active ?? 0 };
  }
}
