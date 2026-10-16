import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BASKET_LIMITS,
  BASKET_USUAL_WINDOW,
  isOpenBasket,
  PURCHASE_SESSION_GAP_MS,
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
import { BasketSharingService } from '../baskets/basket-sharing.service';
import type { CoreConfig } from '../config/app-config';
import { Basket, BasketParticipant } from '../entities';
import { ListAccessService } from '../lists/list-access.service';
import { canChangeDemand } from '../lists/list-acts';
import { BasketCoverageService } from './basket-coverage.service';
import {
  basketScopeOf,
  frozenLinesOf,
  isFrozenBasket,
  standingSkipsOf,
  toEntries,
} from './basket-line-facts';
import { BasketLineKeys, picksOf } from './basket-line-keys';
import { BasketOrderService, type OrderableRow } from './basket-order.service';
import {
  BASKET_ELSEWHERE_SQL,
  BASKET_LIST_REFS_SQL,
  BASKET_SETTLEMENTS_SQL,
  BASKETS_SETTLEMENTS_SQL,
  COVERED_LINE_ITEMS_SQL,
  COVERED_LINES_SQL,
  type BasketElsewhereRow,
  type BasketListRefRow,
  type BasketSettlementRow,
  type BasketsSettlementRow,
  type CoveredLineItemRow,
  type CoveredLineRow,
} from './basket-read.sql';
import { BasketRedaction } from './basket-redaction';
import {
  groupEntries,
  progressOf,
  toRowView,
  walkItemIdsOf,
  type BasketEntry,
  type BasketGroup,
  type BasketSkipFact,
} from './basket-rows';
import { usualLineIdsOf, withUsual } from './basket-usual';
import { USUAL_WINDOWS_SQL, type UsualWindowRow } from './basket-usual.sql';
import {
  CHANGE_LINES_SQL,
  type ChangeLineRow,
} from './changes/basket-changes.sql';
import {
  BasketMarksReader,
  departedLinesOf,
  foldBasketMarks,
  NO_BASKET_CHANGES,
  NO_BASKET_MARKS,
  type BasketMarks,
  type RemovedGroup,
} from './changes/basket-marks.reader';
import { removedRows } from './changes/basket-removed-rows';
import { NO_PICKS, type BasketPicks } from './line-dedup';

// Where every caller of the read already imports it from. It moved beside the
// other facts so the patch of an event can stitch rows without importing this
// service (plan 0204).
export { toEntries };

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
 * Seven queries for the rows, none of them per line: the session, the covered
 * lines, their product sets, the settlements in scope, what other baskets bought
 * lately (plan 0188), the standing skips (plan 0137) and the owner's walk
 * history (plan 0141). Plan 0201 added none: the favourite rides the covered
 * lines, and the product of a buy rides the settlements. The settlements read rides `ix_settlements_basket_live`
 * from plan 0134, the purchases elsewhere ride `ix_settlements_line`, the skips
 * read rides `ix_basket_line_skips_standing` and the history rides both. A read
 * at a shop
 * adds one more, the windows of plan 0165, on `ix_settlements_line`. The
 * participants and the list names are two more, and the access reads run
 * **before any transaction** (plan 0130, section 13).
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
    return this.view(
      basket,
      participant,
      req.supermarketId,
      picksOf(req.picks)
    );
  }

  /**
   * The covered lines as entries, each with its key, and no row (plan 0201).
   *
   * For a caller that has to know which row a line is in and draws none: the
   * marks alone, the changes view, the lines that need a price, the lists that
   * can take a product. The session, the lines, their products and this
   * basket's purchases, which is four queries, and three for a `LIVE` basket
   * with no session.
   *
   * A finished trip answers the lines it asked when it finished (plan 0209,
   * section 1.1), whatever the coverage says now.
   */
  async keyedLinesOf(
    basket: Basket,
    coveredListIds: readonly string[],
    picks: BasketPicks = NO_PICKS
  ): Promise<{
    lines: CoveredLineRow[];
    entries: BasketEntry[];
    keys: BasketLineKeys;
  }> {
    const keys = new BasketLineKeys(picks);
    const frozen = isFrozenBasket(basket);
    if (!frozen && coveredListIds.length === 0) {
      return { lines: [], entries: [], keys };
    }
    const scope = await this.scopeOf(basket);
    const lines = frozen
      ? await this.frozenLinesOf(basket)
      : await this.baskets.query<CoveredLineRow[]>(COVERED_LINES_SQL, [
          [...coveredListIds],
          basket.id,
          scope.startedAt,
          scope.enabled,
          elsewhereGapOf(basket),
        ]);
    if (lines.length === 0) {
      return { lines, entries: [], keys };
    }
    const lineIds = lines.map((line) => line.id);
    const [items, settlements] = await Promise.all([
      this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [
        lineIds,
      ]),
      scope.enabled
        ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
            basket.id,
            lineIds,
            scope.startedAt,
            this.skipWindowMs,
          ])
        : Promise.resolve([]),
    ]);
    const entries = toEntries(lines, items, settlements);
    keys.add(entries);
    return { lines, entries, keys };
  }

  /**
   * Key lines that left the coverage, so a change about one can be placed on
   * the row its product is still on (plan 0138, section 7; plan 0201).
   *
   * One query for their product sets. Their purchases are not read: a line
   * that left counts as its favourite or its first product.
   */
  async keyDeparted(
    keys: BasketLineKeys,
    departed: readonly ChangeLineRow[]
  ): Promise<void> {
    if (departed.length === 0) {
      return;
    }
    const items = await this.baskets.query<CoveredLineItemRow[]>(
      COVERED_LINE_ITEMS_SQL,
      [departed.map((line) => line.id)]
    );
    keys.add(toEntries(departed, items, []));
  }

  /**
   * The covered lines of a basket, in the order a row's anchor is chosen in.
   *
   * Public since plan 0138, so the changes view can name a `rowKey` the basket
   * read would draw. It is the same statement with the same five parameters, which
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
      elsewhereGapOf(basket),
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
    participant: BasketParticipant,
    /**
     * The read's chain (plan 0165). With it every row carries `usual`; without
     * it, which is every write's own answer, every row carries null.
     */
    supermarketId?: string,
    /**
     * What the gateway chose by price (plan 0201, section 1). Only the full
     * read carries any. A write's own answer carries none, so its rows and its
     * progress are the ones core builds alone.
     */
    picks: BasketPicks = NO_PICKS
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

    const [{ rows: drawn, truncated, marks }, people, lists] =
      await Promise.all([
        // The marks are read for **this** viewer, which is why they are asked for
        // here and not by the callers that have no reader to measure (plan 0138,
        // section 7).
        this.rowsOf(basket, coveredListIds, redaction, participant.id, picks),
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

    const rows = supermarketId
      ? await this.usualAt(drawn, marks.removed, supermarketId)
      : drawn;

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
      // The shop the basket was started at (plan 0163, section 1). Core states
      // the lock itself, so it holds even when catalog cannot name the shop.
      supermarketLocationId: basket.supermarketLocationId ?? null,
    };
  }

  /**
   * The four numbers a history row shows, with no reader and no redaction
   * (plan 0136, section 7.4).
   *
   * The counts read for an **open** basket, and the admin detail's rows. A page
   * holds at most a few open baskets, because the sweep finishes them, so one
   * read each is acceptable.
   *
   * **It counts products with no picks** (plan 0201, decided by the owner on
   * 2026-10-13). A card, the home summary and the back office pay for no
   * catalog read, so a line with several products and no favourite counts as
   * its first product here. The full read can group that one line differently.
   */
  async progressOf(basket: Basket): Promise<BasketProgress> {
    return progressOf(await this.unredactedRows(basket));
  }

  /**
   * The progress of finished baskets, for a page of history (plan 0209,
   * section 1.2).
   *
   * **In products, as an open basket's is.** The frozen lines are grouped by
   * `groupEntries` with no picks and counted by `progressOf`, which is the
   * same code the screen of the basket runs, so a history card and the screen
   * of one finished basket cannot disagree. Before this plan a finished
   * basket counted lines in SQL.
   *
   * Three queries for the whole page: the frozen lines, their products and
   * the purchases. A basket that is not finished is not answered.
   */
  async finishedProgressOf(
    baskets: readonly Basket[]
  ): Promise<Map<string, BasketProgress>> {
    const finished = baskets.filter((basket) => isFrozenBasket(basket));
    const progress = new Map<string, BasketProgress>();
    if (finished.length === 0) {
      return progress;
    }
    const ids = finished.map((basket) => basket.id);
    const linesByBasket = await frozenLinesOf(this.baskets, ids);
    const lineIds = [
      ...new Set([...linesByBasket.values()].flat().map((line) => line.id)),
    ];
    const [items, settlements] =
      lineIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [
              lineIds,
            ]),
            this.baskets.query<BasketsSettlementRow[]>(
              BASKETS_SETTLEMENTS_SQL,
              [ids, this.skipWindowMs]
            ),
          ]);
    for (const basket of finished) {
      const own = settlements.filter((row) => row.basketId === basket.id);
      const entries = toEntries(linesByBasket.get(basket.id) ?? [], items, own);
      const context = {
        servedListIds: new Set<string>(),
        demandEditable: () => false,
        // A finished basket reads no skips (plan 0137): its trip is over.
        facts: { skips: new Map(), kind: basket.kind },
        marks: new Map(),
      };
      const rows = groupEntries(entries, NO_PICKS).map((group) =>
        toRowView(group, context)
      );
      progress.set(basket.id, progressOf(rows));
    }
    return progress;
  }

  /**
   * The rows of a basket, unredacted, for a caller that is not a reader.
   *
   * A finished trip answers its frozen rows, grouped by product as the screen
   * groups them, so the admin detail draws the rows its count counts (plan
   * 0209, section 1.2).
   */
  async unredactedRows(basket: Basket): Promise<BasketRowView[]> {
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
   *
   * ## A finished trip holds still (plan 0209, section 1.1)
   *
   * A `GENERATED` basket that is not open reads its lines from
   * `basket_trip_rows`, which its finish wrote, and not from today's coverage.
   * It skips the reads that only an open basket needs: what was bought
   * elsewhere and the change marks. The grouping, the rows and the order are
   * the same code, so a finished basket is drawn as an open one is, from
   * numbers that stop.
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
    participantId?: string,
    /** What the gateway chose by price. Empty for every caller but the read. */
    picks: BasketPicks = NO_PICKS
  ): Promise<{
    rows: BasketRowView[];
    groups: BasketGroup[];
    truncated: boolean;
    marks: BasketMarks;
  }> {
    // A finished trip asked what it asked whatever its owner can write now,
    // so only an open basket stops at an empty coverage.
    const frozen = isFrozenBasket(basket);
    if (!frozen && coveredListIds.length === 0) {
      // A person in no zone has a basket with nothing in it. An answer, never
      // an error: a caller asking what a basket holds is drawing a screen.
      return { rows: [], groups: [], truncated: false, marks: NO_BASKET_MARKS };
    }

    const scope = await this.scopeOf(basket);
    // Null for a basket that is not open, so a finished trip reads nothing
    // that was bought elsewhere.
    const elsewhereGapMs = elsewhereGapOf(basket);
    const lines = frozen
      ? await this.frozenLinesOf(basket)
      : await this.baskets.query<CoveredLineRow[]>(COVERED_LINES_SQL, [
          [...coveredListIds],
          basket.id,
          scope.startedAt,
          scope.enabled,
          elsewhereGapMs,
        ]);

    // Before the settlements, because a removed row shows what this basket bought
    // of a line the coverage no longer holds, and those purchases have to be in
    // the same read (plan 0138, section 7).
    // A removed row lives for the window an outside buy does, and only while
    // the basket is open (plan 0203, section 6): one clock for both kinds of
    // crossed out row.
    //
    // Read here and folded further down (plan 0201): a mark belongs to the key
    // of a row, and the key is the product a line counts as, which is known
    // only after the products and the purchases are read.
    // A finished trip carries no marks: what changed on a list after the trip
    // is not something its rows show.
    const changes =
      participantId && !frozen
        ? await this.marks.changesFor(
            participantId,
            coveredListIds,
            lines,
            elsewhereGapMs
          )
        : NO_BASKET_CHANGES;
    const departed = departedLinesOf(changes, lines);
    const coveredIds = new Set(lines.map((line) => line.id));
    // Every line a removal names that is not covered now. A superset of the
    // lines of the removed rows, which is harmless: the purchases of a line
    // that makes no row are read and then not drawn.
    const removedLineIds = [
      ...new Set(
        changes.removing
          .map((change) => change.lineId)
          .filter((lineId) => !coveredIds.has(lineId))
      ),
    ];

    if (lines.length === 0 && removedLineIds.length === 0) {
      return {
        rows: [],
        groups: [],
        truncated: false,
        marks: {
          ...NO_BASKET_MARKS,
          unseenChangeCount: changes.unseenChangeCount,
          newestUnseenChangeId: changes.newestUnseenChangeId,
        },
      };
    }

    const lineIds = lines.map((line) => line.id);
    const [items, settlements, elsewhere, skips, permissions] =
      await Promise.all([
        // The product sets of the covered lines and of the lines that left, in
        // one statement: both are keyed below.
        this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [
          [...lineIds, ...departed.map((line) => line.id)],
        ]),
        scope.enabled
          ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
              basket.id,
              [...lineIds, ...removedLineIds],
              scope.startedAt,
              this.skipWindowMs,
            ])
          : Promise.resolve([]),
        // What somebody bought lately through another basket, or through none
        // (plan 0188). For the covered lines only: a removed row is a fact about
        // this basket's own past. A count and a time, never a person.
        elsewhereGapMs === null || lineIds.length === 0
          ? Promise.resolve([])
          : this.baskets.query<BasketElsewhereRow[]>(BASKET_ELSEWHERE_SQL, [
              basket.id,
              lineIds,
              elsewhereGapMs,
            ]),
        this.skipsOf(basket),
        // The **owner's** permissions, never the actor's (plan 0131). A reader
        // never learns them, which is why `demandEditable` is served at all.
        this.listAccess.permissionsAmong(basket.ownerUserId, coveredListIds),
      ]);

    const entries = toEntries(lines, items, settlements, elsewhere);
    // The product and the key of every line, worked out once (plan 0201). A
    // line that left is keyed with no purchases.
    const keys = new BasketLineKeys(picks)
      .add(entries)
      .add(toEntries(departed, items, []));
    const marks = foldBasketMarks(changes, lines, keys.keyOf);
    const groups = groupEntries(entries, picks);

    const context = {
      servedListIds: redaction.servedListIds,
      demandEditable: (entry: BasketEntry) =>
        canChangeDemand(
          permissions.get(entry.listId) ?? new Set(),
          entry.approvalStatus
        ),
      facts: { skips, kind: basket.kind },
      // What changed about each row since this viewer last looked, by the key
      // of the row (plan 0138, section 7). Empty for a caller with no viewer.
      marks: marks.byKey,
    };

    // The covered rows and the ones that went (plan 0138) are ordered
    // **together**, because a removed row's slot is computed from its text and
    // its products like any other row's, so it stands where it stood instead of
    // jumping to the end under the thumb that was about to tap it. It carries no
    // products, so it falls back to the text key, which for a row that matched
    // by product can move it: accepted for a disabled row (plan 0141, section
    // 4). It lives for six hours since plan 0203, where it lived for minutes.
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
   * The rows with where each is usually bought, at one chain (plan 0165).
   *
   * One query over every line of every row, after the cap, so a basket of a
   * thousand rows costs one statement and not a thousand. A removed row (plan
   * 0138) answers from the lines that went, which is why the removed groups
   * come in beside the rows.
   */
  private async usualAt(
    rows: BasketRowView[],
    removed: readonly RemovedGroup[],
    supermarketId: string
  ): Promise<BasketRowView[]> {
    const removedLineIds = new Map(
      removed.map((group) => [group.rowKey, group.lineIds])
    );
    const lineIds = usualLineIdsOf(rows, removedLineIds);
    const windows =
      lineIds.length === 0
        ? []
        : await this.baskets.query<UsualWindowRow[]>(USUAL_WINDOWS_SQL, [
            lineIds,
            supermarketId,
            BASKET_USUAL_WINDOW,
          ]);
    return withUsual(rows, windows, removedLineIds);
  }

  /** The lines a finished trip asked for (plan 0209, section 1.1). */
  private async frozenLinesOf(basket: Basket): Promise<CoveredLineRow[]> {
    return (
      (await frozenLinesOf(this.baskets, [basket.id])).get(basket.id) ?? []
    );
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
  private async skipsOf(basket: Basket): Promise<Map<string, BasketSkipFact>> {
    if (!isOpenBasket(basket.status)) {
      return new Map();
    }
    return standingSkipsOf(this.baskets, basket.id, this.skipWindowMs);
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
    return basketScopeOf(this.baskets, basket);
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
 * The window in which another basket's purchase keeps a line a row (plan 0188),
 * or null when this basket does not ask. A removed row lives for the same
 * window (plan 0203, section 6).
 *
 * `$5` of `COVERED_LINES_SQL`, and one definition for the read and for the row
 * resolver, so a write can find every row the read drew.
 *
 * **`PURCHASE_SESSION_GAP_MS`, the window that already means "lately"**: it is
 * what ends a `LIVE` basket's session and what numbers a list's loose sessions,
 * so "bought lately by somebody else" and "bought in this session by me" run
 * out on the same clock.
 *
 * **Null for a basket that is not open.** A finished trip is frozen (plan
 * 0135), and a purchase somebody makes afterwards is not part of it.
 */
export function elsewhereGapOf(basket: Basket): number | null {
  return isOpenBasket(basket.status) ? PURCHASE_SESSION_GAP_MS : null;
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
    // Every product the row can be found under in the history (plan 0201).
    // A removed row has none and falls back to its text.
    optionIds: group ? walkItemIdsOf(group) : [],
    row,
    group,
  };
}
