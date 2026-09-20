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
import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  GENERATED_LIST_SHARING_PATTERNS,
  GENERATED_LIST_SHARING_SCHEMA_IDS,
  type AddGeneratedListParticipantRequest,
  type EnsureShareLinkRequest,
  type GeneratedListJoinCoreResult,
  type GeneratedListJoinResult,
  type GeneratedListLinkPreview,
  type GeneratedListParticipantContext,
  type GeneratedListParticipantListResult,
  type GeneratedListParticipantView,
  type GeneratedListShareLinkResult,
  type GeneratedListShareLinkView,
  type GetUsernamesRequest,
  type JoinGeneratedListRequest,
  type LeaveGeneratedListRequest,
  type MintParticipantTokenRequest,
  type MintParticipantTokenResult,
  type ParticipantTokenResult,
  type UserProfileView,
  type UserUsernameView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AddGeneratedListParticipantDto,
  EnsureShareLinkDto,
  JoinGeneratedListDto,
  RevokeShareLinkDto,
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
 * Several accounts' global usernames at once, for the messages that name people
 * core knows only by id (plan 0114, section 9).
 *
 * **It fails empty**, for the reason {@link resolveUsername} fails null: a name
 * is an improvement on a fallback the client still draws, and losing a share or
 * a page of shared baskets because auth was briefly unreachable would not be.
 */
export async function resolveUsernames(
  nats: NatsClient,
  userIds: readonly string[]
): Promise<UserUsernameView[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) {
    return [];
  }
  try {
    const req: GetUsernamesRequest = { userIds: ids };
    return await nats.send<UserUsernameView[]>(AUTH_PATTERNS.getUsernames, req);
  } catch {
    return [];
  }
}

/**
 * What a profile refuses, as the basket read applies it (plans 0064 and 0066,
 * section 4): the shops one by one, and the chains whole.
 *
 * The ids only. It is `ShopperSelection` with the postal codes taken off,
 * because a basket is priced at scopes that were resolved when it was composed
 * and nothing here re-resolves them: the refusals govern which of a scope's
 * shops may be named, not which scopes there are.
 */
interface ShopRefusalIds {
  supermarketIds: readonly string[];
  supermarketLocationIds: readonly string[];
}

/** Refusing nothing, which is what every branch that cannot ask lands on. */
const NO_REFUSALS: ShopRefusalIds = {
  supermarketIds: [],
  supermarketLocationIds: [],
};

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

  /**
   * Add one of the caller's contacts to the basket (plan 0114, section 4).
   *
   * Owner only, and not found for anybody else's basket. The person must share
   * an approved group with the owner right now, or the answer is
   * `validation_failed`. A person already on the basket by the link becomes an
   * added member, whom revoking the link no longer reaches, and a person who was
   * removed or who left is brought back.
   *
   * Their global name is resolved here and handed to core, which uses it only
   * when the two people share no group or several (section 9).
   */
  @Post(':id/participants')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.participantAdd, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    body: true,
    notFound: true,
    conflict: true,
  })
  async addParticipant(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddGeneratedListParticipantDto
  ): Promise<GeneratedListParticipantView> {
    const [named] = await resolveUsernames(this.nats, [dto.userId]);
    const req: AddGeneratedListParticipantRequest = {
      userId: user.userId,
      generatedListId: id,
      memberUserId: dto.userId,
      globalUsername: named?.username ?? null,
    };
    return this.nats.send<GeneratedListParticipantView>(
      GENERATED_LIST_SHARING_PATTERNS.participantAdd,
      req
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
  @ApiProblemResponses({ body: true, participant: true, notFound: true })
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

  /** Who else is on this basket, for the shop screen. */
  @Get(':id/participants/mine')
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.participantList)
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
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
   * Leave the basket (plan 0114, section 6).
   *
   * A registered participant only: a guest is `forbidden` and the owner is
   * `validation_failed`. Somebody who left may come back through the link while
   * they still hold it, which a removed person may not.
   *
   * It only works because this controller is registered before the owner's
   * sheet. `DELETE :id/participants/:participantId` there matches `mine` as a
   * participant id, and the first matching route is the one that runs, so the
   * other order would send every leave to the account guard and to a core lookup
   * for a participant called `mine`. See {@link GENERATED_LIST_SHARING_CONTROLLERS}.
   */
  @Delete(':id/participants/mine')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(GENERATED_LIST_SHARING_PATTERNS.participantLeave)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    notFound: true,
  })
  leave(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    const req: LeaveGeneratedListRequest = {
      generatedListId: id,
      participantId: participant.participantId,
    };
    return this.nats.send<{ id: string }>(
      GENERATED_LIST_SHARING_PATTERNS.participantLeave,
      req
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
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiComposedResponse(
    GENERATED_LIST_SHARING_SCHEMA_IDS.participantTokenResult,
    { status: HttpStatus.CREATED }
  )
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
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
 * The three controllers sharing adds.
 *
 * **The order is a routing rule.** The participant surface comes first, because
 * its `DELETE :id/participants/mine` (plan 0114, section 6) and the owner's
 * `DELETE :id/participants/:participantId` both match a leave: Nest registers
 * routes in controller order and the first match runs, so the literal path has
 * to be registered before the parameter. No other participant route matches one
 * of the owner's, which is what makes the move safe. The owner's account
 * authenticated sheet and the unauthenticated pair follow.
 */
export const GENERATED_LIST_SHARING_CONTROLLERS = [
  GeneratedListParticipantController,
  GeneratedListShareController,
  ShareLinkController,
];
