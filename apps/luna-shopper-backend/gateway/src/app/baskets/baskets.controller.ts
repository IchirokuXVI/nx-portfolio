import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BASKET_PATTERNS,
  BASKET_SCHEMA_IDS,
  type BasketPage,
  type BasketRunResult,
  type BasketHeaderView,
  type SharedBasketCorePage,
  type SharedBasketPage,
} from '@portfolio/luna-shopper/contracts';
import { UuidParam } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { BasketPresenceService } from './basket-presence.service';
import { resolveUsernames } from './basket-sharing.controller';
import {
  CreateBasketDto,
  ListBasketsQueryDto,
  ListSharedBasketsQueryDto,
  UpdateBasketDto,
} from './basket.dto';

/**
 * The basket a person carries around the shop (plan 0050).
 *
 * Every route takes its `userId` from the verified token, never from the body or
 * a path parameter, and core answers **not found** for a basket that is not the
 * caller's rather than forbidden: a basket is private (section 8), and telling a
 * stranger that an id names something real is telling them something.
 *
 * These routes reach **core** rather than auth, so they use `nats.send` directly
 * and never the account controller's `aboutTheCaller` helper. That helper turns
 * every downstream "not found" into a 401, which is right for routes keyed on
 * nothing but the token. Here a "not found" has an ordinary second meaning, a
 * basket id that is not yours, and answering 401 would sign the user out for
 * asking about somebody else's shopping list.
 */
@ApiTags('baskets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'baskets', version: '1' })
export class BasketsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly presence: BasketPresenceService
  ) {}

  /**
   * Compose a basket from the caller's chosen sources.
   *
   * It refuses no line for being in another basket of the caller's. That rule
   * came from plan 0050 section 3 and plan 0133 section 7 deleted it: it was
   * about two frozen copies of one line, and it is false of two views of one.
   *
   * `memberUserIds` shares it with people from the caller's groups as it is
   * made (plan 0114, section 4), and a person who is not one of their contacts
   * refuses the whole run.
   */
  @Post()
  @ApiContractResponse(BASKET_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  async create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateBasketDto
  ): Promise<BasketRunResult> {
    // Core names each person from their groups, and auth names the ones the
    // owner shares no group with, or several (plan 0114, section 9). Always
    // written after the body, so a body cannot supply names of its own.
    const globalUsernames = await resolveUsernames(
      this.nats,
      dto.memberUserIds ?? []
    );
    return this.nats.send<BasketRunResult>(
      BASKET_PATTERNS.create,
      { userId: user.userId, ...dto, globalUsernames }
    );
  }

  /**
   * The caller's baskets, newest first. Archived ones are hidden by default.
   *
   * The page comes back from core with everything but one number: how many
   * people are in each basket right now (plan 0053, section 2). Presence is a
   * Redis room the realtime service writes and core cannot see, so it is filled
   * in here, on the way out, from the same store the sockets broadcast.
   *
   * One pipelined read for the whole page rather than a request per card, which
   * is what velista `0049` section 4 refuses to spend, and it costs the captions
   * rather than the page when Redis is unreachable.
   */
  @Get()
  @ApiContractResponse(BASKET_PATTERNS.listMine)
  @ApiProblemResponses({ auth: true })
  async listMine(
    @AuthUser() user: CurrentUser,
    @Query() query: ListBasketsQueryDto
  ): Promise<BasketPage> {
    const page = await this.nats.send<BasketPage>(
      BASKET_PATTERNS.listMine,
      { userId: user.userId, ...query }
    );
    const present = await this.presence.countsFor(
      page.items.map((item) => item.id)
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        presentCount: present.get(item.id) ?? 0,
      })),
    };
  }

  /**
   * The baskets other people shared with the caller, newest share first (plan
   * 0114, section 8).
   *
   * Every basket the caller is on as a registered participant, by the link or
   * because the owner added them, finished ones included and archived ones not.
   * Each row is a history row plus who shared it and when.
   *
   * Declared before `:id` on purpose: handlers match in declaration order, and
   * `:id` would otherwise take `shared` for a basket id.
   *
   * Composed on the way out, from three places. Core answers the rows and names
   * the owner when the two people share exactly one group, auth names every
   * other owner globally (section 9), and presence fills the count as it does
   * for the caller's own history. A name auth cannot give is an empty string
   * rather than a failed page.
   */
  @Get('shared')
  @ApiComposedResponse(BASKET_SCHEMA_IDS.sharedPage)
  @ApiProblemResponses({ auth: true, body: true })
  async listShared(
    @AuthUser() user: CurrentUser,
    @Query() query: ListSharedBasketsQueryDto
  ): Promise<SharedBasketPage> {
    const page = await this.nats.send<SharedBasketCorePage>(
      BASKET_PATTERNS.listShared,
      { userId: user.userId, ...query }
    );
    const [present, named] = await Promise.all([
      this.presence.countsFor(page.items.map((item) => item.id)),
      resolveUsernames(
        this.nats,
        page.items
          .filter((item) => item.ownerZoneUsername === null)
          .map((item) => item.ownerUserId)
      ),
    ]);
    const globalName = new Map(named.map((row) => [row.userId, row.username]));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(
        ({ ownerUserId, ownerZoneUsername, ...summary }) => ({
          ...summary,
          presentCount: present.get(summary.id) ?? 0,
          owner: {
            userId: ownerUserId,
            name: ownerZoneUsername ?? globalName.get(ownerUserId) ?? '',
          },
        })
      ),
    };
  }

  // REMOVED-BY-0144: the owner's header read, `GET /v1/generated-lists/:id`.
  //
  // Renaming it landed it on `GET /v1/baskets/:id`, which plan 0136 had already
  // given to the participant read of the whole basket. The two are one read by
  // that plan's rule, so the older one went with its NATS subject and both its
  // handlers. Nothing called it: not velista, not the back office, not the e2e.
  // `sources`, the one field the participant read does not carry, still reaches
  // the wire through `POST /v1/baskets`, which answers the same header shape.
  //
  // Search `REMOVED-BY-0144` to delete this note once a release has shipped
  // without anybody missing the read.

  /** Rename it, archive it, or move it between the four statuses. */
  @Patch(':id')
  @ApiContractResponse(BASKET_PATTERNS.update)
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  update(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string,
    @Body() dto: UpdateBasketDto
  ): Promise<BasketHeaderView> {
    return this.nats.send<BasketHeaderView>(BASKET_PATTERNS.update, {
      userId: user.userId,
      basketId: id,
      ...dto,
    });
  }

  /**
   * Delete a basket. A real delete of the generated rows alone: it never touches
   * a zone list, whose lines are the originals this one only ever copied.
   */
  @Delete(':id')
  @ApiContractResponse(BASKET_PATTERNS.delete)
  @ApiProblemResponses({ auth: true, notFound: true })
  remove(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send<{ id: string }>(BASKET_PATTERNS.delete, {
      userId: user.userId,
      basketId: id,
    });
  }

  /** Reorder the basket into the order this person walks the shop in. */
}
