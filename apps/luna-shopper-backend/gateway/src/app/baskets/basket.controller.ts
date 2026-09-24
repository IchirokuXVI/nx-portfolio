import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BASKET_PATTERNS,
  BASKET_SCHEMA_IDS,
  type AcknowledgeBasketChangesRequest,
  type AddBasketLineRequest,
  type BasketChangePage,
  type BasketChangesAcknowledged,
  type BasketResult,
  type BasketRowResult,
  type BasketSearchScope,
  type BasketSearchScopeRequest,
  type BasketSummaryView,
  type BasketView,
  type CatalogSuggestResponse,
  type BasketParticipantContext,
  type GetBasketRequest,
  type GetLiveBasketRequest,
  type ListBasketChangesRequest,
  type RenameBasketRowRequest,
  type RevertBasketRowRequest,
  type SetBasketRowDemandRequest,
  type SettleBasketRowRequest,
  type SettlementPaid,
  type SkipBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketShopLockedException,
  ForbiddenException,
  UuidParam,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { SUGGEST_SCHEMA } from '../catalog/catalog.controller';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
  componentRef,
} from '../docs';
import { BasketSuggestQueryDto } from '../baskets/basket-sharing.dto';
import {
  PARTICIPANT_THROTTLE_LIMITS,
  ParticipantThrottle,
  ParticipantThrottlerGuard,
} from '../baskets/participant-throttler.guard';
import {
  Participant,
  ParticipantGuard,
} from '../baskets/participant.guard';
import { NatsClient } from '../messaging/nats-client';
import { BasketCatalogService } from './basket-catalog.service';
import {
  AcknowledgeBasketChangesDto,
  AddBasketLineDto,
  BasketChangesQueryDto,
  BasketReadQueryDto,
  RenameBasketRowDto,
  RevertBasketRowDto,
  SetBasketRowDemandDto,
  SettleBasketRowDto,
} from './basket.dto';
import { pricedItemId, SettlePriceService } from './settle-price.service';

/**
 * The basket that is always there (plan 0136, section 4).
 *
 * Account only, and its own controller because of the guard: everything else
 * under `/v1/baskets` is the participant surface, where a guest arrives with a
 * session secret and no account.
 *
 * **It is registered before {@link BasketController}**, and the order is a
 * routing rule rather than a preference: `live` and `:id` both match
 * `GET /v1/baskets/live`, Nest registers routes in controller order and the
 * first match runs, so the literal path has to come first or the participant
 * guard would answer a route that has no participant.
 */
@ApiTags('baskets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'baskets', version: '1' })
export class BasketLiveController {
  constructor(
    private readonly nats: NatsClient,
    private readonly catalog: BasketCatalogService
  ) {}

  /**
   * The caller's permanent basket, created the first time they ask for it.
   *
   * Idempotent the way a create is: two tabs opening the app at once make one
   * basket, through the partial unique index rather than through a lock.
   */
  @Get('live')
  @ApiComposedResponse(BASKET_SCHEMA_IDS.result)
  @ApiProblemResponses({ auth: true, body: true })
  async live(
    @AuthUser() user: CurrentUser,
    @Query() query?: BasketReadQueryDto
  ): Promise<BasketResult> {
    // The chain of the shop the device chose, so each row says whether it is
    // usually bought there (plan 0165). Absent when the read has no shop.
    const supermarketId = query?.locationId
      ? await this.catalog.chainOf(query.locationId)
      : undefined;
    const req: GetLiveBasketRequest = {
      userId: user.userId,
      ...(supermarketId ? { supermarketId } : {}),
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.live, req);
    // The shop the device chose, which is the only way a `LIVE` basket's shop
    // reaches the server (plan 0163; velista 0091, section 7). The permanent
    // basket never has one of its own, so it is never locked.
    return this.catalog.compose(basket, basket.me.id, query?.locationId);
  }

  /**
   * The three numbers the home card draws, with no rows behind them.
   *
   * Its own route because the card must not pay for a thousand rows and a
   * catalog composition to show three numbers.
   */
  @Get('live/summary')
  @ApiContractResponse(BASKET_PATTERNS.liveSummary)
  @ApiProblemResponses({ auth: true })
  summary(@AuthUser() user: CurrentUser): Promise<BasketSummaryView> {
    const req: GetLiveBasketRequest = { userId: user.userId };
    return this.nats.send<BasketSummaryView>(BASKET_PATTERNS.liveSummary, req);
  }
}

/**
 * The basket, and the seven writes on a row (plan 0136; plan 0137).
 *
 * Every route is behind {@link ParticipantGuard}: the gateway turns a credential
 * into a participant and the participant is the whole of the identity here. An
 * owner reading their own basket arrives as their own participant row like
 * everybody else, which is what lets one screen serve all three readers.
 *
 * ## A row is addressed by a line id
 *
 * `rowKey` is the anchor's list line id, and any entry's id names the same row.
 * A row has no identity of its own because it is recomputed on every read, and a
 * row whose anchor was bought to zero a moment ago must not turn the next tap
 * into a not found.
 */
@ApiTags('baskets')
@UseGuards(ParticipantGuard)
@Controller({ path: 'baskets', version: '1' })
export class BasketController {
  constructor(
    private readonly nats: NatsClient,
    private readonly catalog: BasketCatalogService,
    /** What a settle cost, read here and never sent by a client (plan 0143). */
    private readonly prices: SettlePriceService
  ) {}

  /**
   * The basket, its rows, its people and the products they name.
   *
   * `locationId` reads it at one shop (plan 0163, section 2): every product is
   * priced at that shop's scope stack and carries what catalog knows about its
   * availability there. A basket started at a shop is always read at that
   * shop, and a different `locationId` answers 409 `basket_shop_locked`.
   *
   * A read with a shop also says, on every row, how often its lines were
   * bought at that shop's chain (plan 0165). The chain is learned before core
   * is asked for the rows, because core counts and catalog knows chains.
   */
  @Get(':id')
  @ApiComposedResponse(BASKET_SCHEMA_IDS.result)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    body: true,
    shopLocked: true,
  })
  async get(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Query() query?: BasketReadQueryDto
  ): Promise<BasketResult> {
    const { searchScope, supermarketId } = await this.catalog.readShopOf(
      id,
      participant.participantId,
      query?.locationId
    );
    const req: GetBasketRequest = {
      basketId: id,
      participantId: participant.participantId,
      ...(supermarketId ? { supermarketId } : {}),
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.get, req);
    return this.catalog.compose(
      basket,
      participant.participantId,
      query?.locationId,
      searchScope
    );
  }

  /** Say what happened to a row at the shelf. */
  @Post(':id/rows/:rowKey/settle')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  // 201, which is what Nest answers for a `POST` and what the settle this
  // replaced already documented: a write on a row appends a settlement row
  // rather than replacing one.
  @ApiContractResponse(BASKET_PATTERNS.rowSettle, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
    finishedBasket: true,
    shopLocked: true,
  })
  async settle(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: SettleBasketRowDto
  ): Promise<BasketRowResult> {
    const req: SettleBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      outcome: dto.outcome,
      quantity: dto.quantity,
      from: dto.from,
      itemId: dto.itemId,
      allocations: dto.allocations,
      // What the screen said one of it costs, read here and never sent by the
      // client (plan 0143). It runs **before** the write and not after it: a
      // second message attaching a price to a settlement already written would
      // have to find its rows again after a revert split them.
      paid: (await this.paidFor(id, rowKey, participant, dto)) ?? undefined,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowSettle, req);
  }

  /**
   * The price a settle records, read as the basket's **owner** (plan 0143,
   * section 4.2).
   *
   * The owner and the profile come from `basket.searchScope`, which is the
   * question the basket read already asks to price the screen, and the same
   * message now carries whether this actor is served shops. So an actor who is
   * a registered participant with a profile of their own, or a guest with none,
   * still records the owner's price at the owner's scopes: the owner delegated
   * shopping, not pricing.
   *
   * It costs one catalog round trip more than a settle used to, at most the
   * service's own budget and usually a few milliseconds, and only when the
   * client named a scope.
   *
   * A settle that names no `itemId` also sends the `rowKey`, and core answers
   * which product that row records (plan 0151). That is the product priced
   * here, so the price and the settlement cannot disagree, and it costs no
   * extra round trip.
   */
  private async paidFor(
    basketId: string,
    rowKey: string,
    participant: BasketParticipantContext,
    dto: SettleBasketRowDto
  ): Promise<SettlementPaid | null> {
    // A shop with no scope is still asked about, so that a basket started at
    // another shop refuses it (plan 0163, section 5). Neither is nothing to
    // record, and costs no round trip.
    if (!dto.priceScopeId && !dto.supermarketLocationId) {
      return null;
    }
    const req: BasketSearchScopeRequest = {
      basketId,
      participantId: participant.participantId,
      ...(dto.itemId === undefined && dto.priceScopeId ? { rowKey } : {}),
    };
    let scope: BasketSearchScope;
    try {
      scope = await this.nats.send<BasketSearchScope>(
        BASKET_PATTERNS.searchScope,
        req
      );
    } catch {
      // Core could not say whose basket this is, so there is no owner to price
      // as. The settle itself is about to ask core the same question and will
      // fail or succeed on its own terms.
      return null;
    }
    // The settle's shop: the basket's own if it has one, else the one the
    // client named, else none (plan 0163, section 5). A basket started at a
    // shop refuses another, and a settle that names none records the basket's.
    const own = scope.supermarketLocationId ?? null;
    if (own && dto.supermarketLocationId && dto.supermarketLocationId !== own) {
      throw new BasketShopLockedException(
        'This basket was started at another shop'
      );
    }
    if (!dto.priceScopeId) {
      // A place with no scope is not recorded: the shop is never stored
      // without the scope it was priced at.
      return null;
    }
    return this.prices.read({
      userId: scope.ownerUserId,
      profileId: scope.profileId ?? undefined,
      itemId: pricedItemId(dto.itemId, scope.pick),
      priceScopeId: dto.priceScopeId,
      supermarketLocationId: own ?? dto.supermarketLocationId,
      servedLocations: scope.servesLocations,
    });
  }

  /** Take back units somebody said they bought, or the close on a row. */
  @Post(':id/rows/:rowKey/revert')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  // 201, which is what Nest answers for a `POST` and what the settle this
  // replaced already documented: a write on a row appends a settlement row
  // rather than replacing one.
  @ApiContractResponse(BASKET_PATTERNS.rowRevert, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
    finishedBasket: true,
  })
  revert(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: RevertBasketRowDto
  ): Promise<BasketRowResult> {
    const req: RevertBasketRowRequest =
      dto.target === 'UNITS'
        ? {
            basketId: id,
            participantId: participant.participantId,
            rowKey,
            target: 'UNITS',
            // The DTO cannot require them on one branch alone without a `oneOf`
            // that renders badly in the published document, so the two fields
            // are optional there and required here, where the branch is known.
            units: requireField(dto.units, 'units'),
            from: requireField(dto.from, 'from'),
          }
        : {
            basketId: id,
            participantId: participant.participantId,
            rowKey,
            target: 'CLOSE',
          };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowRevert, req);
  }

  /** Change what one household asks for, from the basket. */
  @Post(':id/rows/:rowKey/demand')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  // 201, which is what Nest answers for a `POST` and what the settle this
  // replaced already documented: a write on a row appends a settlement row
  // rather than replacing one.
  @ApiContractResponse(BASKET_PATTERNS.rowDemand, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    notFound: true,
    finishedBasket: true,
  })
  demand(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: SetBasketRowDemandDto
  ): Promise<BasketRowResult> {
    const req: SetBasketRowDemandRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      lineId: dto.lineId,
      quantity: dto.quantity,
      from: dto.from,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowDemand, req);
  }

  /** Rename a row, and every list line it is made of (plan 0113's rule). */
  @Patch(':id/rows/:rowKey')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowRename)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    finishedBasket: true,
    lineMerge: true,
  })
  rename(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: RenameBasketRowDto
  ): Promise<BasketRowResult> {
    const req: RenameBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId: requireAccount(participant),
      rowKey,
      content: dto.content,
      confirmMerge: dto.confirmMerge,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowRename, req);
  }

  /**
   * Put a row off for now (plan 0137, section 5.1).
   *
   * A `PUT` rather than a `POST`, because it states a condition the row is to be
   * in rather than appending an act: a second call changes nothing and answers
   * the same row. Any live participant may send it, a guest included, and
   * neither this nor the `DELETE` takes a body.
   */
  @Put(':id/rows/:rowKey/skip')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowSkip)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    // A row bought to zero while the sheet was open has nothing left to skip,
    // which is a plain conflict beside the finished basket's own code.
    conflict: true,
    finishedBasket: true,
  })
  skip(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string
  ): Promise<BasketRowResult> {
    const req: SkipBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowSkip, req);
  }

  /** Take the skip back (plan 0137, section 5.2). Finding none is not an error. */
  @Delete(':id/rows/:rowKey/skip')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowUnskip)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    finishedBasket: true,
  })
  unskip(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string
  ): Promise<BasketRowResult> {
    const req: SkipBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowUnskip, req);
  }

  /**
   * Put a line on one of the basket's lists.
   *
   * **Account participants only**, which reverses plan 0055's guest composer:
   * a basket holds no lines of its own any more, so there is nowhere for a line
   * with no list to live and every add is a write to a household.
   */
  @Post(':id/lines')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.lineAdd, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    notFound: true,
    finishedBasket: true,
  })
  addLine(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Body() dto: AddBasketLineDto
  ): Promise<BasketRowResult> {
    const req: AddBasketLineRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId: requireAccount(participant),
      targetListId: dto.targetListId,
      content: dto.content,
      quantity: dto.quantity,
      itemIds: dto.itemIds,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.lineAdd, req);
  }

  /**
   * What changed on the lists this basket covers, newest first (plan 0138,
   * section 8).
   *
   * A history rather than a nudge, so it includes the reader's own changes: the
   * marks on the basket read are what leave those out. Unthrottled like the other
   * reads on this surface.
   */
  @Get(':id/changes')
  @ApiContractResponse(BASKET_PATTERNS.changesList)
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
  changes(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Query() query: BasketChangesQueryDto
  ): Promise<BasketChangePage> {
    const req: ListBasketChangesRequest = {
      basketId: id,
      participantId: participant.participantId,
      cursor: query.cursor,
      limit: query.limit,
    };
    return this.nats.send<BasketChangePage>(BASKET_PATTERNS.changesList, req);
  }

  /**
   * Say which changes this viewer has drawn (section 6).
   *
   * A `POST` rather than a `PUT`, because it moves a cursor forward rather than
   * stating where the cursor is: a `through` at or before it writes nothing and
   * answers the count as it stands, and a cursor can never move backwards.
   *
   * **The client sends it only while the marked rows, or the changes view, were on
   * screen with the document visible.** A background refetch acknowledges nothing.
   * This route cannot tell the difference and does not try to: the rule is the
   * client's to keep, and velista 0093 says how.
   */
  @Post(':id/changes/seen')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.changesAcknowledge, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
  })
  acknowledgeChanges(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Body() dto: AcknowledgeBasketChangesDto
  ): Promise<BasketChangesAcknowledged> {
    const req: AcknowledgeBasketChangesRequest = {
      basketId: id,
      participantId: participant.participantId,
      through: dto.through,
    };
    return this.nats.send<BasketChangesAcknowledged>(
      BASKET_PATTERNS.changesAcknowledge,
      req
    );
  }

  /** The composer's dropdown, priced at the basket's own scopes. */
  @Get(':id/catalog/suggest')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.suggest)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiOkResponse({
    description:
      'The dropdown, in the order it is to be drawn: every matching group first, then the individual products. The same body /v1/catalog/suggest answers, field for field.',
    schema: componentRef(SUGGEST_SCHEMA),
  })
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
  async suggest(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Query() query: BasketSuggestQueryDto
  ): Promise<CatalogSuggestResponse> {
    const scope = await this.nats.send<BasketSearchScope>(
      BASKET_PATTERNS.searchScope,
      { basketId: id, participantId: participant.participantId }
    );

    // The owner's catalog read at the basket's scopes, whoever is asking, so a
    // guest gets the same members and the same chains as the owner (plan 0161).
    return this.catalog.suggest({
      userId: scope.ownerUserId,
      query: query.q,
      limit: query.limit,
      resolved: await this.catalog.describeScopes(scope),
    });
  }
}

/**
 * The actor's account, for the two routes that are not delegated writes.
 *
 * Adding a line and renaming a row are authorized by the **person making
 * them**, so a guest is refused here rather than in core: they present a
 * session secret and hold no `WRITE` on anything.
 */
function requireAccount(participant: BasketParticipantContext): string {
  if (!participant.userId) {
    throw new ForbiddenException(
      'Only people with an account can do this on a basket'
    );
  }
  return participant.userId;
}

/**
 * A field the DTO could not require on its own branch.
 *
 * `RevertBasketRowDto` would need a `oneOf` to say that `units` and `from`
 * belong to `UNITS` alone, and a `oneOf` renders badly in the published document
 * where a client author reads one request body. So the two are optional there
 * and required here, where the branch is known.
 */
function requireField<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new ValidationException(`${field} is required for this target`, {
      messageArgs: { field },
    });
  }
  return value;
}
