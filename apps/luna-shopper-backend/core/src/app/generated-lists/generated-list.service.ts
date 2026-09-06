import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_LIMITS,
  GeneratedLineOrigin,
  GeneratedListStatus,
  isLiveGeneratedList,
  LIVE_GENERATED_LIST_STATUSES,
  RealtimeEvent,
  SettlementOutcome,
  type CreateGeneratedListRequest,
  type GeneratedListBasketLineView,
  type GeneratedListIdRequest,
  type GeneratedListLineView,
  type GeneratedListPage,
  type GeneratedListRunResult,
  type GeneratedListSkippedLineView,
  type GeneratedListSourceInput,
  type GeneratedListSourceSnapshot,
  type GeneratedListView,
  type ListGeneratedListsRequest,
  type UpdateGeneratedListRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  LineSettlement,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ProfileService } from '../profiles/profile.service';
import {
  NO_GENERATED_LINE_COUNTS,
  toBasketLineView,
  toGeneratedLineView,
  toGeneratedListSummaryView,
  toGeneratedListView,
  type GeneratedListLineCounts,
} from './generated-list.mappers';
import {
  CANDIDATE_LINE_ITEMS_SQL,
  CANDIDATE_LINES_SQL,
  GENERATED_LIST_COUNTS_SQL,
  LIVE_OVERLAP_SQL,
  WRITABLE_LISTS_SQL,
  type CandidateLineRow,
  type GeneratedListCountsRow,
  type LiveOverlapRow,
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
    private readonly events: CoreEventsPublisher
  ) {}

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
        return { list: await this.viewFor(existing), skipped: [] };
      }
    }

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
    const { kept, skipped } = await this.dropOverlaps(
      req.userId,
      candidates,
      zoneOf
    );
    const itemsByLine = await this.itemsOf(kept.map((line) => line.id));

    const composed = this.compose(kept, itemsByLine, zoneOf);
    if (composed.length > GENERATED_LIST_LIMITS.maxLines) {
      throw new ValidationException(
        `a generated list can hold at most ${GENERATED_LIST_LIMITS.maxLines} lines`,
        { messageArgs: { field: 'sources' } }
      );
    }

    const snapshot: GeneratedListSourceSnapshot = {
      profileId: resolved.profileId,
      pricingProfileId: resolved.pricingProfileId,
      sources: resolved.sources.map((source) => ({
        zoneId: source.zoneId,
        listId: source.listId,
      })),
    };

    const saved = await this.write(req, snapshot, composed);
    const view = await this.viewFor(saved);
    this.events.emitToUsers(
      RealtimeEvent.GeneratedListCreated,
      [req.userId],
      view
    );
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
    return { list: view, skipped };
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
      sources,
    };
  }

  private checkSources(sources: GeneratedListSourceInput[]): void {
    if (sources.length > GENERATED_LIST_LIMITS.maxSources) {
      throw new ValidationException(
        `at most ${GENERATED_LIST_LIMITS.maxSources} sources can be given`,
        { messageArgs: { field: 'sources' } }
      );
    }
  }

  /**
   * Drop the candidates a live basket of this user is already carrying, and say
   * which ones and where they went (plan 0050, section 3).
   */
  private async dropOverlaps(
    userId: string,
    candidates: CandidateLineRow[],
    zoneOf: Map<string, string>
  ): Promise<{
    kept: CandidateLineRow[];
    skipped: GeneratedListSkippedLineView[];
  }> {
    if (candidates.length === 0) {
      return { kept: [], skipped: [] };
    }
    const rows = await this.lists.query<LiveOverlapRow[]>(LIVE_OVERLAP_SQL, [
      userId,
      candidates.map((line) => line.id),
      LIVE_GENERATED_LIST_STATUSES,
      // No basket to exclude: this run is composing the one that would hold
      // these lines, and it does not exist yet.
      null,
    ]);
    if (rows.length === 0) {
      return { kept: candidates, skipped: [] };
    }

    const carriedBy = new Map(
      rows.map((row) => [row.lineId, row.generatedListId])
    );
    const kept: CandidateLineRow[] = [];
    const skipped: GeneratedListSkippedLineView[] = [];
    for (const line of candidates) {
      const carrier = carriedBy.get(line.id);
      if (carrier) {
        skipped.push({
          // The report names the zone as well as the list, because "your milk is
          // in another basket" is only actionable if the person can tell which
          // household's milk it was.
          zoneId: zoneOf.get(line.listId) ?? '',
          listId: line.listId,
          lineId: line.id,
          content: line.content,
          carriedByGeneratedListId: carrier,
        });
        continue;
      }
      kept.push(line);
    }
    return { kept, skipped };
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
   * Write the basket, its lines, their provenance rows and their options in one
   * transaction, so a basket never exists without the lines it was composed of.
   */
  private async write(
    req: CreateGeneratedListRequest,
    sourceSnapshot: GeneratedListSourceSnapshot,
    composed: ComposedLine[]
  ): Promise<GeneratedList> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const listRepo = manager.getRepository(GeneratedList);
        const lineRepo = manager.getRepository(GeneratedListLine);
        const originRepo = manager.getRepository(GeneratedListLineOrigin);
        const optionRepo = manager.getRepository(GeneratedListLineOption);

        const list = await listRepo.save(
          listRepo.create({
            ownerUserId: req.userId,
            name: checkName(req.name),
            status: GeneratedListStatus.DRAFT,
            generatedAt: new Date(),
            sourceSnapshot,
            defaultTargetListId: req.defaultTargetListId ?? null,
            idempotencyKey: req.idempotencyKey ?? null,
          })
        );

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
        return list;
      });
    } catch (error) {
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
   */
  async listMine(req: ListGeneratedListsRequest): Promise<GeneratedListPage> {
    const limit = clampPageSize(req.limit);
    const qb = this.lists
      .createQueryBuilder('gl')
      .where('gl."ownerUserId" = :userId', { userId: req.userId })
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

  /** Rename a basket, move it between statuses, or change its default target. */
  async update(req: UpdateGeneratedListRequest): Promise<GeneratedListView> {
    const list = await this.load(req.userId, req.generatedListId);
    const wasLive = isLiveGeneratedList(list.status);
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
    const isLive = isLiveGeneratedList(saved.status);
    if (wasLive && !isLive) {
      await this.claims.announceReleased(await this.claims.refsOf(saved.id));
    } else if (!wasLive && isLive) {
      this.claims.announce(
        true,
        saved.ownerUserId,
        await this.claims.refsOf(saved.id)
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
    // **Before** the delete, because the provenance rows go with it and there
    // would be nothing left to ask afterwards (plan 0052, section 3.2). The
    // announcement is still made after the write, so a client is never told a
    // line is free while the basket holding it is still there.
    const refs = isLiveGeneratedList(list.status)
      ? await this.claims.refsOf(list.id)
      : [];
    await this.lists.delete({ id: list.id });
    this.events.emitToUsers(RealtimeEvent.GeneratedListDeleted, [req.userId], {
      id: list.id,
    });
    await this.claims.announceReleased(refs);
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
    const result = await this.lists.delete({ ownerUserId: userId });
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
    return toGeneratedListView(list, await this.lineViewsFor(list.id));
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
    const [origins, options] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: In(lineIds) },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: In(lineIds) },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    return lines.map((line) =>
      toGeneratedLineView(line, {
        origins: origins.filter((row) => row.generatedListLineId === line.id),
        options: options.filter((row) => row.generatedListLineId === line.id),
      })
    );
  }

  /** One line's view, for the endpoints that answer with a single line. */
  async lineViewFor(line: GeneratedListLine): Promise<GeneratedListLineView> {
    const [origins, options] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: line.id },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: line.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    return toGeneratedLineView(line, { origins, options });
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
    const [origins, options, outcomes] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: In(lineIds) },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: In(lineIds) },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.lastOutcomes(lineIds),
    ]);
    return lines.map((line) =>
      toBasketLineView(
        line,
        {
          origins: origins.filter((row) => row.generatedListLineId === line.id),
          options: options.filter((row) => row.generatedListLineId === line.id),
          lastOutcome: outcomes.get(line.id) ?? null,
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
    const [origins, options, outcomes] = await Promise.all([
      this.origins.find({
        where: { generatedListLineId: line.id },
        order: { createdAt: 'ASC' },
      }),
      this.options.find({
        where: { generatedListLineId: line.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.lastOutcomes([line.id]),
    ]);
    return toBasketLineView(
      line,
      { origins, options, lastOutcome: outcomes.get(line.id) ?? null },
      seesZoneData
    );
  }

  /**
   * What the newest settle on each of these basket lines said.
   *
   * **Not derivable from the line itself**, which is the whole reason this query
   * exists: `NOT_AVAILABLE` closes the outstanding amount exactly as a purchase
   * does, so a screen reading `settledQuantity` alone would caption a shop that
   * had none as somebody who bought it (velista `0044`, section 4.2).
   *
   * One query for the whole basket rather than one per line, ordered oldest
   * first so the last write into the map wins. A settle writes one row per origin
   * it touched, all with the same outcome, so reading the newest by `createdAt`
   * answers "what did the last act on this line say" whichever of its rows comes
   * last.
   */
  private async lastOutcomes(
    lineIds: string[]
  ): Promise<Map<string, SettlementOutcome>> {
    if (lineIds.length === 0) {
      return new Map();
    }
    const rows = await this.settlements.find({
      // A settlement somebody took back says nothing about the line any more
      // (plan 0054, section 3.3). Without this a reopened line would keep the
      // caption of the settle that was undone, which is the one field on the row
      // that cannot be derived from the numbers.
      where: { generatedListLineId: In(lineIds), revertedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
      // No `select` projection: TypeORM's typed form rejects a partial entity
      // here, and the rows are small and bounded by one basket's settlements.
    });

    const newest = new Map<string, SettlementOutcome>();
    for (const row of rows) {
      if (row.generatedListLineId !== null) {
        newest.set(row.generatedListLineId, row.outcome);
      }
    }
    return newest;
  }
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

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code ===
      PG_UNIQUE_VIOLATION
  );
}
