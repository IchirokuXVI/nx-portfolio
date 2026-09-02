import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GeneratedListStatus,
  LIVE_GENERATED_LIST_STATUSES,
} from '@portfolio/luna-shopper/contracts';
import { Logger } from 'nestjs-pino';
import { In, LessThan, Repository } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import { GeneratedList } from '../entities';
import { GeneratedListService } from './generated-list.service';

/**
 * The backstop for a trip nobody finished (plan 0059, section 4).
 *
 * Moves a `DRAFT` or `ACTIVE` basket whose `generatedAt` is older than the claim
 * window to `COMPLETED`. **Every** live basket past the window, not only the
 * fully settled ones: the basket with six unsettled lines is precisely the one
 * that needs closing, because those six are what the household is still being
 * told somebody is out buying. A sweep that only closed the tidy ones would close
 * the baskets that were already claiming nothing and leave the ones that were.
 *
 * ## One number, not two (section 4.2)
 *
 * The cutoff is `generatedList.claimWindowMs`, the number `LINE_CLAIMS_SQL`
 * already uses. Past that window the claim had already expired, so the basket had
 * already stopped saying anything to the household: the sweep is writing down
 * what the read already believed, which is why it cannot surprise anyone and why
 * a second number here would be a way for the status and the claim to disagree.
 * The invariant to keep: **a live basket never outlives its own claim.** After
 * this, "the window expired" and "the trip is over" are the same event.
 *
 * ## Through `update`, one basket at a time (section 4.4)
 *
 * Not a bulk `UPDATE`. The transition has to announce the released claims to
 * every zone room and emit `GeneratedListUpdated` to the owner, and
 * {@link GeneratedListService.update} is where that lives. A bulk update would be
 * one query and a household that never hears about it.
 *
 * ## What it never does (section 4.5)
 *
 * Never touches `ARCHIVED`: archiving is a person hiding a basket, it is already
 * not live, and the sweep would only rewrite a deliberate choice. Never deletes
 * anything: plan 0050 section 7 left retention unbounded and this does not decide
 * it. Never writes a zone list: the unsettled lines stay unsettled and
 * unrecorded, which is plan 0047 section 3's rule. Never emits a per line event:
 * the release is announced per zone room by `announceReleased`.
 *
 * Shaped like `ZoneReaperService` rather than inventing a second background
 * style: an `unref`ed interval that never holds the process open, a `running`
 * flag so two ticks cannot overlap, a batch cap per tick, and a `sweep()` a spec
 * can call directly with no timers involved.
 */
@Injectable()
export class GeneratedListSweepService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cfg: CoreConfig['generatedList'];
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    private readonly generated: GeneratedListService,
    private readonly logger: Logger,
    configService: ConfigService
  ) {
    this.cfg = configService.getOrThrow<CoreConfig>('core').generatedList;
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.sweep.enabled) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.cfg.sweep.intervalMs);
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
      this.logger.error({ err }, 'generated list sweep failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Finish one batch of live baskets older than the window. Returns how many
   * were finished.
   *
   * The batch is a cap per tick, not per run: whatever is left is swept on the
   * next tick, oldest first, so a backlog drains in the order it was left rather
   * than keeping the same old baskets at the back for ever.
   */
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - this.cfg.claimWindowMs);
    const stale = await this.lists.find({
      where: {
        status: In([...LIVE_GENERATED_LIST_STATUSES]),
        generatedAt: LessThan(cutoff),
      },
      order: { generatedAt: 'ASC', id: 'ASC' },
      take: this.cfg.sweep.batchSize,
    });

    let finished = 0;
    for (const list of stale) {
      try {
        await this.generated.update({
          userId: list.ownerUserId,
          generatedListId: list.id,
          status: GeneratedListStatus.COMPLETED,
        });
        finished++;
      } catch (err) {
        // The owner deleted it, or their whole account went, between the query
        // and now. One vanished basket is not a reason to leave the rest of the
        // batch live until the next tick.
        this.logger.error(
          { err, generatedListId: list.id },
          'generated list sweep could not finish a basket'
        );
      }
    }
    if (finished > 0) {
      this.logger.log(
        { count: finished },
        'generated list sweep finished baskets past the claim window'
      );
    }
    return finished;
  }
}
