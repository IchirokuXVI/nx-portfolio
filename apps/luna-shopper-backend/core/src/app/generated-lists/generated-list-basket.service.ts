import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  RealtimeEvent,
  type GeneratedListBasketLineView,
  type GeneratedListBasketView,
  type GeneratedListLineMovedEvent,
  type GetGeneratedListBasketRequest,
  type SetGeneratedListPickRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  UnauthorizedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toBasketView } from './generated-list.mappers';
import { GeneratedListService } from './generated-list.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';

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
    private readonly generated: GeneratedListService,
    private readonly sharing: GeneratedListSharingService,
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

    const [lines, people] = await Promise.all([
      this.generated.basketLineViewsFor(list.id, seesZoneData),
      this.sharing.listParticipants({
        generatedListId: list.id,
        asParticipantId: req.participantId,
      }),
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
      seesZoneData
    );
  }

  /**
   * Swap a line's pick to another of its options (plan 0051, section 6.1).
   *
   * **Anybody holding the basket may do this, guests included.** The options are
   * catalog products and never zone data, and the person at the shelf is exactly
   * who wants another brand. So there is no `seesZoneData` check on the write,
   * only on what is handed back.
   *
   * The new pick has to be one of the line's **own** options, which is checked
   * rather than assumed: without it this route would repoint any line at any
   * product in the catalog.
   */
  async setPick(
    req: SetGeneratedListPickRequest
  ): Promise<GeneratedListBasketLineView> {
    const { list, seesZoneData } = await this.resolve(req);

    const line = await this.lines.findOne({
      where: { id: req.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    const option = await this.options.findOne({
      where: { generatedListLineId: line.id, itemId: req.itemId },
    });
    if (!option) {
      // A free text line has no options at all and lands here too, which is the
      // right answer: it has no product identity, so it has no pick to make.
      throw new ValidationException(
        'That product is not one of this line’s options',
        { messageArgs: { field: 'itemId' } }
      );
    }

    if (line.itemId !== req.itemId) {
      line.itemId = req.itemId;
      line.lastEditedByParticipantId = req.participantId;
      line.lastEditedAt = new Date();
      await this.lines.save(line);
    }

    const view = await this.generated.basketLineViewFor(line, seesZoneData);
    // Redacted to the least privileged reader in the room, because a broadcast
    // cannot be projected per socket. Nothing is lost: the three gated fields do
    // not move when a pick is swapped, so a reader who passes section 5.2 merges
    // the mutable fields onto the line they already hold.
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
  }): Promise<{ list: GeneratedList; seesZoneData: boolean }> {
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

    return { list, seesZoneData: await this.sharing.seesZoneData(participant) };
  }
}
