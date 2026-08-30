import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  baseContentType,
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
  type CommentAudioView,
  type CommentPage,
  type CommentView,
  type LinePage,
  type LineView,
  type ListAccessView,
  type ListPage,
  type ListView,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import type { Request, Response } from 'express';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { CommentTranscriptionService } from './comment-transcription.service';
import {
  AddCommentDto,
  AddLineDto,
  AddVoiceCommentDto,
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
import {
  VOICE_RECORDING_FIELD,
  VoiceRecordingInterceptor,
  type VoiceRecording,
} from './voice-recording.interceptor';

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
  constructor(
    private readonly nats: NatsClient,
    private readonly transcription: CommentTranscriptionService
  ) {}

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

  /**
   * Leave a comment that is a recording (plan 0045).
   *
   * **A sibling route rather than a second shape on the one above**, and the one
   * above is untouched. A file interceptor on a route that also accepts a JSON
   * body means the global `ValidationPipe` sees a different thing depending on
   * the content type, and the typed comment path is the busiest write in the
   * product.
   *
   * The response comes back the moment the comment and its bytes are stored,
   * carrying a recording and no body yet. The transcript is asked for afterwards,
   * and when it lands core emits `comment.updated` to the line's room. That order
   * is what makes a provider outage cost a transcript and never a message.
   *
   * Its own rate limit bucket, stricter than the default: an upload is orders of
   * magnitude more expensive than a sentence, and that bucket was sized for
   * sentences.
   */
  @Post(':id/comments/voice')
  @Throttle(THROTTLE_LIMITS.voiceComment)
  @UseInterceptors(VoiceRecordingInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [VOICE_RECORDING_FIELD],
      properties: {
        [VOICE_RECORDING_FIELD]: { type: 'string', format: 'binary' },
        durationSeconds: { type: 'number', minimum: 0, maximum: 3600 },
      },
    },
  })
  @ApiContractResponse(COMMENT_PATTERNS.addVoice, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  async addVoiceComment(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Body() dto: AddVoiceCommentDto
  ): Promise<CommentView> {
    // Put there by the interceptor, which has already enforced the byte cap on
    // the stream and the content type against the allowlist.
    //
    // `multer` has already dropped the parameters, so `mimetype` is the bare
    // container rather than the `audio/webm;codecs=opus` the browser negotiated.
    // `baseContentType` is applied anyway, because this line must not depend on
    // that being true: core matches on the base type and so does the provider.
    const file = (request as { file?: VoiceRecording }).file as VoiceRecording;
    const contentType = baseContentType(file.mimetype);

    const comment = await this.nats.send<CommentView>(
      COMMENT_PATTERNS.addVoice,
      {
        userId: user.userId,
        lineId: id,
        // Base64 over the broker, which is the third of a megabyte of inflation
        // the raised `max_payload` accounts for (plan 0041, section 4.2).
        audio: file.buffer.toString('base64'),
        contentType,
        durationSeconds: dto.durationSeconds ?? null,
      }
    );

    // Started, not awaited. Nobody should wait on a model to leave a comment,
    // and the comment is already stored and playable by this point.
    //
    // The normalised type, the same one core stored, so a recording is described
    // to the provider exactly as it is described in the database.
    this.transcription.schedule(comment, file.buffer, contentType);

    return comment;
  }
}

/**
 * A comment's recording, on its own controller because it hangs off the comment
 * rather than the line (plan 0045, section 5).
 */
@ApiTags('comments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'comments', version: '1' })
export class CommentsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * The bytes, gated on `READ` of the comment's list.
   *
   * That is the same gate as reading the comment's text, and there is
   * deliberately no separate permission: plan 0036 section 4.3 says `READ` is
   * genuinely everything else about a list's content, and a recording somebody
   * left on a line is that.
   *
   * **The whole body, no range requests.** A hundred kilobyte file does not need
   * a 206, and scrubbing inside one that is already fetched is the browser's
   * problem rather than the server's. If a longer format ever ships, ranges are
   * added then, deliberately.
   *
   * **`Cache-Control: private, immutable`** with a long age. The bytes never
   * change: a comment is not editable and neither is its recording. This is the
   * one route in the product where an immutable cache is unambiguously correct,
   * and it is what keeps a re-listened thread from re-downloading. `private`
   * because the response is gated on who is asking, so no shared cache may hold
   * it.
   *
   * **Never a redirect to storage.** The bytes come from this route today, and if
   * plan 0045 section 2's exit is ever taken they still come from this route,
   * from somewhere else. Handing clients a storage URL would make the storage
   * decision part of the API.
   *
   * It writes the response itself rather than returning a value, because the body
   * is audio rather than JSON. `@ApiResponse` documents that in place of
   * `ApiContractResponse`, which describes a JSON contract shape this route has
   * none of.
   */
  @Get(':id/audio')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @ApiProduces('audio/*')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The recording, as the bytes the browser produced.',
    content: { 'audio/*': { schema: { type: 'string', format: 'binary' } } },
  })
  async getCommentAudio(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Res() response: Response
  ): Promise<void> {
    const audio = await this.nats.send<CommentAudioView>(
      COMMENT_PATTERNS.getAudio,
      { userId: user.userId, commentId: id }
    );

    const bytes = Buffer.from(audio.audio, 'base64');
    response.setHeader('Content-Type', audio.contentType);
    response.setHeader('Content-Length', bytes.byteLength);
    response.end(bytes);
  }
}
