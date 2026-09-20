import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BASKET_LIMITS,
  BasketKind,
  PURCHASE_SESSION_GAP_MS,
  SettlementOutcome,
  type BasketListRef,
  type BasketProgress,
  type BasketRowView,
  type BasketView,
  type GetBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  NotAParticipantException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { GeneratedList, GeneratedListParticipant } from '../entities';
import { GeneratedListOrderService } from '../generated-lists/generated-list-order.service';
import { GeneratedListSharingService } from '../generated-lists/generated-list-sharing.service';
import { canChangeDemand } from '../lists/list-acts';
import { ListAccessService } from '../lists/list-access.service';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketRedaction } from './basket-redaction';
import {
  groupEntries,
  progressOf,
  toRowView,
  type BasketEntry,
  type BasketGroup,
} from './basket-rows';
import {
  BASKET_LIST_REFS_SQL,
  BASKET_SESSION_LOOKBACK_MS,
  BASKET_SESSION_SQL,
  BASKET_SETTLEMENTS_SQL,
  COVERED_LINE_ITEMS_SQL,
  COVERED_LINES_SQL,
  type BasketListRefRow,
  type BasketSessionRow,
  type BasketSettlementRow,
  type CoveredLineItemRow,
  type CoveredLineRow,
} from './basket.sql';

/**
 * The basket, read from the lists it covers (plan 0136, section 3).
 *
 * A basket stores nothing about its rows. Every number on this screen is
 * computed here, on every request, from `list_lines` and `line_settlements`.
 *
 * ## Why nothing is cached
 *
 * A materialized row is the copy this series removes. The read is bounded by a
 * household's lists, which level off (plan 0122, section 2: "a list grows by what
 * a household buys, not by how long it shops"), and every number in it changes on
 * every purchase anybody makes, so a cache would be invalidated as often as it is
 * read.
 *
 * ## What it costs
 *
 * Four queries for the rows, none of them per line: the session, the covered
 * lines, their product sets and the settlements in scope. The settlements read
 * rides `ix_settlements_basket_live` from plan 0134. The participants and the
 * list names are two more, and the access reads run **before any transaction**
 * (plan 0130, section 13).
 */
@Injectable()
export class BasketReadService {
  private readonly logger = new Logger(BasketReadService.name);

  constructor(
    @InjectRepository(GeneratedList)
    private readonly baskets: Repository<GeneratedList>,
    private readonly coverage: BasketCoverageService,
    private readonly sharing: GeneratedListSharingService,
    // For the **owner's** permissions on each covered list, which is what
    // `demandEditable` answers (plan 0131). Never the actor's.
    private readonly listAccess: ListAccessService,
    private readonly order: GeneratedListOrderService
  ) {}

  /** The basket as one participant reads it. */
  async read(req: GetBasketRequest): Promise<BasketView> {
    const { basket, participant } = await this.resolve(req);
    return this.view(basket, participant);
  }

  /**
   * The same read for a participant already resolved, which every write does
   * after it commits.
   *
   * A write answers the row as it now stands **and** the basket's progress, and
   * progress is a count over every row, so a write costs a read. That is the
   * contract rather than an oversight: a client that had to refetch to redraw
   * its header would make the same read one round trip later.
   */
  async view(
    basket: GeneratedList,
    participant: GeneratedListParticipant
  ): Promise<BasketView> {
    const covered = await this.coverage.listsOf(basket);
    const coveredListIds = covered.map((row) => row.listId);

    // Before the rows, and before any transaction: a reader with no account
    // costs no access query at all.
    const redaction = participant.userId
      ? BasketRedaction.of(
          participant,
          await this.sharing.writableAmong(participant.userId, coveredListIds)
        )
      : BasketRedaction.none(participant);

    const [{ rows, truncated }, people, lists] = await Promise.all([
      this.rowsOf(basket, coveredListIds, redaction),
      this.sharing.listParticipants({
        generatedListId: basket.id,
        asParticipantId: participant.id,
      }),
      this.listRefs(redaction),
    ]);

    const me = people.participants.find((row) => row.id === participant.id);
    if (!me) {
      // The guard resolved them a moment ago, so this is a revocation that
      // landed in between rather than a caller who was never here.
      throw new NotAParticipantException('Not a participant of this basket');
    }

    return {
      id: basket.id,
      kind: basket.kind,
      name: basket.name,
      status: basket.status,
      createdAt: basket.generatedAt.toISOString(),
      rows,
      lists,
      participants: people.participants,
      me,
      progress: progressOf(rows),
      truncated,
      servesLocations: redaction.servesLocations,
    };
  }

  /**
   * The four numbers a history row shows, with no reader and no redaction
   * (plan 0136, section 7.4).
   *
   * The counts read for an **open** basket, and the admin detail's rows. A page
   * holds at most a few open baskets, because the sweep finishes them, so one
   * read each is acceptable.
   */
  async progressOf(basket: GeneratedList): Promise<BasketProgress> {
    return progressOf(await this.openRows(basket));
  }

  /** The rows of an open basket, unredacted, for a caller that is not a reader. */
  async openRows(basket: GeneratedList): Promise<BasketRowView[]> {
    const covered = await this.coverage.listsOf(basket);
    const listIds = covered.map((row) => row.listId);
    const { rows } = await this.rowsOf(
      basket,
      listIds,
      BasketRedaction.unredacted(listIds)
    );
    return rows;
  }

  /**
   * The rows themselves: the four queries, the grouping, the order and the cap.
   *
   * Public so that the writes can recompute a row without composing the whole
   * view, and so that the finish can freeze the numbers it draws.
   */
  async rowsOf(
    basket: GeneratedList,
    coveredListIds: readonly string[],
    redaction: BasketRedaction
  ): Promise<{ rows: BasketRowView[]; groups: BasketGroup[]; truncated: boolean }> {
    if (coveredListIds.length === 0) {
      // A person in no zone has a basket with nothing in it. An answer, never
      // an error: a caller asking what a basket holds is drawing a screen.
      return { rows: [], groups: [], truncated: false };
    }

    const scope = await this.scopeOf(basket);
    const lines = await this.baskets.query<CoveredLineRow[]>(COVERED_LINES_SQL, [
      [...coveredListIds],
      basket.id,
      scope.startedAt,
      scope.enabled,
    ]);
    if (lines.length === 0) {
      return { rows: [], groups: [], truncated: false };
    }

    const lineIds = lines.map((line) => line.id);
    const [items, settlements, permissions] = await Promise.all([
      this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [
        lineIds,
      ]),
      scope.enabled
        ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
            basket.id,
            lineIds,
            scope.startedAt,
          ])
        : Promise.resolve([]),
      // The **owner's** permissions, never the actor's (plan 0131). A reader
      // never learns them, which is why `demandEditable` is served at all.
      this.listAccess.permissionsAmong(basket.ownerUserId, coveredListIds),
    ]);

    const entries = toEntries(lines, items, settlements);
    const groups = groupEntries(entries);

    // Asked on **every** read rather than once at creation, which reverses plan
    // 0110 section 2 by necessity: a view has no `position` to write it into.
    // The reason that rule gave is kept another way, and the order still cannot
    // move under a thumb while somebody shops: it learns from **finished** trips
    // only, never from the basket being shopped.
    const ordered = await this.order.order(
      basket.ownerUserId,
      groups.map((group) => ({
        content: group.anchor.content,
        options: [...new Set(group.entries.flatMap((e) => e.itemIds))],
        group,
      }))
    );

    const truncated = ordered.length > BASKET_LIMITS.maxRows;
    if (truncated) {
      // A warning and not a failure: the guard is against a pathological
      // account, and the shopper still gets the first thousand things to buy in
      // the order they walk them.
      this.logger.warn(
        `Basket ${basket.id} has ${ordered.length} rows, cut to ${BASKET_LIMITS.maxRows}`
      );
    }
    const kept = ordered.slice(0, BASKET_LIMITS.maxRows).map((e) => e.group);

    const context = {
      servedListIds: redaction.servedListIds,
      demandEditable: (entry: BasketEntry) =>
        canChangeDemand(
          permissions.get(entry.listId) ?? new Set(),
          entry.approvalStatus
        ),
    };
    return {
      rows: kept.map((group) => toRowView(group, context)),
      groups: kept,
      truncated,
    };
  }

  /**
   * Which of this basket's purchases count (plan 0136, section 3.1, step 2).
   *
   * A `GENERATED` basket is a trip, so every standing purchase it made is in
   * scope and there is no lower bound. A `LIVE` basket never ends, so the scope
   * is the **current session** and there may be none, in which case `bought` is
   * zero everywhere and yesterday's shop does not reappear as today's progress.
   */
  private async scopeOf(
    basket: GeneratedList
  ): Promise<{ startedAt: Date | null; enabled: boolean }> {
    if (basket.kind !== BasketKind.LIVE) {
      return { startedAt: null, enabled: true };
    }
    const [session] = await this.baskets.query<BasketSessionRow[]>(
      BASKET_SESSION_SQL,
      [basket.id, BASKET_SESSION_LOOKBACK_MS, PURCHASE_SESSION_GAP_MS]
    );
    return session
      ? { startedAt: session.startedAt, enabled: true }
      : { startedAt: null, enabled: false };
  }

  /** The names behind the lists this reader was served. */
  private async listRefs(redaction: BasketRedaction): Promise<BasketListRef[]> {
    const listIds = [...redaction.servedListIds];
    if (listIds.length === 0) {
      // A guest, and every reader who writes none of the covered lists. No
      // query at all, which is the difference between a rule and a filter.
      return [];
    }
    return this.baskets.query<BasketListRefRow[]>(BASKET_LIST_REFS_SQL, [
      listIds,
    ]);
  }

  /** The basket and the live participant asking for it. */
  async resolve(req: {
    basketId: string;
    participantId: string;
  }): Promise<{
    basket: GeneratedList;
    participant: GeneratedListParticipant;
  }> {
    const basket = await this.baskets.findOne({ where: { id: req.basketId } });
    if (!basket) {
      throw new NotFoundException('Basket not found');
    }
    // Resolved by id rather than by a credential: the gateway has already
    // checked the credential, and re-presenting it here would mean a guest's
    // session secret travelling a second hop for no gain. The row is still read
    // live, so a revocation between the guard and here is refused.
    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      basket.id
    );
    if (!participant) {
      throw new NotAParticipantException('Not a participant of this basket');
    }
    return { basket, participant };
  }
}

/**
 * Stitch the three row reads into the shape the pure rules take.
 *
 * A free function rather than a method for the reason the rest of `basket-rows`
 * is: it is the join the database did not do, and a spec can state it.
 */
export function toEntries(
  lines: readonly CoveredLineRow[],
  items: readonly CoveredLineItemRow[],
  settlements: readonly BasketSettlementRow[]
): BasketEntry[] {
  const itemsByLine = new Map<string, string[]>();
  for (const row of items) {
    const held = itemsByLine.get(row.lineId);
    if (held) {
      held.push(row.itemId);
    } else {
      itemsByLine.set(row.lineId, [row.itemId]);
    }
  }

  const settlementsByLine = new Map<
    string,
    { id: string; outcome: SettlementOutcome; quantity: number; settledAt: Date; settledByParticipantId: string | null }[]
  >();
  for (const row of settlements) {
    const fact = {
      id: row.id,
      outcome: row.outcome as SettlementOutcome,
      quantity: row.quantity,
      // `pg` hands a `timestamptz` back as a `Date`, but a driver that hands
      // back a string would otherwise reach `toISOString` and throw.
      settledAt: row.settledAt instanceof Date ? row.settledAt : new Date(row.settledAt),
      settledByParticipantId: row.settledByParticipantId,
    };
    const held = settlementsByLine.get(row.lineId);
    if (held) {
      held.push(fact);
    } else {
      settlementsByLine.set(row.lineId, [fact]);
    }
  }

  return lines.map((line) => ({
    lineId: line.id,
    listId: line.listId,
    content: line.content,
    quantity: line.quantity,
    itemSetHash: line.itemSetHash,
    approvalStatus: line.approvalStatus,
    createdAt:
      line.createdAt instanceof Date ? line.createdAt : new Date(line.createdAt),
    itemIds: itemsByLine.get(line.id) ?? [],
    settlements: settlementsByLine.get(line.id) ?? [],
  }));
}
