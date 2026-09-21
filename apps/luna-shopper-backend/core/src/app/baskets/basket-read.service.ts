import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BASKET_LIMITS,
  BasketKind,
  isOpenBasket,
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
import type { CoreConfig } from '../config/app-config';
import { Basket, BasketParticipant } from '../entities';
import { BasketSharingService } from '../baskets/basket-sharing.service';
import { ListAccessService } from '../lists/list-access.service';
import { canChangeDemand } from '../lists/list-acts';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketOrderService, type OrderableRow } from './basket-order.service';
import { BasketRedaction } from './basket-redaction';
import {
  groupEntries,
  progressOf,
  toRowView,
  type BasketEntry,
  type BasketGroup,
  type BasketSettlementFact,
  type BasketSkipFact,
} from './basket-rows';
import {
  BASKET_LIST_REFS_SQL,
  BASKET_SESSION_LOOKBACK_MS,
  BASKET_SESSION_SQL,
  BASKET_SETTLEMENTS_SQL,
  COVERED_LINE_ITEMS_SQL,
  COVERED_LINES_SQL,
  STANDING_SKIPS_SQL,
  type BasketLineSkipRow,
  type BasketListRefRow,
  type BasketSessionRow,
  type BasketSettlementRow,
  type CoveredLineItemRow,
  type CoveredLineRow,
} from './basket-read.sql';
import { CHANGE_LINES_SQL } from './changes/basket-changes.sql';
import {
  BasketMarksReader,
  NO_BASKET_MARKS,
  type BasketMarks,
} from './changes/basket-marks.reader';
import { removedRows } from './changes/basket-removed-rows';

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
 * Six queries for the rows, none of them per line: the session, the covered
 * lines, their product sets, the settlements in scope, the standing skips (plan
 * 0137) and the owner's walk history (plan 0141). The settlements read rides
 * `ix_settlements_basket_live` from plan 0134, the skips read rides
 * `ix_basket_line_skips_standing` and the history rides both. The participants
 * and the list names are two more, and the access reads run **before any
 * transaction** (plan 0130, section 13).
 */
@Injectable()
export class BasketReadService {
  private readonly logger = new Logger(BasketReadService.name);

  /** How long a skip, and a `LIVE` basket's close, keep a row marked (0137). */
  private readonly skipWindowMs: number;

  constructor(
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    private readonly coverage: BasketCoverageService,
    private readonly sharing: BasketSharingService,
    // For the **owner's** permissions on each covered list, which is what
    // `demandEditable` answers (plan 0131). Never the actor's.
    private readonly listAccess: ListAccessService,
    private readonly order: BasketOrderService,
    // What changed since this viewer last looked (plan 0138). Last but for the
    // configuration, so no positional construction in a spec has to shift an
    // argument to take it.
    private readonly marks: BasketMarksReader,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.skipWindowMs =
      configService.getOrThrow<CoreConfig>('core').basket.skipWindowMs;
  }

  /** The basket as one participant reads it. */
  async read(req: GetBasketRequest): Promise<BasketView> {
    const { basket, participant } = await this.resolve(req);
    return this.view(basket, participant);
  }

  /**
   * The covered lines of a basket, in the order a row's anchor is chosen in.
   *
   * Public since plan 0138, so the changes view can name a `rowKey` the basket
   * read would draw. It is the same statement with the same four parameters, which
   * is the property that matters: an anchor computed from a different set of lines
   * would hand a client a key the write routes refuse.
   */
  async coveredLinesOf(
    basket: Basket,
    coveredListIds: readonly string[]
  ): Promise<CoveredLineRow[]> {
    if (coveredListIds.length === 0) {
      return [];
    }
    const scope = await this.scopeOf(basket);
    return this.baskets.query<CoveredLineRow[]>(COVERED_LINES_SQL, [
      [...coveredListIds],
      basket.id,
      scope.startedAt,
      scope.enabled,
    ]);
  }

  /**
   * The lines a set of ids names, **soft deleted ones included** (plan 0138).
   *
   * The one read in the basket that serves a line no other read will: a change
   * about a line that was taken off the list still has to say what it was called.
   */
  async changeLinesOf(lineIds: readonly string[]): Promise<CoveredLineRow[]> {
    if (lineIds.length === 0) {
      return [];
    }
    return this.baskets.query<CoveredLineRow[]>(CHANGE_LINES_SQL, [
      [...lineIds],
    ]);
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
    basket: Basket,
    participant: BasketParticipant
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

    const [{ rows, truncated, marks }, people, lists] = await Promise.all([
      // The marks are read for **this** viewer, which is why they are asked for
      // here and not by the callers that have no reader to measure (plan 0138,
      // section 7).
      this.rowsOf(basket, coveredListIds, redaction, participant.id),
      this.sharing.listParticipants({
        basketId: basket.id,
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
      unseenChangeCount: marks.unseenChangeCount,
      newestUnseenChangeId: marks.newestUnseenChangeId,
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
  async progressOf(basket: Basket): Promise<BasketProgress> {
    return progressOf(await this.openRows(basket));
  }

  /** The rows of an open basket, unredacted, for a caller that is not a reader. */
  async openRows(basket: Basket): Promise<BasketRowView[]> {
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
   * The rows themselves: the five queries, the grouping, the order and the cap.
   *
   * Public so that the writes can recompute a row without composing the whole
   * view, and so that the finish can freeze the numbers it draws.
   */
  async rowsOf(
    basket: Basket,
    coveredListIds: readonly string[],
    redaction: BasketRedaction,
    /**
     * The viewer, for the marks (plan 0138, section 7). Absent for a caller that
     * is not a reader: the history counts, the admin detail and the finish read
     * the rows to count or freeze them, and a mark belongs to somebody looking.
     */
    participantId?: string
  ): Promise<{
    rows: BasketRowView[];
    groups: BasketGroup[];
    truncated: boolean;
    marks: BasketMarks;
  }> {
    if (coveredListIds.length === 0) {
      // A person in no zone has a basket with nothing in it. An answer, never
      // an error: a caller asking what a basket holds is drawing a screen.
      return { rows: [], groups: [], truncated: false, marks: NO_BASKET_MARKS };
    }

    const scope = await this.scopeOf(basket);
    const lines = await this.baskets.query<CoveredLineRow[]>(
      COVERED_LINES_SQL,
      [[...coveredListIds], basket.id, scope.startedAt, scope.enabled]
    );

    // Before the settlements, because a removed row shows what this basket bought
    // of a line the coverage no longer holds, and those purchases have to be in
    // the same read (plan 0138, section 7).
    const marks = participantId
      ? await this.marks.marksFor(participantId, coveredListIds, lines)
      : NO_BASKET_MARKS;
    const removedLineIds = marks.removed.flatMap((group) => group.lineIds);

    if (lines.length === 0 && marks.removed.length === 0) {
      return { rows: [], groups: [], truncated: false, marks };
    }

    const lineIds = lines.map((line) => line.id);
    const [items, settlements, skips, permissions] = await Promise.all([
      this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [
        lineIds,
      ]),
      scope.enabled
        ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
            basket.id,
            [...lineIds, ...removedLineIds],
            scope.startedAt,
            this.skipWindowMs,
          ])
        : Promise.resolve([]),
      this.skipsOf(basket),
      // The **owner's** permissions, never the actor's (plan 0131). A reader
      // never learns them, which is why `demandEditable` is served at all.
      this.listAccess.permissionsAmong(basket.ownerUserId, coveredListIds),
    ]);

    const entries = toEntries(lines, items, settlements);
    const groups = groupEntries(entries);

    const context = {
      servedListIds: redaction.servedListIds,
      demandEditable: (entry: BasketEntry) =>
        canChangeDemand(
          permissions.get(entry.listId) ?? new Set(),
          entry.approvalStatus
        ),
      facts: { skips, kind: basket.kind },
      // What changed about each row since this viewer last looked, by the row's
      // merge key (plan 0138, section 7). Empty for a caller with no viewer.
      marks: marks.byKey,
    };

    // The covered rows and the ones that went (plan 0138) are ordered
    // **together**, because a removed row's slot is computed from its text and
    // its products like any other row's, so it stands where it stood instead of
    // jumping to the end under the thumb that was about to tap it. It carries no
    // products, so it falls back to the text key, which for a row that matched
    // by product can move it: accepted for a disabled row that lives for
    // minutes (plan 0141, section 4).
    const orderable = [
      ...groups.map((group) => orderableOf(toRowView(group, context), group)),
      ...removedRows(marks.removed, settlements).map((row) =>
        orderableOf(row, null)
      ),
    ];

    // Asked on **every** read rather than once at creation, which reverses plan
    // 0110's "written once" by necessity: a view has no `position` to write it
    // into. The reason that rule gave is kept another way (plan 0141, section
    // 2): the history leaves the **current** session out, so nothing a shopper
    // does in the shop moves a row, and the answer is a pure function of the
    // history and of each row's own text and products.
    const ordered = await this.order.order(
      basket.ownerUserId,
      orderable,
      new Date()
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
    const kept = ordered.slice(0, BASKET_LIMITS.maxRows);

    return {
      rows: kept.map((entry) => entry.row),
      groups: kept
        .map((entry) => entry.group)
        .filter((group): group is BasketGroup => group !== null),
      truncated,
      marks,
    };
  }

  /**
   * This basket's standing skips, by line (plan 0137, section 3).
   *
   * One query per read and never one per row, over the whole basket rather than
   * over the lines it just read: the statement is an index range on
   * `("basketId", "lineId")` and a basket holds a handful of skips, so narrowing
   * it to a line list would add a parameter and save nothing.
   *
   * **A finished basket reads none.** Its rows come from `basket_trip_rows`,
   * and a skip is an intention about a trip that is over.
   */
  private async skipsOf(
    basket: Basket
  ): Promise<Map<string, BasketSkipFact>> {
    if (!isOpenBasket(basket.status)) {
      return new Map();
    }
    const rows = await this.baskets.query<BasketLineSkipRow[]>(
      STANDING_SKIPS_SQL,
      [basket.id, this.skipWindowMs]
    );
    return new Map(
      rows.map((row) => [
        row.lineId,
        {
          // `pg` hands a `timestamptz` back as a `Date`, but a driver that
          // handed back a string would otherwise reach `getTime` and throw.
          skippedAt:
            row.skippedAt instanceof Date
              ? row.skippedAt
              : new Date(row.skippedAt),
          skippedByParticipantId: row.skippedByParticipantId,
          fresh: row.fresh,
        },
      ])
    );
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
    basket: Basket
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
  async resolve(req: { basketId: string; participantId: string }): Promise<{
    basket: Basket;
    participant: BasketParticipant;
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
 * A drawn row, with the three things the walk order decides its slot from.
 *
 * `BasketRowView` already carries all three, under `rowKey` rather than `key`.
 * They are copied out rather than the view being handed over whole, so the order
 * cannot read anything else about a row: the slot is a function of the history,
 * the text and the products, and of nothing else (plan 0141, section 2, rule 2).
 *
 * The `group` travels with it so the caller can hand its own groups back after
 * the cap. A removed row has none, because it is no longer covered.
 */
function orderableOf(
  row: BasketRowView,
  group: BasketGroup | null
): OrderableRow & { row: BasketRowView; group: BasketGroup | null } {
  return {
    key: row.rowKey,
    content: row.content,
    optionIds: row.optionIds,
    row,
    group,
  };
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

  const settlementsByLine = new Map<string, BasketSettlementFact[]>();
  for (const row of settlements) {
    const fact: BasketSettlementFact = {
      id: row.id,
      outcome: row.outcome as SettlementOutcome,
      quantity: row.quantity,
      // `pg` hands a `timestamptz` back as a `Date`, but a driver that hands
      // back a string would otherwise reach `toISOString` and throw.
      settledAt:
        row.settledAt instanceof Date ? row.settledAt : new Date(row.settledAt),
      settledByParticipantId: row.settledByParticipantId,
      // Computed by the database against its own `now()` (plan 0137, section
      // 4), and read for a `LIVE` basket's close alone.
      fresh: row.fresh,
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
      line.createdAt instanceof Date
        ? line.createdAt
        : new Date(line.createdAt),
    itemIds: itemsByLine.get(line.id) ?? [],
    settlements: settlementsByLine.get(line.id) ?? [],
  }));
}
