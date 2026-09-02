import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_LIMITS,
  LineApprovalStatus,
  OriginUnavailableReason,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListLineMovedEvent,
  type GeneratedListLineOriginDetail,
  type GeneratedListLineOriginsResult,
  type GeneratedListOriginCandidate,
  type GetGeneratedListLineOriginsRequest,
  type LineSettlementSummary,
  type SetGeneratedListOriginQuantityRequest,
  type SetGeneratedListOriginQuantityResult,
} from '@portfolio/luna-shopper/contracts';
import {
  BelowSettledException,
  ForbiddenException,
  NotFoundException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toLineView } from '../lists/list.mappers';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import {
  ACTIVE_OVERLAP_SQL,
  SHEET_CANDIDATE_LINES_SQL,
  type ActiveOverlapRow,
  type SheetCandidateLineRow,
  type WritableListRow,
} from './generated-list.sql';
import { LineClaimService } from './line-claim.service';
import { mergeKey } from './line-dedup';
import { namesOfLists, type NamedList } from './list-names';

/**
 * What a basket line is made of, and how a household changes its share of it
 * (plan 0057).
 *
 * ## The distinction the whole file rests on
 *
 * > **Lowering what a list asked for is not buying it.**
 *
 * The number on the basket row means "bought" when it goes down (plan 0056). The
 * numbers here sit one screen deeper and mean the opposite: they are what each
 * household **wants**, and moving one down is that household changing its mind,
 * exactly as somebody editing the quantity on the list page would.
 *
 * So nothing in this file writes a `LineSettlement`, nothing here sets the bought
 * indicator, nothing here touches `settledQuantity`, and nothing here appears in
 * a consumption history. A line lowered to zero this way is plan 0047 section
 * 2.2's line at zero: known about, not currently wanted, and never bought. That
 * is the single most likely thing to be got wrong by somebody editing this next
 * to {@link GeneratedListSettleService}, which is why it is the first paragraph.
 *
 * ## Why it is a service of its own
 *
 * It is the one thing in this batch that changes a **household's own list**, and
 * everything about it is shaped by keeping that separate from buying. Putting it
 * on the settle service would put the two meanings of one control in one class,
 * and the response shape is deliberately not the settle's for the same reason
 * (section 6).
 *
 * ## Both operations are gated on the all or nothing rule
 *
 * Plan 0051 section 5.2, checked here against core's own access tables rather
 * than taken from the gateway's context. A guest sees neither collection and can
 * write nothing, and that is not a degraded experience: a guest must never have
 * to know which household a tin of tomatoes belongs to.
 */
@Injectable()
export class GeneratedListOriginsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOrigin)
    private readonly origins: Repository<GeneratedListLineOrigin>,
    @InjectRepository(ListLine)
    private readonly zoneLines: Repository<ListLine>,
    @InjectRepository(LineSettlement)
    private readonly settlements: Repository<LineSettlement>,
    @InjectRepository(ShoppingList)
    private readonly shoppingLists: Repository<ShoppingList>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  // --- The read --------------------------------------------------------------

  /**
   * A basket line's origins, and the lists that hold the same thing and are not
   * origins (plan 0057, section 3).
   *
   * The read the allocation sheet could never be. That one appears only while
   * settling and can only say how many of the units **already bought** belong to
   * each list; this one says what each household currently wants, and it is the
   * only place plan 0050's provenance rows can be read back at all.
   */
  async lineOrigins(
    req: GetGeneratedListLineOriginsRequest
  ): Promise<GeneratedListLineOriginsResult> {
    const { list, line, actorUserId } = await this.resolve(req);

    const rows = await this.origins.find({
      where: { generatedListLineId: line.id },
      // Oldest provenance first, which is the settle's own allocation order.
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    // The zone lines behind those rows, read together: `listQuantity` is what
    // each list asks for **now**, which is not `contributed` and diverges the
    // moment anybody edits either side of the snapshot (section 3.1).
    const sourceLines = await this.zoneLinesById(rows.map((row) => row.lineId));
    const settledHere = await this.settledPerOrigin(line.id);
    // The **owner's** standing and not the reader's, because plan 0051 section
    // 6.4 makes the owner's access what authorizes every settle.
    const ownerWritable = await this.sharing.writableAmong(
      list.ownerUserId,
      rows.map((row) => row.listId)
    );

    const candidates = await this.candidatesFor(
      list,
      line,
      rows,
      sourceLines,
      actorUserId
    );

    const names = await namesOfLists(this.shoppingLists, [
      ...rows.map((row) => row.listId),
      ...candidates.map((row) => row.listId),
    ]);

    return {
      generatedListId: list.id,
      lineId: line.id,
      origins: rows.map((row) => ({
        originId: row.id,
        listId: row.listId,
        lineId: row.lineId,
        zoneId: row.zoneId,
        ...named(names, row.listId),
        contributed: row.quantity,
        // Zero for an origin whose zone line has been deleted underneath the
        // basket, which plan 0050 section 1 makes an ordinary thing to have in a
        // history rather than an error.
        listQuantity: sourceLines.get(row.lineId)?.quantity ?? 0,
        settledHere: settledHere.get(row.lineId) ?? 0,
        writable: ownerWritable.has(row.listId),
      })),
      candidates: candidates.map((row) => ({
        ...row,
        ...named(names, row.listId),
      })),
    };
  }

  /**
   * Lists holding the same thing that are not already an origin of this line
   * (section 3.2).
   *
   * The match is `mergeKey`, unchanged. That is not a convenience, it is the
   * correctness argument for the whole collection: **the sheet must never offer
   * a match the run would not have merged**, or the same product appears as one
   * line in one basket and two in the next, and the household cannot tell which
   * of the two the shopper was looking at.
   */
  private async candidatesFor(
    list: GeneratedList,
    line: GeneratedListLine,
    rows: readonly GeneratedListLineOrigin[],
    sourceLines: ReadonlyMap<string, ListLine>,
    actorUserId: string
  ): Promise<Omit<GeneratedListOriginCandidate, 'listName' | 'zoneName'>[]> {
    const scope = await this.candidateScope(list.ownerUserId, actorUserId);
    if (scope.length === 0) {
      return [];
    }

    const key = this.keyOf(line, rows, sourceLines);
    const already = new Set(rows.map((row) => row.lineId));
    const found = (
      await this.lists.query<SheetCandidateLineRow[]>(
        SHEET_CANDIDATE_LINES_SQL,
        [scope.map((row) => row.listId)]
      )
    ).filter((row) => !already.has(row.id) && mergeKey(row) === key);
    if (found.length === 0) {
      return [];
    }

    // The run's own overlap query, asked about the **owner**: a line another
    // active basket of theirs is carrying is one plan 0050 section 3 refuses to
    // put in two places at once.
    const claimed = new Set(
      (
        await this.lists.query<ActiveOverlapRow[]>(ACTIVE_OVERLAP_SQL, [
          list.ownerUserId,
          found.map((row) => row.id),
        ])
      ).map((row) => row.lineId)
    );

    const zoneOf = new Map(scope.map((row) => [row.listId, row.zoneId]));
    return found.map((row) => ({
      listId: row.listId,
      lineId: row.id,
      // Every candidate came from the scope query, which names the zone beside
      // the list, so this is a lookup rather than a join.
      zoneId: zoneOf.get(row.listId) ?? '',
      listQuantity: row.quantity,
      content: row.content,
      // The run merges on normalized text as its last resort and is deliberately
      // conservative about it, so a text match is offered and flagged rather
      // than offered silently (section 8).
      matchedOnText: !row.itemSetHash,
      ...this.unavailability(row, claimed),
    }));
  }

  /**
   * Why this candidate cannot be adopted, or nothing at all when it can.
   *
   * The three reasons are checked in the order section 3.2's table states them,
   * and the property that matters is that a candidate carrying one is **served
   * rather than filtered out**.
   */
  private unavailability(
    row: SheetCandidateLineRow,
    claimed: ReadonlySet<string>
  ): { unavailable?: OriginUnavailableReason } {
    if (claimed.has(row.id)) {
      return { unavailable: OriginUnavailableReason.CLAIMED };
    }
    if (row.approvalStatus !== LineApprovalStatus.APPROVED) {
      return { unavailable: OriginUnavailableReason.NOT_APPROVED };
    }
    if (row.quantity <= 0) {
      return { unavailable: OriginUnavailableReason.SETTLED };
    }
    return {};
  }

  /**
   * The lists a candidate may be drawn from: the **owner's** writable set
   * intersected with the **actor's** (section 4.1).
   *
   * For the overwhelming case, where the actor is the owner, that is their entire
   * writable set across every zone they are in, which is exactly the requirement:
   * a list from a zone the run never drew from is adoptable, and so is a zone the
   * run never heard of.
   *
   * The intersection bites only on a registered co-shopper, and it is there
   * because of plan 0051 section 6.4. **A settle is authorized by the owner's
   * access.** If a co-shopper could adopt a line from a zone the owner is not in,
   * the basket would carry an origin that every subsequent settle skips and
   * reports, forever, and a control that adds a row nothing can ever act on is
   * worse than one that cannot add it. Lifting this needs the security rule every
   * settle runs through to become per origin, which section 8 records and does not
   * build.
   */
  private candidateScope(
    ownerUserId: string,
    actorUserId: string
  ): Promise<WritableListRow[]> {
    // Shared with plan 0058's target picker rather than copied, because the two
    // offer different things and must not be able to disagree about which lists
    // qualify: both end in a provenance row that every later settle acts on.
    return this.sharing.writableIntersection(ownerUserId, actorUserId);
  }

  /**
   * The run's deduplication key for this basket line.
   *
   * Taken from an origin's own zone line rather than recomputed from the basket
   * line, because the key is a property of what the run merged and every origin
   * carries it by construction: they are on one line precisely because they
   * agreed on it.
   *
   * A line with no surviving origin falls back to its text, which is what the run
   * does for a free text line. It is the honest answer rather than a good one: a
   * basket line's `options` are the **union** of its origins' product sets, so no
   * `itemSetHash` can be reconstructed from it, and a line that has lost its last
   * origin (section 5.3) has nothing else left to be identified by.
   */
  private keyOf(
    line: GeneratedListLine,
    rows: readonly GeneratedListLineOrigin[],
    sourceLines: ReadonlyMap<string, ListLine>
  ): string {
    for (const row of rows) {
      const source = sourceLines.get(row.lineId);
      if (source) {
        return mergeKey(source);
      }
    }
    return mergeKey({ itemSetHash: null, content: line.content });
  }

  // --- The write -------------------------------------------------------------

  /**
   * Set one list's contribution to a basket line (plan 0057, section 5).
   *
   * An upsert: an existing origin for that zone line is edited, one that does not
   * exist is adopted, and a contribution set to zero takes the list off the line.
   * In one transaction the zone line moves by the difference, the origin row is
   * written, the basket line moves by the same difference, and the claim moves
   * with it.
   *
   * **The basket line moves by the delta and is never recomputed** from the sum
   * of its origins. The obvious implementation sets `quantity = sum(origins)` and
   * is wrong, because plan 0056 lets a shopper raise a basket line above what the
   * households asked for and a recompute would silently throw that away the next
   * time anybody opened this sheet. The consequence is that a basket line's
   * quantity can exceed the sum of its origins, and that is not drift, it is the
   * sale.
   */
  async setOriginQuantity(
    req: SetGeneratedListOriginQuantityRequest
  ): Promise<SetGeneratedListOriginQuantityResult> {
    const { list, line, seesZoneData, actorUserId } = await this.resolve(req);
    const quantity = this.checkQuantity(req.quantity, 'quantity');
    this.checkQuantity(req.from, 'from');

    const existing = await this.origins.findOne({
      where: { generatedListLineId: line.id, lineId: req.sourceLineId },
    });
    const previous = existing?.quantity ?? 0;
    if (req.from !== previous) {
      // Two people editing one split must not silently overwrite each other's
      // arithmetic (plan 0056, section 3.2). The client refetches and shows the
      // number as it now stands, which is the only honest answer: what their
      // gesture meant depends on where it started.
      throw new StaleQuantityException(
        'This contribution has changed since it was read',
        { messageArgs: { current: previous } }
      );
    }

    const source = await this.zoneLines.findOne({
      where: { id: req.sourceLineId },
    });
    if (!source || source.listId !== req.sourceListId) {
      throw new NotFoundException('Line not found');
    }
    await this.requireWritable(list, actorUserId, req.sourceListId);

    const settledHere = (await this.settledPerOrigin(line.id)).get(
      req.sourceLineId
    );
    if (quantity < (settledHere ?? 0)) {
      // Two units of the flat's milk have been bought through this basket, so
      // the flat cannot retroactively have wanted one (section 5.2). Per origin
      // and per basket rather than a comparison against the zone line, which may
      // legitimately be below that number already because somebody settled it
      // from the list page.
      throw new BelowSettledException(
        'That is fewer than this basket has already bought for this list',
        { messageArgs: { floor: settledHere ?? 0 } }
      );
    }

    const delta = quantity - previous;
    if (delta === 0) {
      // A drag that landed where it started is not an error, and it writes
      // nothing rather than writing the same numbers again.
      return this.unchanged(line, existing, source, seesZoneData);
    }
    if (!existing) {
      await this.checkAdoptable(list, line, source);
    }

    const zone = await this.shoppingLists.findOne({
      where: { id: req.sourceListId },
    });
    if (!zone) {
      throw new NotFoundException('List not found');
    }

    const written = await this.write(line, existing, req, {
      zoneId: zone.zoneId,
      quantity,
      delta,
    });

    // Every announcement waits for the commit, which is the convention
    // everywhere in core: an event for a write that then rolled back is a client
    // showing something that never happened.
    //
    // `line.updated` and never `line.settled` (section 6). This is an ordinary
    // demand change: it re triggers no approval (plan 0047, section 7) and it
    // wrote no settlement, so the zone hears exactly what it hears when somebody
    // edits the quantity on the list page.
    this.events.emit(
      RealtimeEvent.LineUpdated,
      zone.zoneId,
      toLineView(
        written.source,
        written.itemIds,
        written.settlements,
        written.claim
      ),
      req.sourceListId
    );

    const announcement: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      // Redacted to the least privileged reader in the room, because a broadcast
      // cannot be projected per socket. A reader who passes section 5.2 merges
      // the mutable fields onto the line it already holds.
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineUpdated,
      list.id,
      announcement
    );

    const ref = {
      zoneId: zone.zoneId,
      listId: req.sourceListId,
      lineId: req.sourceLineId,
    };
    if (!existing) {
      // An adoption claims the zone line, so the other household's list says
      // somebody is out buying it (plan 0051, section 5.3). Named as the owner
      // and never as the actor, exactly as a run is (plan 0052, section 2).
      this.claims.announce(true, list.ownerUserId, [ref]);
    } else if (quantity === 0) {
      // Asked of the derivation rather than assumed from the transition: a line
      // this basket has just let go of may still be held by another, and telling
      // the household nobody is buying it would be a wrong answer produced by a
      // correct write.
      await this.claims.announceReleased([ref]);
    }

    return {
      line: await this.generated.basketLineViewFor(line, seesZoneData),
      origin: written.origin
        ? await this.detailOf(list, line, written.origin, written.source)
        : null,
      listQuantity: written.source.quantity,
    };
  }

  /**
   * The transaction (section 5): the zone line, the origin row and the basket
   * line move together, or none of them do.
   */
  private async write(
    line: GeneratedListLine,
    existing: GeneratedListLineOrigin | null,
    req: SetGeneratedListOriginQuantityRequest,
    move: { zoneId: string; quantity: number; delta: number }
  ): Promise<WrittenOrigin> {
    return this.dataSource.transaction(async (manager) => {
      const zoneLines = manager.getRepository(ListLine);
      const origins = manager.getRepository(GeneratedListLineOrigin);
      const basketLines = manager.getRepository(GeneratedListLine);

      // Re-read under the lock, because the delta is computed from what the row
      // says: a concurrent write between the read and the write is an update
      // that vanishes with nothing logged and nothing errored (plan 0040,
      // section 3).
      const source = await zoneLines.findOne({
        where: { id: req.sourceLineId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source) {
        throw new NotFoundException('Line not found');
      }

      // Floored at zero, exactly as the signed delta path floors it. The zone
      // line may already be below what this origin contributed, because somebody
      // settled it from the list page, and it lands at zero rather than below it.
      source.quantity = Math.max(0, source.quantity + move.delta);
      source.version += 1;
      await zoneLines.save(source);

      let origin: GeneratedListLineOrigin | null = null;
      if (move.quantity === 0 && existing) {
        // The list leaves the line (section 5.3). No settlement is written and
        // no bought indicator is set: the household stopped wanting it, nobody
        // bought it.
        await origins.delete({ id: existing.id });
      } else if (existing) {
        existing.quantity = move.quantity;
        origin = await origins.save(existing);
      } else {
        origin = await origins.save(
          origins.create({
            generatedListLineId: line.id,
            zoneId: move.zoneId,
            listId: req.sourceListId,
            lineId: req.sourceLineId,
            quantity: move.quantity,
            // The zone line's version as this write leaves it, so a row adopted
            // now does not immediately read as an origin that has moved. What
            // the column is for is telling a reader the origin has changed since
            // it was recorded (plan 0050, section 1).
            lineVersion: source.version,
          })
        );
      }

      // Floored at what has already been settled through this basket rather than
      // at zero: those units are bought, and a line cannot ask for fewer than it
      // has already got.
      line.quantity = Math.max(
        line.settledQuantity,
        line.quantity + move.delta
      );
      line.lastEditedByParticipantId = req.participantId;
      line.lastEditedAt = new Date();
      await basketLines.save(line);

      return {
        source,
        origin,
        // Read through the caller's manager rather than this service's own
        // repositories, which would take a second connection while this
        // transaction holds one; enough concurrent edits and every connection in
        // the pool is a transaction waiting for one that will never come free.
        itemIds: await this.zoneLineItemIds(manager, source.id),
        settlements: await this.settlementsOf(manager, source.id),
        claim: await this.claims.claimOf(source.id, manager),
      };
    });
  }

  /**
   * Whether a zone line this basket does not already carry may be adopted
   * (section 3.2).
   *
   * The same three refusals the sheet reports as `unavailable`, restated on the
   * write, plus the match itself. The sheet is a projection and the projection is
   * not the authority: a client holding a stale sheet, or one calling the route
   * directly, has to meet the same rules.
   */
  private async checkAdoptable(
    list: GeneratedList,
    line: GeneratedListLine,
    source: ListLine
  ): Promise<void> {
    if (source.approvalStatus !== LineApprovalStatus.APPROVED) {
      throw new ValidationException(
        'That line has not been approved, so a basket cannot take it',
        { messageArgs: { field: 'sourceLineId' } }
      );
    }
    if (source.quantity <= 0) {
      throw new ValidationException(
        'That line is not currently wanted, so there is nothing to take',
        { messageArgs: { field: 'sourceLineId' } }
      );
    }

    const rows = await this.origins.find({
      where: { generatedListLineId: line.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const sourceLines = await this.zoneLinesById(rows.map((row) => row.lineId));
    if (mergeKey(source) !== this.keyOf(line, rows, sourceLines)) {
      // The run's own rule, and refusing here is what stops the same product
      // being one line in one basket and two in the next.
      throw new ValidationException(
        'That line is not the same thing as this basket line',
        { messageArgs: { field: 'sourceLineId' } }
      );
    }

    const carried = await this.lists.query<ActiveOverlapRow[]>(
      ACTIVE_OVERLAP_SQL,
      [list.ownerUserId, [source.id]]
    );
    if (carried.length > 0) {
      throw new ValidationException(
        'Another basket is already carrying that line',
        { messageArgs: { field: 'sourceLineId' } }
      );
    }
  }

  /**
   * Both accesses, intersected, on the one list being written (section 4.2).
   *
   * Section 6.4 answers "what authorizes an actor who has no access of their
   * own", and its answer is the owner's delegation. It does not say an actor with
   * access may not use it, and here the actor necessarily has one: they hold
   * `WRITE` on every source list, which is what passing the all or nothing rule
   * means. So the write is checked against **both**, at request time, and it is
   * cheap because it is the same `writableAmong` read the settle already makes.
   *
   * Resolved before the transaction opens, exactly as the settle does it: every
   * repository the access service holds draws its own connection from the pool,
   * so asking it a question from inside a transaction means one request holding
   * two, which deadlocks a pool under load rather than failing honestly.
   */
  private async requireWritable(
    list: GeneratedList,
    actorUserId: string,
    listId: string
  ): Promise<void> {
    const owner = await this.sharing.writableAmong(list.ownerUserId, [listId]);
    if (!owner.has(listId)) {
      throw new ForbiddenException(
        'The basket’s owner can no longer write that list'
      );
    }
    if (actorUserId === list.ownerUserId) {
      return;
    }
    const actor = await this.sharing.writableAmong(actorUserId, [listId]);
    if (!actor.has(listId)) {
      throw new ForbiddenException('You need write access to that list');
    }
  }

  // --- Shared ----------------------------------------------------------------

  /**
   * The basket, the line, and whether this participant may be here at all.
   *
   * `seesZoneData` is asked of core's own access tables at request time rather
   * than taken from the request (plan 0051, section 5.2): the gateway computes
   * the same value for its own guard, but a value that travelled through a
   * message is a value a future caller could send.
   *
   * Both operations are refused outright rather than redacted, which is the one
   * place this differs from every other read on the participant surface. There is
   * nothing left of either after the redaction: every field of an origin and of a
   * candidate names a zone or a list.
   */
  private async resolve(req: {
    generatedListId: string;
    lineId: string;
    participantId: string;
  }): Promise<{
    list: GeneratedList;
    line: GeneratedListLine;
    seesZoneData: boolean;
    actorUserId: string;
  }> {
    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }
    const line = await this.lines.findOne({
      where: { id: req.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      list.id
    );
    if (!participant) {
      throw new ForbiddenException('Not a participant of this basket');
    }
    const seesZoneData = await this.sharing.seesZoneData(participant);
    if (!seesZoneData || !participant.userId) {
      // A guest fails the first test and has no account to fail the second with,
      // which is the same sentence twice: section 4.1's intersection is over two
      // users' access, so an actor with no user is an actor with no scope.
      throw new ForbiddenException(
        'Seeing where a line came from needs write access to every source list'
      );
    }

    return { list, line, seesZoneData, actorUserId: participant.userId };
  }

  /**
   * What this basket has already settled against each of a line's origins, in one
   * query rather than one per origin.
   *
   * `BOUGHT` only: `NOT_AVAILABLE` closes an outstanding amount without buying
   * anything, and this number is a floor on what a household can be said to have
   * wanted, so a shop that did not have the milk cannot raise it.
   */
  private async settledPerOrigin(
    generatedListLineId: string
  ): Promise<Map<string, number>> {
    const rows = await this.settlements.find({
      where: { generatedListLineId, outcome: SettlementOutcome.BOUGHT },
    });
    const perLine = new Map<string, number>();
    for (const row of rows) {
      perLine.set(row.lineId, (perLine.get(row.lineId) ?? 0) + row.quantity);
    }
    return perLine;
  }

  /** The zone lines behind a set of provenance rows, in one read. */
  private async zoneLinesById(
    lineIds: readonly string[]
  ): Promise<Map<string, ListLine>> {
    const unique = [...new Set(lineIds)];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.zoneLines.find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** A zone line's product set, in attachment order (plan 0048, section 1.1). */
  private async zoneLineItemIds(
    manager: EntityManager,
    lineId: string
  ): Promise<string[]> {
    const rows = await manager.getRepository(ListLineItem).find({
      where: { lineId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => row.itemId);
  }

  /**
   * The zone line's two settlement indicators (plan 0047, section 5), read
   * through the caller's manager.
   *
   * Read rather than derived, unlike in a settle, which knows the outcome because
   * it has just written one. Nothing here writes a settlement, so the indicators
   * this event carries are whatever they already were, and leaving them out would
   * take the bought indicator off a line that has been bought.
   */
  private async settlementsOf(
    manager: EntityManager,
    lineId: string
  ): Promise<LineSettlementSummary> {
    const repo = manager.getRepository(LineSettlement);
    // Sequential rather than `Promise.all`: one manager is one connection, so
    // two queries issued at once on it are serialised by the driver anyway.
    const boughtCount = await repo.count({
      where: { lineId, outcome: SettlementOutcome.BOUGHT },
    });
    const latest = await repo.findOne({
      where: { lineId },
      order: { settledAt: 'DESC', id: 'DESC' },
    });
    return { boughtCount, lastOutcome: latest?.outcome ?? null };
  }

  /** One origin row, named and numbered as the read presents it (section 3.1). */
  private async detailOf(
    list: GeneratedList,
    line: GeneratedListLine,
    origin: GeneratedListLineOrigin,
    source: ListLine
  ): Promise<GeneratedListLineOriginDetail> {
    const [names, writable, settled] = await Promise.all([
      namesOfLists(this.shoppingLists, [origin.listId]),
      this.sharing.writableAmong(list.ownerUserId, [origin.listId]),
      this.settledPerOrigin(line.id),
    ]);
    return {
      originId: origin.id,
      listId: origin.listId,
      lineId: origin.lineId,
      zoneId: origin.zoneId,
      ...named(names, origin.listId),
      contributed: origin.quantity,
      listQuantity: source.quantity,
      settledHere: settled.get(origin.lineId) ?? 0,
      writable: writable.has(origin.listId),
    };
  }

  /** A request that asked for the number the origin already had. */
  private async unchanged(
    line: GeneratedListLine,
    existing: GeneratedListLineOrigin | null,
    source: ListLine,
    seesZoneData: boolean
  ): Promise<SetGeneratedListOriginQuantityResult> {
    const list = await this.lists.findOne({
      where: { id: line.generatedListId },
    });
    return {
      line: await this.generated.basketLineViewFor(line, seesZoneData),
      origin:
        existing && list
          ? await this.detailOf(list, line, existing, source)
          : null,
      listQuantity: source.quantity,
    };
  }

  /** A whole number of units, within the ceiling a line may hold. */
  private checkQuantity(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationException(
        `${field} must be a whole number of units, or zero`,
        { messageArgs: { field } }
      );
    }
    if (value > GENERATED_LIST_LIMITS.maxQuantity) {
      throw new ValidationException(
        `${field} must be at most ${GENERATED_LIST_LIMITS.maxQuantity}`,
        { messageArgs: { field } }
      );
    }
    return value;
  }
}

/** What the transaction produced, held until it commits. */
interface WrittenOrigin {
  /** The zone line as this write left it. */
  source: ListLine;
  /** The provenance row, or null when the contribution was set to zero. */
  origin: GeneratedListLineOrigin | null;
  itemIds: string[];
  settlements: LineSettlementSummary;
  claim: Awaited<ReturnType<LineClaimService['claimOf']>>;
}

/**
 * A list's name for a caption, defaulted to null rather than invented.
 *
 * A list that has since been deleted is absent from the map, which is the
 * ordinary way a basket outlives what it drew from rather than an error.
 */
function named(
  names: ReadonlyMap<string, NamedList>,
  listId: string
): { listName: string | null; zoneName: string | null } {
  const found = names.get(listId);
  return {
    listName: found?.name ?? null,
    zoneName: found?.zoneName ?? null,
  };
}
