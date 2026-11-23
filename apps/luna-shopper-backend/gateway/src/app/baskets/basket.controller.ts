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
  BASKET_LIMITS,
  BASKET_PATTERNS,
  BASKET_SCHEMA_IDS,
  CONTENT_LOCALES,
  type AcknowledgeBasketChangesRequest,
  type AddBasketLineRequest,
  type BasketChangePage,
  type BasketChangesAcknowledged,
  type BasketMarksView,
  type BasketParticipantContext,
  type BasketProductListsView,
  type BasketResult,
  type BasketRowResult,
  type BasketSearchScope,
  type BasketSearchScopeRequest,
  type BasketSummaryView,
  type BasketView,
  type BuyForListBasketRequest,
  type CatalogSuggestResponse,
  type ChangeBasketLinesProductRequest,
  type GetBasketMarksRequest,
  type GetBasketProductListsRequest,
  type GetLiveBasketRequest,
  type ItemSnapshot,
  type LineUnit,
  type ListBasketChangesRequest,
  type RenameBasketRowRequest,
  type RevertBasketRowRequest,
  type SetBasketRowDemandRequest,
  type SettleBasketRowRequest,
  type SkipBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketShopLockedException,
  ForbiddenException,
  getRequestContext,
  toSupportedLocale,
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
import { LineUnitCheck } from '../lists/line-unit-check';
import { NatsClient } from '../messaging/nats-client';
import { BasketCatalogService } from './basket-catalog.service';
import {
  AcknowledgeBasketChangesDto,
  AddBasketLineDto,
  BasketChangesQueryDto,
  BasketReadQueryDto,
  BuyForListBasketRowDto,
  ChangeBasketLinesProductDto,
  RenameBasketRowDto,
  RevertBasketRowDto,
  SetBasketRowDemandDto,
  SettleBasketRowDto,
  SkipBasketRowDto,
  UnskipBasketRowQueryDto,
} from './basket.dto';
import {
  pricedItemId,
  SettlePriceService,
  type RewriteChoice,
  type SettleChoice,
} from './settle-price.service';

/**
 * What the two rows routes say about their answer (plan 0205, section 3).
 *
 * The prices are the reason it is written down: a client that reads the rows
 * alone goes on drawing the prices of its last full read.
 */
const ROWS_ALONE =
  'The rows, the lists, the people, the progress and the marks of the basket, with no products, no price scopes and no shop. For a client that already holds those from the full read and reads again after an event. The prices such a client draws are as old as its last full read: it makes a full read when the page opens, when the app comes back and when the socket reconnects, and a price changes when a harvest runs. When a row names a product the client does not hold, it makes the full read.';

/** Core could not be asked, so the settle records no price and no name. */
const NOTHING_CHOSEN: SettleChoice = { paid: null, itemSnapshot: null };

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
    const locationId = query?.locationId;
    const { basket, searchScope, prices } = await this.catalog.liveRowsOf(
      user.userId,
      locationId
    );
    return this.catalog.compose(
      basket,
      basket.me.id,
      locationId,
      searchScope,
      prices
    );
  }

  /**
   * The rows of the caller's permanent basket, with no catalog half (plan
   * 0205, section 3).
   *
   * The read of a client that already holds the products, the scopes and the
   * shop from a full read, and needs the rows again after an event. It asks
   * what {@link live} asks up to the rows and stops there: no products, no
   * scopes, no shop. Like {@link live} it creates the basket the first time.
   *
   * It takes the `locationId` of the full read, because `usual` depends on
   * the chain of that shop and the product of a line can depend on its
   * prices.
   */
  @Get('live/rows')
  @ApiContractResponse(BASKET_PATTERNS.live, { description: ROWS_ALONE })
  @ApiProblemResponses({ auth: true, body: true })
  async liveRows(
    @AuthUser() user: CurrentUser,
    @Query() query?: BasketReadQueryDto
  ): Promise<BasketView> {
    const { basket } = await this.catalog.liveRowsOf(
      user.userId,
      query?.locationId
    );
    return basket;
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
  /** The unit a line is allowed, on the basket's add (plan 0246, section 4.2). */
  private readonly units: LineUnitCheck;

  constructor(
    private readonly nats: NatsClient,
    private readonly catalog: BasketCatalogService,
    /** What a settle cost, read here and never sent by a client (plan 0143). */
    private readonly prices: SettlePriceService
  ) {
    this.units = new LineUnitCheck(nats);
  }

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
    const { basket, searchScope, prices } = await this.catalog.rowsOf(
      id,
      participant.participantId,
      query?.locationId
    );
    return this.catalog.compose(
      basket,
      participant.participantId,
      query?.locationId,
      searchScope,
      prices
    );
  }

  /**
   * The rows, the lists, the people, the progress and the marks, as core
   * computes them, with no catalog half (plan 0205, section 3).
   *
   * The read of a client that already holds the products, the scopes and the
   * shop from a full read, and needs the rows again after an event (velista
   * plan 0143). It asks what {@link get} asks up to the rows and stops there.
   * The full read is the read of a page that opens.
   *
   * It takes the `locationId` of the full read, because `usual` depends on
   * the chain of that shop and the product of a line can depend on its
   * prices. A basket started at a shop refuses another with the same 409.
   *
   * A row can name a product the client does not hold, for one a line that
   * somebody added since. The client then makes the full read.
   */
  @Get(':id/rows')
  @ApiContractResponse(BASKET_PATTERNS.get, { description: ROWS_ALONE })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    body: true,
    shopLocked: true,
  })
  async rows(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Query() query?: BasketReadQueryDto
  ): Promise<BasketView> {
    const { basket } = await this.catalog.rowsOf(
      id,
      participant.participantId,
      query?.locationId
    );
    return basket;
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
    lineUnitMismatch: true,
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
    const [chosen] = await Promise.all([
      // What one of it costs and what it is called, read here and never sent
      // by the client (plan 0143; plan 0202). It runs **before** the write and
      // not after it: a second message attaching a price to a settlement
      // already written would have to find its rows again after a revert
      // split them.
      this.chosenFor(id, participant, dto),
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
      unit: dto.unit,
      from: dto.from,
      itemId: dto.itemId,
      allocations: dto.allocations,
      paid: chosen.paid ?? undefined,
      ...(chosen.itemSnapshot ? { itemSnapshot: chosen.itemSnapshot } : {}),
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowSettle, req);
  }

  /**
   * The price and the name a settle records, read as the basket's **owner**
   * (plan 0143, section 4.2; plan 0202, sections 1 and 2).
   *
   * The owner and the profile come from `basket.searchScope`, which is the
   * question the basket read already asks to price the screen, and the same
   * message carries whether this actor is served shops and the shop the basket
   * was started at. So an actor who is a registered participant with a profile
   * of their own, or a guest with none, still records the owner's price at the
   * owner's scopes: the owner delegated shopping, not pricing.
   *
   * **`dto.priceScopeId` is not read** (plan 0202, section 2). The gateway
   * chooses the price: at the shop of the settle, or the cheapest across the
   * owner's scopes when the settle has no shop. So every settle asks core this
   * one question, also a settle that names no shop and no scope, which asked
   * nothing before that plan. A settle of lines with no product then stops
   * here and asks catalog nothing.
   *
   * A settle that names no `itemId` sends its `lineIds`, and core answers which
   * product those lines record (plan 0151; plan 0201). That is the product
   * priced and named here, so the price, the name and the settlement cannot
   * disagree, and it costs no extra round trip. Since plan 0201 the lines agree
   * on one product or record none, so that answer is a product or nothing and
   * never a choice between several.
   */
  private async chosenFor(
    basketId: string,
    participant: BasketParticipantContext,
    dto: SettleChoiceInput
  ): Promise<SettleChoice> {
    const scope = await this.searchScopeOf(
      basketId,
      participant,
      dto.itemId === undefined ? dto.lineIds : undefined
    );
    if (scope === null) {
      return NOTHING_CHOSEN;
    }
    return this.choiceIn(scope, pricedItemId(dto.itemId, scope.pick), dto);
  }

  /**
   * `basket.searchScope` for a settle, or null when core could not
   * say whose basket this is: there is no owner to price as, and the write
   * itself is about to ask core the same question and will fail or succeed on
   * its own terms. With `lineIds`, the answer's `pick` is the product those
   * lines record.
   */
  private async searchScopeOf(
    basketId: string,
    participant: BasketParticipantContext,
    lineIds: string[] | undefined
  ): Promise<BasketSearchScope | null> {
    const req: BasketSearchScopeRequest = {
      basketId,
      participantId: participant.participantId,
      ...(lineIds === undefined ? {} : { lineIds }),
    };
    try {
      return await this.nats.send<BasketSearchScope>(
        BASKET_PATTERNS.searchScope,
        req
      );
    } catch {
      return null;
    }
  }

  /** {@link chosenFor}'s price and name of one product, once the scope is known. */
  private choiceIn(
    scope: BasketSearchScope,
    itemId: string | undefined,
    dto: Pick<SettleChoiceInput, 'supermarketLocationId' | 'unit'>
  ): Promise<SettleChoice> {
    // The settle's shop: the basket's own if it has one, else the one the
    // client named, else none (plan 0163, section 5). A basket started at a
    // shop refuses another, and a settle that names none records the basket's.
    const own = scope.supermarketLocationId ?? null;
    if (own && dto.supermarketLocationId && dto.supermarketLocationId !== own) {
      throw new BasketShopLockedException(
        'This basket was started at another shop'
      );
    }
    return this.prices.choose({
      userId: scope.ownerUserId,
      profileId: scope.profileId ?? undefined,
      itemId,
      supermarketLocationId: own ?? dto.supermarketLocationId,
      servedLocations: scope.servesLocations,
      // The price of one of the row's unit (plan 0246 M7).
      unit: dto.unit,
    });
  }

  /**
   * Record a buy of the row's product for a covered list that does not ask
   * for it (plan 0273).
   *
   * What the section "Add it to another list" of the basket's line sheet
   * sends. Core makes the list's line at quantity 0 when it has none and
   * records the buy on it in one transaction, so a failure leaves no line
   * behind. Afterwards the line is an entry of the row, and every plus and
   * minus on it is the settle and the revert with `lineIds: [lineId]`.
   *
   * **Account participants only**, who hold `WRITE` on the list themselves.
   * A guest is refused here, before catalog or core is asked.
   *
   * **The product is the row's** (plan 0273, amended on 2026-11-22): the
   * body names none, because this write can make a line on another
   * household's list. The gateway learns it as a settle that names no
   * product does, from `basket.searchScope` with the row key's line, and core
   * reads it again from the row and refuses a row with no product. The
   * product priced here rides the message as `expectedItemId`, and a row that
   * holds another by the time core reads it answers 409 `conflict`, so the
   * client reads the row again and retries.
   *
   * The price and the name are read as for a settle, as the basket's owner.
   * The name is catalog's, in the reader's language or else any it holds, and
   * is what a line made here is called. The unit is checked as the basket's
   * add checks it, because the write can make a line.
   *
   * A line that must be made needs that name, so two answers are kept apart
   * (plan 0273, amended again on 2026-11-22): a product catalog names in no
   * language answers 409 `basket_product_has_no_name`, and a catalog that did
   * not answer, by its budget or by a failure, answers 503
   * `catalog_unavailable`, which the client answers by trying again. Neither
   * writes anything. A buy on a line the list already holds needs no name and
   * goes on without catalog.
   */
  @Post(':id/rows/:rowKey/buy-for-list')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowBuyForList, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    conflict: true,
    finishedBasket: true,
    shopLocked: true,
    lineInRow: true,
    rowProduct: true,
    lineUnitMismatch: true,
    lineUnitDiffers: true,
    lineUnitNotOffered: true,
  })
  async buyForList(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: BuyForListBasketRowDto
  ): Promise<BasketRowResult> {
    const userId = requireAccount(participant);
    // The row's product, read off the row key's line. A row with no product
    // prices nothing here, and core answers `basket_row_has_no_product`. Not
    // through `searchScopeOf`: a core that cannot answer this is a failed core
    // call, as on every other route here, and never a catalog that was silent.
    const scopeReq: BasketSearchScopeRequest = {
      basketId: id,
      participantId: participant.participantId,
      lineIds: [rowKey],
    };
    const scope = await this.nats.send<BasketSearchScope>(
      BASKET_PATTERNS.searchScope,
      scopeReq
    );
    const itemId = pricedItemId(undefined, scope.pick);
    // Beside each other and under one budget each, as on a settle.
    const [chosen] = await Promise.all([
      itemId === undefined ? NOTHING_CHOSEN : this.choiceIn(scope, itemId, dto),
      // The basket's add checks the unit of a line it can make, and so does
      // this when it names no line. A named line keeps its own unit, which
      // core holds the buy to.
      dto.lineId || itemId === undefined
        ? undefined
        : this.units.assertOffered([{ unit: dto.unit, itemIds: [itemId] }]),
    ]);
    const content = nameIn(chosen.itemSnapshot);
    const req: BuyForListBasketRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId,
      rowKey,
      targetListId: dto.targetListId,
      ...(dto.lineId ? { lineId: dto.lineId } : {}),
      // The product priced and named above, built here and never read from
      // the body. Core refuses the write when the row holds another by then.
      expectedItemId: itemId ?? null,
      quantity: dto.quantity,
      unit: dto.unit,
      ...(content ? { content } : {}),
      // Core turns this into 503 `catalog_unavailable` when it must make the
      // line, and into nothing when the list already holds one.
      ...(chosen.unanswered ? { catalogUnanswered: true } : {}),
      paid: chosen.paid ?? undefined,
      ...(chosen.itemSnapshot ? { itemSnapshot: chosen.itemSnapshot } : {}),
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowBuyForList, req);
  }

  /**
   * Change the product of basket lines (plan 0202, section 3).
   *
   * What the page sends when somebody takes another product than the row
   * shows. Core rewrites the buys of this trip, so the lines count as the new
   * product, and with `keep` it also adds the product to each line and makes
   * it the favourite.
   *
   * **Account participants only.** A guest is refused here, before catalog or
   * core is asked: they settle what the row shows and hold no list.
   *
   * The gateway reads what the new product costs and what it is called, as it
   * does for a settle, and core reads neither. So core is asked first where
   * the buys of the trip were priced, the product is priced at those scopes,
   * and the answers ride the write.
   *
   * An `itemId` catalog does not know is `validation_failed`, by the rule of a
   * settle: only a definite "not found" refuses, and a slow catalog does not.
   * A line the basket does not cover answers 404 for the whole request.
   */
  @Post(':id/lines/product')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.linesProduct, {
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
  async changeProduct(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Body() dto: ChangeBasketLinesProductDto
  ): Promise<BasketRowResult> {
    const userId = requireAccount(participant);
    // Beside each other and under one budget each, as on a settle.
    const [chosen] = await Promise.all([
      this.rewriteChosenFor(id, participant, dto),
      this.prices.refuseUnknownItem(dto.itemId),
    ]);
    const req: ChangeBasketLinesProductRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId,
      lineIds: dto.lineIds,
      itemId: dto.itemId,
      keep: dto.keep,
      ...(chosen.itemSnapshot ? { itemSnapshot: chosen.itemSnapshot } : {}),
      ...(chosen.prices.length > 0 ? { prices: chosen.prices } : {}),
      ...(chosen.paid ? { paid: chosen.paid } : {}),
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.linesProduct, req);
  }

  /**
   * What a change of product records on the buys it rewrites (plan 0202,
   * section 3), read as the basket's owner.
   *
   * `basket.searchScope` answers where the standing buys of the named lines in
   * this trip were priced. With none of them there is nothing to rewrite, and
   * catalog is not asked.
   */
  private async rewriteChosenFor(
    basketId: string,
    participant: BasketParticipantContext,
    dto: ChangeBasketLinesProductDto
  ): Promise<RewriteChoice> {
    const req: BasketSearchScopeRequest = {
      basketId,
      participantId: participant.participantId,
      lineIds: dto.lineIds,
      tripBuys: true,
    };
    let scope: BasketSearchScope;
    try {
      scope = await this.nats.send<BasketSearchScope>(
        BASKET_PATTERNS.searchScope,
        req
      );
    } catch {
      // The write is about to ask core about the same lines, and it answers
      // the real refusal: a line that is not covered, or a basket that is
      // gone.
      return { paid: null, itemSnapshot: null, prices: [] };
    }
    return this.prices.chooseForRewrite({
      userId: scope.ownerUserId,
      profileId: scope.profileId ?? undefined,
      itemId: dto.itemId,
      // A buy that recorded no scope is priced as a settle is: at the basket's
      // own shop when it has one, else at the cheapest.
      supermarketLocationId: scope.supermarketLocationId ?? undefined,
      servedLocations: scope.servesLocations,
      priceScopeIds: scope.tripBuys?.priceScopeIds ?? [],
      unscoped: scope.tripBuys?.unscoped ?? false,
      // The buys' unit, as core answered it (plan 0246 M7).
      unit: scope.tripBuys?.unit ?? 'UNIT',
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
    lineUnitMismatch: true,
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
      unit: dto.unit,
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
    lineUnitDiffers: true,
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
    lineAddChoice: true,
    lineUnitDiffers: true,
    lineUnitNotOffered: true,
  })
  async addLine(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Body() dto: AddBasketLineDto
  ): Promise<BasketRowResult> {
    const userId = requireAccount(participant);
    // The list's own add through another door, so the same check (plan 0246,
    // section 4.2). Absent is `UNIT`.
    await this.units.assertOffered([
      { unit: dto.unit ?? 'UNIT', itemIds: dto.itemIds ?? [] },
    ]);
    const req: AddBasketLineRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId,
      targetListId: dto.targetListId,
      content: dto.content,
      quantity: dto.quantity,
      unit: dto.unit,
      itemIds: dto.itemIds,
      named: dto.named,
      askIfAmbiguous: dto.askIfAmbiguous,
      intoLineId: dto.intoLineId,
      newLine: dto.newLine,
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

/** What {@link BasketController.chosenFor} reads of a settle. */
interface SettleChoiceInput {
  itemId?: string;
  lineIds?: string[];
  supermarketLocationId?: string;
  unit: LineUnit;
}

/**
 * The product's name in the reader's language, the name a line that is not
 * named carries (plan 0214; plan 0273), or null when catalog did not answer.
 * A name catalog does not hold in that language falls back to another it does.
 */
function nameIn(snapshot: ItemSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }
  const locale = toSupportedLocale(getRequestContext()?.locale);
  const names = snapshot.name as Partial<Record<string, string>>;
  const order = [
    ...(locale ? [locale] : []),
    ...CONTENT_LOCALES,
    ...Object.keys(names),
  ];
  for (const key of order) {
    const name = names[key]?.trim();
    if (name) {
      return name.slice(0, BASKET_LIMITS.contentMaxLength);
    }
  }
  return null;
}

/**
 * The actor's account, for the routes that are not delegated writes.
 *
 * Adding a line, renaming a row and a buy for a list that does not ask are
 * authorized by the **person making them**, so a guest is refused here
 * rather than in core: they present a session secret and hold no `WRITE` on
 * anything.
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
