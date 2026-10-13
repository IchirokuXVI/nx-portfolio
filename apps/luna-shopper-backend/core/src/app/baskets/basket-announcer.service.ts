import { Injectable, Logger } from '@nestjs/common';
import {
  BASKET_LIMITS,
  RealtimeEvent,
  type BasketEntryPatch,
  type BasketKind,
  type BasketLinesChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { BasketCoverageService } from './basket-coverage.service';
import type { CoveringBasket } from './basket-coverage.sql';
import { BasketPatchReader } from './basket-patch.reader';

/** One line of one list, as a write reports what it touched. */
export interface ChangedLine {
  listId: string;
  lineId: string;
  /**
   * The write recorded a `list_line_changes` row for this line (plan 0203). A
   * buy that lowered the line did, and "they had none" did not.
   */
  recorded?: boolean;
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
 * - **One event per write**, never one per line (plan 0052, section 3.1). A
 *   write that touched two lists is two events, because two lists have two
 *   coverages. Since plan 0204 a write that only moves numbers is one event
 *   **for each covering basket**, because each of them reads the line
 *   differently: what one bought is what another reads as bought elsewhere.
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
    private readonly events: CoreEventsPublisher,
    // What each covering basket reads of the lines that moved (plan 0204). Last,
    // so no positional construction in a spec has to shift an argument.
    private readonly patches: BasketPatchReader
  ) {}

  /**
   * A write to lines of one list, announced to every basket that covers it
   * with the ids alone, so each of them reads again.
   *
   * For a write that moves more than numbers: an add, a rename, a merge, a
   * delete, an approval, a change of products, the group sync. Each needs
   * names, products or prices that a room must not carry or that core does not
   * hold (plan 0204, section 3). A write that only moves numbers calls
   * {@link linesMoved}.
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
   * carrying that list's lines. The group sync is its caller.
   */
  async linesChangedAcross(entries: readonly ChangedLine[]): Promise<void> {
    for (const [listId, lineIds] of byList(entries)) {
      await this.linesChanged(listId, lineIds);
    }
  }

  /**
   * A write that **only moved numbers** on lines of one list, announced to each
   * basket that covers it with what those lines read now (plan 0204, section 3).
   *
   * A settle, a revert, a buy on the list page, and a change of quantity that
   * touches nothing else. A client applies the entries and does not read the
   * basket again, which is the whole of that plan: before it, the other phone
   * waited and then read everything.
   *
   * ## One envelope for each basket
   *
   * The entries differ between two baskets over one list, so one payload cannot
   * serve two rooms. Each basket's envelope names that basket and its owner and
   * nobody else. The baskets are computed in parallel.
   *
   * ## When the ids go alone
   *
   * - **More than {@link BASKET_LIMITS.patchMaxLines} lines.** One envelope for
   *   every basket, as {@link linesChanged} sends.
   * - **A patch that failed**, for that basket alone. The others still get
   *   their entries. A client that gets ids reads the basket, so a failure costs
   *   one read and never a wrong number.
   *
   * ## `marksMoved` is decided for each basket
   *
   * `marksMoved` is whether the write recorded a change row. A basket is told
   * so only when it is shown that row (plan 0204, section 3):
   *
   * - **A buy and a taken back buy** are shown to every basket but the one they
   *   were made through (plan 0203, section 2). The caller names that basket as
   *   `throughBasketId`, and its envelope carries no `marksMoved`. A buy on the
   *   list page has no such basket, so every basket is told.
   * - **A change of quantity made through a basket** names no basket here. It
   *   is shown to the other people of that basket too (plan 0138, section 5),
   *   so that basket is told as well.
   */
  async linesMoved(
    listId: string,
    lineIds: readonly string[],
    marksMoved = false,
    throughBasketId: string | null = null
  ): Promise<void> {
    const ids = [...new Set(lineIds)];
    if (ids.length === 0) {
      return;
    }
    await this.safely(async () => {
      const covering = await this.coverage.coveringBaskets(listId);
      if (ids.length > BASKET_LIMITS.patchMaxLines) {
        this.announce(covering, ids);
        return;
      }
      await Promise.all(
        covering.map((basket) =>
          this.patchTo(
            basket,
            [listId],
            ids,
            marksMoved && basket.basketId !== throughBasketId
          )
        )
      );
    });
  }

  /**
   * The same, for a write that touched more than one list.
   *
   * Grouped here rather than at each call site, because the basket writes that
   * can span two lists all report what they touched the same way and none of
   * them should own the arithmetic. The lists are announced in parallel: two
   * lists have two coverages, and neither waits for the other.
   *
   * Its callers are the basket settle and the basket revert, so the write was
   * made through `throughBasketId`. The marks of a list moved when the write
   * recorded a change row for one of its lines ({@link ChangedLine.recorded}).
   */
  async linesMovedAcross(
    entries: readonly ChangedLine[],
    throughBasketId: string | null = null
  ): Promise<void> {
    const recorded = new Set(
      entries.filter((entry) => entry.recorded).map((entry) => entry.listId)
    );
    await Promise.all(
      [...byList(entries)].map(([listId, lineIds]) =>
        this.linesMoved(listId, lineIds, recorded.has(listId), throughBasketId)
      )
    );
  }

  /**
   * A write that belongs to one basket and to no list: a skip, and taking one
   * back (plan 0137).
   *
   * No other basket hears it, and that is the whole difference from
   * {@link linesMoved}. A skip is one trip's "not today" on a line the trip
   * still covers, so the line itself did not move and nobody else's basket
   * changed. The envelope carries the entries as this basket reads them, with
   * `skipped` set or cleared (plan 0204, section 3).
   *
   * The owner is addressed as well as the room, because the owner's dashboard
   * counts what is left and a skip changes that count: addressing the room
   * alone would take the home card off a skip, which plan 0136 section 8 put
   * there.
   */
  basketMoved(
    basket: { id: string; ownerUserId: string; kind: BasketKind },
    entries: readonly ChangedLine[]
  ): void {
    const lineIds = [...new Set(entries.map((entry) => entry.lineId))];
    if (lineIds.length === 0) {
      return;
    }
    const target = {
      basketId: basket.id,
      ownerUserId: basket.ownerUserId,
      kind: basket.kind,
    };
    void this.safely(async () => {
      if (lineIds.length > BASKET_LIMITS.patchMaxLines) {
        this.announce([target], lineIds);
        return;
      }
      await this.patchTo(target, [...byList(entries).keys()], lineIds, false);
    });
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
   * One basket's envelope: the ids, and the entries when they can be computed.
   *
   * The catch is around the read alone. A basket whose patch fails is sent the
   * ids, and the failure of one basket is not the failure of the others, which
   * is why this does not lean on {@link safely} above it.
   */
  private async patchTo(
    basket: CoveringBasket,
    listIds: readonly string[],
    lineIds: string[],
    marksMoved: boolean
  ): Promise<void> {
    let entries: BasketEntryPatch[] | undefined;
    if (basket.kind) {
      try {
        entries = await this.patches.entriesOf(
          { basketId: basket.basketId, kind: basket.kind },
          listIds,
          lineIds
        );
      } catch (err) {
        this.logger.error(
          { err, basketId: basket.basketId },
          'a basket patch failed, so the ids go alone'
        );
      }
    }
    const payload: BasketLinesChangedEvent = entries
      ? { lineIds, entries, ...(marksMoved ? { marksMoved: true } : {}) }
      : { lineIds };
    this.events.emitTo(
      RealtimeEvent.BasketLinesChanged,
      { basketIds: [basket.basketId], userIds: [basket.ownerUserId] },
      payload
    );
  }

  /**
   * One envelope with the ids alone, naming every basket and every owner once.
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

/** The lines a write touched, by the list each is in. */
function byList(entries: readonly ChangedLine[]): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const entry of entries) {
    const lines = lists.get(entry.listId);
    if (lines) {
      lines.push(entry.lineId);
    } else {
      lists.set(entry.listId, [entry.lineId]);
    }
  }
  return lists;
}
