import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LIVE_GENERATED_LIST_STATUSES,
  NO_LINE_CLAIM,
  RealtimeEvent,
  type LineClaim,
  type LineClaimChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import { DataSource, type EntityManager } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  BASKET_CLAIMED_LINES_SQL,
  BASKET_LINE_CLAIMED_LINES_SQL,
  readLineClaims,
  type ZoneLineClaimRef,
} from './line-claim.sql';

/**
 * Who is out buying which zone line (plan 0052).
 *
 * ## Why it is a module of its own
 *
 * It answers a question about baskets and it is asked by the **lists** slice, on
 * every line read there. `ListsModule` cannot import `GeneratedListsModule`,
 * which imports it, so this sits in a module of its own that both import, which
 * is exactly what `SharedListGrantModule` does and for the same reason.
 *
 * ## The claim is derived and stored nowhere
 *
 * Section 4 rejects a column on the line. A stored flag would have to stay correct
 * across basket deletion, account deletion, a trip nobody ever took and the
 * overlap rule that lets two baskets hold one line, and every one of those is a
 * way to leave a line claimed by a basket that no longer exists. The join is the
 * answer instead, and the events below are a notification that a readable fact
 * has changed rather than the only way to learn it.
 */
@Injectable()
export class LineClaimService {
  /** A live basket older than this claims nothing (section 4.1). */
  private readonly windowMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: CoreEventsPublisher,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.windowMs =
      configService.getOrThrow<CoreConfig>('core').generatedList.claimWindowMs;
  }

  /**
   * The claim on a page of lines, in one query rather than one per row.
   *
   * The same rule the settlement summary follows: a list page asks this about
   * every line it draws, so answering it one line at a time would be a request
   * per row of a screen somebody opens in a shop.
   *
   * **A caller inside a transaction must pass its manager.** This service's own
   * `DataSource` draws a second connection from the pool, so reading through it
   * from inside a transaction means one request holding two connections at once,
   * which is the deadlock `LineService.settlementsOf` documents at length. It is
   * not a compromise either: nothing here writes, so both routes see the same
   * rows, and inside a settle's transaction the manager is the only route that
   * can see the basket line the settle has just moved.
   */
  async claimsOf(
    lineIds: readonly string[],
    manager?: EntityManager
  ): Promise<Map<string, LineClaim>> {
    const query = manager
      ? (sql: string, parameters: unknown[]) => manager.query(sql, parameters)
      : (sql: string, parameters: unknown[]) =>
          this.dataSource.query(sql, parameters);
    return readLineClaims(
      query,
      lineIds,
      LIVE_GENERATED_LIST_STATUSES,
      this.since()
    );
  }

  /** One line's claim, for the paths that answer with a single line. */
  async claimOf(lineId: string, manager?: EntityManager): Promise<LineClaim> {
    const claims = await this.claimsOf([lineId], manager);
    return claims.get(lineId) ?? NO_LINE_CLAIM;
  }

  /**
   * The zone lines a basket is claiming right now, read before the transition
   * that ends the claim.
   *
   * Read **before** for deletion and it does not matter for a status change, so
   * every caller reads first and announces after: one order that is correct in
   * both cases beats two orders that are each correct in one.
   */
  async refsOf(
    generatedListId: string,
    manager?: EntityManager
  ): Promise<ZoneLineClaimRef[]> {
    const runner = manager ?? this.dataSource;
    return (await runner.query(BASKET_CLAIMED_LINES_SQL, [
      generatedListId,
    ])) as ZoneLineClaimRef[];
  }

  /**
   * The zone lines one basket line is claiming, for the two transitions that are
   * about one line: settled all the way through, or taken out of the basket.
   */
  async refsOfBasketLine(
    generatedListLineId: string,
    manager?: EntityManager
  ): Promise<ZoneLineClaimRef[]> {
    const runner = manager ?? this.dataSource;
    return (await runner.query(BASKET_LINE_CLAIMED_LINES_SQL, [
      generatedListLineId,
    ])) as ZoneLineClaimRef[];
  }

  /**
   * Announce the release of whichever of these lines nothing carries any more.
   *
   * Asked of the derivation rather than assumed from the transition, and that is
   * the whole of section 3.4 in one call: a line one basket has just let go of may
   * still be held by another, and telling the household nobody is buying it would
   * be a wrong answer produced by a correct write. The lines that really are free
   * are announced; the rest changed nothing and are not spoken about.
   */
  async announceReleased(refs: readonly ZoneLineClaimRef[]): Promise<void> {
    if (refs.length === 0) {
      return;
    }
    const claims = await this.claimsOf(refs.map((ref) => ref.lineId));
    const released = refs.filter(
      (ref) => !(claims.get(ref.lineId)?.claimed ?? false)
    );
    this.announce(false, null, released);
  }

  /**
   * Tell every affected zone room that these lines are now claimed, or are not
   * any more.
   *
   * **One event per zone rather than one per line** (section 3.1). A run takes
   * every wanted line of every list it drew from, and a per line fan out of a
   * hundred events into a household room is a self inflicted problem. The single
   * line transitions come through here too, carrying one entry, so there is one
   * payload shape and not two that could drift apart.
   *
   * The zone rides the envelope and no list does, deliberately: one basket draws
   * from several lists of one zone at once, so the room is the zone's and each
   * entry names its own list.
   */
  announce(
    claimed: boolean,
    claimedByUserId: string | null,
    refs: readonly ZoneLineClaimRef[]
  ): void {
    const byZone = new Map<string, LineClaimChangedEvent>();
    for (const ref of refs) {
      const existing = byZone.get(ref.zoneId);
      const payload =
        existing ??
        ({
          zoneId: ref.zoneId,
          claimed,
          // Null on a release, always: there is nobody to name once nobody has
          // it, and a name on a release would read as a claim to a client that
          // looked at the name before the flag.
          claimedByUserId: claimed ? claimedByUserId : null,
          lines: [],
        } satisfies LineClaimChangedEvent);
      payload.lines.push({ lineId: ref.lineId, listId: ref.listId });
      byZone.set(ref.zoneId, payload);
    }

    for (const payload of byZone.values()) {
      this.events.emit(RealtimeEvent.LineClaimChanged, payload.zoneId, payload);
    }
  }

  /** The oldest a basket may have been generated and still claim its lines. */
  private since(): Date {
    return new Date(Date.now() - this.windowMs);
  }
}
