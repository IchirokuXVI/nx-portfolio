import { Injectable, Logger } from '@nestjs/common';
import {
  RealtimeEvent,
  type BasketLinesChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { BasketCoverageService } from './basket-coverage.service';
import type { CoveringBasket } from './basket-coverage.sql';

/** One line of one list, as a write reports what it touched. */
export interface ChangedLine {
  listId: string;
  lineId: string;
}

/**
 * Tells the baskets that a write reached them (plan 0139, section 3).
 *
 * Since plan 0136 a basket stores no lines: it reads the lines of the lists it
 * covers. So every write to a list line is a write to every basket that covers
 * the list, and until this service existed none of those baskets heard about it.
 * A shopper in a shop saw a line their partner added at home when they next
 * touched the screen, and not before.
 *
 * It is one small service so that **no emit site composes an audience by hand**.
 * Working out which baskets cover a list is one question with one answer, and a
 * site that built the audience itself would be a second place for it to be
 * wrong.
 *
 * ## Three rules that hold at every call site
 *
 * - **After the commit, never inside it.** The coverage read draws its own
 *   connection from the pool, so asking it from inside a transaction means one
 *   request holding two, which deadlocks the pool under load (plan 0130, section
 *   13).
 * - **One event per write**, never one per basket and never one per line (plan
 *   0052, section 3.1). A write that touched two lists is two events, because
 *   two lists have two coverages.
 * - **It never throws into its caller.** The write it follows has committed and
 *   the household's own list event has already gone out, so a failed coverage
 *   read costs one client a nudge and nothing else. A client that missed one
 *   still reads the truth on its next read.
 */
@Injectable()
export class BasketAnnouncer {
  private readonly logger = new Logger(BasketAnnouncer.name);

  constructor(
    private readonly coverage: BasketCoverageService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * A write to lines of one list, announced to every basket that covers it.
   *
   * The owners' own `user:` rooms are addressed beside the basket rooms, for the
   * reason the settle used to give when it emitted to the owner: the owner is
   * usually **not** in the basket's room. They are at home looking at the
   * dashboard while somebody else shops, and the card counts what is left.
   *
   * The basket that made the write hears its own event, because it covers the
   * list it wrote to. The acting client already holds the answer of its request
   * and merging a read over it is idempotent.
   */
  async linesChanged(
    listId: string,
    lineIds: readonly string[]
  ): Promise<void> {
    if (lineIds.length === 0) {
      return;
    }
    await this.safely(async () => {
      const covering = await this.coverage.coveringBaskets(listId);
      this.announce(covering, [...new Set(lineIds)]);
    });
  }

  /**
   * The same, for a write that touched more than one list: one event per list,
   * carrying that list's lines.
   *
   * Grouping here rather than at each call site, because the three basket writes
   * that can span two lists all report what they touched the same way and none
   * of them should own the arithmetic.
   */
  async linesChangedAcross(entries: readonly ChangedLine[]): Promise<void> {
    const byList = new Map<string, string[]>();
    for (const entry of entries) {
      const lines = byList.get(entry.listId);
      if (lines) {
        lines.push(entry.lineId);
      } else {
        byList.set(entry.listId, [entry.lineId]);
      }
    }
    for (const [listId, lineIds] of byList) {
      await this.linesChanged(listId, lineIds);
    }
  }

  /**
   * A write that belongs to one basket and to no list: a skip, and taking one
   * back (plan 0137).
   *
   * No other basket hears it, and that is the whole difference from
   * {@link linesChanged}. A skip is one trip's "not today" on a line the trip
   * still covers, so the line itself did not move and nobody else's basket
   * changed.
   *
   * The plan writes this as taking the basket id alone. It takes the owner as
   * well, because the owner's dashboard counts what is left and a skip changes
   * that count: addressing the room alone would take the home card off a skip,
   * which plan 0136 section 8 put there.
   */
  basketChanged(
    basket: { id: string; ownerUserId: string },
    lineIds: readonly string[]
  ): void {
    void this.safely(async () =>
      this.announce(
        [{ basketId: basket.id, ownerUserId: basket.ownerUserId }],
        [...new Set(lineIds)]
      )
    );
  }

  /**
   * The coverage itself moved rather than a line (plan 0139, section 5).
   *
   * A list was created, deleted or had its access changed, or somebody's
   * standing in the zone did. None of those is a write to a line, and each of
   * them adds or removes whole lists from somebody's basket.
   *
   * It addresses **every** open basket of the household rather than the ones
   * that gained or lost the list, on purpose: the set before the write and the
   * set after it differ, the superset needs neither, and an empty payload costs
   * a client one debounced read.
   */
  async coverageMoved(zoneId: string): Promise<void> {
    this.coverageMovedTo(await this.openBaskets(zoneId));
  }

  /**
   * The open baskets of a household, read now so they can be told later.
   *
   * The half of {@link coverageMoved} a **deletion** needs. A zone's memberships
   * go with the zone, so a read after the delete answers nothing and the
   * household is told nothing, exactly as `tripListsOfBasket` is read before the
   * basket it belongs to goes. The baskets themselves survive: they belong to
   * the people, not to the zone.
   */
  async openBaskets(zoneId: string): Promise<CoveringBasket[]> {
    let baskets: CoveringBasket[] = [];
    await this.safely(async () => {
      baskets = await this.coverage.basketsOfZoneMembers(zoneId);
    });
    return baskets;
  }

  /** The other half: announce to baskets {@link openBaskets} already read. */
  coverageMovedTo(baskets: readonly CoveringBasket[]): void {
    void this.safely(async () => this.announce(baskets, []));
  }

  /**
   * One envelope, naming every basket and every owner once.
   *
   * An audience of no baskets publishes nothing: the publisher refuses it,
   * because a write to a list nobody's basket covers is the ordinary case rather
   * than an event addressed to nobody.
   */
  private announce(
    covering: readonly CoveringBasket[],
    lineIds: string[]
  ): void {
    const payload: BasketLinesChangedEvent = { lineIds };
    this.events.emitTo(
      RealtimeEvent.BasketLinesChanged,
      {
        basketIds: covering.map((row) => row.basketId),
        userIds: [...new Set(covering.map((row) => row.ownerUserId))],
      },
      payload
    );
  }

  /**
   * One announcement, logged rather than raised when it fails.
   *
   * The read **and** the publish, not only the read. Several call sites let the
   * promise run on rather than awaiting it, because the write has committed and
   * a nudge is not part of the answer, and there a raised error would surface as
   * an unhandled rejection with nothing left to catch it.
   */
  private async safely(announce: () => Promise<void>): Promise<void> {
    try {
      await announce();
    } catch (err) {
      this.logger.error({ err }, 'a basket announcement failed');
    }
  }
}
