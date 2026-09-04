import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RealtimeEvent, ZoneStatus } from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { LessThan, Repository } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import type { CoreConfig } from '../config/app-config';
import { Zone } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';

/**
 * Zone reaper (plan 0011, section 3). Deletes zones that have been
 * MARKED_FOR_DELETION for longer than the grace period and still have no owner
 * (no admin claimed them). Deleting the zone cascades its memberships, lists,
 * lines and comments. Self-contained interval loop, matching the raw-timer style
 * used elsewhere: `unref`ed, non-overlapping, cleared on shutdown.
 */
@Injectable()
export class ZoneReaperService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cfg: CoreConfig['reaper'];
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    private readonly events: CoreEventsPublisher,
    private readonly logger: Logger,
    // Only the operator path writes to it. A scheduled run has no actor to
    // record (plan 0077, section 8), which is why the two paths are two methods.
    private readonly audit: CoreAuditService,
    configService: ConfigService
  ) {
    this.cfg = configService.getOrThrow<CoreConfig>('core').reaper;
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.enabled) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.cfg.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.reap();
    } catch (err) {
      this.logger.error({ err }, 'zone reaper failed');
    } finally {
      this.running = false;
    }
  }

  /** Delete one batch of abandoned marked zones. Returns how many were removed. */
  async reap(): Promise<number> {
    const cutoff = new Date(Date.now() - this.cfg.graceMs);
    const zones = await this.zones.find({
      where: {
        status: ZoneStatus.MARKED_FOR_DELETION,
        // LessThan naturally excludes rows whose markedForDeletionAt is null.
        markedForDeletionAt: LessThan(cutoff),
      },
      take: this.cfg.batchSize,
    });

    let removed = 0;
    for (const zone of zones) {
      // An admin may have claimed it between the query and now; skip if rescued.
      if (zone.ownerUserId) {
        continue;
      }
      await this.deleteZone(zone.id);
      removed++;
    }
    if (removed > 0) {
      this.logger.log(
        { count: removed },
        'zone reaper deleted abandoned zones'
      );
    }
    return removed;
  }

  /**
   * Delete one zone: the row goes, the cascade takes its memberships, lists,
   * lines and comments, and every client holding it is told.
   *
   * Public because plan 0074 gives an operator a delete a zone action, and
   * section 1 says a named action reuses the code that maintains the invariant
   * rather than restating it. What deleting a zone **means** lives here, so the
   * operator's delete and the reaper's are one write and cannot come to mean two
   * different things.
   *
   * This is the **scheduled** path, and it writes no audit row. A cron run has no
   * actor, and a trail row naming nobody is worse than the absence of one,
   * because the table's whole subject is who did it (plan 0077, section 8). The
   * operator's is {@link deleteZoneAsOperator}, which is a separate entry point
   * rather than an optional argument for exactly that reason.
   */
  async deleteZone(zoneId: string): Promise<{ id: string }> {
    await this.zones.delete({ id: zoneId });
    return this.announceDeletion(zoneId);
  }

  /**
   * Delete one zone on an operator's say so (plan 0074, section 1; plan 0077,
   * section 8).
   *
   * The same deletion and the same announcement, recorded. The row is **loaded**
   * first rather than deleted by id, because what the zone said is the part of a
   * deletion worth keeping: a trail saying only that something with this id used
   * to exist cannot answer what was lost. That load is also why a zone that is
   * already gone answers 404 here and not on the scheduled path, which reads its
   * batch before it deletes anything.
   *
   * No grace period and no marking on this path, deliberately. The grace period
   * exists so an admin can rescue a zone whose owner vanished by accident (plan
   * 0011, section 3); an operator deleting a zone on purpose is the decision the
   * grace period was waiting for, and leaving the zone up for a week afterwards
   * would only mean it is still there when they check.
   */
  async deleteZoneAsOperator(
    zoneId: string,
    actorId: string
  ): Promise<{ id: string }> {
    const zone = await this.zones.findOne({ where: { id: zoneId } });
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }
    await this.audit.write(actorId, (tx) => tx.delete(Zone, zone));
    return this.announceDeletion(zoneId);
  }

  /**
   * What a committed deletion tells everybody holding the zone.
   *
   * After the write on both paths, since an event for a transaction that then
   * rolls back is a lie every open client acts on.
   */
  private announceDeletion(zoneId: string): { id: string } {
    this.events.emit(RealtimeEvent.ZoneDeleted, zoneId, { id: zoneId });
    return { id: zoneId };
  }
}
