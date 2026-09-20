import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BasketKind,
  GENERATED_LIST_LIMITS,
  GENERATED_LIST_SHARING_LIMITS,
  GeneratedLineOrigin,
  GeneratedListStatus,
  isOpenBasket,
  RealtimeEvent,
  SettlementOutcome,
  type BasketSourceView,
  type CreateGeneratedListRequest,
  type GeneratedListBasketLineView,
  type GeneratedListIdRequest,
  type GeneratedListLineView,
  type GeneratedListPage,
  type GeneratedListRunResult,
  type GeneratedListSourceInput,
  type GeneratedListView,
  type ListGeneratedListsRequest,
  type ListSharedGeneratedListsRequest,
  type SharedGeneratedListCorePage,
  type SharedGeneratedListCoreView,
  type UpdateGeneratedListRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  BasketSource,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  GeneratedListParticipant,
  LineSettlement,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  announceTripsChanged,
  tripListsOfBasket,
  tripListsOfOwner,
} from '../lists/trips/trips.announce';
import { ProfileService } from '../profiles/profile.service';
import { GeneratedListMembersService } from './generated-list-members.service';
import {
  SHARED_BASKETS_SQL,
  type SharedBasketRow,
} from './generated-list-members.sql';
import { GeneratedListOrderService } from './generated-list-order.service';
import {
  NO_GENERATED_LINE_COUNTS,
  toBasketLineView,
  toBasketSourceView,
  toGeneratedLineView,
  toGeneratedListSummaryView,
  toGeneratedListView,
  type GeneratedListLineCounts,
} from './generated-list.mappers';
import {
  CANDIDATE_LINE_ITEMS_SQL,
  CANDIDATE_LINES_SQL,
  GENERATED_LIST_COUNTS_SQL,
  WRITABLE_LISTS_SQL,
  type CandidateLineRow,
  type GeneratedListCountsRow,
  type WritableListRow,
} from './generated-list.sql';
import { LineClaimService } from './line-claim.service';
import { mergeKey } from './line-dedup';

/** Postgres unique-violation, raised by the partial index on the idempotency key. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * One sentence for every way a basket fails to resolve.
 *
 * A basket that never existed and one belonging to somebody else must be
 * indistinguishable, on the same reasoning plan 0049 gave for a profile:
 * answering "forbidden" for the second would confirm that the id names a real
 * basket, and a basket is private (plan 0050, section 8).
 */
export const NO_SUCH_GENERATED_LIST = 'Generated list not found';

/** How many baskets one page of the history holds. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Generated shopping lists (plan 0050): the basket a person carries around the
 * shop, composed from the wanted, approved lines of the zones and lists they
 * chose, owned by one user and kept as history.
 *
 * ## The two rules the whole feature turns on
 *
 * **It is a snapshot, not a live view** (section 4). Nothing in a basket updates
 * when a zone line changes afterwards. A shopping list that rewrites itself while
 * you are in the shop is hostile, and the zone list stays available for anybody
 * who wants the live truth. The provenance rows carry `lineVersion` so a later
 * read can still tell that an origin has moved.
 *
 * **An edit inside a basket changes the shared zone lists only when the user has
 * said which shared list should receive it** (section 5). That rule lives in
 * {@link GeneratedListLineService}, which owns every write; this service owns the
 * run, the reads and the basket's own fields.
 *
 * ## What this implementation takes from plan 0051 before 0051 is built
 *
 * Plan 0047 landed first and took the trip status off a zone line, so two things
 * plan 0050 wrote could not be built as written. Qualification is `quantity > 0`
 * rather than `status = 'PENDING'`, and generation takes `WRITE` on the source
 * lists rather than mere membership. Both are plan 0051 section 1's table, and
 * the reasoning is in `generated-list.sql.ts` beside the predicates themselves.
 * The share links and participants plan 0051 adds are **not** here: every basket
 * in this plan has exactly one reader.
 *
 * ## What it deliberately does not do
 *
 * **It does not price anything.** Section 4 asks the run to resolve each line's
 * pick to the best priced of its options, falling back to the first option added
 * when none is priced. Core holds no prices, catalog exposes no subject that
 * answers "the cheapest of these products at these scopes", and pricing a basket
 * is backlog 0004, which consumes what this plan produces. So the run takes the
 * fallback the plan itself names, {@link resolvePick}, and the user facing half
 * of the feature, switching the pick to any other option, is built in full.
 */
@Injectable()
export class GeneratedListService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOrigin)
    private readonly origins: Repository<GeneratedListLineOrigin>,
    @InjectRepository(GeneratedListLineOption)
    private readonly options: Repository<GeneratedListLineOption>,
    // Read only here, to answer "what did the last settle on this line say".
    // The writes all belong to `GeneratedListSettleService`.
    @InjectRepository(LineSettlement)
    private readonly settlements: Repository<LineSettlement>,
    private readonly profiles: ProfileService,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher,
    // The order a shopper walks (plan 0110), asked once per run and never
    // afterwards. A service of its own because it is a read of the owner's past
    // trips rather than anything about the lists this run drew from.
    private readonly order: GeneratedListOrderService,
    // The people a basket is shared with on purpose (plan 0114): checked and
    // written by the run, read back by the shared listing, and told of a
    // deletion.
    private readonly members: GeneratedListMembersService,
    // What the run was asked to draw from (plan 0133, section 4), read back on
    // every view of a basket. Last in the list on purpose, so that adding it
    // shifts no existing positional argument in the specs.
    @InjectRepository(BasketSource)
    private readonly sources: Repository<BasketSource>
  ) {}

  /**
   * The query function `trips.announce` reads a basket's origin lists through:
   * the repository's own, as every other raw read in this service goes.
   */
  private readonly tripQuery = (
    sql: string,
    parameters: unknown[]
  ): Promise<unknown> => this.lists.query(sql, parameters);

  // --- The run ---------------------------------------------------------------

  /**
   * Compose a basket (plan 0050, section 4).
   *
   * Idempotent on `idempotencyKey` (plan 0004, section 9), and idempotent the way
   * a person means it: a double tap gets **the basket the first tap made**, not a
   * second basket and not an error. The partial unique index is what enforces it,
   * so two taps racing each other resolve correctly rather than usually.
   *
   * Regeneration produces a **new** basket rather than mutating an old one, which
   * is what makes the history in section 7 an actual history.
   */
  async create(
    req: CreateGeneratedListRequest
  ): Promise<GeneratedListRunResult> {
    if (req.idempotencyKey) {
      const existing = await this.lists.findOne({
        where: { ownerUserId: req.userId, idempotencyKey: req.idempotencyKey },
      });
      if (existing) {
        return { list: await this.viewFor(existing) };
      }
    }

    // Checked before anything is composed (plan 0114, section 4): a basket
    // shared with somebody the owner may not share it with is refused whole,
    // rather than created and then shared with fewer people than asked.
    const members = await this.checkMembers(req);

    const resolved = await this.resolveSources(req);
    const listIds = resolved.sources.map((source) => source.listId);

    const candidates =
      listIds.length === 0
        ? []
        : await this.lists.query<CandidateLineRow[]>(CANDIDATE_LINES_SQL, [
            listIds,
          ]);

    const zoneOf = new Map(
      resolved.sources.map((source) => [source.listId, source.zoneId])
    );
    const itemsByLine = await this.itemsOf(candidates.map((line) => line.id));

    const composed = this.compose(candidates, itemsByLine, zoneOf);
    if (composed.length > GENERATED_LIST_LIMITS.maxLines) {
      throw new ValidationException(
        `a generated list can hold at most ${GENERATED_LIST_LIMITS.maxLines} lines`,
        { messageArgs: { field: 'sources' } }
      );
    }

    // What the request **named**, not the lists it resolved to (plan 0133,
    // section 4.2), so a whole zone stays a whole zone and follows a list added
    // to that zone next month.
    const sources = recordedSources(resolved.named, resolved.sources);

    // The order the owner walks (plan 0110), decided here and written once. The
    // positions below are the index in **this** array, not the order the source
    // lists happened to be read in.
    const walked = await this.order.order(req.userId, composed);
    const invited: GeneratedListParticipant[] = [];
    const saved = await this.write(
      req,
      resolved.pricingProfileId,
      sources,
      walked,
      members,
      invited
    );
    const view = await this.viewFor(saved);
    this.events.emitToUsers(
      RealtimeEvent.GeneratedListCreated,
      [req.userId],
      view
    );
    // After the write commits, so nobody is told of a basket that was not made.
    for (const participant of invited) {
      this.members.announceLive(saved.id, participant);
    }
    // The one zone event a generated list emits (plan 0052, section 3.1), and
    // the declared exception to plan 0050 section 8 rather than a contradiction
    // to be discovered later. Every origin the run took is now claimed, in one
    // event per zone room: two people in one household putting the same milk in
    // two trolleys is the entire reason the indicator exists.
    //
    // Named as the **owner** and never as a participant (section 2): a basket
    // shared with three guests is still one person's trip from the household's
    // point of view.
    this.claims.announce(true, req.userId, await this.claims.refsOf(saved.id));
    // And each list it drew from has a new trip (plan 0122, section 6). Asked of
    // the origins that were written rather than of the sources that were named:
    // a source every line of which another basket already carries contributed
    // nothing, and its list has no new trip to read.
    announceTripsChanged(
      this.events,
      await tripListsOfBasket(this.tripQuery, saved.id)
    );
    return { list: view };
  }

  /**
   * Which lists the run draws from, in the order section 2 states: the request's
   * own sources, else the named profile's, else the caller's default profile's,
   * which default to `ALL`.
   *
   * Every branch ends at the same filter, which is the point: a source is only
   * ever a **narrowing** of the lists the caller may already draw from, so naming
   * a zone somebody was removed from yesterday contributes nothing rather than
   * failing the run. A list that disappears between two runs simply stops
   * contributing, exactly as section 2 says.
   *
   * **Every branch also answers what it was asked for**, beside what that
   * resolved to (plan 0133, section 4.2). The resolved lists compose the basket;
   * the named sources are what `basket_sources` records, and the two differ in
   * exactly the way that matters: a request for a whole zone resolves to that
   * zone's lists today and is recorded as the zone. `null` is `ALL`, which names
   * no source of its own and is recorded as one whole zone row per zone the
   * caller can draw from.
   *
   * **Both branches also answer a pricing profile** (plan 0078, section 3), and
   * it is a second answer rather than the same one because the two questions
   * differ. `profileId` says whose sources were read, so the explicit branch
   * answers null and section 2's order is untouched. `pricingProfileId` says
   * who the run belongs to, and a run that named its own sources still belongs
   * to somebody who shops somewhere. Resolved here, once, rather than on every
   * search inside the finished basket: that is the open question at plan 0055
   * line 217, answered yes by moving the read off the hot path.
   */
  private async resolveSources(req: CreateGeneratedListRequest): Promise<{
    profileId: string | null;
    pricingProfileId: string;
    /** What was asked for, or null for `ALL`. */
    named: GeneratedListSourceInput[] | null;
    /** What that narrowed to, which is what the run composes from. */
    sources: WritableListRow[];
  }> {
    const writable = await this.lists.query<WritableListRow[]>(
      WRITABLE_LISTS_SQL,
      [req.userId]
    );

    if (req.sources && req.sources.length > 0) {
      this.checkSources(req.sources);
      // A named profile is still loaded, and still refused if it is not this
      // caller's, so the run fails before anything is written rather than
      // pricing itself against a stranger's shops.
      const pricingProfileId = await this.profiles.pricingProfileId(
        req.userId,
        req.profileId
      );
      return {
        profileId: null,
        pricingProfileId,
        named: req.sources,
        sources: narrow(writable, req.sources),
      };
    }

    const profile = await this.profiles.resolveGenerationSources({
      userId: req.userId,
      profileId: req.profileId,
    });
    // `ALL` is the default and answers with no sources of its own, which means
    // every list the caller may draw from: the profile narrows, it never widens.
    const sources =
      profile.sources.length === 0
        ? writable
        : narrow(writable, profile.sources);
    // One profile answered both questions here, so the two ids agree.
    return {
      profileId: profile.profileId,
      pricingProfileId: profile.profileId,
      named: profile.sources.length === 0 ? null : profile.sources,
      sources,
    };
  }

  /**
   * The people this run shares its basket with, checked and named (plan 0114,
   * sections 4 and 9).
   *
   * Unique, at most one fewer than the participant limit so the owner keeps a
   * place, and every one a contact of the owner's now. The gateway's DTO refuses
   * the first two already, and they are checked again here because a request
   * that slips past it still meets this.
   */
  private async checkMembers(
    req: CreateGeneratedListRequest
  ): Promise<InvitedMember[]> {
    const ids = req.memberUserIds ?? [];
    if (ids.length === 0) {
      return [];
    }
    if (new Set(ids).size !== ids.length) {
      throw new ValidationException('a person can be named only once', {
        messageArgs: { field: 'memberUserIds' },
      });
    }
    const most = GENERATED_LIST_SHARING_LIMITS.maxParticipants - 1;
    if (ids.length > most) {
      throw new ValidationException(
        `a basket can be shared with at most ${most} people`,
        { messageArgs: { field: 'memberUserIds' } }
      );
    }
    const common = await this.members.requireContacts(
      req.userId,
      ids,
      'memberUserIds'
    );
    return ids.map((userId) => ({
      userId,
      username: this.members.nameFor(
        common.get(userId),
        this.members.globalUsernameOf(req.globalUsernames, userId)
      ),
    }));
  }

  private checkSources(sources: GeneratedListSourceInput[]): void {
    if (sources.length > GENERATED_LIST_LIMITS.maxSources) {
      throw new ValidationException(
        `at most ${GENERATED_LIST_LIMITS.maxSources} sources can be given`,
        { messageArgs: { field: 'sources' } }
      );
    }
  }

  /** Every candidate line's product set, in attachment order, in one query. */
  private async itemsOf(lineIds: string[]): Promise<Map<string, string[]>> {
    const byLine = new Map<string, string[]>();
    if (lineIds.length === 0) {
      return byLine;
    }
    const rows = await this.lists.query<{ lineId: string; itemId: string }[]>(
      CANDIDATE_LINE_ITEMS_SQL,
      [lineIds]
    );
    for (const row of rows) {
      const items = byLine.get(row.lineId);
      if (items) {
        items.push(row.itemId);
        continue;
      }
      byLine.set(row.lineId, [row.itemId]);
    }
    return byLine;
  }

  /**
   * Merge the qualifying lines into basket lines (plan 0050, section 3).
   *
   * Quantities sum and every contributing line gets its provenance row, which is
   * the whole reason the origins table exists: settling has to know how many
   * units each source list was asking for.
   *
   * The options are the **union** of the contributing lines' product sets, in
   * first seen order, because a basket line that merged two zone lines means
   * either household's product and the person at the shelf picks between them.
   */
  private compose(
    lines: CandidateLineRow[],
    itemsByLine: Map<string, string[]>,
    zoneOf: Map<string, string>
  ): ComposedLine[] {
    const byKey = new Map<string, ComposedLine>();
    for (const line of lines) {
      const zoneId = zoneOf.get(line.listId);
      if (!zoneId) {
        // A list the caller may not draw from produced no candidate, so this is
        // unreachable. Skipped rather than asserted: a run that cannot name the
        // zone of an origin must not write a provenance row that lies about it.
        continue;
      }
      const key = mergeKey(line);
      const items = itemsByLine.get(line.id) ?? [];
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.origins.push({
          zoneId,
          listId: line.listId,
          lineId: line.id,
          quantity: line.quantity,
          lineVersion: line.version,
        });
        for (const itemId of items) {
          if (!existing.options.includes(itemId)) {
            existing.options.push(itemId);
          }
        }
        continue;
      }
      byKey.set(key, {
        content: line.content,
        quantity: line.quantity,
        options: [...new Set(items)],
        origins: [
          {
            zoneId,
            listId: line.listId,
            lineId: line.id,
            quantity: line.quantity,
            lineVersion: line.version,
          },
        ],
      });
    }
    return [...byKey.values()];
  }

  /**
   * The product a basket line means to buy today.
   *
   * **The first option added**, which is the fallback plan 0050 section 4 names
   * for a line whose options are not priced. It is the only branch this plan can
   * take: core holds no prices, and the "cheapest of these products at these
   * scopes" read the priced branch needs is not a subject catalog exposes.
   * Pricing a basket is backlog 0004, which consumes what this plan produces, and
   * replacing this one function is the whole of what it has to change here.
   *
   * A free text line has no options and keeps a null pick, which is section 1's
   * rule rather than an accident of the fallback.
   */
  private resolvePick(options: string[]): string | null {
    return options[0] ?? null;
  }

  /**
   * Write the basket, its sources, its lines, their provenance rows, their
   * options and the people it is shared with in one transaction, so a basket
   * never exists without the lines it was composed of, its sources, or shared
   * with fewer people than asked.
   *
   * The rows written for those people are pushed onto `invited`, for the caller
   * to announce once this has committed.
   */
  private async write(
    req: CreateGeneratedListRequest,
    pricingProfileId: string,
    sources: BasketSourceView[],
    composed: ComposedLine[],
    members: InvitedMember[],
    invited: GeneratedListParticipant[]
  ): Promise<GeneratedList> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const listRepo = manager.getRepository(GeneratedList);
        const sourceRepo = manager.getRepository(BasketSource);
        const lineRepo = manager.getRepository(GeneratedListLine);
        const originRepo = manager.getRepository(GeneratedListLineOrigin);
        const optionRepo = manager.getRepository(GeneratedListLineOption);

        const list = await listRepo.save(
          listRepo.create({
            ownerUserId: req.userId,
            // A run composes a trip, always. The permanent basket is not made
            // by anything here (plan 0133, section 2; plan 0136).
            kind: BasketKind.GENERATED,
            name: checkName(req.name),
            status: GeneratedListStatus.OPEN,
            generatedAt: new Date(),
            pricingProfileId,
            defaultTargetListId: req.defaultTargetListId ?? null,
            idempotencyKey: req.idempotencyKey ?? null,
          })
        );

        // Before the lines, so that a basket never has a line whose source is
        // not yet recorded, and inside this transaction so a run that fails
        // leaves neither.
        if (sources.length > 0) {
          await sourceRepo.insert(
            sources.map((source) => ({
              basketId: list.id,
              zoneId: source.zoneId,
              listId: source.listId,
            }))
          );
        }

        for (const [index, entry] of composed.entries()) {
          const line = await lineRepo.save(
            lineRepo.create({
              generatedListId: list.id,
              content: entry.content,
              quantity: entry.quantity,
              settledQuantity: 0,
              itemId: this.resolvePick(entry.options),
              origin: GeneratedLineOrigin.DERIVED,
              targetListId: null,
              position: index + 1,
            })
          );
          await originRepo.insert(
            entry.origins.map((origin) => ({
              generatedListLineId: line.id,
              ...origin,
            }))
          );
          if (entry.options.length > 0) {
            await optionRepo.insert(
              entry.options.map((itemId, position) => ({
                generatedListLineId: line.id,
                itemId,
                position,
              }))
            );
          }
        }

        for (const member of members) {
          const { participant } = await this.members.invite(manager, {
            generatedListId: list.id,
            userId: member.userId,
            invitedByUserId: req.userId,
            username: member.username,
          });
          invited.push(participant);
        }
        return list;
      });
    } catch (error) {
      // Nothing above committed, so nobody was added either.
      invited.length = 0;
      // Two taps raced and the other one won. Its basket is the right answer to
      // both, which is what the key was for.
      if (isUniqueViolation(error) && req.idempotencyKey) {
        const winner = await this.lists.findOne({
          where: {
            ownerUserId: req.userId,
            idempotencyKey: req.idempotencyKey,
          },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  // --- Reading ---------------------------------------------------------------

  /** One basket of the caller's, with its lines. Not found for anybody else's. */
  async get(req: GeneratedListIdRequest): Promise<GeneratedListView> {
    return this.viewFor(await this.load(req.userId, req.generatedListId));
  }

  /**
   * The caller's baskets, newest first, cursor paginated (plan 0050, section 7).
   *
   * `ARCHIVED` is hidden unless asked for, which is what archiving is: hiding a
   * basket from the default listing without deleting it.
   *
   * **Trips only** (plan 0133, section 6). The history lists the baskets somebody
   * made, and the permanent basket was made by nobody: it has no name, no date
   * worth showing and no end, and plan 0136 gives it its own door.
   */
  async listMine(req: ListGeneratedListsRequest): Promise<GeneratedListPage> {
    const limit = clampPageSize(req.limit);
    const qb = this.lists
      .createQueryBuilder('gl')
      .where('gl."ownerUserId" = :userId', { userId: req.userId })
      .andWhere('gl.kind = :generated', { generated: BasketKind.GENERATED })
      .orderBy('gl."generatedAt"', 'DESC')
      .addOrderBy('gl.id', 'DESC')
      .take(limit + 1);

    if (!req.includeArchived) {
      qb.andWhere('gl.status != :archived', {
        archived: GeneratedListStatus.ARCHIVED,
      });
    }
    const cursor = decodeCursor(req.cursor);
    if (cursor) {
      // Keyset rather than an offset, and on the pair rather than the timestamp
      // alone: two baskets generated in the same millisecond would otherwise
      // repeat or skip a row across the page boundary.
      qb.andWhere('(gl."generatedAt", gl.id) < (:generatedAt, :id)', cursor);
    }

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const counts = await this.countsFor(page.map((row) => row.id));
    return {
      items: page.map((row) =>
        toGeneratedListSummaryView(
          row,
          counts.get(row.id) ?? NO_GENERATED_LINE_COUNTS
        )
      ),
      nextCursor:
        rows.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1])
          : null,
    };
  }

  /**
   * The baskets other people shared with the caller, newest share first (plan
   * 0114, section 8).
   *
   * A listing of its own rather than a flag on {@link listMine}, because the two
   * read different rows: that one reads baskets by owner, this one reads the
   * caller's participant rows, and they order by different dates. Each row is
   * the history row, plus who shared it and when.
   *
   * The owner is named here only halfway. Core knows which groups the two people
   * share and the owner's name in them, and no global usernames, so a row whose
   * owner shares exactly one group with the caller is named here and every other
   * row reaches the gateway with a null, for auth to name (section 9).
   */
  async listShared(
    req: ListSharedGeneratedListsRequest
  ): Promise<SharedGeneratedListCorePage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeSharedCursor(req.cursor);
    const rows = await this.lists.query<SharedBasketRow[]>(SHARED_BASKETS_SQL, [
      req.userId,
      cursor,
      limit + 1,
    ]);
    const page = rows.slice(0, limit);
    if (page.length === 0) {
      return { items: [], nextCursor: null };
    }

    const ids = page.map((row) => row.generatedListId);
    const baskets = new Map(
      (await this.lists.find({ where: { id: In(ids) } })).map((row) => [
        row.id,
        row,
      ])
    );
    const counts = await this.countsFor(ids);
    const owners = await this.members.commonGroups(
      req.userId,
      [...baskets.values()].map((row) => row.ownerUserId)
    );

    const items: SharedGeneratedListCoreView[] = [];
    for (const row of page) {
      const basket = baskets.get(row.generatedListId);
      if (!basket) {
        // Deleted between the two reads. The next page is unaffected, because
        // the cursor below names a row of this page rather than of the answer.
        continue;
      }
      const common = owners.get(basket.ownerUserId);
      items.push({
        ...toGeneratedListSummaryView(
          basket,
          counts.get(basket.id) ?? NO_GENERATED_LINE_COUNTS
        ),
        ownerUserId: basket.ownerUserId,
        ownerZoneUsername: common?.groupCount === 1 ? common.username : null,
        sharedAt: new Date(row.sharedAt).toISOString(),
      });
    }
    return {
      items,
      nextCursor:
        rows.length > limit
          ? encodeSharedCursor(page[page.length - 1].generatedListId)
          : null,
    };
  }

  /**
   * The numbers a history row shows, for a whole page, in one query (plan 0053,
   * section 2).
   *
   * A basket whose id is absent from the answer had no lines at all, so the
   * caller defaults it rather than this inserting a zero row per id: `GROUP BY`
   * produces nothing for an empty group, and inventing one here would only move
   * the same default a line earlier.
   */
  private async countsFor(
    listIds: string[]
  ): Promise<Map<string, GeneratedListLineCounts>> {
    const counts = new Map<string, GeneratedListLineCounts>();
    if (listIds.length === 0) {
      return counts;
    }
    const rows = await this.lines.query<GeneratedListCountsRow[]>(
      GENERATED_LIST_COUNTS_SQL,
      [listIds]
    );
    for (const row of rows) {
      counts.set(row.generatedListId, {
        lineCount: row.lineCount,
        settledLineCount: row.settledLineCount,
        boughtLineCount: row.boughtLineCount,
        notAvailableLineCount: row.notAvailableLineCount,
      });
    }
    return counts;
  }

  // --- Writing the basket's own fields ---------------------------------------

  /**
   * Rename a basket, move it between statuses, or change its default target.
   *
   * The permanent basket takes neither of the first two (plan 0133, section 2):
   * it has no name and it never ends. Both are refused here, naming the field, so
   * the caller is told which write was wrong rather than meeting
   * `ck_generated_lists_live_shape` as a database error.
   */
  async update(req: UpdateGeneratedListRequest): Promise<GeneratedListView> {
    const list = await this.load(req.userId, req.generatedListId);
    const live = list.kind === BasketKind.LIVE;
    if (live && req.name !== undefined) {
      throw new ValidationException(
        'The basket that is always there has no name',
        {
          messageArgs: { field: 'name' },
        }
      );
    }
    if (live && req.status !== undefined) {
      throw new ValidationException(
        'The basket that is always there cannot be finished',
        { messageArgs: { field: 'status' } }
      );
    }
    // Open **and** a trip, in both directions (plan 0133, section 6), so the
    // permanent basket never announces a claim and never releases one.
    const wasLive = isTripInProgress(list);
    const before = { name: list.name, status: list.status };
    if (req.name !== undefined) {
      list.name = checkName(req.name);
    }
    if (req.status !== undefined) {
      list.status = req.status;
    }
    if (req.defaultTargetListId !== undefined) {
      list.defaultTargetListId = req.defaultTargetListId;
    }
    const saved = await this.lists.save(list);
    const view = await this.viewFor(saved);
    this.events.emitToUsers(
      RealtimeEvent.GeneratedListUpdated,
      [req.userId],
      view
    );

    // A basket leaving the live statuses unclaims every line it still holds
    // (plan 0052, section 3.2): the trip is over, or it has been put away, and
    // the household should stop being told somebody is out buying the bread.
    // The other direction is announced too, because a basket put back into
    // `DRAFT` claims its lines again and the read would say so on the next cold
    // load; an event that only ever released would leave a live socket showing
    // less than a refresh.
    const isLive = isTripInProgress(saved);
    if (wasLive && !isLive) {
      await this.claims.announceReleased(await this.claims.refsOf(saved.id));
    } else if (!wasLive && isLive) {
      this.claims.announce(
        true,
        saved.ownerUserId,
        await this.claims.refsOf(saved.id)
      );
    }

    // A trip's head is the basket's name and whether it is live, so either one
    // moving is a reason to read the trips again (plan 0122, section 6). The
    // sweep finishes a basket through this method, so it is covered here too.
    // A change of the default target list is neither, and says nothing.
    if (saved.name !== before.name || saved.status !== before.status) {
      announceTripsChanged(
        this.events,
        await tripListsOfBasket(this.tripQuery, saved.id)
      );
    }
    return view;
  }

  /**
   * Delete a basket.
   *
   * A real delete of the generated rows alone, and it **never touches a zone
   * list** (plan 0050, section 7). The lines are copies rather than references,
   * so nothing a household depends on goes with it.
   */
  async delete(req: GeneratedListIdRequest): Promise<{ id: string }> {
    const list = await this.load(req.userId, req.generatedListId);
    if (list.kind === BasketKind.LIVE) {
      // One per person, and it is the door onto their lists (plan 0136), so
      // deleting it would take a screen away rather than a trip.
      throw new ConflictException(
        'The basket that is always there cannot be deleted'
      );
    }
    // **Before** the delete, because the provenance rows go with it and there
    // would be nothing left to ask afterwards (plan 0052, section 3.2). The
    // announcement is still made after the write, so a client is never told a
    // line is free while the basket holding it is still there.
    const refs = isOpenBasket(list.status)
      ? await this.claims.refsOf(list.id)
      : [];
    // Before the delete too, for the same reason: the participant rows go with
    // the basket (plan 0114, section 10).
    const shared = await this.members.liveRegistered(list.id);
    // And before the delete once more (plan 0122, section 6): which lists lose a
    // basket trip is written in the origins, and they cascade away with it.
    const tripLists = await tripListsOfBasket(this.tripQuery, list.id);
    await this.lists.delete({ id: list.id });
    // The owner's own sessions, as before, and since plan 0114 the basket's room
    // as well: a deleted basket used to tell nobody on it, and the room is the
    // one address that reaches a guest. It is also the basket realtime sweeps
    // both basket rooms by.
    this.events.emitTo(
      RealtimeEvent.GeneratedListDeleted,
      { userIds: [req.userId], generatedListId: list.id },
      { id: list.id }
    );
    for (const participant of shared) {
      if (participant.userId) {
        this.members.announceUnshared(list.id, participant.userId);
      }
    }
    await this.claims.announceReleased(refs);
    // The basket trip is gone, and whatever it bought now reads as loose trips.
    announceTripsChanged(this.events, tripLists);
    return { id: list.id };
  }

  /**
   * Every basket of a deleted account, and everything hanging off it (plan 0011,
   * section 5).
   *
   * A basket is private to one user, so there is nobody to hand it to and nothing
   * to anonymize: it goes. The settlements it wrote are **zone facts** and stay,
   * which is plan 0047 section 3.1's distinction between the basket and the
   * purchase.
   */
  async deleteForUser(userId: string): Promise<number> {
    // Before the delete, as `delete` reads them (plan 0122, section 6): every
    // list one of these baskets drew from loses a basket trip.
    const tripLists = await tripListsOfOwner(this.tripQuery, userId);
    const result = await this.lists.delete({ ownerUserId: userId });
    announceTripsChanged(this.events, tripLists);
    return result.affected ?? 0;
  }

  // --- Shared helpers --------------------------------------------------------

  /** One basket of this caller's, or not found. Never forbidden (section 8). */
  async load(userId: string, generatedListId: string): Promise<GeneratedList> {
    const row = await this.lists.findOne({
      where: { id: generatedListId, ownerUserId: userId },
    });
    if (!row) {
      throw new NotFoundException(NO_SUCH_GENERATED_LIST);
    }
    return row;
  }

  /** A basket and its lines, with every child read in one query each. */
  async viewFor(list: GeneratedList): Promise<GeneratedListView> {
    return toGeneratedListView(
      list,
      await this.lineViewsFor(list.id),
      await this.sourcesOf(list.id)
    );
  }

  /**
   * What this basket was asked to draw from, in the order it was written
   * (plan 0133, section 4).
   *
   * Public, because `GeneratedListBasketService` answers the same field on the
   * shared basket view and a second read of the same rows would be a second
   * chance to order them differently.
   *
   * A `LIVE` basket has no rows, and the empty array is the right answer for it:
   * its coverage is a rule rather than a list of sources.
   */
  async sourcesOf(generatedListId: string): Promise<BasketSourceView[]> {
    const rows = await this.sources.find({
      where: { basketId: generatedListId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map(toBasketSourceView);
  }

  /** Every line of a basket, with its origins and options attached. */
  async lineViewsFor(
    generatedListId: string
  ): Promise<GeneratedListLineView[]> {
    const lines = await this.lines.find({
      where: { generatedListId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    if (lines.length === 0) {
      return [];
    }
    const lineIds = lines.map((line) => line.id);
    const [origins, options, facts] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: In(lineIds) },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: In(lineIds) },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.settlementFacts(lineIds),
    ]);
    return lines.map((line) =>
      toGeneratedLineView(line, {
        origins: origins.filter((row) => row.generatedListLineId === line.id),
        options: options.filter((row) => row.generatedListLineId === line.id),
        settledPerOrigin:
          facts.get(line.id)?.settledPerOrigin ?? NO_SETTLED_ORIGINS,
      })
    );
  }

  /** One line's view, for the endpoints that answer with a single line. */
  async lineViewFor(line: GeneratedListLine): Promise<GeneratedListLineView> {
    const [origins, options, facts] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: line.id },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: line.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.settlementFacts([line.id]),
    ]);
    return toGeneratedLineView(line, {
      origins,
      options,
      settledPerOrigin:
        facts.get(line.id)?.settledPerOrigin ?? NO_SETTLED_ORIGINS,
    });
  }

  /**
   * Every line of a basket, projected for the participant reading it (plan 0051,
   * section 5).
   *
   * The same two queries as {@link lineViewsFor}; only the projection differs, so
   * a redacted read costs a privileged one's work and hands back less.
   */
  async basketLineViewsFor(
    generatedListId: string,
    seesZoneData: boolean
  ): Promise<GeneratedListBasketLineView[]> {
    const lines = await this.lines.find({
      where: { generatedListId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    if (lines.length === 0) {
      return [];
    }
    const lineIds = lines.map((line) => line.id);
    const [origins, options, facts] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: In(lineIds) },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: In(lineIds) },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.settlementFacts(lineIds),
    ]);
    return lines.map((line) =>
      toBasketLineView(
        line,
        {
          origins: origins.filter((row) => row.generatedListLineId === line.id),
          options: options.filter((row) => row.generatedListLineId === line.id),
          ...(facts.get(line.id) ?? {}),
        },
        seesZoneData
      )
    );
  }

  /** One line, projected, for the routes that answer with a single line. */
  async basketLineViewFor(
    line: GeneratedListLine,
    seesZoneData: boolean
  ): Promise<GeneratedListBasketLineView> {
    const [origins, options, facts] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: line.id },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: line.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.settlementFacts([line.id]),
    ]);
    return toBasketLineView(
      line,
      { origins, options, ...(facts.get(line.id) ?? {}) },
      seesZoneData
    );
  }

  /**
   * The two things a basket line's own settlements say about it: what the newest
   * settle said, and how many units are still waiting for a list.
   *
   * **Neither is derivable from the line itself**, which is why this query
   * exists. `NOT_AVAILABLE` closes the outstanding amount exactly as a purchase
   * does, so a screen reading `settledQuantity` alone would caption a shop that
   * had none as somebody who bought it (velista `0044`, section 4.2). And a
   * waiting purchase (plan 0093, section 2) has advanced `settledQuantity`
   * without landing on any list, so nothing on the line says how much a list is
   * about to receive.
   *
   * One query for the whole basket rather than one per line and per fact,
   * ordered oldest first so the last write into the map wins. A settle writes one
   * row per origin it touched, all with the same outcome, so reading the newest
   * answers "what did the last act on this line say" whichever of its rows comes
   * last.
   */
  private async settlementFacts(
    lineIds: string[]
  ): Promise<Map<string, BasketLineSettlementFacts>> {
    const facts = new Map<string, BasketLineSettlementFacts>();
    if (lineIds.length === 0) {
      return facts;
    }
    const rows = await this.settlements.find({
      // A settlement somebody took back says nothing about the line any more
      // (plan 0054, section 3.3). Without this a reopened line would keep the
      // caption of the settle that was undone, which is the one field on the row
      // that cannot be derived from the numbers, and would count units a reopen
      // has already given back.
      where: { generatedListLineId: In(lineIds), revertedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
      // No `select` projection: TypeORM's typed form rejects a partial entity
      // here, and the rows are small and bounded by one basket's settlements.
    });

    for (const row of rows) {
      if (row.generatedListLineId === null) {
        continue;
      }
      const known = facts.get(row.generatedListLineId) ?? {
        lastOutcome: null,
        waitingSettled: 0,
        settledPerOrigin: new Map<string, number>(),
      };
      known.lastOutcome = row.outcome;
      if (row.outcome === SettlementOutcome.BOUGHT) {
        if (row.lineId === null) {
          // Bought, and still belonging to no list (plan 0093, section 4). A
          // `NOT_AVAILABLE` waiting row is not counted, because it moved no
          // units: it is an outcome rather than a quantity.
          known.waitingSettled += row.quantity;
        } else {
          // What this origin got (plan 0109, section 4). Keyed on the zone line
          // the purchase landed on, which is what an origin row is unique on,
          // and counted for `BOUGHT` alone: a shop that had none closes the
          // outstanding amount without buying anything, so it cannot raise what
          // a household can be said to have received.
          known.settledPerOrigin.set(
            row.lineId,
            (known.settledPerOrigin.get(row.lineId) ?? 0) + row.quantity
          );
        }
      }
      facts.set(row.generatedListLineId, known);
    }
    return facts;
  }
}

/** What a basket line's own settlements say about it, for its view. */
interface BasketLineSettlementFacts {
  lastOutcome: SettlementOutcome | null;
  waitingSettled: number;
  /**
   * How many units each of the line's origins got, keyed on its zone line (plan
   * 0109, section 4).
   *
   * Read off the rows this query already loads rather than by a second, grouped
   * one: the basket's live settlements are all here, and asking the database
   * twice for two sums over one set of rows would be a second definition of
   * "reverted" free to drift from the first.
   */
  settledPerOrigin: Map<string, number>;
}

/** A line nobody has settled: no last outcome, and nothing against any origin. */
const NO_SETTLED_ORIGINS: ReadonlyMap<string, number> = new Map<
  string,
  number
>();

/** One person a run shares its basket with, and the name their row carries. */
interface InvitedMember {
  userId: string;
  username: string | null;
}

/** A basket line as the run composed it, before it is written. */
interface ComposedLine {
  content: string;
  quantity: number;
  options: string[];
  origins: {
    zoneId: string;
    listId: string;
    lineId: string;
    quantity: number;
    lineVersion: number;
  }[];
}

/**
 * The writable lists a set of sources actually names.
 *
 * A source naming a zone with no list means **every list in that zone the caller
 * may draw from**, which is plan 0051 section 2's wording of the rule plan 0050
 * section 2 stated for readable lists. A source naming a list the caller may not
 * draw from contributes nothing, silently, because that is the same thing as the
 * list having been taken away between two runs.
 */
function narrow(
  writable: WritableListRow[],
  sources: { zoneId: string; listId?: string | null }[]
): WritableListRow[] {
  const wholeZones = new Set(
    sources.filter((source) => !source.listId).map((source) => source.zoneId)
  );
  const namedLists = new Set(
    sources
      .filter((source) => source.listId)
      .map((source) => `${source.zoneId}:${source.listId}`)
  );
  return writable.filter(
    (row) =>
      wholeZones.has(row.zoneId) ||
      namedLists.has(`${row.zoneId}:${row.listId}`)
  );
}

/**
 * Whether this basket is a trip somebody is still shopping (plan 0133, section
 * 6), which is the only kind of basket that claims a household's lines.
 *
 * Open **and** a trip. `isOpenBasket` alone would say yes to the permanent
 * basket, which is always open and claims nothing, and the claim announcements
 * either side of a status change would then fire for a basket that never
 * changes status. It is the TypeScript half of `OPEN_GENERATED_BASKET`.
 */
function isTripInProgress(
  basket: Pick<GeneratedList, 'kind' | 'status'>
): boolean {
  return basket.kind === BasketKind.GENERATED && isOpenBasket(basket.status);
}

/**
 * The source rows a run records, from what it was **named** and what that
 * narrowed to (plan 0133, section 4.2).
 *
 * `named` is null for `ALL`, which names no source of its own: it is recorded as
 * one whole zone row per zone the caller can draw from now, so the basket is a
 * chosen set of zones rather than a standing "everything". The basket that
 * follows everything is the `LIVE` one.
 *
 * Two rules the table cannot hold are held here:
 *
 * - **A source that narrows to nothing writes no row.** Plan 0050 section 2's
 *   rule kept: a source is only ever a narrowing, and one that names nothing is
 *   silently nothing.
 * - **A whole zone row wins over a list row of that same zone.** Both would
 *   describe the same coverage, and the pair would make `listsOf` ask two
 *   questions where one answers.
 */
function recordedSources(
  named: GeneratedListSourceInput[] | null,
  resolved: readonly WritableListRow[]
): BasketSourceView[] {
  const zones = new Set(resolved.map((row) => row.zoneId));
  if (named === null) {
    return [...zones].map((zoneId) => ({ zoneId, listId: null }));
  }

  const wholeZones = new Set(
    named
      .filter((source) => !source.listId && zones.has(source.zoneId))
      .map((source) => source.zoneId)
  );
  const rows: BasketSourceView[] = [...wholeZones].map((zoneId) => ({
    zoneId,
    listId: null,
  }));

  const lists = new Set(resolved.map((row) => `${row.zoneId}:${row.listId}`));
  const written = new Set<string>();
  for (const source of named) {
    if (!source.listId || wholeZones.has(source.zoneId)) {
      continue;
    }
    const key = `${source.zoneId}:${source.listId}`;
    if (!lists.has(key) || written.has(key)) {
      continue;
    }
    written.add(key);
    rows.push({ zoneId: source.zoneId, listId: source.listId });
  }
  return rows;
}

/** Trimmed, capped, and an empty name is no name rather than an empty one. */
function checkName(name: string | null | undefined): string | null {
  if (name === undefined || name === null) {
    return null;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > GENERATED_LIST_LIMITS.nameMaxLength) {
    throw new ValidationException(
      `a name can be at most ${GENERATED_LIST_LIMITS.nameMaxLength} characters`,
      { messageArgs: { field: 'name' } }
    );
  }
  return trimmed;
}

function clampPageSize(limit: number | undefined): number {
  if (!limit || limit < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * The keyset cursor, over the pair the listing orders by.
 *
 * Base64 of a JSON pair rather than the timestamp alone, for the reason the
 * ordering states: two baskets generated in the same millisecond would repeat or
 * skip a row across the page boundary if the id were not part of the key.
 */
function encodeCursor(row: GeneratedList): string {
  return Buffer.from(
    JSON.stringify({ generatedAt: row.generatedAt.toISOString(), id: row.id })
  ).toString('base64url');
}

function decodeCursor(
  cursor: string | undefined
): { generatedAt: string; id: string } | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    );
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { generatedAt?: unknown }).generatedAt === 'string' &&
      typeof (parsed as { id?: unknown }).id === 'string'
    ) {
      return parsed as { generatedAt: string; id: string };
    }
  } catch {
    // A cursor is an opaque token the server minted. One that does not decode
    // was not minted here, so it is refused rather than guessed at.
  }
  throw new ValidationException('invalid cursor', {
    messageArgs: { field: 'cursor' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shared listing's cursor: the basket of the last row on the page, and
 * nothing else (plan 0114, section 8).
 *
 * Unlike {@link encodeCursor} it carries no timestamp, for the reason
 * `SHARED_BASKETS_SQL` gives: Postgres reads the row's own key back at full
 * precision, where a millisecond `Date` would repeat the boundary row.
 */
function encodeSharedCursor(generatedListId: string): string {
  return Buffer.from(JSON.stringify({ id: generatedListId })).toString(
    'base64url'
  );
}

/**
 * The basket a shared listing cursor names, or null for the first page.
 *
 * Refused unless it names a uuid, because the id reaches Postgres as a `uuid`
 * parameter and anything else would fail there as a server error.
 */
function decodeSharedCursor(cursor: string | undefined): string | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    );
    const id =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { id?: unknown }).id
        : undefined;
    if (typeof id === 'string' && UUID.test(id)) {
      return id;
    }
  } catch {
    // Not a cursor this server minted, refused below.
  }
  throw new ValidationException('invalid cursor', {
    messageArgs: { field: 'cursor' },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code ===
      PG_UNIQUE_VIOLATION
  );
}
