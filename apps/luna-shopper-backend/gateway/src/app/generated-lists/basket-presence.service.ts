import { Injectable } from '@nestjs/common';
import {
  countLivePresence,
  generatedListPresenceKey,
  RedisService,
} from '@portfolio/luna-shopper/platform';

/**
 * How many people are in each of these baskets right now (plan 0053, section 2).
 *
 * ## Why the gateway, and why at read time
 *
 * The count belongs on `GeneratedListSummaryView`, which core projects, and core
 * cannot answer it: presence is a Redis room the realtime service writes, and
 * core holds no Redis. The gateway holds one already, for the throttler and for
 * the scope cache, so it is the only service that both answers the history read
 * and can see the room.
 *
 * Resolved on every read rather than stored beside the basket, which is section
 * 2's open decision settled in favour of read time. A stored count is wrong the
 * moment somebody closes a tab, and a card reading "2 shopping" about a shop
 * everybody left is exactly the staleness velista `0048` section 5 refuses to
 * draw. Nothing here writes anything: the room is the realtime service's, and
 * this only counts what is in it.
 *
 * ## Failure
 *
 * **Zero, never an error.** Presence fails open and empty everywhere else in
 * this system, and it is worth the same here for a stronger reason: the caller
 * is asking for their shopping history, and a Redis blip must cost the little
 * "2 shopping" caption on a card rather than the page. {@link RedisService}
 * already answers undefined for a command it could not run, so the degradation
 * is the ordinary path through this code rather than a catch.
 */
@Injectable()
export class BasketPresenceService {
  constructor(private readonly redis: RedisService) {}

  /**
   * One entry per basket asked about, so a caller can index without checking.
   *
   * A pipeline rather than a command per basket: a history page is twenty rows
   * and twenty round trips to Redis to draw a caption is the read that would
   * eventually need fixing. Twenty small hashes in one pipeline is one.
   */
  async countsFor(
    generatedListIds: readonly string[]
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>(
      generatedListIds.map((id) => [id, 0])
    );
    if (generatedListIds.length === 0) {
      return counts;
    }

    const rooms = await this.redis.tryCommand(async (client) => {
      const pipeline = client.pipeline();
      for (const id of generatedListIds) {
        pipeline.hgetall(generatedListPresenceKey(id));
      }
      return pipeline.exec();
    }, 'basket presence counts');

    if (!rooms) {
      return counts;
    }

    // `exec` answers a [error, result] pair per queued command, in the order
    // they were queued. One command failing is one basket counted as empty
    // rather than the whole page losing its captions.
    const now = Date.now();
    rooms.forEach(([err, entries], index) => {
      const id = generatedListIds[index];
      if (err || !entries || id === undefined) {
        return;
      }
      counts.set(id, countLivePresence(entries as Record<string, string>, now));
    });

    return counts;
  }
}
