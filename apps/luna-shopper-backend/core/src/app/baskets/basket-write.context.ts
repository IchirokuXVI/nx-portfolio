import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type BasketRowResult,
  type LineWriteVia,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { BasketSharingService } from '../baskets/basket-sharing.service';
import { Basket, BasketParticipant, type ListLine } from '../entities';
import { BasketAnnouncer, type ChangedLine } from './basket-announcer.service';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRowResolver, type BasketRow } from './basket-row-resolver';

/**
 * What every write on a row needs before it may touch anything (plan 0136,
 * section 5).
 *
 * The five writes share a resolver, a coverage, a redaction, an event and an
 * answer shape. They are five services because they are five different
 * operations on the database, and this is the part that is the same in all of
 * them, gathered once rather than copied five times and drifting.
 *
 * **Everything here runs before a transaction opens** (plan 0130, section 13).
 * Every repository the access service holds draws its own connection from the
 * pool, so asking it a question from inside a transaction means one request
 * holding two, which deadlocks the pool under load rather than failing honestly.
 */
@Injectable()
export class BasketWriteContext {
  constructor(
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    private readonly coverage: BasketCoverageService,
    private readonly sharing: BasketSharingService,
    private readonly resolver: BasketRowResolver,
    private readonly read: BasketReadService,
    // Who tells the baskets a write reached them (plan 0139, section 3). Handed
    // to the open write below, so that the five writes name what moved and never
    // an audience.
    private readonly announcer: BasketAnnouncer
  ) {}

  /** Load the basket, the actor, the coverage and the redaction. */
  async open(req: {
    basketId: string;
    participantId: string;
  }): Promise<OpenBasketWrite> {
    const basket = await this.baskets.findOne({ where: { id: req.basketId } });
    if (!basket) {
      throw new NotFoundException('Basket not found');
    }

    // The row is read live, so a revocation between the gateway's guard and
    // here is refused rather than admitted on a credential checked a hop ago.
    //
    // `liveParticipantById` rather than `livePresenceEntry`, which is the same
    // lookup with fewer columns: the redaction asks about the participant's
    // account and the read composes them, so the whole row is wanted and asking
    // twice would be one query for the attribution and one for everything else.
    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      basket.id
    );
    if (!participant) {
      throw new ForbiddenException('Not a participant of this basket');
    }

    const covered = await this.coverage.listsOf(basket);
    const coveredListIds = covered.map((row) => row.listId);
    const servedListIds = participant.userId
      ? await this.sharing.writableAmong(participant.userId, coveredListIds)
      : new Set<string>();

    return new OpenBasketWrite(
      basket,
      participant,
      coveredListIds,
      new Map(covered.map((row) => [row.listId, row.zoneId])),
      servedListIds,
      this.resolver,
      this.read,
      this.announcer
    );
  }
}

/** One write, with everything it may read already answered. */
export class OpenBasketWrite {
  constructor(
    readonly basket: Basket,
    /** The actor: attribution, the redaction and the answer all read this row. */
    readonly participant: BasketParticipant,
    readonly coveredListIds: readonly string[],
    private readonly zones: ReadonlyMap<string, string>,
    /** The covered lists this actor writes themselves (section 3.4). */
    readonly servedListIds: ReadonlySet<string>,
    private readonly resolver: BasketRowResolver,
    private readonly read: BasketReadService,
    private readonly announcer: BasketAnnouncer
  ) {}

  /**
   * The lines a write names, refusing any that is not a row of the basket
   * (plan 0201, section 4). `rowKey` must be one of them.
   */
  row(rowKey: string, lineIds: readonly string[]): Promise<BasketRow> {
    return this.resolver.resolve(
      this.basket,
      this.coveredListIds,
      rowKey,
      lineIds
    );
  }

  /**
   * One line of a covered list, at zero or not, for the change of demand
   * (plan 0201, review point 2).
   */
  line(rowKey: string, lineId: string): Promise<ListLine> {
    return this.resolver.resolveLine(this.coveredListIds, rowKey, lineId);
  }

  /**
   * Whether a line is the whole of its row, as core groups the basket with no
   * picks.
   *
   * The change of demand asks it for an actor who was not served the list of
   * the line, which is a guest and a co shopper who does not write that list.
   * Before plan 0201 such an actor could change demand on a row of one entry
   * and on no other, and this keeps that rule: who may change a demand did not
   * move.
   *
   * A line the basket does not draw, which is a line at zero, is in no row, so
   * it is not alone in one.
   */
  async aloneInItsRow(lineId: string): Promise<boolean> {
    const { lines, keys } = await this.read.keyedLinesOf(
      this.basket,
      this.coveredListIds
    );
    const line = lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      return false;
    }
    const key = keys.keyOf(line);
    return lines.filter((candidate) => keys.keyOf(candidate) === key).length === 1;
  }

  /**
   * Who this write is, as the change record names them (plan 0138, section 4).
   *
   * The **actor's** identity and not the account the write was authorized
   * against. Those differ on every delegated write: changing what a household
   * asks for is checked against the basket's owner (plan 0131) while the person
   * doing it may be a guest, so `userId` here is the participant's own account
   * and is null for a guest.
   */
  via(): LineWriteVia {
    return {
      participantId: this.participant.id,
      basketId: this.basket.id,
      userId: this.participant.userId,
    };
  }

  /**
   * The zone a covered list is in.
   *
   * Read off the coverage rather than joined back through the list, which is
   * what the settle path already did with a provenance row's own copy: the
   * answer is in hand and a join would ask for it twice.
   */
  zoneOf(listId: string): string {
    const zoneId = this.zones.get(listId);
    if (!zoneId) {
      // Unreachable while the list is covered, since coverage is a join through
      // the zone. Throwing beats emitting an event addressed to `undefined`.
      throw new NotFoundException('List not found');
    }
    return zoneId;
  }

  /**
   * Tell every basket that covers these lines what they read now (plan 0136,
   * section 8; plan 0139, section 3; plan 0204, section 3).
   *
   * **Not just the basket that made the write.** A basket row is a list line,
   * so a settle here is a row moving in every other open basket that covers the
   * same list, and the one in this shop is only the loudest of them.
   *
   * For the writes that only move numbers: a settle and a revert. Each covering
   * basket is sent the entries as **it** reads them, because what this basket
   * bought is what another reads as bought elsewhere.
   *
   * **Not awaited, and it returns nothing to await.** The write has committed,
   * and a patch is several reads for each covering basket. An answer that
   * waited for them would be a slower write on the phone that made it, for the
   * benefit of every other phone.
   *
   * The entries carry their list because the coverage is per list: a row can
   * span two households' lists, and two lists have two coverages.
   *
   * An entry says whether the write recorded a change row for its line (plan
   * 0203). Every other basket is then told that its marks moved. This basket
   * is not: a buy is shown to every basket but the one it was made through.
   */
  announceLinesMoved(entries: readonly ChangedLine[]): void {
    void this.announcer.linesMovedAcross(entries, this.basket.id);
  }

  /**
   * Tell **this** basket alone what some of its lines read now (plan 0139,
   * section 3; plan 0204, section 3).
   *
   * For a write that belongs to one basket and to no list, which is a skip and
   * taking one back. The line did not move, so no other basket's rows changed.
   */
  announceBasketMoved(entries: readonly ChangedLine[]): void {
    if (entries.length === 0) {
      return;
    }
    this.announcer.basketMoved(this.basket, entries);
  }

  /**
   * The lines of the write as they are now, and the basket's progress (plan
   * 0201, section 4).
   *
   * **No row.** A row is the group of lines that count as one product, and for
   * a line with several products and no favourite that depends on the prices
   * of a read, which no write holds. So the answer is the entries, and the
   * client rebuilds its rows from them or takes them from its next read.
   *
   * A full read with no picks, because `progress` is a count over every row.
   * It is the count core builds alone, and `BasketProgress` in the contracts
   * says how that can differ from the count of a full read.
   *
   * A named line that is not in the answer left the basket: it is at zero with
   * no buy that keeps it a row, or it was merged away, deleted or rejected.
   */
  async result(lineIds: readonly string[]): Promise<BasketRowResult> {
    const view = await this.read.view(this.basket, this.participant);
    const wanted = new Set(lineIds);
    return {
      entries: view.rows.flatMap((row) =>
        row.entries.filter((entry) => wanted.has(entry.lineId))
      ),
      progress: view.progress,
    };
  }
}
