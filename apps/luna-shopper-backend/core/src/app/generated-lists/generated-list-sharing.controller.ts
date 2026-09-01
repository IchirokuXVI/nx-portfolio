import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GENERATED_LIST_SHARING_PATTERNS,
  type EnsureShareLinkRequest,
  type GeneratedListJoinCoreResult,
  type GeneratedListLinkPreview,
  type GeneratedListParticipantContext,
  type GeneratedListParticipantListResult,
  type GeneratedListSettleResult,
  type GeneratedListShareLinkResult,
  type GeneratedListShareLinkView,
  type GeneratedListShareRequest,
  type JoinGeneratedListRequest,
  type ListParticipantsRequest,
  type PreviewShareLinkRequest,
  type ResolveParticipantRequest,
  type RevokeParticipantRequest,
  type RevokeShareLinkRequest,
  type SettleGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
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
    private readonly settle: GeneratedListSettleService
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
}
