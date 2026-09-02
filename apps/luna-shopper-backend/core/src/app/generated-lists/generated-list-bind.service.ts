import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GeneratedLineOrigin,
  LineApprovalStatus,
  RealtimeEvent,
  isLiveGeneratedList,
  type BindGeneratedListLineRequest,
  type BindGeneratedListLineResult,
  type GeneratedListLineMovedEvent,
  type GeneratedListLineTarget,
  type GetGeneratedListLineTargetsRequest,
  type GetGeneratedListLineTargetsResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ForbiddenException,
  GeneratedListFinishedException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { GeneratedList, GeneratedListLine, ShoppingList } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { LineClaimService } from './line-claim.service';
import { namesOfLists } from './list-names';

/**
 * Binding an added basket line to a shopping list (plan 0058).
 *
 * ## The rule this is an instance of
 *
 * > An edit inside a basket changes the shared lists **only** when somebody has
 * > said which list should receive it.
 *
 * That is plan 0050 section 5, and it is the sentence the whole generated list
 * feature turns on. Plan 0055 lets anybody in the shop put a line in the basket,
 * and that line lives in the basket alone; this file is the one gesture that
 * takes it out, and it is the "has said which list" half made reachable from the
 * screen the person holding the basket is actually on.
 *
 * Everything restrictive here follows from that one sentence. The gesture is
 * deliberate, it is one way, and it is not available to somebody who cannot be
 * told which lists exist.
 *
 * ## Why it is a service of its own
 *
 * The promotion already existed. {@link GeneratedListLineService.promote} has
 * created the zone line through the ordinary add path since plan 0050, and
 * nothing here reimplements it: what was missing was a way to **reach** it that
 * is not the owner's account surface, and a read that says which lists may be
 * chosen. So this file is a participant surface and a picker, and the write back
 * stays in the one place that owns plan 0050 section 5's rule.
 *
 * ## A guest sees neither half, and not because a guest is untrusted
 *
 * Both operations **name lists**, and naming a list to a guest is exactly the
 * disclosure plan 0051 section 5.2 exists to prevent. A guest's line stays in
 * the basket, which is where they put it, and anybody with an account and the
 * access can bind it afterwards. That is the same refusal the origin sheet
 * makes, for the same reason and in the same words.
 */
@Injectable()
export class GeneratedListBindService {
  constructor(
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    // Read only, and only to name a list for a reader already found entitled to
    // the names. Nothing here writes a zone list: that is the write back's job,
    // and it goes through the ordinary add path.
    @InjectRepository(ShoppingList)
    private readonly shoppingLists: Repository<ShoppingList>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    // The write back itself (plan 0050, section 5). Reused rather than repeated,
    // so the access check at that moment, the list's approval rules and the
    // ordinary `line.added` event all come with it unchanged.
    private readonly lineWrites: GeneratedListLineService,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  // --- The read --------------------------------------------------------------

  /**
   * Which lists this line may be sent to (plan 0058, section 3).
   *
   * Answers the lists, each with its zone, its name and whether the run drew
   * from it. **It sorts nothing else**: the flag is the whole ergonomics of the
   * picker, because the line was almost certainly remembered while shopping for
   * the lists this basket came from, and grouping by zone is the client's
   * because the zone is how the reader thinks about it rather than how the data
   * is stored.
   *
   * ## It refuses a line it could never bind
   *
   * A `DERIVED` line and one that already has a target are refused here with the
   * codes the write uses, rather than answered with a set the reader cannot act
   * on. A picker that can only fail on the tap is worse than a refusal that says
   * why, and the client learns the same thing either way; the write checks the
   * same two conditions again, because a projection is never the authority.
   *
   * The basket's status is deliberately **not** checked here. It is a write
   * precondition (section 4) and a finished basket is still a readable one.
   */
  async lineTargets(
    req: GetGeneratedListLineTargetsRequest
  ): Promise<GetGeneratedListLineTargetsResult> {
    const { list, line, actorUserId } = await this.resolve(req);
    this.requireBindable(line);

    // Both accesses, at request time (section 3.1). The actor's half is what the
    // requirement asks for; the owner's half is plan 0051 section 6.4, because a
    // list the owner cannot write would give the household a line it sees and
    // never sees bought.
    const scope = await this.sharing.writableIntersection(
      list.ownerUserId,
      actorUserId
    );
    const names = await namesOfLists(
      this.shoppingLists,
      scope.map((row) => row.listId)
    );
    // Read from the snapshot rather than from the line's origins, because an
    // added line has no origins at all: what makes a row the likely answer is
    // where this **basket** came from.
    const fromRun = new Set(
      list.sourceSnapshot.sources.map((source) => source.listId)
    );

    const targets: GeneratedListLineTarget[] = scope.map((row) => {
      const named = names.get(row.listId);
      return {
        listId: row.listId,
        zoneId: row.zoneId,
        // Null rather than an invented name, exactly as the origin sheet does
        // it: a list that went between the scope read and the naming read is the
        // ordinary way a set of ids outruns its captions.
        listName: named?.name ?? null,
        zoneName: named?.zoneName ?? null,
        fromRun: fromRun.has(row.listId),
      };
    });

    return { generatedListId: list.id, lineId: line.id, targets };
  }

  // --- The write -------------------------------------------------------------

  /**
   * Send an added line to a shopping list, once (plan 0058, section 4).
   *
   * The promotion is the one that already existed: the zone line is created
   * through `line.add`, with the list's ordinary approval behaviour, and the
   * provenance row is written. The claim follows, so the household's list says
   * somebody is out buying it.
   *
   * ## Whose account the line is created under
   *
   * The **actor's**. A household's list may name only accounts, and the account
   * that said which list is the honest author (section 6): a guest's typed name
   * stays in the basket, where it belongs. The owner's `WRITE` is checked beside
   * it and never instead of it, because the owner's access is what authorizes
   * every settle on the origin this creates.
   *
   * ## What it deliberately does not do
   *
   * **It writes no settlement**, and section 4.1 is emphatic that this is the
   * decision most worth arguing. The units bought before the binding are known:
   * who, when and how many. Backfilling them would still be wrong, because the
   * household never asked for those units, and plan 0047 section 6.3 computes a
   * purchase interval from exactly these rows. Seeding that series with a
   * purchase that satisfied no demand of theirs makes the first estimate the
   * household ever sees a worse one.
   *
   * **It has no inverse.** Clearing a target does not delete the line it created
   * (plan 0050, section 5), because a shared list is not something a basket may
   * take things back out of. Removing the line is done on the target list, by
   * somebody with access, as an ordinary delete: the same person and the same
   * gesture as removing anything else from it, which is the property that makes
   * this safe to offer at all.
   */
  async bindLine(
    req: BindGeneratedListLineRequest
  ): Promise<BindGeneratedListLineResult> {
    const { list, line, seesZoneData, actorUserId, participantId } =
      await this.resolve(req);

    if (!isLiveGeneratedList(list.status)) {
      // Its own code rather than a validation failure (plan 0055, section 3.3):
      // nothing about the request was malformed and no field of it is at fault,
      // the trip is over, and a client that cannot tell a state it can explain
      // from a bug it cannot will show the wrong sentence for both.
      throw new GeneratedListFinishedException(
        'This basket is finished, so its lines cannot be sent to a list'
      );
    }
    this.requireBindable(line);
    await this.requireWritable(list.ownerUserId, actorUserId, req.listId);

    // Section 4.1. Somebody adds batteries in the shop, buys them, and then says
    // they belong in the flat's list: the units are already gone, so asking the
    // household for four would be asking for something in the cupboard. Floored
    // at zero, which is plan 0047 section 2.2's line rather than a degenerate
    // case: the household now knows about batteries and does not currently need
    // any, and keeps the history from here on.
    const outstanding = Math.max(0, line.quantity - line.settledQuantity);

    line.lastEditedByParticipantId = participantId;
    line.lastEditedAt = new Date();
    const promoted = await this.lineWrites.promote(
      actorUserId,
      line,
      req.listId,
      { quantity: outstanding }
    );

    const ref = {
      zoneId: promoted.zoneId,
      listId: req.listId,
      lineId: promoted.line.id,
    };
    // The line is now in somebody's basket, so the household's list says so
    // (plan 0051, section 5.3). Named as the **owner** and never as the actor,
    // exactly as a run is (plan 0052, section 2): the claim is the basket's.
    this.claims.announce(true, list.ownerUserId, [ref]);

    const announcement: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      // Redacted to the least privileged reader in the room, because a broadcast
      // cannot be projected per socket. A guest in the shop hears that the line
      // moved and learns no list name from it, which is the point: the line they
      // are looking at now has a target, and they are still not told which.
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineUpdated,
      list.id,
      announcement
    );

    return {
      line: await this.generated.basketLineViewFor(line, seesZoneData),
      listId: req.listId,
      zoneId: promoted.zoneId,
      createdLineId: promoted.line.id,
      quantity: promoted.quantity,
      // Read off the created line rather than derived from the list's settings
      // (section 4.3). Nothing here approves anything and nothing here overrides
      // the add: this reports what the ordinary path decided, so a reader is
      // told their line is waiting rather than believing it landed.
      pendingApproval:
        promoted.line.approvalStatus === LineApprovalStatus.PENDING,
    };
  }

  // --- Shared ----------------------------------------------------------------

  /**
   * The two conditions that are about the line itself (section 4).
   *
   * Checked on both operations, which is why they are here rather than inline on
   * the write: the read has to refuse the same two lines, or it would offer a
   * picker whose every choice fails.
   */
  private requireBindable(line: GeneratedListLine): void {
    if (line.origin !== GeneratedLineOrigin.ADDED) {
      // A DERIVED line is already in the lists its origins name, so giving it a
      // target would be asking a shared list for a second copy of a line it
      // already holds. `updateLine` refuses this today and the message is the
      // same one, because it is the same refusal.
      throw new ValidationException(
        'only a line added to this basket can be sent to a shopping list',
        { messageArgs: { field: 'listId' } }
      );
    }
    if (line.targetListId !== null) {
      // Binding is once (section 4.2). Setting a target twice does not create
      // two lines, so the second attempt is refused rather than quietly ignored:
      // a reader who taps a second list is asking for something this gesture
      // cannot do, and telling them so is the only honest answer.
      throw new ConflictException(
        'This line has already been sent to a shopping list'
      );
    }
  }

  /**
   * Both accesses on the one list being written, at request time (section 3.1).
   *
   * The actor's, because they are the person doing it and the created line will
   * carry their name. The owner's, because plan 0051 section 6.4 makes the
   * owner's access what authorizes every settle: a line bound into a list the
   * owner cannot write would be reported as skipped on every purchase for the
   * life of the basket, and the household would see the line and never see it
   * bought.
   *
   * **Refused here rather than at settle time**, which is the whole of it. The
   * picker never offers such a list, and this is the same question asked again
   * on the write, because a client holding a stale set, or one calling the route
   * directly, has to meet the same rule.
   */
  private async requireWritable(
    ownerUserId: string,
    actorUserId: string,
    listId: string
  ): Promise<void> {
    const owner = await this.sharing.writableAmong(ownerUserId, [listId]);
    if (!owner.has(listId)) {
      throw new ForbiddenException(
        'The basket’s owner can no longer write that list'
      );
    }
    if (actorUserId === ownerUserId) {
      return;
    }
    const actor = await this.sharing.writableAmong(actorUserId, [listId]);
    if (!actor.has(listId)) {
      throw new ForbiddenException('You need write access to that list');
    }
  }

  /**
   * The basket, the line, and whether this participant may be here at all.
   *
   * `seesZoneData` is asked of core's own access tables at request time rather
   * than taken from the request (plan 0051, section 5.2): the gateway computes
   * the same value for its own guard, but a value that travelled through a
   * message is a value a future caller could send.
   *
   * Both operations are refused outright rather than redacted, which is the same
   * place the origin sheet departs from the rest of this surface and for the
   * same reason. There is nothing left of either after the redaction: a target
   * is a list and a zone and their names, and the write is a list id.
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
    participantId: string;
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
      // which is the same sentence twice: section 3.1's scope is over two users'
      // access, so an actor with no user is an actor with no scope.
      throw new ForbiddenException(
        'Sending a line to a shopping list needs write access to every source list'
      );
    }

    return {
      list,
      line,
      seesZoneData,
      actorUserId: participant.userId,
      participantId: participant.id,
    };
  }
}
