import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GeneratedLineOrigin,
  ParticipantKind,
  RealtimeEvent,
  isLiveGeneratedList,
  type AddGeneratedListParticipantLineRequest,
  type GeneratedListBasketLineView,
  type GeneratedListBasketScope,
  type GeneratedListBasketView,
  type GeneratedListLineAddedEvent,
  type GeneratedListLineMovedEvent,
  type GeneratedListSourceName,
  type GetGeneratedListBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  GeneratedListFinishedException,
  NotFoundException,
  UnauthorizedException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListParticipant,
  ShoppingList,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  checkContent,
  checkOptions,
  checkQuantity,
  checkRoom,
  nextPosition,
} from './basket-line-limits';
import { findMergeTarget } from './basket-merge';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { toBasketView } from './generated-list.mappers';
import { GeneratedListService } from './generated-list.service';
import { namesOfLists } from './list-names';

/**
 * The basket as the person holding it reads it, and the one edit any of them may
 * make (plan 0051, sections 5 and 6.1; velista `0044`, section 4).
 *
 * ## Why this is not on `GeneratedListService`
 *
 * That service answers the **owner**. Every read on it resolves a basket by
 * `ownerUserId`, which is right for the history and cannot answer a guest at all.
 * This one resolves nothing by user: the gateway's `ParticipantGuard` has already
 * turned a credential into a participant, and the participant is the whole of the
 * identity here. An owner reading their own basket arrives as their own
 * participant row like everybody else, which is what lets one screen serve all
 * three readers.
 *
 * ## The one rule everything here implements
 *
 * Section 5.2 redacts **by absence**. A reader who does not hold `WRITE` on every
 * source list of the run does not receive `origins`, `targetListId`, `origin` or
 * the source snapshot at all, rather than receiving them empty or nulled. The
 * decision is taken once, here, from `seesZoneData` evaluated at request time,
 * and is carried into the mappers; nothing downstream is trusted to hide a field
 * it was handed.
 */
@Injectable()
export class GeneratedListBasketService {
  constructor(
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOption)
    private readonly options: Repository<GeneratedListLineOption>,
    // Read only, and only to name a source list for a reader who passes the
    // rule. Nothing here writes a zone list; that is the settle service's job
    // and it goes through the owner's access.
    @InjectRepository(ShoppingList)
    private readonly shoppingLists: Repository<ShoppingList>,
    private readonly generated: GeneratedListService,
    private readonly sharing: GeneratedListSharingService,
    // For the owner's default target alone (plan 0055, section 3.2). The write
    // back belongs to the service that owns plan 0050 section 5's rule, and
    // reimplementing it here would drift from it the first time it changed.
    private readonly lineWrites: GeneratedListLineService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * The basket, its lines and everybody on it, in one read.
   *
   * One shape rather than three requests because the screen cannot draw a single
   * row without all of it: a line's attribution is a participant id, so the
   * people are this screen's vocabulary rather than a second screen's data.
   */
  async getBasket(
    req: GetGeneratedListBasketRequest
  ): Promise<GeneratedListBasketView> {
    const { list, seesZoneData } = await this.resolve(req);

    const [lines, people, sourceNames] = await Promise.all([
      this.generated.basketLineViewsFor(list.id, seesZoneData),
      this.sharing.listParticipants({
        generatedListId: list.id,
        asParticipantId: req.participantId,
      }),
      // Only asked for when it may be answered. A reader who does not pass the
      // rule costs no query here rather than costing one and having the result
      // thrown away, which is the difference between a rule and a filter.
      seesZoneData ? this.sourceNames(list) : Promise.resolve([]),
    ]);

    const me = people.participants.find((row) => row.id === req.participantId);
    if (!me) {
      // The guard resolved them a moment ago, so this is a revocation that
      // landed in between rather than a caller who was never here.
      throw new UnauthorizedException('Not a participant of this basket');
    }

    return toBasketView(
      list,
      lines,
      { participants: people.participants, me },
      seesZoneData,
      sourceNames
    );
  }

  /**
   * The names behind the (zone, list) pairs the run drew from.
   *
   * So a row can say "from Weekly shop" rather than "from 0f3a…". Read from the
   * snapshot rather than from the lines' origins, because the snapshot is what
   * the run actually drew from and is the thing a three week old basket can
   * still be explained by (plan 0050, section 4).
   *
   * A list that has since been deleted simply drops out: a basket outlives the
   * lists it came from, and a caption naming fewer households is a better answer
   * than an error or a raw id.
   */
  private async sourceNames(
    list: GeneratedList
  ): Promise<GeneratedListSourceName[]> {
    const named = await namesOfLists(
      this.shoppingLists,
      list.sourceSnapshot.sources.map((source) => source.listId)
    );
    // A list that has since been deleted is absent from the map and therefore
    // from the captions, which is the intended answer: naming fewer households
    // is better than an error or a raw id.
    return [...named.values()];
  }

  /**
   * Put a line in the basket, as any live participant (plan 0055, section 3).
   *
   * The gesture the basket could not make: every write on this surface until now
   * settled a line that was already there or swapped its product, and creating
   * one was on the owner's account surface, resolved by `ownerUserId`, which
   * cannot answer a guest at all. A guest in an aisle who remembers the milk is
   * exactly the reader the shared basket exists for.
   *
   * ## What makes it safe to hand to a stranger
   *
   * The line is created `ADDED` with `targetListId` null, so it lives in the
   * basket and nowhere else: it names no zone, claims no zone line, and emits no
   * zone event. The rule plan 0050 section 5 protects is that a basket never
   * changes a shared list unless somebody says which one, and a line with no
   * target changes nothing shared. The disclosure runs the other way too, which
   * is the half worth stating: a guest typing "batteries" tells the basket
   * nothing about any household, and the line they created carries no list name
   * for anybody to read.
   *
   * ## The basket's default target is the owner's, and only the owner's
   *
   * `defaultTargetListId` is the owner saying "everything I add today also goes
   * in the flat list", and it is their standing intent about **their own**
   * additions. A guest's line silently promoted into a household list would be a
   * zone write the guest cannot see, cannot explain and did not ask for, made
   * under the owner's access: precisely the accident plan 0050 section 5 exists
   * to prevent, arriving through the back door. A registered participant is in
   * the same position, and the honest way for their line to reach a list is plan
   * `0058`, which is a gesture with a list picker in front of it.
   */
  async addLine(
    req: AddGeneratedListParticipantLineRequest
  ): Promise<GeneratedListBasketLineView> {
    const { list, participant, seesZoneData } = await this.resolve(req);

    if (!isLiveGeneratedList(list.status)) {
      // Its own code rather than a validation failure (section 3.3): a client
      // that cannot tell a state it can explain from a bug it cannot will show
      // the wrong sentence for both, and "this basket is finished" is a sentence
      // the shopper can act on.
      throw new GeneratedListFinishedException(
        'This basket is finished, so nothing more can be added to it'
      );
    }

    const content = checkContent(req.content);
    const quantity = checkQuantity(req.quantity ?? 1);
    const optionIds = checkOptions(req.options);

    // Plan 0094, section 5: a typed "Milk" lands on the Milk that is already
    // there. The basket cannot merge by name alone, because siblings share a
    // name on purpose, so the rule is the name **and** the product, with a
    // product free row as the fallback so nothing chooses a milk the shopper did
    // not.
    const existing = findMergeTarget(
      await this.lines.find({
        where: { generatedListId: list.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      { content, itemId: req.itemId ?? null }
    );
    if (existing) {
      return this.raise(list, existing, {
        participant,
        quantity,
        itemId: req.itemId ?? null,
        optionIds,
        seesZoneData,
      });
    }

    await checkRoom(this.lines, list.id);

    const position = await nextPosition(this.lines, list.id);
    const line = await this.lines.save(
      this.lines.create({
        generatedListId: list.id,
        content,
        quantity,
        settledQuantity: 0,
        itemId: req.itemId ?? null,
        origin: GeneratedLineOrigin.ADDED,
        // Never from the request, which has no `targetListId` to offer, and
        // never from the basket's default for anybody but the owner below.
        targetListId: null,
        position,
        // Written once and never afterwards (section 4). Without it the first
        // person to settle this line becomes the only person it names, and
        // "who put this here" stops having an answer.
        createdByParticipantId: participant.id,
      })
    );

    if (optionIds.length > 0) {
      await this.options.insert(
        optionIds.map((itemId, index) => ({
          generatedListLineId: line.id,
          itemId,
          position: index,
        }))
      );
    }

    if (
      participant.kind === ParticipantKind.OWNER &&
      list.defaultTargetListId
    ) {
      // Through the ordinary write back (plan 0050, section 5), so the owner's
      // `WRITE` is checked at this moment and the zone list hears the ordinary
      // `line.added`. Reached only here, so a guest's add cannot take this
      // branch however the basket is configured.
      await this.lineWrites.promote(
        list.ownerUserId,
        line,
        list.defaultTargetListId
      );
    }

    const view = await this.generated.basketLineViewFor(line, seesZoneData);
    // Its own event rather than a second `lineUpdated`, because a client
    // receiving that one has to decide whether to replace a row or append one
    // (section 8). Redacted to the least privileged reader in the room like
    // every broadcast there, which costs nothing on a line with no origins.
    const announcement: GeneratedListLineAddedEvent = {
      generatedListId: list.id,
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineAdded,
      list.id,
      announcement
    );

    return view;
  }

  /**
   * The add landed on a line the basket already holds (plan 0094, section 5).
   *
   * It sums rather than appends, takes the incoming product when the row named
   * none, and adds any option the row was not offering. The row keeps its
   * position, its `createdByParticipantId` and everything attached to it: the
   * person adding two more milks did not put the milk there.
   *
   * ## It announces an update and not an add
   *
   * A client receiving `lineAdded` appends a row, and appending a row it already
   * draws is the duplicate this rule exists to prevent. So the merge is a
   * `lineUpdated`, which is what actually happened to the basket.
   *
   * ## The owner's default target still applies
   *
   * The owner saying "everything I add today also goes in the flat list" is
   * about the units they just added, whether they landed on a new row or an old
   * one, so the promotion runs either way and the flat's own line is raised by
   * the ordinary write back. A guest's add takes this branch as little as it
   * takes the other one.
   */
  private async raise(
    list: GeneratedList,
    line: GeneratedListLine,
    args: {
      participant: GeneratedListParticipant;
      quantity: number;
      itemId: string | null;
      optionIds: readonly string[];
      seesZoneData: boolean;
    }
  ): Promise<GeneratedListBasketLineView> {
    line.quantity += args.quantity;
    line.itemId ??= args.itemId;
    line.lastEditedByParticipantId = args.participant.id;
    line.lastEditedAt = new Date();
    await this.lines.save(line);

    if (args.optionIds.length > 0) {
      const held = await this.options.find({
        where: { generatedListLineId: line.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
      const known = new Set(held.map((row) => row.itemId));
      const missing = args.optionIds.filter((itemId) => !known.has(itemId));
      if (missing.length > 0) {
        await this.options.insert(
          missing.map((itemId, index) => ({
            generatedListLineId: line.id,
            itemId,
            position: held.length + index,
          }))
        );
      }
    }

    if (
      args.participant.kind === ParticipantKind.OWNER &&
      list.defaultTargetListId
    ) {
      await this.lineWrites.promote(
        list.ownerUserId,
        line,
        list.defaultTargetListId,
        // What this add asked for, and not the row's new total: the flat has
        // already been told about the units that were on the row before.
        { quantity: args.quantity }
      );
    }

    const view = await this.generated.basketLineViewFor(
      line,
      args.seesZoneData
    );
    const announcement: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineUpdated,
      list.id,
      announcement
    );
    return view;
  }

  /**
   * Where a search inside this basket is priced (plan 0055, section 5.1).
   *
   * Core answers what the **run** was composed against, and catalog answers what
   * that means today: the split plan 0049 section 2.1 already draws for an
   * account holder's own search, applied to a reader who may hold no account.
   *
   * The three candidate scopes, and why this is the one: the caller's own
   * default profile is refused because a guest has none and a registered
   * participant's would rank a stranger's basket by a different city's shops;
   * the run's snapshot is what the basket was composed against and is already
   * stored; and no scope at all is the fallback when the snapshot names no
   * profile. The snapshot exists for exactly this class of question, and ranking
   * a search inside a basket is plan 0050 section 1's "explain a three week old
   * basket to the person looking at it" applied live.
   *
   * **The field read is `pricingProfileId`, not `profileId`** (plan 0078). The
   * other one answers whose sources the run read, and a request that names its
   * own sources reads none, so it is null on every run velista has ever
   * created. Reading it here is why no basket has ever shown a price. This one
   * is the owner's profile captured when the run was composed, which is the row
   * section 5.1's table accepts, and it is null only on a run composed before
   * that plan. Such a run stays unpriced, which is the same table's "no scope
   * at all" fallback.
   */
  async searchScope(
    req: GetGeneratedListBasketRequest
  ): Promise<GeneratedListBasketScope> {
    // Resolved rather than read straight off the row, so a revoked participant
    // cannot use the basket as an open catalog proxy after being thrown out.
    const { list } = await this.resolve(req);
    return {
      ownerUserId: list.ownerUserId,
      // A snapshot stored before plan 0078 has no such key, and `undefined` is
      // not a value this message carries: read the absence as null.
      profileId: list.sourceSnapshot.pricingProfileId ?? null,
    };
  }

  /**
   * The basket and what this participant may see of it.
   *

   * `seesZoneData` is asked here rather than taken from the gateway's context,
   * even though the guard has just computed it. Section 5.2 insists the question
   * is answered at request time from core's own access tables, and a value that
   * travelled through a message is a value a future caller could send.
   */
  private async resolve(req: {
    generatedListId: string;
    participantId: string;
  }): Promise<{
    list: GeneratedList;
    participant: GeneratedListParticipant;
    seesZoneData: boolean;
  }> {
    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }

    // Resolved by id rather than by a credential: the gateway has already
    // checked the credential, and re-presenting it here would mean a guest's
    // session secret travelling a second hop for no gain. The row is still read
    // live, so a revocation between the guard and here is refused.
    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      list.id
    );
    if (!participant) {
      throw new UnauthorizedException('Not a participant of this basket');
    }

    return {
      list,
      participant,
      seesZoneData: await this.sharing.seesZoneData(participant),
    };
  }
}
