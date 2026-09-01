import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  GENERATED_LIST_PATTERNS,
  type GeneratedListLineView,
  type GeneratedListPage,
  type GeneratedListRunResult,
  type GeneratedListView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AddGeneratedListLineDto,
  CreateGeneratedListDto,
  ListGeneratedListsQueryDto,
  ReorderGeneratedListLinesDto,
  UpdateGeneratedListDto,
  UpdateGeneratedListLineDto,
} from './generated-list.dto';

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
@ApiTags('generated-lists')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'generated-lists', version: '1' })
export class GeneratedListController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Compose a basket from the caller's chosen sources.
   *
   * The answer carries the basket **and what the run left behind**: a line a live
   * basket is already carrying is skipped and named, because a basket missing the
   * milk somebody distinctly remembers writing is a bug report otherwise.
   */
  @Post()
  @ApiContractResponse(GENERATED_LIST_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateGeneratedListDto
  ): Promise<GeneratedListRunResult> {
    return this.nats.send<GeneratedListRunResult>(
      GENERATED_LIST_PATTERNS.create,
      { userId: user.userId, ...dto }
    );
  }

  /** The caller's baskets, newest first. Archived ones are hidden by default. */
  @Get()
  @ApiContractResponse(GENERATED_LIST_PATTERNS.listMine)
  @ApiProblemResponses({ auth: true })
  listMine(
    @AuthUser() user: CurrentUser,
    @Query() query: ListGeneratedListsQueryDto
  ): Promise<GeneratedListPage> {
    return this.nats.send<GeneratedListPage>(GENERATED_LIST_PATTERNS.listMine, {
      userId: user.userId,
      ...query,
    });
  }

  @Get(':id')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.get)
  @ApiProblemResponses({ auth: true, notFound: true })
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<GeneratedListView> {
    return this.nats.send<GeneratedListView>(GENERATED_LIST_PATTERNS.get, {
      userId: user.userId,
      generatedListId: id,
    });
  }

  /** Rename it, archive it, or move it between the four statuses. */
  @Patch(':id')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.update)
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateGeneratedListDto
  ): Promise<GeneratedListView> {
    return this.nats.send<GeneratedListView>(GENERATED_LIST_PATTERNS.update, {
      userId: user.userId,
      generatedListId: id,
      ...dto,
    });
  }

  /**
   * Delete a basket. A real delete of the generated rows alone: it never touches
   * a zone list, whose lines are the originals this one only ever copied.
   */
  @Delete(':id')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.delete)
  @ApiProblemResponses({ auth: true, notFound: true })
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send<{ id: string }>(GENERATED_LIST_PATTERNS.delete, {
      userId: user.userId,
      generatedListId: id,
    });
  }

  /**
   * Type a line into a basket.
   *
   * With a target list it is **also** created there through the ordinary add
   * path, so the caller must hold write access at that moment and the new line
   * starts pending approval like any other. Without one it lives in the basket
   * alone.
   */
  @Post(':id/lines')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.addLine, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    body: true,
    membership: true,
    notFound: true,
  })
  addLine(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: AddGeneratedListLineDto
  ): Promise<GeneratedListLineView> {
    return this.nats.send<GeneratedListLineView>(
      GENERATED_LIST_PATTERNS.addLine,
      { userId: user.userId, generatedListId: id, ...dto }
    );
  }

  /**
   * Edit one line: its text, its quantity, its pick, or its target list.
   *
   * Everything but the last is local to the basket. That is the rule the whole
   * plan turns on: a user tidying up their own shopping list at the till must not
   * rewrite a list four other people depend on.
   */
  @Patch(':id/lines/:lineId')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.updateLine)
  @ApiProblemResponses({
    auth: true,
    body: true,
    membership: true,
    notFound: true,
  })
  updateLine(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateGeneratedListLineDto
  ): Promise<GeneratedListLineView> {
    return this.nats.send<GeneratedListLineView>(
      GENERATED_LIST_PATTERNS.updateLine,
      { userId: user.userId, generatedListId: id, lineId, ...dto }
    );
  }

  /**
   * Take a line out of the basket, leaving every zone line it came from exactly
   * as it was. "I decided not to buy this today" is not "somebody bought it".
   */
  @Delete(':id/lines/:lineId')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.deleteLine)
  @ApiProblemResponses({ auth: true, notFound: true })
  deleteLine(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string
  ): Promise<{ id: string }> {
    return this.nats.send<{ id: string }>(GENERATED_LIST_PATTERNS.deleteLine, {
      userId: user.userId,
      generatedListId: id,
      lineId,
    });
  }

  /** Reorder the basket into the order this person walks the shop in. */
  @Post(':id/lines/order')
  @ApiContractResponse(GENERATED_LIST_PATTERNS.reorderLines, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  reorderLines(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: ReorderGeneratedListLinesDto
  ): Promise<GeneratedListView> {
    return this.nats.send<GeneratedListView>(
      GENERATED_LIST_PATTERNS.reorderLines,
      { userId: user.userId, generatedListId: id, ...dto }
    );
  }
}
