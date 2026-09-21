import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParticipantEndedReason } from '@portfolio/luna-shopper/contracts';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import type { BasketParticipant } from '../entities';
import { BasketMembersService } from './basket-members.service';

/**
 * What evicts a socket when somebody's twelve hours run out (plan 0140,
 * section 7).
 *
 * ## HTTP never waits for this
 *
 * The live participant predicate refuses an expired row at the instant of its
 * expiry, on the database's clock, so every request is already answered
 * correctly before this service runs. It exists for the two things a predicate
 * cannot do: **close a socket that is already open**, and **write down why a row
 * ended**. A participant socket is verified at connect and never again, so
 * without this a connected client would go on hearing a household's shopping
 * after its access had gone.
 *
 * ## The eviction is one method call
 *
 * `announceEnded` emits `basket.participantLeft` to the basket room.
 * Realtime turns that event into an evict sweep of both rooms of the basket
 * (`consumer/sweeps.ts`), every socket in them re-asks `checkParticipant`, and
 * the expired one leaves. A registered visitor's own sessions hear
 * `basket.unshared` and drop the basket from their shared listing.
 * **Realtime needs no change**, and a connected socket outlives its access by
 * one interval at most.
 *
 * ## Two statements, and only one of them announces
 *
 * The second revokes links whose twelve hours passed, so the table says what
 * every read already believes. It tells nobody, because nothing about a person's
 * access changed: a dead link evicts none of the people it let in, who carry
 * their own expiry.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets two core replicas sweep at once without
 * announcing one row twice, and the announcements are made after the statement
 * committed, as everywhere in core.
 *
 * Shaped like {@link BasketSweepService} rather than inventing a second
 * background style: an `unref`ed interval that never holds the process open, a
 * `running` flag so two ticks cannot overlap, a batch cap per tick, and a
 * `sweep()` a spec can call directly with no timers involved.
 */
@Injectable()
export class BasketAccessSweepService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cfg: CoreConfig['basket']['accessSweep'];
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly members: BasketMembersService,
    private readonly logger: Logger,
    configService: ConfigService
  ) {
    this.cfg = configService.getOrThrow<CoreConfig>('core').basket.accessSweep;
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
      await this.sweep();
    } catch (err) {
      this.logger.error({ err }, 'basket access sweep failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * End one batch of expired access, and revoke the links that ran out.
   * Returns how many people were evicted.
   *
   * The batch is a cap per tick, not per run: whatever is left is swept on the
   * next tick, oldest expiry first, so a backlog drains in the order it was
   * left.
   */
  async sweep(): Promise<number> {
    // What TypeORM answers for an `UPDATE ... RETURNING` is `[rows, rowCount]`
    // rather than the plain row array a `SELECT` gives, which is the trap
    // `basket.sql.ts` records. Read straight off, the announcements below would
    // fire on an array and a number, reach no room, and fail nothing.
    const answered = await this.dataSource.query(
      `UPDATE "basket_participants" p
         SET "revokedAt" = now(), "endedReason" = $2
         WHERE p.id IN (
           SELECT id FROM "basket_participants"
           WHERE "revokedAt" IS NULL
             AND "expiresAt" IS NOT NULL
             AND "expiresAt" <= now()
           ORDER BY "expiresAt"
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
       RETURNING p.*`,
      [this.cfg.batchSize, ParticipantEndedReason.EXPIRED]
    );
    const expired: BasketParticipant[] =
      Array.isArray(answered) && Array.isArray(answered[0])
        ? answered[0]
        : Array.isArray(answered)
          ? answered
          : [];

    // After the statement committed, which is the rule everywhere in core: a
    // room told about a row that a rollback then un-ended would be a lie nobody
    // could take back.
    for (const participant of expired) {
      this.members.announceEnded(participant.basketId, participant);
    }

    // The table catching up with what the reads already believe. It announces
    // nothing: a dead link evicts none of the people it let in.
    await this.dataSource.query(
      `UPDATE "basket_share_links"
         SET "revokedAt" = now()
         WHERE "revokedAt" IS NULL AND "expiresAt" <= now()`
    );

    if (expired.length > 0) {
      this.logger.log(
        { count: expired.length },
        'basket access sweep ended expired participants'
      );
    }
    return expired.length;
  }
}
