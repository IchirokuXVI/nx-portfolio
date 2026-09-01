import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GENERATED_LIST_SHARING_PATTERNS,
  type EnsureShareLinkRequest,
  type GeneratedListBasketLineView,
  type GeneratedListBasketView,
  type GeneratedListJoinCoreResult,
  type GeneratedListLineOriginsResult,
  type GeneratedListLinkPreview,
  type GeneratedListParticipantContext,
  type GeneratedListParticipantListResult,
  type GeneratedListSettleResult,
  type GeneratedListShareLinkResult,
  type GeneratedListShareLinkView,
  type GeneratedListShareRequest,
  type GetGeneratedListBasketRequest,
  type GetGeneratedListLineOriginsRequest,
  type JoinGeneratedListRequest,
  type ListParticipantsRequest,
  type PreviewShareLinkRequest,
  type ResolveParticipantRequest,
  type RevokeParticipantRequest,
  type RevokeShareLinkRequest,
  type SetGeneratedListOriginQuantityRequest,
  type SetGeneratedListOriginQuantityResult,
  type SetGeneratedListPickRequest,
  type SettleGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import { GeneratedListBasketService } from './generated-list-basket.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';

/**
 * Core's sharing surface (plan 0051, sections 3 and 4). The gateway is the only
 * caller.
 *
 * Two kinds of request arrive here and the difference is the whole security
 * story. The owner's four operations carry a `userId` a verified account token
 * resolved to. The preview and the join carry **no identity at all**: they are the
 * unauthenticated pair, and the link secret is the only thing standing between a
 * caller and a participant row, which is why `preview` discloses nothing and
 * answers the same way for a link that never existed as for one that was revoked.
 */
@Controller()
export class GeneratedListSharingController {
  constructor(
    private readonly sharing: GeneratedListSharingService,
    private readonly settle: GeneratedListSettleService,
    private readonly basket: GeneratedListBasketService,
    private readonly origins: GeneratedListOriginsService
  ) {}

  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.linkEnsure)
  ensureLink(
    @Payload() req: EnsureShareLinkRequest
  ): Promise<GeneratedListShareLinkView> {
    return this.sharing.ensureLink(req);
  }

  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.linkGet)
  getLink(
    @Payload() req: GeneratedListShareRequest
  ): Promise<GeneratedListShareLinkResult> {
    return this.sharing.getLink(req);
  }

  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.linkRevoke)
  revokeLink(
    @Payload() req: RevokeShareLinkRequest
  ): Promise<{ revoked: number }> {
    return this.sharing.revokeLink(req);
  }

  /** Unauthenticated, and it leaks nothing (section 4, step 1). */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.linkPreview)
  preview(
    @Payload() req: PreviewShareLinkRequest
  ): Promise<GeneratedListLinkPreview> {
    return this.sharing.preview(req);
  }

  /** Unauthenticated unless the caller chose to present a token (step 3). */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.join)
  join(
    @Payload() req: JoinGeneratedListRequest
  ): Promise<GeneratedListJoinCoreResult> {
    return this.sharing.join(req);
  }

  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.participantList)
  listParticipants(
    @Payload() req: ListParticipantsRequest
  ): Promise<GeneratedListParticipantListResult> {
    return this.sharing.listParticipants(req);
  }

  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.participantRevoke)
  revokeParticipant(
    @Payload() req: RevokeParticipantRequest
  ): Promise<{ id: string }> {
    return this.sharing.revokeParticipant(req);
  }

  /**
   * The per request check behind every participant authenticated route
   * (section 3.3): one indexed lookup, no cache, revocation biting immediately.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.participantResolve)
  resolveParticipant(
    @Payload() req: ResolveParticipantRequest
  ): Promise<GeneratedListParticipantContext> {
    return this.sharing.resolveParticipant(req);
  }

  /**
   * Settle a basket line back to its origins (plan 0051, section 6).
   *
   * The one operation here that reaches a zone list, and the one authorized by
   * somebody other than the caller: section 6.4 checks the basket **owner's**
   * `WRITE` on each origin, never the actor's, because a guest has none.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.settleLine)
  settleLine(
    @Payload() req: SettleGeneratedListLineRequest
  ): Promise<GeneratedListSettleResult> {
    return this.settle.settle(req);
  }

  /**
   * The basket as a participant reads it (plan 0051, section 5).
   *
   * Distinct from `generatedList.get`, which resolves by the owner's id and so
   * cannot answer a guest at all, and redacted per reader by section 5.2.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.basketGet)
  getBasket(
    @Payload() req: GetGeneratedListBasketRequest
  ): Promise<GeneratedListBasketView> {
    return this.basket.getBasket(req);
  }

  /**
   * Swap a line's pick (plan 0051, section 6.1).
   *
   * Any participant may, guests included: the options are catalog products and
   * never zone data, and the person at the shelf is who wants another brand.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.setPick)
  setPick(
    @Payload() req: SetGeneratedListPickRequest
  ): Promise<GeneratedListBasketLineView> {
    return this.basket.setPick(req);
  }

  /**
   * What a basket line is made of, and what else could go into it (plan 0057,
   * section 3).
   *
   * Refused outright for a reader who does not pass plan 0051 section 5.2 rather
   * than redacted, which is the one place this surface differs from the rest of
   * itself: every field of an origin and of a candidate names a zone or a list,
   * so there would be nothing left after the redaction.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.lineOrigins)
  lineOrigins(
    @Payload() req: GetGeneratedListLineOriginsRequest
  ): Promise<GeneratedListLineOriginsResult> {
    return this.origins.lineOrigins(req);
  }

  /**
   * Set one list's contribution, editing an origin or adopting a new one (plan
   * 0057, section 5).
   *
   * **The one operation here that changes a household's own list without buying
   * anything.** The settle beside it lowers a zone line because units were
   * bought; this lowers one because the household changed its mind, and the two
   * are kept apart down to the response shape: this writes no settlement, sets no
   * bought indicator, and answers with neither settlement refs nor a skip report.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.setOriginQuantity)
  setOriginQuantity(
    @Payload() req: SetGeneratedListOriginQuantityRequest
  ): Promise<SetGeneratedListOriginQuantityResult> {
    return this.origins.setOriginQuantity(req);
  }
}
