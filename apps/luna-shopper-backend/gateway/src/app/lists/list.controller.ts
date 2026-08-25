import {
  Body,
  Controller,
  Delete,
  Get,
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
  type ListPage,
  type ListView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { NatsClient } from '../messaging/nats-client';
import {
  AddCommentDto,
  AddLineDto,
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
@Controller({ path: 'zones/:zoneId/lists', version: '1' })
export class ZoneListsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  create(
    @AuthUser() user: CurrentUser,
    @Param('zoneId') zoneId: string,
    @Body() dto: CreateListDto
  ): Promise<ListView> {
    return this.nats.send<ListView>(LIST_PATTERNS.create, {
      userId: user.userId,
      zoneId,
      name: dto.name,
    });
  }

  @Get()
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
@Controller({ path: 'lists', version: '1' })
export class ListsController {
  constructor(private readonly nats: NatsClient) {}

  @Patch(':id')
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateListDto
  ): Promise<ListView> {
    return this.nats.send<ListView>(LIST_PATTERNS.update, {
      userId: user.userId,
      listId: id,
      name: dto.name,
    });
  }

  @Delete(':id')
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

  @Get(':id/lines')
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

  @Post(':id/lines/reorder')
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
@Controller({ path: 'lines', version: '1' })
export class LinesController {
  constructor(private readonly nats: NatsClient) {}

  @Patch(':id')
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

  @Post(':id/approval')
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
