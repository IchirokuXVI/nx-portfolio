import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GENERATED_LIST_SHARING_PATTERNS,
  type AddGeneratedListParticipantLineRequest,
  type EnsureShareLinkRequest,
  type GeneratedListBasketLineView,
  type GeneratedListBasketScope,
  type GeneratedListBasketView,
  type GeneratedListJoinCoreResult,
  type GeneratedListLineOriginsResult,
  type GeneratedListLinkPreview,
  type GeneratedListParticipantContext,
  type GeneratedListParticipantListResult,
  type GeneratedListReopenResult,
  type GeneratedListSettleResult,
  type GeneratedListShareLinkResult,
  type GeneratedListShareLinkView,
  type GeneratedListShareRequest,
  type GetGeneratedListBasketRequest,
  type GetGeneratedListLineOriginsRequest,
  type JoinGeneratedListRequest,
  type ListParticipantsRequest,
  type PreviewShareLinkRequest,
  type ReopenGeneratedListLineRequest,
  type ResolveParticipantRequest,
  type RevokeParticipantRequest,
  type RevokeShareLinkRequest,
  type SetGeneratedListLineOutstandingRequest,
  type SetGeneratedListOriginQuantityRequest,
  type SetGeneratedListOriginQuantityResult,
  type SetGeneratedListPickRequest,
  type SettleGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import { GeneratedListBasketService } from './generated-list-basket.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListOutstandingService } from './generated-list-outstanding.service';
import { GeneratedListReopenService } from './generated-list-reopen.service';
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
    private readonly reopenService: GeneratedListReopenService,
    private readonly outstanding: GeneratedListOutstandingService,
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
   * Take a settled basket line back to outstanding (plan 0054, section 3).
   *
   * The same authorization the settle has and no more: any live participant,
   * guests included. It puts back every unit this basket line took off an origin
   * list and marks the settlements that took them, rather than deleting them,
   * because a settlement is an append.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.reopenLine)
  reopenLine(
    @Payload() req: ReopenGeneratedListLineRequest
  ): Promise<GeneratedListReopenResult> {
    return this.reopenService.reopen(req);
  }

  /**
   * Move what is still to get on a basket line (plan 0056, section 3).
   *
   * One message read in two directions: raising means this basket will buy more,
   * lowering means that many were bought. The lower half is the settle above,
   * called rather than reimplemented, so both ways of buying a tin write the
   * same rows and agree about who bought it.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.setOutstanding)
  setOutstanding(
    @Payload() req: SetGeneratedListLineOutstandingRequest
  ): Promise<GeneratedListSettleResult> {
    return this.outstanding.setOutstanding(req);
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
   * Put a line in the basket, as any live participant (plan 0055, section 3).
   *
   * Distinct from `generatedList.addLine`, which resolves a basket by its
   * owner's id and so cannot answer the guest in the aisle who remembers the
   * milk. The line is created `ADDED` with no target, so it changes nothing any
   * household shares.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.addLine)
  addLine(
    @Payload() req: AddGeneratedListParticipantLineRequest
  ): Promise<GeneratedListBasketLineView> {
    return this.basket.addLine(req);
  }

  /**
   * Where a search inside this basket is priced (plan 0055, section 5.1).
   *
   * Core says what the run was composed against and catalog says what that
   * means today, which is plan 0049 section 2.1's split reached by a caller who
   * may hold no account.
   */
  @MessagePattern(GENERATED_LIST_SHARING_PATTERNS.searchScope)
  searchScope(
    @Payload() req: GetGeneratedListBasketRequest
  ): Promise<GeneratedListBasketScope> {
    return this.basket.searchScope(req);
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
