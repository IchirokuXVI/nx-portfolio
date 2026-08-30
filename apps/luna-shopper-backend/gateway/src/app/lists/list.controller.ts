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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
  type CommentPage,
  type CommentView,
  type LinePage,
  type LineView,
  type ListAccessView,
  type ListPage,
  type ListView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AddCommentDto,
  AddLineDto,
  AddLineQuantityDto,
  AddLinesDto,
  CreateListDto,
  LineQueryDto,
  ListQueryDto,
  ReorderLinesDto,
  SetApprovalDto,
  SetListAccessDto,
  SetStatusDto,
  UpdateLineDto,
  UpdateListDto,
} from './list.dto';

/** Shopping lists scoped to a zone (plan 0007). */
@ApiTags('lists')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'zones/:zoneId/lists', version: '1' })
export class ZoneListsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(LIST_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  create(
    @AuthUser() user: CurrentUser,
    @Param('zoneId') zoneId: string,
    @Body() dto: CreateListDto
  ): Promise<ListView> {
    return this.nats.send<ListView>(LIST_PATTERNS.create, {
      userId: user.userId,
      zoneId,
      name: dto.name,
      shareWithZone: dto.shareWithZone,
    });
  }

  @Get()
  @ApiContractResponse(LIST_PATTERNS.list)
  list(
    @AuthUser() user: CurrentUser,
    @Param('zoneId') zoneId: string,
    @Query() query: ListQueryDto
  ): Promise<ListPage> {
    return this.nats.send<ListPage>(LIST_PATTERNS.list, {
      userId: user.userId,
      zoneId,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }
}

/** Direct list operations and its lines (plan 0007). */
@ApiTags('lists')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'lists', version: '1' })
export class ListsController {
  constructor(private readonly nats: NatsClient) {}

  @Patch(':id')
  @ApiContractResponse(LIST_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateListDto
  ): Promise<ListView> {
    return this.nats.send<ListView>(LIST_PATTERNS.update, {
      userId: user.userId,
      listId: id,
      name: dto.name,
      autoApproveLines: dto.autoApproveLines,
    });
  }

  @Delete(':id')
  @ApiContractResponse(LIST_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(LIST_PATTERNS.delete, {
      userId: user.userId,
      listId: id,
    });
  }

  @Put(':id/access')
  @ApiContractResponse(LIST_PATTERNS.setAccess)
  @ApiProblemResponses({ body: true })
  setAccess(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: SetListAccessDto
  ): Promise<{ listId: string }> {
    return this.nats.send(LIST_PATTERNS.setAccess, {
      userId: user.userId,
      listId: id,
      entries: dto.entries,
    });
  }

  /**
   * The list's stored access table (plan 0036, section 6).
   *
   * `MANAGE` only: who else may write to a list is governance rather than
   * content, so `READ` does not reach it. The gate is core's, as it is for every
   * other route here. Group staff appear in no entry, because their grant is
   * derived from `ZoneRole` and there is nothing stored to return.
   */
  @Get(':id/access')
  @ApiContractResponse(LIST_PATTERNS.getAccess)
  getAccess(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ListAccessView> {
    return this.nats.send<ListAccessView>(LIST_PATTERNS.getAccess, {
      userId: user.userId,
      listId: id,
    });
  }

  @Get(':id/lines')
  @ApiContractResponse(LINE_PATTERNS.list)
  listLines(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: LineQueryDto
  ): Promise<LinePage> {
    return this.nats.send<LinePage>(LINE_PATTERNS.list, {
      userId: user.userId,
      listId: id,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Post(':id/lines')
  @ApiContractResponse(LINE_PATTERNS.add, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  addLine(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddLineDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(LINE_PATTERNS.add, {
      userId: user.userId,
      listId: id,
      content: dto.content,
      quantity: dto.quantity,
      itemId: dto.itemId,
    });
  }

  /**
   * Add several lines at once (plan 0040, section 6).
   *
   * Not restricted to the assistant, and not called from velista today, which is
   * stated because it is the one thing here that reads as an oversight. "Paste a
   * shopping list", "add the usual" and importing last week's list are all this
   * route, and it is a genuine gap in the API that the assistant happened to be
   * the first caller to hit.
   *
   * It stays on the default throttle bucket (section 6.4). A named limit would be
   * a number chosen with no evidence behind it, and the write is cheap and
   * already capped by the array's `maxItems`.
   */
  @Post(':id/lines/batch')
  @ApiContractResponse(LINE_PATTERNS.addMany, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  addLines(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddLinesDto
  ): Promise<LineView[]> {
    return this.nats.send<LineView[]>(LINE_PATTERNS.addMany, {
      userId: user.userId,
      listId: id,
      items: dto.items,
    });
  }

  @Post(':id/lines/reorder')
  @ApiContractResponse(LINE_PATTERNS.reorder, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  reorder(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: ReorderLinesDto
  ): Promise<{ listId: string }> {
    return this.nats.send(LINE_PATTERNS.reorder, {
      userId: user.userId,
      listId: id,
      orderedLineIds: dto.orderedLineIds,
    });
  }
}

/** Direct line operations and its comments (plan 0007). */
@ApiTags('lines')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'lines', version: '1' })
export class LinesController {
  constructor(private readonly nats: NatsClient) {}

  @Patch(':id')
  @ApiContractResponse(LINE_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateLineDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(LINE_PATTERNS.update, {
      userId: user.userId,
      lineId: id,
      content: dto.content,
      quantity: dto.quantity,
      itemId: dto.itemId,
    });
  }

  /**
   * Add units to a line, or take them off (plan 0040, section 3).
   *
   * A sub resource rather than a `quantityDelta` field on the `PATCH`, for the
   * reason `:id/approval` and `:id/status` are also sub resources: `PATCH` means
   * "here is the new value", and a body where one field is absolute and another
   * is relative needs a mutual exclusion rule that every existing client then has
   * to be told never to trip. {@link UpdateLineDto} is what velista already sends
   * from three places, and giving it a field it must never populate is a trap
   * with no upside.
   *
   * It answers with the line as it now stands, like every other line route. The
   * caller knows the delta it sent and `quantity` is the new count, so "two more,
   * five now" is available from the response plus what the caller already had; a
   * bespoke envelope on one route out of ten would be a cost paid by every reader
   * of the API for a subtraction.
   */
  @Post(':id/quantity')
  @ApiContractResponse(LINE_PATTERNS.addQuantity, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  addQuantity(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddLineQuantityDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(LINE_PATTERNS.addQuantity, {
      userId: user.userId,
      lineId: id,
      delta: dto.delta,
    });
  }

  @Post(':id/approval')
  @ApiContractResponse(LINE_PATTERNS.setApproval, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  setApproval(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: SetApprovalDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(LINE_PATTERNS.setApproval, {
      userId: user.userId,
      lineId: id,
      approvalStatus: dto.approvalStatus,
    });
  }

  @Post(':id/status')
  @ApiContractResponse(LINE_PATTERNS.setStatus, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  setStatus(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: SetStatusDto
  ): Promise<LineView> {
    return this.nats.send<LineView>(LINE_PATTERNS.setStatus, {
      userId: user.userId,
      lineId: id,
      status: dto.status,
    });
  }

  @Delete(':id')
  @ApiContractResponse(LINE_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(LINE_PATTERNS.delete, {
      userId: user.userId,
      lineId: id,
    });
  }

  @Get(':id/comments')
  @ApiContractResponse(COMMENT_PATTERNS.list)
  listComments(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: ListQueryDto
  ): Promise<CommentPage> {
    return this.nats.send<CommentPage>(COMMENT_PATTERNS.list, {
      userId: user.userId,
      lineId: id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post(':id/comments')
  @ApiContractResponse(COMMENT_PATTERNS.add, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  addComment(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddCommentDto
  ): Promise<CommentView> {
    return this.nats.send<CommentView>(COMMENT_PATTERNS.add, {
      userId: user.userId,
      lineId: id,
      body: dto.body,
    });
  }
}
