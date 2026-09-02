import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  GENERATED_LIST_SHARING_PATTERNS,
  GENERATED_LIST_SHARING_SCHEMA_IDS,
  ITEM_PATTERNS,
  type AddGeneratedListParticipantLineRequest,
  type CatalogSuggestResponse,
  type EnsureShareLinkRequest,
  type GeneratedListBasketLineView,
  type GeneratedListBasketResult,
  type GeneratedListBasketScope,
  type GeneratedListBasketView,
  type GeneratedListJoinCoreResult,
  type GeneratedListJoinResult,
  type GeneratedListLineOriginsResult,
  type GeneratedListLinkPreview,
  type GeneratedListParticipantContext,
  type GeneratedListParticipantListResult,
  type GeneratedListReopenResult,
  type GeneratedListSettleResult,
  type GeneratedListShareLinkResult,
  type GeneratedListShareLinkView,
  type GetGeneratedListBasketRequest,
  type GetGeneratedListLineOriginsRequest,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemPage,
  type ItemView,
  type JoinGeneratedListRequest,
  type MintParticipantTokenRequest,
  type MintParticipantTokenResult,
  type ParticipantTokenResult,
  type ProductGroupOfferPage,
  type ReopenGeneratedListLineRequest,
  type SetGeneratedListOriginQuantityRequest,
  type SetGeneratedListOriginQuantityResult,
  type SetGeneratedListPickRequest,
  type SettleGeneratedListLineRequest,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { SUGGEST_SCHEMA } from '../catalog/catalog.controller';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
  componentRef,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AddGeneratedListParticipantLineDto,
  BasketSuggestQueryDto,
  EnsureShareLinkDto,
  JoinGeneratedListDto,
  RevokeShareLinkDto,
  SetGeneratedListOriginQuantityDto,
  SetGeneratedListPickDto,
  SettleGeneratedListLineDto,
} from './generated-list-sharing.dto';
import {
  PARTICIPANT_THROTTLE_LIMITS,
  ParticipantThrottle,
  ParticipantThrottlerGuard,
} from './participant-throttler.guard';
import { Participant, ParticipantGuard } from './participant.guard';

/**
 * The caller's global username, for the messages that write it onto a
 * participant row (plan 0054, section 2.3).
 *
 * **Core is told the name and never asks for it.** That is plan 0018 section 9's
 * rule for `CreateZoneRequest.username`, and it applies unchanged: core owns no
 * usernames, so resolving one here is a field on a message rather than a fan out
 * read from core into auth. The alternative, enriching participant views at read
 * time, would make a basket read a second request per read on the one screen in
 * this product that is refetched every time somebody in a shop settles anything.
 *
 * **A failure answers null rather than throwing**, which is the one place this
 * departs from `ZoneController.resolveIdentity`. There the hop is also the only
 * moment the route checks that the account behind the token exists at all; here
 * the three callers already resolve a basket by that account or mint a
 * participant it is bound to, so the hop buys only the name. A name is an
 * improvement on a fallback the client still has, and losing the share sheet or
 * a join in a shop because auth was briefly unreachable would not be.
 */
async function resolveUsername(
  nats: NatsClient,
  userId: string
): Promise<string | null> {
  try {
    const profile = await nats.send<UserProfileView>(AUTH_PATTERNS.getProfile, {
      userId,
    });
    return profile.username ?? null;
  } catch {
    return null;
  }
}

/**
 * The owner's share sheet (plan 0051, section 3).
 *
 * Account authenticated throughout, and every route resolves the basket by the
 * caller's own id, so a basket that is not theirs is **not found** rather than
 * forbidden, exactly as plan 0050's routes answer.
 */
@ApiTags('generated-lists')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'generated-lists', version: '1' })
export class GeneratedListShareController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * The share sheet: the live link, minting one if there is none.
   *
   * `PUT` rather than `POST`, because this is "ensure" and not "create": pressing
   * share twice from two devices must produce one link, and a basket that already
   * has a live one gets that link back rather than a second. The partial unique
   * index makes that true in the database rather than in a check the second
   * request could race past, and the idempotent verb is what says so to a client.
   */
  @Put(':id/share-link')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.linkEnsure)
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  async ensureLink(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: EnsureShareLinkDto
  ): Promise<GeneratedListShareLinkView> {
    const req: EnsureShareLinkRequest = {
      userId: user.userId,
      generatedListId: id,
      ...dto,
      // Sharing mints the owner's participant row, so this is where their name
      // reaches it (plan 0054, section 2.3). Core is told the name and never
      // asks for it, which is plan 0018 section 9's rule unchanged.
      username: await resolveUsername(this.nats, user.userId),
    };
    return this.nats.send<GeneratedListShareLinkView>(
      GENERATED_LIST_SHARING_PATTERNS.linkEnsure,
      req
    );
  }

  /** The live link if there is one, without minting. Absent when there is none. */
  @Get(':id/share-link')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.linkGet)
  @ApiProblemResponses({ auth: true, notFound: true })
  getLink(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<GeneratedListShareLinkResult> {
    return this.nats.send<GeneratedListShareLinkResult>(
      GENERATED_LIST_SHARING_PATTERNS.linkGet,
      { userId: user.userId, generatedListId: id }
    );
  }

  /**
   * Revoke the live link (section 3.4).
   *
   * Two levels, and the default is the one people mean: no new participant may be
   * minted, and everybody already shopping keeps working, because their session
   * is what authorizes them and the link is only an invitation they accepted.
   */
  @Delete(':id/share-link')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.linkRevoke)
  @ApiProblemResponses({ auth: true, notFound: true })
  revokeLink(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: RevokeShareLinkDto
  ): Promise<{ revoked: number }> {
    return this.nats.send<{ revoked: number }>(
      GENERATED_LIST_SHARING_PATTERNS.linkRevoke,
      {
        userId: user.userId,
        generatedListId: id,
        revokeParticipants: query.revokeParticipants,
      }
    );
  }

  /** Everybody on the basket, for the share sheet. */
  @Get(':id/participants')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.participantList)
  @ApiProblemResponses({ auth: true, notFound: true })
  async listParticipants(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<GeneratedListParticipantListResult> {
    // No `asParticipantId`: the owner passes section 5.2 by construction, so the
    // device strings are theirs to see.
    return this.nats.send<GeneratedListParticipantListResult>(
      GENERATED_LIST_SHARING_PATTERNS.participantList,
      {
        generatedListId: id,
        userId: user.userId,
        // The second place the owner's row can be named (plan 0054,
        // section 2.3): this sheet is read whether or not anybody has pressed
        // share, so an owner who has never minted a link is still named here.
        username: await resolveUsername(this.nats, user.userId),
      }
    );
  }

  /** Revoke one participant and nobody else: the lost phone (section 3.4). */
  @Delete(':id/participants/:participantId')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.participantRevoke)
  @ApiProblemResponses({ auth: true, notFound: true })
  revokeParticipant(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('participantId') participantId: string
  ): Promise<{ id: string }> {
    return this.nats.send<{ id: string }>(
      GENERATED_LIST_SHARING_PATTERNS.participantRevoke,
      { userId: user.userId, generatedListId: id, participantId }
    );
  }
}

/**
 * The unauthenticated pair (plan 0051, section 4): what somebody holding a link
 * can do before they are anybody.
 *
 * Deliberately its own controller with **no class level guard**. Putting these
 * beside the owner's routes would mean exempting two handlers from a guard that
 * protects the rest, which is the shape a mistake hides in.
 */
@ApiTags('generated-lists')
@Controller({ path: 'share-links', version: '1' })
export class ShareLinkController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * What the join screen may know before anybody joins.
   *
   * **It never fails.** A link that never existed, one that was revoked, one that
   * expired and one whose basket is finished all answer `joinable: false` and
   * nothing else. That is what lets section 3.1 (a dead link and a fictional one
   * are indistinguishable) and section 4 (the screen says so honestly) both hold:
   * answering 404 for one and 200 for the other would satisfy the second and
   * quietly break the first.
   */
  @Get(':secret')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.linkPreview)
  @ApiProblemResponses({})
  preview(@Param('secret') secret: string): Promise<GeneratedListLinkPreview> {
    return this.nats.send<GeneratedListLinkPreview>(
      GENERATED_LIST_SHARING_PATTERNS.linkPreview,
      { secret }
    );
  }

  /**
   * Join, as a guest or as yourself.
   *
   * `OptionalJwtAuthGuard` is what makes both work on one route: no token is the
   * ordinary case and mints a guest, and a token that is present but bad is a 401
   * rather than a quiet fall through to the guest path, which would turn an
   * expired session into a second identity on somebody's basket.
   *
   * The session secret in the answer is returned **once** and stored hashed. The
   * socket token beside it is minted here rather than in core, because core holds
   * no signing key.
   */
  @Post(':secret/join')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiComposedResponse(GENERATED_LIST_SHARING_SCHEMA_IDS.joinResult, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, notFound: true })
  async join(
    @Param('secret') secret: string,
    @Body() dto: JoinGeneratedListDto,
    @AuthUser() user: CurrentUser | undefined,
    @Headers('user-agent') userAgent?: string
  ): Promise<GeneratedListJoinResult> {
    const req: JoinGeneratedListRequest = {
      secret,
      displayName: dto.displayName,
      userId: user?.userId,
      // Null for a guest, and the account's own name for somebody signed in
      // (plan 0054, section 2.3). A separate field from the typed one, because a
      // guest's typed "Dani" and an account called Dani are different facts and
      // section 3.5 rests on telling them apart.
      username: user ? await resolveUsername(this.nats, user.userId) : null,
      userAgent,
    };
    const joined = await this.nats.send<GeneratedListJoinCoreResult>(
      GENERATED_LIST_SHARING_PATTERNS.join,
      req
    );
    const token = await this.mintToken(joined);
    return { ...joined, ...token };
  }

  private mintToken(
    joined: GeneratedListJoinCoreResult
  ): Promise<MintParticipantTokenResult> {
    const req: MintParticipantTokenRequest = {
      participantId: joined.participant.id,
      generatedListId: joined.generatedListId,
      kind: joined.participant.kind,
    };
    return this.nats.send<MintParticipantTokenResult>(
      AUTH_PATTERNS.mintParticipantToken,
      req
    );
  }
}

/**
 * Everything a guest does (plan 0051, sections 5 and 6).
 *
 * Guarded by {@link ParticipantGuard}, which accepts either credential and hands
 * every handler the same resolved participant, so nothing below knows or cares
 * whether a guest or the owner is holding the phone.
 */
@ApiTags('generated-lists')
@UseGuards(ParticipantGuard)
@Controller({ path: 'generated-lists', version: '1' })
export class GeneratedListParticipantController {
  constructor(
    private readonly nats: NatsClient,
    // Plan 0055, section 5.1: the run's profile turned into scope ids, through
    // the same resolver and the same cache an account holder's search uses.
    private readonly scopes: ScopeResolutionService
  ) {}

  /**
   * The basket itself, as this participant may see it (section 5).
   *
   * The route the whole screen is built on, and the one plan 0050 could not
   * provide: `GET /v1/generated-lists/:id` resolves a basket by its owner's id,
   * so a guest holding a link gets a 404 from it however valid their session is.
   * This one resolves nothing by user, and core redacts the answer per reader.
   */
  @Get(':id/basket')
  @ApiComposedResponse(GENERATED_LIST_SHARING_SCHEMA_IDS.basketResult)
  @ApiProblemResponses({ auth: true, notFound: true })
  async getBasket(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string
  ): Promise<GeneratedListBasketResult> {
    const req: GetGeneratedListBasketRequest = {
      generatedListId: id,
      participantId: participant.participantId,
    };
    const basket = await this.nats.send<GeneratedListBasketView>(
      GENERATED_LIST_SHARING_PATTERNS.basketGet,
      req
    );

    return { ...basket, products: await this.productsOf(basket) };
  }

  /**
   * The products every line names, in one catalog round trip.
   *
   * Composed here rather than fetched by the client because every catalog route
   * needs an account token and the reader may be a guest who has none. Section
   * 6.1 says a line's options are catalog products and never zone data, so a
   * guest is entitled to the names; this is how they get them without opening a
   * second public catalog surface.
   *
   * A catalog that is unreachable costs the captions and not the screen: the
   * lines, their quantities and what is outstanding are the basket, and a shopper
   * standing in an aisle is better served by a list with unnamed picks than by an
   * error page.
   */
  private async productsOf(
    basket: GeneratedListBasketView
  ): Promise<ItemView[]> {
    const ids = [
      ...new Set(
        basket.lines.flatMap((line) =>
          line.itemId ? [line.itemId, ...line.options] : line.options
        )
      ),
    ];
    if (ids.length === 0) {
      return [];
    }

    const req: GetItemsRequest = { ids };
    try {
      const found = await this.nats.send<GetItemsResult>(
        ITEM_PATTERNS.getMany,
        req
      );
      return found.items;
    } catch {
      return [];
    }
  }

  /**
   * Put a line in the basket, as any live participant (plan 0055, section 3).
   *
   * The gesture the basket could not make. `POST /v1/generated-lists/:id/lines`
   * on the owner's account surface resolves a basket by `ownerUserId`, so a
   * guest holding a perfectly valid session gets a not found from it; this one
   * resolves nothing by user, exactly as the basket read does.
   *
   * The line is created `ADDED` with no target, so it changes nothing any
   * household shares, which is what makes it safe to hand to somebody who
   * arrived through a forwarded link.
   *
   * ## Why it is under `basket` and not at `:id/lines`
   *
   * Plan 0055 section 3 names `POST /v1/generated-lists/:id/lines`, and that
   * path is **already taken** by the owner's own add on
   * `GeneratedListController`. Nest matches a method and path to the first
   * controller registered for it, so a second handler there would never be
   * reached and every guest would meet the account guard instead: the feature
   * would be shipped and unreachable, with nothing failing to say so.
   *
   * `basket` is the segment the participant surface already reads through
   * (`GET :id/basket`), so this is that surface's write rather than a new idea:
   * the basket is what a participant holds, and its lines are what they may put
   * something in.
   */
  @Post(':id/basket/lines')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.addLine, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    body: true,
    notFound: true,
    finishedBasket: true,
  })
  addLine(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Body() dto: AddGeneratedListParticipantLineDto
  ): Promise<GeneratedListBasketLineView> {
    const req: AddGeneratedListParticipantLineRequest = {
      generatedListId: id,
      participantId: participant.participantId,
      content: dto.content,
      quantity: dto.quantity,
      itemId: dto.itemId,
      options: dto.options,
    };
    return this.nats.send<GeneratedListBasketLineView>(
      GENERATED_LIST_SHARING_PATTERNS.addLine,
      req
    );
  }

  /**
   * Search the catalog through the basket (plan 0055, section 5).
   *
   * Composed here for the same reason {@link productsOf} is: every catalog route
   * needs an account token and the reader may be a guest who has none. Section
   * 5.2 says catalog items and product groups are public product facts, so a
   * guest is entitled to them; this is how they get them without opening a
   * second public catalog surface.
   *
   * ## The scope is the run's, never the caller's
   *
   * Core answers what the basket was composed against and catalog turns it into
   * scope ids: the split plan 0049 section 2.1 draws, reached by somebody with
   * no profile of their own. A registered participant's own profile is refused
   * as firmly as a guest's absent one, because it would rank a stranger's basket
   * by a different city's shops.
   *
   * ## It fails empty, never loudly
   *
   * A dropdown is an offer, and free text has been first class since plan 0043.
   * Adding a line must never fail because a search did, so every failure below
   * answers `{ suggestions: [] }`.
   */
  @Get(':id/catalog/suggest')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.suggest)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiOkResponse({
    description:
      'The dropdown, in the order it is to be drawn: every matching group first, then the individual products. The same body /v1/catalog/suggest answers, field for field.',
    schema: componentRef(SUGGEST_SCHEMA),
  })
  @ApiProblemResponses({ auth: true, notFound: true })
  async suggest(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Query() query: BasketSuggestQueryDto
  ): Promise<CatalogSuggestResponse> {
    const scope = await this.nats.send<GeneratedListBasketScope>(
      GENERATED_LIST_SHARING_PATTERNS.searchScope,
      { generatedListId: id, participantId: participant.participantId }
    );

    const common = {
      userId: scope.ownerUserId,
      query: query.q,
      priceScopeIds: await this.priceScopesOf(scope),
      limit: query.limit,
    };
    const [groups, items] = await Promise.all([
      this.nats
        .send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, common)
        .catch(
          () => ({ items: [], nextCursor: null }) as ProductGroupOfferPage
        ),
      this.nats
        .send<ItemPage>(ITEM_PATTERNS.search, common)
        .catch(() => ({ items: [], nextCursor: null }) as ItemPage),
    ]);

    return {
      suggestions: [
        ...groups.items.map((group) => ({
          kind: 'group' as const,
          group,
          item: null,
        })),
        ...items.items.map((item) => ({
          kind: 'item' as const,
          group: null,
          item,
        })),
      ],
    };
  }

  /**
   * The scopes this basket's search is priced at, or none (section 5.1).
   *
   * **Undefined and not an empty array**, which is the difference between an
   * unscoped search and no search at all: catalog answers an empty array with an
   * empty page, and answers an absent one with products carrying no prices. A
   * dropdown that names the right thing without a price beats one that will not
   * open, so every way of having no scope lands on undefined here.
   *
   * Resolved through the same service and the same Redis cache the owner's own
   * searches use, keyed by that owner and that profile, so a basket search costs
   * nothing extra while they are shopping and picks up a profile edit as soon as
   * they make one.
   */
  private async priceScopesOf(
    scope: GeneratedListBasketScope
  ): Promise<string[] | undefined> {
    if (!scope.profileId) {
      return undefined;
    }
    try {
      return await this.scopes.forRead(scope.ownerUserId, {
        profileId: scope.profileId,
      });
    } catch {
      // A profile emptied or deleted since the run, which the shopper in the
      // aisle can neither see nor fix. Section 5.3's rule applies to the whole
      // route: it fails empty, never loudly.
      return undefined;
    }
  }

  /**
   * Swap a line's pick to another of its options (section 6.1).
   *
   * **No `seesZoneData` check**, unlike the allocation sheet below it. The
   * options are catalog products and never zone data, so a guest at the shelf may
   * prefer another brand and say so; the settlement that follows records whatever
   * is actually in the trolley.
   */
  @Post(':id/lines/:lineId/pick')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.setPick, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  setPick(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: SetGeneratedListPickDto
  ): Promise<GeneratedListBasketLineView> {
    const req: SetGeneratedListPickRequest = {
      generatedListId: id,
      lineId,
      participantId: participant.participantId,
      itemId: dto.itemId,
    };
    return this.nats.send<GeneratedListBasketLineView>(
      GENERATED_LIST_SHARING_PATTERNS.setPick,
      req
    );
  }

  /**
   * Settle a line: the whole outstanding amount, a number, or an allocation.
   *
   * The allocation sheet is refused here rather than in core for a caller who
   * does not pass section 5.2, because it is the gateway that knows what this
   * request asked for; core enforces the same rule on the values it is given.
   */
  @Post(':id/lines/:lineId/settle')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.settleLine, {
    status: HttpStatus.CREATED,
  })
  // 409 rather than 422 for a line that is already finished (plan 0054,
  // section 4): the request is well formed and the state refuses it, and a
  // client keying its copy on `validation_failed` could not tell that from a
  // malformed quantity.
  @ApiProblemResponses({
    auth: true,
    body: true,
    notFound: true,
    conflict: true,
  })
  settle(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: SettleGeneratedListLineDto
  ): Promise<GeneratedListSettleResult> {
    if (dto.allocations && !participant.seesZoneData) {
      // Naming source lists is naming zone data (section 5.2), so the sheet is
      // not merely useless to a guest, it is a disclosure they may not have.
      throw new ForbiddenException(
        'Allocating per list needs write access to every source list'
      );
    }
    const req: SettleGeneratedListLineRequest = {
      generatedListId: id,
      lineId,
      participantId: participant.participantId,
      outcome: dto.outcome,
      quantity: dto.quantity,
      allocations: dto.allocations,
      itemId: dto.itemId,
    };
    return this.nats.send<GeneratedListSettleResult>(
      GENERATED_LIST_SHARING_PATTERNS.settleLine,
      req
    );
  }

  /**
   * Take a settled line back to outstanding (plan 0054, section 3).
   *
   * **No `seesZoneData` check**, like the pick swap above it and unlike the
   * allocation sheet: the act touches exactly the origins this basket line's own
   * settlements touched, and the answer names none of them. Any live participant
   * may, guests included, because refusing it to the person who just made the
   * mistake would leave the mistake standing.
   *
   * 409 when the line has nothing settled on it, which is the same distinction
   * section 4 draws on the settle: a well formed request the state refuses.
   */
  @Post(':id/lines/:lineId/reopen')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.reopenLine, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, notFound: true, conflict: true })
  reopen(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string
  ): Promise<GeneratedListReopenResult> {
    const req: ReopenGeneratedListLineRequest = {
      generatedListId: id,
      lineId,
      participantId: participant.participantId,
    };
    return this.nats.send<GeneratedListReopenResult>(
      GENERATED_LIST_SHARING_PATTERNS.reopenLine,
      req
    );
  }

  /**
   * What a basket line is made of, and what else could go into it (plan 0057,
   * section 3).
   *
   * Refused here for a participant who does not pass plan 0051 section 5.2, and
   * refused again in core on the same question asked of its own tables. Unlike
   * the basket read, there is no redacted projection to fall back to: every field
   * of an origin and of a candidate names a zone or a list, so a guest gets
   * nothing rather than less. That is not a degraded experience, it is section
   * 6.1's sentence — a guest must never have to know which household a tin of
   * tomatoes belongs to.
   *
   * The reopen above takes no such check, and the difference is the whole of
   * section 5.2: that one **touches** zone lines without naming any, and this one
   * is nothing but names.
   */
  @Get(':id/lines/:lineId/origins')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.lineOrigins)
  @ApiProblemResponses({ auth: true, notFound: true })
  lineOrigins(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string
  ): Promise<GeneratedListLineOriginsResult> {
    this.requireZoneData(participant);
    const req: GetGeneratedListLineOriginsRequest = {
      generatedListId: id,
      lineId,
      participantId: participant.participantId,
    };
    return this.nats.send<GeneratedListLineOriginsResult>(
      GENERATED_LIST_SHARING_PATTERNS.lineOrigins,
      req
    );
  }

  /**
   * Set one list's contribution: edit an origin, or adopt a new one (plan 0057,
   * section 5).
   *
   * **Nothing here is a purchase.** The reel on the row above means "bought" when
   * it goes down; this number is what a household wants, and lowering it is that
   * household changing its mind. So no settlement is written, no bought indicator
   * moves, and the response deliberately has nowhere to put either.
   *
   * `POST` rather than `PUT` on a collection URL, because the write is an upsert
   * addressed by the body rather than by the path: the same request adopts a list
   * that was not in the run and edits one that was.
   */
  @Post(':id/lines/:lineId/origins')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.setOriginQuantity, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  setOriginQuantity(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: SetGeneratedListOriginQuantityDto
  ): Promise<SetGeneratedListOriginQuantityResult> {
    this.requireZoneData(participant);
    const req: SetGeneratedListOriginQuantityRequest = {
      generatedListId: id,
      lineId,
      participantId: participant.participantId,
      // The body names the zone line and the path names the basket line, so the
      // two `lineId`s are separated here rather than in a message where nothing
      // sits beside them to say which is which.
      sourceListId: dto.listId,
      sourceLineId: dto.lineId,
      quantity: dto.quantity,
      from: dto.from,
    };
    return this.nats.send<SetGeneratedListOriginQuantityResult>(
      GENERATED_LIST_SHARING_PATTERNS.setOriginQuantity,
      req
    );
  }

  /**
   * Plan 0051 section 5.2's all or nothing rule, at the gateway.
   *
   * Both origin routes are refused rather than answered with less, for the reason
   * the allocation sheet is refused above: naming source lists is naming zone
   * data, and here there is nothing else in the answer.
   */
  private requireZoneData(participant: GeneratedListParticipantContext): void {
    if (!participant.seesZoneData) {
      throw new ForbiddenException(
        'Seeing where a line came from needs write access to every source list'
      );
    }
  }

  /** Who else is on this basket, for the shop screen. */
  @Get(':id/participants/mine')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.participantList)
  @ApiProblemResponses({ auth: true, notFound: true })
  listParticipants(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string
  ): Promise<GeneratedListParticipantListResult> {
    // The asker is named, so core decides whether the device strings are theirs
    // to see rather than the gateway guessing (section 7).
    return this.nats.send<GeneratedListParticipantListResult>(
      GENERATED_LIST_SHARING_PATTERNS.participantList,
      { generatedListId: id, asParticipantId: participant.participantId }
    );
  }

  /**
   * A fresh socket token, presented with the participant credential (section 9).
   *
   * This is where revocation bites for the socket: the token itself cannot be
   * revoked, so it is short lived, and the thing that renews it is the database
   * read that carries revocation.
   */
  @Post(':id/participant-token')
  @ApiComposedResponse(
    GENERATED_LIST_SHARING_SCHEMA_IDS.participantTokenResult,
    { status: HttpStatus.CREATED }
  )
  @ApiProblemResponses({ auth: true, notFound: true })
  async refreshToken(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string
  ): Promise<ParticipantTokenResult> {
    const req: MintParticipantTokenRequest = {
      participantId: participant.participantId,
      generatedListId: id,
      kind: participant.kind,
    };
    const token = await this.nats.send<MintParticipantTokenResult>(
      AUTH_PATTERNS.mintParticipantToken,
      req
    );
    const people = await this.nats.send<GeneratedListParticipantListResult>(
      GENERATED_LIST_SHARING_PATTERNS.participantList,
      { generatedListId: id, asParticipantId: participant.participantId }
    );
    const mine = people.participants.find(
      (row) => row.id === participant.participantId
    );
    return {
      ...token,
      // Guarded above, so the participant is live and therefore in the list; the
      // fallback exists only because `find` cannot know that.
      participant: mine ?? people.participants[0],
    };
  }
}

/**
 * The three controllers sharing adds, in the order their guards get stricter:
 * the owner's account authenticated sheet, the unauthenticated pair, and the
 * participant surface.
 */
export const GENERATED_LIST_SHARING_CONTROLLERS = [
  GeneratedListShareController,
  ShareLinkController,
  GeneratedListParticipantController,
];
