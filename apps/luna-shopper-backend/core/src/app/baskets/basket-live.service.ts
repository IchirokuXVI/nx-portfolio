import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BasketKind,
  GeneratedListStatus,
  type BasketSummaryView,
  type BasketView,
  type GetLiveBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import { DataSource, Repository } from 'typeorm';
import { GeneratedList } from '../entities';
import { GeneratedListSharingService } from '../generated-lists/generated-list-sharing.service';
import { BasketReadService } from './basket-read.service';

/**
 * The basket that is always there (plan 0136, section 4).
 *
 * One per person, covering every list they can write, never finished and never
 * named. It is the screen a shopper opens without composing anything first, and
 * it is what makes composing a trip an optional gesture rather than the price of
 * entry.
 *
 * ## It is born on the first read
 *
 * There is no create route and no migration that backfills one per account. A
 * person who never opens the basket never has a row, and the first read makes
 * one. That is the same shape `ensureOwnerParticipant` already uses, and for the
 * same reason: a lazily created row means every account that existed before this
 * plan works without a backfill nobody can verify.
 *
 * ## It is not news
 *
 * Being born emits no `generatedList.created` and no `list.tripsChanged`. A
 * basket somebody opened for the first time is not an event any other screen
 * needs, and a trip it is not: `basket_sources` has no rows for it, the sweep
 * ignores it, the claim ignores it and the history ignores it, all of which plan
 * 0133 section 6 arranged before there was a row to ignore.
 */
@Injectable()
export class BasketLiveService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly baskets: Repository<GeneratedList>,
    private readonly sharing: GeneratedListSharingService,
    private readonly read: BasketReadService
  ) {}

  /** The caller's permanent basket, read as themselves. */
  async live(req: GetLiveBasketRequest): Promise<BasketView> {
    const basket = await this.ensure(req.userId);
    const participant = await this.sharing.ensureOwnerParticipant(basket);
    return this.read.view(basket, participant);
  }

  /**
   * The same basket with the rows dropped (plan 0136, section 2).
   *
   * Its own route because the home card needs three numbers and must not pay for
   * a thousand rows and a catalog composition to get them. It creates the basket
   * exactly as {@link live} does, so a person whose first sight of the app is
   * that card is not left without one.
   */
  async summary(req: GetLiveBasketRequest): Promise<BasketSummaryView> {
    const basket = await this.ensure(req.userId);
    return {
      id: basket.id,
      kind: basket.kind,
      progress: await this.read.progressOf(basket),
    };
  }

  /**
   * The row, made if it is missing.
   *
   * Idempotent through `uq_generated_lists_live_owner`, the partial unique index
   * plan 0133 declared over `LIVE` rows: two tabs opening the app at once make
   * one basket, and the loser reads the winner rather than failing. The route is
   * idempotent the way `create` is, by a constraint rather than by a lock.
   */
  private async ensure(userId: string): Promise<GeneratedList> {
    const held = await this.baskets.findOne({
      where: { ownerUserId: userId, kind: BasketKind.LIVE },
    });
    if (held) {
      return held;
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(GeneratedList);
        return repo.save(
          repo.create({
            ownerUserId: userId,
            kind: BasketKind.LIVE,
            // Every one of these is `ck_generated_lists_live_shape`, stated
            // here so the message comes from the service before the constraint
            // has to refuse it: no name, open, no run behind it, and no profile
            // frozen, because a basket that never ends cannot freeze a profile
            // its owner goes on editing (plan 0136, section 4).
            name: null,
            status: GeneratedListStatus.OPEN,
            generatedAt: new Date(),
            pricingProfileId: null,
            idempotencyKey: null,
          })
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.baskets.findOne({
          where: { ownerUserId: userId, kind: BasketKind.LIVE },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }
}

/**
 * Postgres unique-violation, raised by `uq_generated_lists_live_owner`.
 *
 * A third copy of the same two lines that `generated-list.service.ts` and
 * `generated-list-sharing.service.ts` already hold. It stays a copy rather than
 * becoming a shared helper because plan 0136 adds no abstraction this plan does
 * not name, and because the two existing copies are private to files this series
 * is about to rewrite.
 */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}
