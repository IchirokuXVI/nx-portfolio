import { Injectable } from '@nestjs/common';
import {
  BasketKind,
  isOpenBasket,
  type AddBasketLineRequest,
  type BasketRowResult,
  type BasketSearchScope,
  type GetBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  GeneratedListFinishedException,
} from '@portfolio/luna-shopper/platform';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineService } from '../lists/line.service';
import { ProfileService } from '../profiles/profile.service';
import { servesLocations } from './basket-redaction';
import { BasketWriteContext } from './basket-write.context';

/**
 * Putting a line on one of the basket's lists (plan 0136, section 5.4).
 *
 * ## This reverses plan 0055, and says so
 *
 * That plan let a guest add a line, on the argument that "a guest in an aisle
 * who remembers the milk is exactly the reader the shared basket exists for".
 * What made it safe was that the line "lives in the basket and nowhere else": it
 * named no zone, claimed no zone line and emitted no zone event.
 *
 * **No such place exists now.** A basket holds no lines of its own, so there is
 * nowhere for a line with no list to live, and a line that reaches a list is a
 * write to a household. So `targetListId` is required and the route is account
 * participants only.
 *
 * ## Two conditions, one refusal
 *
 * The actor holds `WRITE` on the target list **themselves**, and the list is in
 * the basket's coverage. Either missing is the same `ForbiddenException` that
 * does not say which, so the route cannot be used to probe which lists an owner
 * covers.
 *
 * ## The write is the list's own
 *
 * `LineService.add`, so plan 0091's merge onto a line the list already holds and
 * plan 0037's approval both apply, and the zone hears the ordinary `line.added`
 * or `line.updated`. A result that is `PENDING` is a covered line, so the row
 * appears with `awaitingApproval` and can be bought: plan 0092 section 4.2 is the
 * precedent, where a created line "starts under the list's own approval rule"
 * and was still settled.
 */
@Injectable()
export class BasketLineAddService {
  constructor(
    private readonly context: BasketWriteContext,
    private readonly lines: LineService,
    private readonly profiles: ProfileService,
    private readonly events: CoreEventsPublisher
  ) {}

  async add(req: AddBasketLineRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new GeneratedListFinishedException(
        'This basket is finished, so nothing more can be added to it'
      );
    }
    if (!opened.participant.userId) {
      // Refused before anything is read. A guest has no account, so there is no
      // `WRITE` to hold and no list they could name.
      throw new ForbiddenException(
        'Only people with an account can add a line to a basket'
      );
    }

    if (
      !opened.servedListIds.has(req.targetListId) ||
      !opened.coveredListIds.includes(req.targetListId)
    ) {
      // One refusal for both conditions. `servedListIds` is the actor's own
      // `WRITE` over the coverage, so the first test covers the second in every
      // reachable case; both are written because they are two rules and a future
      // change to either must not silently satisfy the other.
      throw new ForbiddenException('That list cannot be added to from here');
    }

    const added = await this.lines.add({
      // The **actor's** own account, which is what makes this different from
      // every other write here: adding is the one gesture that is not delegated,
      // so it is authorized by the person making it.
      userId: req.userId,
      listId: req.targetListId,
      content: req.content,
      quantity: req.quantity,
      itemIds: req.itemIds,
      // The basket the line arrived through, on the change record (plan 0138,
      // section 4). Here the actor and the authorized account are the same
      // person, because adding is the one gesture that is not delegated, and the
      // participant is still carried: it is how the change is recognized as this
      // reader's own on their own basket.
      via: opened.via(),
    });

    // No announcement of its own (plan 0139, section 3). The add went through
    // `LineService.add`, which announces to every basket covering the list, and
    // this basket is one of them: it had to cover the list to add to it.
    return opened.result([added.line.id], added.line.id);
  }

  /**
   * Where a search inside this basket is priced (plan 0055, section 5.1).
   *
   * Core answers what the basket is priced against and catalog answers what that
   * means today. The three candidate scopes, and why this is the one: the
   * caller's own default profile is refused because a guest has none and a
   * registered participant's would rank a stranger's basket by a different
   * city's shops; the basket's own profile is what it is priced against
   * everywhere else on the screen; and no scope at all is the fallback.
   *
   * A `GENERATED` basket answers its stored `pricingProfileId`. A `LIVE` basket
   * stores none and resolves the owner's default on every request, because a
   * basket that never ends cannot freeze a profile its owner goes on editing.
   */
  async searchScope(req: GetBasketRequest): Promise<BasketSearchScope> {
    // Resolved rather than read straight off the row, so a revoked participant
    // cannot use the basket as an open catalog proxy after being thrown out.
    const opened = await this.context.open(req);
    return {
      ownerUserId: opened.basket.ownerUserId,
      profileId:
        opened.basket.kind === BasketKind.LIVE
          ? await this.profiles.pricingProfileId(
              opened.basket.ownerUserId,
              undefined
            )
          : opened.basket.pricingProfileId,
      // The **actor's** flag where the two above are the basket's, and the same
      // one the read obeys (plan 0136, section 2). It rides here so that the
      // settle of plan 0143, which already asks this question to price what was
      // paid, learns whether this reader may record the shop they named without
      // reading a whole basket for one boolean.
      servesLocations: servesLocations(opened.participant),
    };
  }
}
