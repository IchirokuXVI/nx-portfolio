import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BASKET_SHARING_PATTERNS,
  type AddBasketParticipantRequest,
  type EnsureShareLinkRequest,
  type BasketJoinCoreResult,
  type BasketLinkPreview,
  type BasketParticipantContext,
  type BasketParticipantListResult,
  type BasketParticipantView,
  type BasketShareLinkResult,
  type BasketShareLinkView,
  type BasketShareRequest,
  type JoinBasketRequest,
  type LeaveBasketRequest,
  type ListParticipantsRequest,
  type PreviewShareLinkRequest,
  type ResolveParticipantRequest,
  type RevokeParticipantRequest,
  type RevokeShareLinkRequest,
} from '@portfolio/luna-shopper/contracts';
import { BasketSharingService } from './basket-sharing.service';

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
export class BasketSharingController {
  constructor(private readonly sharing: BasketSharingService) {}

  @MessagePattern(BASKET_SHARING_PATTERNS.linkEnsure)
  ensureLink(
    @Payload() req: EnsureShareLinkRequest
  ): Promise<BasketShareLinkView> {
    return this.sharing.ensureLink(req);
  }

  @MessagePattern(BASKET_SHARING_PATTERNS.linkGet)
  getLink(
    @Payload() req: BasketShareRequest
  ): Promise<BasketShareLinkResult> {
    return this.sharing.getLink(req);
  }

  @MessagePattern(BASKET_SHARING_PATTERNS.linkRevoke)
  revokeLink(
    @Payload() req: RevokeShareLinkRequest
  ): Promise<{ revoked: number }> {
    return this.sharing.revokeLink(req);
  }

  /** Unauthenticated, and it leaks nothing (section 4, step 1). */
  @MessagePattern(BASKET_SHARING_PATTERNS.linkPreview)
  preview(
    @Payload() req: PreviewShareLinkRequest
  ): Promise<BasketLinkPreview> {
    return this.sharing.preview(req);
  }

  /** Unauthenticated unless the caller chose to present a token (step 3). */
  @MessagePattern(BASKET_SHARING_PATTERNS.join)
  join(
    @Payload() req: JoinBasketRequest
  ): Promise<BasketJoinCoreResult> {
    return this.sharing.join(req);
  }

  @MessagePattern(BASKET_SHARING_PATTERNS.participantList)
  listParticipants(
    @Payload() req: ListParticipantsRequest
  ): Promise<BasketParticipantListResult> {
    return this.sharing.listParticipants(req);
  }

  @MessagePattern(BASKET_SHARING_PATTERNS.participantRevoke)
  revokeParticipant(
    @Payload() req: RevokeParticipantRequest
  ): Promise<{ id: string }> {
    return this.sharing.revokeParticipant(req);
  }

  /** Add one of the owner's contacts to the basket (plan 0114, section 4). */
  @MessagePattern(BASKET_SHARING_PATTERNS.participantAdd)
  addParticipant(
    @Payload() req: AddBasketParticipantRequest
  ): Promise<BasketParticipantView> {
    return this.sharing.addParticipant(req);
  }

  /**
   * Leave a basket, as the participant the gateway's guard resolved (plan 0114,
   * section 6). Refused to a guest and to the owner.
   */
  @MessagePattern(BASKET_SHARING_PATTERNS.participantLeave)
  leave(@Payload() req: LeaveBasketRequest): Promise<{ id: string }> {
    return this.sharing.leave(req);
  }

  /**
   * The per request check behind every participant authenticated route
   * (section 3.3): one indexed lookup, no cache, revocation biting immediately.
   */
  @MessagePattern(BASKET_SHARING_PATTERNS.participantResolve)
  resolveParticipant(
    @Payload() req: ResolveParticipantRequest
  ): Promise<BasketParticipantContext> {
    return this.sharing.resolveParticipant(req);
  }

}
