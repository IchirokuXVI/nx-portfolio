import { Injectable } from '@nestjs/common';
import {
  BasketKind,
  isOpenBasket,
  type BasketRowResult,
  type SkipBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  GeneratedListFinishedException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, type EntityManager } from 'typeorm';
import { BasketLineSkip } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineClaimService } from '../generated-lists/line-claim.service';
import type { ZoneLineClaimRef } from '../generated-lists/line-claim.sql';
import { lockEntries } from './basket-row-resolver';
import {
  BasketWriteContext,
  type OpenBasketWrite,
} from './basket-write.context';
import {
  REVERT_SKIPS_SQL,
  STANDING_SKIP_LINES_SQL,
  UNREVERTED_SKIP_LINES_SQL,
  type BasketSkipLineRow,
} from './basket.sql';

/**
 * "Not today" on a row, and taking it back (plan 0137, section 5).
 *
 * A shopper can no longer take a line out of a basket, because a basket holds no
 * lines of its own to take one out of (plan 0130, section 5). What they say
 * instead is that they are not buying it on this trip: the row stays where it
 * is, reads `SKIPPED` for twelve hours, and then becomes an ordinary row again
 * carrying a note that it was skipped earlier.
 *
 * ## Both routes are open to any live participant
 *
 * A guest included. The permission is the owner's `WRITE`, and it holds **by
 * construction** rather than by a check: the row is resolved from a coverage
 * computed for this request, and coverage is defined as the lists the owner can
 * write now. That is the property {@link BasketSettleService} states at length,
 * and it is the same property here.
 *
 * ## Neither carries `from`
 *
 * The one exception to "every write on a row names the number it started from"
 * (plan 0130, section 8). That guard exists because a number's meaning depends
 * on where it started, and "not today" means the same thing whether the row says
 * two or three. Refusing a skip because a flatmate raised the milk a second
 * earlier is friction that protects nothing. What the state refuses instead is a
 * row with nothing left to skip.
 *
 * ## Nothing here writes a settlement
 *
 * The settle and the revert do not learn that skips exist. A purchase through
 * this basket ends a skip through one `WHERE` in `SKIP_STANDS`, and taking that
 * purchase back puts the skip back the same way, so neither of those services
 * needs a line of this one.
 */
@Injectable()
export class BasketSkipService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: BasketWriteContext,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Put every entry the row still asks for off for now (section 5.1).
   *
   * **Idempotent.** A second call inserts nothing and answers the same row. A
   * skip that is standing but no longer fresh is deliberately **not** refreshed
   * either: to skip again for another twelve hours the shopper takes it back and
   * skips again, which is two gestures for a rare wish and keeps the table
   * append only.
   */
  async skip(req: SkipBasketRowRequest): Promise<BasketRowResult> {
    const opened = await this.openOpen(req);
    const row = await opened.row(req.rowKey);

    // The entries this call marked, which is what decides what to announce and
    // which claims to ask about. A second call marks none.
    const inserted: SkippedEntry[] = [];
    let touched: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const locked = await lockEntries(manager, row);
      touched = [...locked.keys()];
      const held = [...locked.values()].reduce(
        (sum, line) => sum + line.quantity,
        0
      );
      if (held === 0) {
        // A conflict rather than a validation failure (plan 0054, section 4):
        // the request is well formed and the state refuses it. It was bought
        // while the sheet was open, and the client reads the basket again.
        throw new ConflictException('This row has nothing left to skip');
      }

      // Asked through the transaction's manager, so it sees whatever this
      // transaction has already written and holds the lock while it decides.
      const asking = row.entries.filter(
        (entry) => (locked.get(entry.lineId)?.quantity ?? 0) > 0
      );
      const standing = await standingSkipsAmong(
        manager,
        opened.basket.id,
        asking.map((entry) => entry.lineId)
      );

      const skips = manager.getRepository(BasketLineSkip);
      const now = new Date();
      for (const entry of asking) {
        if (standing.has(entry.lineId)) {
          // Already off for now. Left exactly as it is, stale or fresh, which
          // is what makes a second call change nothing.
          continue;
        }
        await skips.save(
          skips.create({
            basketId: opened.basket.id,
            lineId: entry.lineId,
            // The participant, always, including for the owner, as every act
            // on a basket is attributed (plan 0051, section 3.2).
            skippedByParticipantId: opened.participant.id,
            skippedAt: now,
            revertedAt: null,
            revertedByParticipantId: null,
          })
        );
        inserted.push({ lineId: entry.lineId, listId: entry.listId });
      }
    });

    const lineIds = inserted.map((entry) => entry.lineId);
    opened.announceLinesChanged(lineIds, this.events);
    // A household is told "Marta is buying this" so that nobody buys it twice,
    // and Marta has said she is not buying it today, so the line is free while
    // the skip is fresh (section 5.4). Asked of the derivation rather than
    // assumed, because another open basket may still be carrying it.
    await this.claims.announceReleased(this.refs(opened, inserted));

    return opened.result(touched, req.rowKey);
  }

  /**
   * Take back every skip this basket holds on the row (section 5.2).
   *
   * Every unreverted row is marked, **standing or not**: marking one that a
   * purchase already ended costs nothing and leaves no stray row that a later
   * revert of that purchase could bring back to life. Finding none is not an
   * error, so this is idempotent in the same way the `PUT` is.
   */
  async unskip(req: SkipBasketRowRequest): Promise<BasketRowResult> {
    const opened = await this.openOpen(req);
    const row = await opened.row(req.rowKey);

    let reverted: SkippedEntry[] = [];
    let touched: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const locked = await lockEntries(manager, row);
      touched = [...locked.keys()];
      // Which entries this call is about to change, read under the lock and
      // before the update, so the announce names those and no others.
      const rows = (await manager.query(UNREVERTED_SKIP_LINES_SQL, [
        opened.basket.id,
        touched,
      ])) as BasketSkipLineRow[];
      const marked = new Set(rows.map((entry) => entry.lineId));
      reverted = row.entries.filter((entry) => marked.has(entry.lineId));
      if (marked.size > 0) {
        await manager.query(REVERT_SKIPS_SQL, [
          opened.basket.id,
          touched,
          opened.participant.id,
        ]);
      }
    });

    opened.announceLinesChanged(
      reverted.map((entry) => entry.lineId),
      this.events
    );
    await this.announceClaimed(opened, reverted);

    return opened.result(touched, req.rowKey);
  }

  /**
   * Load the write and refuse a basket that is over.
   *
   * Its own code rather than a validation failure (plan 0059, section 3.1): a
   * finished trip that still took skips would let a link shared with somebody
   * who is no longer shopping change what the basket says days later.
   */
  private async openOpen(req: SkipBasketRowRequest): Promise<OpenBasketWrite> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new GeneratedListFinishedException(
        'This basket is finished, so nothing more can be skipped in it'
      );
    }
    return opened;
  }

  /**
   * Tell the zone that these lines are claimed again, after a skip was taken
   * back (section 5.4).
   *
   * A `LIVE` basket claims nothing, so its skips release nothing and there is
   * nothing to claim back: no query at all rather than a query whose answer is
   * discarded.
   *
   * The claim is read rather than assumed, for {@link
   * LineClaimService.announceReleased}'s reason in the other direction: the
   * basket that now carries a line may be a different one, and its owner is the
   * name the household has to be told.
   */
  private async announceClaimed(
    opened: OpenBasketWrite,
    entries: readonly SkippedEntry[]
  ): Promise<void> {
    if (entries.length === 0 || opened.basket.kind !== BasketKind.GENERATED) {
      return;
    }
    const refs = this.refs(opened, entries);
    const claims = await this.claims.claimsOf(refs.map((ref) => ref.lineId));
    // Grouped by whoever the derivation names, so a line two baskets cover is
    // announced under the owner that actually holds it.
    const byOwner = new Map<string, ZoneLineClaimRef[]>();
    for (const ref of refs) {
      const claim = claims.get(ref.lineId);
      if (!claim?.claimed || !claim.claimedByUserId) {
        continue;
      }
      const held = byOwner.get(claim.claimedByUserId);
      if (held) {
        held.push(ref);
      } else {
        byOwner.set(claim.claimedByUserId, [ref]);
      }
    }
    for (const [ownerUserId, held] of byOwner) {
      this.claims.announce(true, ownerUserId, held);
    }
  }

  /** The entries as the claim addresses them: a zone, a list and a line. */
  private refs(
    opened: OpenBasketWrite,
    entries: readonly SkippedEntry[]
  ): ZoneLineClaimRef[] {
    return entries.map((entry) => ({
      zoneId: opened.zoneOf(entry.listId),
      listId: entry.listId,
      lineId: entry.lineId,
    }));
  }
}

/** One entry a skip was written on or taken back from. */
interface SkippedEntry {
  lineId: string;
  listId: string;
}

/**
 * Which of these lines this basket already holds a standing skip on.
 *
 * A free function taking the caller's manager, for the reason
 * `readLineSettlementSummaries` gives: the same statement is asked from inside a
 * transaction, where the manager is the only route that can see what the
 * transaction has written.
 */
async function standingSkipsAmong(
  manager: EntityManager,
  basketId: string,
  lineIds: readonly string[]
): Promise<Set<string>> {
  if (lineIds.length === 0) {
    return new Set();
  }
  const rows = (await manager.query(STANDING_SKIP_LINES_SQL, [
    basketId,
    [...lineIds],
  ])) as BasketSkipLineRow[];
  return new Set(rows.map((row) => row.lineId));
}
