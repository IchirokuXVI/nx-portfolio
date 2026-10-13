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
  type BasketLinePick,
  type BasketMarksView,
  type BasketParticipantContext,
  type BasketProductListsView,
  type BasketResult,
  type BasketRowResult,
  type BasketSearchScope,
  type BasketSearchScopeRequest,
  type BasketSummaryView,
  type BasketView,
  type CatalogSuggestResponse,
  type GetBasketMarksRequest,
  type GetBasketProductListsRequest,
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
import { BasketSuggestQueryDto } from '../baskets/basket-sharing.dto';
import {
  PARTICIPANT_THROTTLE_LIMITS,
  ParticipantThrottle,
  ParticipantThrottlerGuard,
} from '../baskets/participant-throttler.guard';
import { Participant, ParticipantGuard } from '../baskets/participant.guard';
import { SUGGEST_SCHEMA } from '../catalog/catalog.controller';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
  componentRef,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  BasketCatalogService,
  type BasketReadPrices,
} from './basket-catalog.service';
import {
  AcknowledgeBasketChangesDto,
  AddBasketLineDto,
  BasketChangesQueryDto,
  BasketReadQueryDto,
  RenameBasketRowDto,
  RevertBasketRowDto,
  SetBasketRowDemandDto,
  SettleBasketRowDto,
  SkipBasketRowDto,
  UnskipBasketRowQueryDto,
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
    // The shop the device chose, which is the only way a `LIVE` basket's shop
    // reaches the server (plan 0163; velista 0091, section 7). The permanent
    // basket never has one of its own, so it is never locked.
    const locationId = query?.locationId;
    // Beside each other, because neither needs the other. The shop gives its
    // chain, so each row says whether it is usually bought there (plan 0165).
    // The other question creates the basket and answers the lines whose
    // product only a price can choose (plan 0201, section 1).
    const [shop, choices] = await Promise.all([
      locationId ? this.catalog.shopAt(locationId, []) : null,
      this.catalog.livePriceChoicesOf(user.userId),
    ]);
    // Asked here only when a line needs a price, because the scopes that
    // count are the owner's. Otherwise the composition asks it, as it always
    // did.
    const searchScope =
      choices && choices.lines.length > 0
        ? await this.catalog.searchScopeOf(
            choices.basketId,
            choices.participantId
          )
        : undefined;
    const prices =
      choices && searchScope !== undefined
        ? await this.catalog.pricesFor(
            choices.lines,
            searchScope,
            locationId,
            shop
          )
        : null;
    const supermarketId = shop?.supermarket.id;
    const req: GetLiveBasketRequest = {
      userId: user.userId,
      ...(supermarketId ? { supermarketId } : {}),
      ...picksOn(prices),
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.live, req);
    return this.catalog.compose(
      basket,
      basket.me.id,
      locationId,
      searchScope,
      prices
    );
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
 *
 * ## A write names its lines
 *
 * Two reads at two shops can group the same lines differently, so the key
 * alone does not say which lines a tap meant (plan 0201, section 4). Every
 * write on a row carries `lineIds`, core acts on those lines and no others,
 * and `rowKey` must be one of them.
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
   *
   * A row is a product (plan 0201), and a line with several products and no
   * favourite counts as the cheapest of them. Core holds no price, so core is
   * asked first which lines need one, the gateway prices them, and the read of
   * the rows carries a pick for each. A basket with no such line pays one
   * small message to core and nothing to catalog.
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
    // Beside each other, because neither needs the other. A basket started at
    // another shop is refused by the first, before anything is priced.
    const [{ searchScope, supermarketId, shopId, shop }, choices] =
      await Promise.all([
        this.catalog.readShopOf(
          id,
          participant.participantId,
          query?.locationId
        ),
        this.catalog.priceChoicesOf(id, participant.participantId),
      ]);
    const prices = await this.catalog.pricesFor(
      choices?.lines ?? [],
      searchScope,
      shopId,
      shop
    );
    const req: GetBasketRequest = {
      basketId: id,
      participantId: participant.participantId,
      ...(supermarketId ? { supermarketId } : {}),
      ...picksOn(prices),
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.get, req);
    return this.catalog.compose(
      basket,
      participant.participantId,
      query?.locationId,
      searchScope,
      prices
    );
  }

  /**
   * The covered lists that can still take a product (plan 0201, section 5).
   *
   * Every covered list the actor may write that has no line counting as that
   * product, each with its line that holds the product when it has one. The
   * page raises such a line with the demand route, and adds one with
   * `POST :id/lines` otherwise.
   *
   * Account participants only, and core is what refuses a guest with
   * `forbidden`: the lists a person may write are a fact about their account.
   * Unthrottled like the other reads on this surface.
   */
  @Get(':id/products/:itemId/lists')
  @ApiContractResponse(BASKET_PATTERNS.productLists)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    membership: true,
    notFound: true,
  })
  productLists(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @UuidParam('itemId') itemId: string
  ): Promise<BasketProductListsView> {
    const req: GetBasketProductListsRequest = {
      basketId: id,
      participantId: participant.participantId,
      itemId,
    };
    return this.nats.send<BasketProductListsView>(
      BASKET_PATTERNS.productLists,
      req
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
    // Beside each other, because neither needs the other and both are held to
    // the same budget, so a settle waits for the slower of the two and not
    // for their sum.
    const [paid] = await Promise.all([
      // What the screen said one of it costs, read here and never sent by the
      // client (plan 0143). It runs **before** the write and not after it: a
      // second message attaching a price to a settlement already written would
      // have to find its rows again after a revert split them.
      this.paidFor(id, participant, dto),
      // The product can be one that is on none of the lines, so core cannot
      // check the id and catalog is asked (plan 0201, section 4). Only a
      // definite "catalog does not know it" refuses the buy.
      dto.itemId === undefined
        ? undefined
        : this.prices.refuseUnknownItem(dto.itemId),
    ]);
    const req: SettleBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      lineIds: dto.lineIds,
      outcome: dto.outcome,
      quantity: dto.quantity,
      from: dto.from,
      itemId: dto.itemId,
      allocations: dto.allocations,
      paid: paid ?? undefined,
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
   * A settle that names no `itemId` also sends its `lineIds`, and core answers
   * which product those lines record (plan 0151; plan 0201). That is the
   * product priced here, so the price and the settlement cannot disagree, and
   * it costs no extra round trip.
   */
  private async paidFor(
    basketId: string,
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
      ...(dto.itemId === undefined && dto.priceScopeId
        ? { lineIds: dto.lineIds }
        : {}),
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
            lineIds: dto.lineIds,
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
            lineIds: dto.lineIds,
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

  /**
   * Rename the named lines of a row, each on its own list (plan 0113's rule).
   *
   * Core refuses a line that has a product with `validation_failed`: a row
   * with a product is named by the catalog (plan 0201, section 4).
   */
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
      lineIds: dto.lineIds,
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
   * the same lines. Any live participant may send it, a guest included.
   *
   * The body names the lines to put off (plan 0201, section 4). The `DELETE`
   * names them in its query, because a body on a `DELETE` is not delivered
   * reliably.
   */
  @Put(':id/rows/:rowKey/skip')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowSkip)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
    // A row bought to zero while the sheet was open has nothing left to skip,
    // which is a plain conflict beside the finished basket's own code.
    conflict: true,
    finishedBasket: true,
  })
  skip(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: SkipBasketRowDto
  ): Promise<BasketRowResult> {
    const req: SkipBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      lineIds: dto.lineIds,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowSkip, req);
  }

  /**
   * Take the skip back (plan 0137, section 5.2). Finding none is not an error.
   *
   * The lines are named in the query, comma separated (`?lineIds=a,b`).
   */
  @Delete(':id/rows/:rowKey/skip')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowUnskip)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
    finishedBasket: true,
  })
  unskip(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Query() query: UnskipBasketRowQueryDto
  ): Promise<BasketRowResult> {
    const req: SkipBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      lineIds: query.lineIds,
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
   * The marks and the count alone (plan 0204, section 6).
   *
   * What a client reads after a `basket.linesChanged` said `marksMoved`. It
   * holds the rows already, and a room cannot carry a mark, because a mark
   * depends on what each viewer acknowledged. So this answers the marks of the
   * caller and nothing else: no rows, no people, and no catalog read.
   *
   * Unthrottled like the other reads on this surface.
   */
  @Get(':id/changes/marks')
  @ApiContractResponse(BASKET_PATTERNS.changesMarks)
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
  marks(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string
  ): Promise<BasketMarksView> {
    const req: GetBasketMarksRequest = {
      basketId: id,
      participantId: participant.participantId,
    };
    return this.nats.send<BasketMarksView>(BASKET_PATTERNS.changesMarks, req);
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
 * The picks of a read as the request carries them, or nothing (plan 0201).
 *
 * Absent rather than empty when nothing was priced, so a basket with no line
 * that needs a price sends core the request it always sent.
 */
function picksOn(prices: BasketReadPrices | null): {
  picks?: BasketLinePick[];
} {
  return prices && prices.picks.length > 0 ? { picks: prices.picks } : {};
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
