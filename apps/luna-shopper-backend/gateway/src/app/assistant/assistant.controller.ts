import {
  BadRequestException,
  Body,
  Controller,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  ASSISTANT_PATTERNS,
  type AssistantTurnResponse,
} from '@portfolio/luna-shopper/contracts';
import { AuthHeader } from '../auth/auth-header.decorator';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { AssistantTurnDto, AssistantVoiceDto } from './assistant.dto';

/**
 * The assistant, reached through the gateway at `/v1/assistant` (plan 0039,
 * section 3).
 *
 * **No new hostname**, no new certificate, no new CORS origin, and no second base
 * URL in the app. An earlier draft gave the assistant its own `bot.` host on the
 * argument that a turn holds a connection open for as long as a model takes to
 * answer; that argument does not survive the runtime, because Node holds an
 * awaited socket rather than a thread. What backlog 0005 actually refused was
 * putting the assistant's **logic** in the gateway, and keeping the logic in its
 * own service satisfies that in full — this controller holds none of it.
 *
 * The honest consequence, written down in the plan and worth knowing when reading
 * a trace: a turn occupies a gateway request while the assistant turns around and
 * calls the gateway again for its context, so one conversation turn is a **nested
 * pair**. At two replicas and this volume that is not a problem, and the
 * assistant's own concurrency limit caps it regardless.
 *
 * The one thing this controller does that no other does is forward the caller's
 * raw `Authorization` header. That is rule A1: the assistant carries the caller's
 * own token and can therefore do exactly what that user could do by tapping, and
 * nothing more. It mints no token and holds no service account, so without this
 * header it can reach nothing at all — which is the design, not an oversight.
 */
@ApiTags('assistant')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true })
@Controller({ path: 'assistant', version: '1' })
export class AssistantController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Answer one turn.
   *
   * 201, like every other POST in this gateway. A turn creates nothing, so 200
   * would read better, but the whole surface follows Nest's default statuses with
   * no `@HttpCode` anywhere and `openapi-document.spec.ts` enforces that as a
   * house rule. Breaking it here to be tidier would cost a red test and a
   * precedent.
   *
   * Two error statuses here are load bearing rather than incidental. The 429,
   * which the global throttler documents on every route anyway, carries
   * `retryAfterSeconds` **in the problem body** (rule A5), because `main.ts`
   * enables CORS with no `exposedHeaders` and a browser therefore cannot read a
   * `Retry-After` header cross origin; the panel counts the body's number down
   * and never derives one of its own. And the 501, which is what a cluster with
   * no `GEMINI_API_KEY` answers: the route stays in the published document in
   * every environment, and `notConfigured` is what makes the document honest
   * about it (plan 0026).
   */
  @Post()
  @ApiContractResponse(ASSISTANT_PATTERNS.turn, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, notConfigured: true })
  turn(
    @AuthUser() user: CurrentUser,
    @AuthHeader() authorization: string,
    @Body() dto: AssistantTurnDto
  ): Promise<AssistantTurnResponse> {
    return this.nats.send<AssistantTurnResponse>(ASSISTANT_PATTERNS.turn, {
      userId: user.userId,
      // Verbatim. The guard above has already proved it verifies, and rewriting
      // or re-minting it here would break the one property the whole plan rests
      // on: that the assistant can do exactly what this user could do by hand.
      authorization,
      transcript: dto.transcript,
      message: dto.message,
      // Forwarded as it arrived. The scope is a claim the service verifies by
      // reading the list with this same token (plan 0044, section 3).
      scope: dto.scope,
    });
  }

  /**
   * Answer one spoken turn (plan 0041).
   *
   * A second path on `/v1/assistant` rather than a host of its own, which is what
   * plan 0039 section 3's decision to proxy through the gateway keeps buying: no
   * new certificate, no new CORS origin, no second base URL in the app.
   *
   * **`multipart/form-data`**, because the recording is the one leg of this
   * journey that costs the person something — a phone on mobile data — and base64
   * in a JSON body would inflate it by a third. Over the broker it *is* base64,
   * which is why `max_payload` is 16 MB in both the compose stack and the chart;
   * that trade is section 4.2.
   *
   * The byte cap lives on the interceptor, configured in this module, because the
   * global `ValidationPipe` never sees a file and Express's own body limits do not
   * apply to a multipart stream. A cap stated anywhere else is a cap that is not
   * enforced.
   */
  @Post('voice')
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio', 'transcript'],
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description:
            'The recording, in a container the deployment accepts (webm, ogg, mp4, wav).',
        },
        transcript: {
          type: 'string',
          description:
            'The conversation so far, oldest first, as a JSON array of {role, content}.',
          example: '[{"role":"USER","content":"add milk to the weekly shop"}]',
        },
        zoneId: {
          type: 'string',
          format: 'uuid',
          description:
            'Narrow this turn to one list: the zone it is in. Send it with listId or not at all.',
        },
        listId: {
          type: 'string',
          format: 'uuid',
          description:
            'Narrow this turn to one list: the list itself. Send it with zoneId or not at all.',
        },
      },
    },
  })
  @ApiContractResponse(ASSISTANT_PATTERNS.voice, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, notConfigured: true })
  voice(
    @AuthUser() user: CurrentUser,
    @AuthHeader() authorization: string,
    @Body() dto: AssistantVoiceDto,
    @UploadedFile() audio?: Express.Multer.File
  ): Promise<AssistantTurnResponse> {
    // The interceptor enforces the size and refuses anything over it; what it
    // does not do is insist the part was sent at all. A request with a transcript
    // and no recording is a client bug, and it is a 400 here rather than an empty
    // buffer travelling to the service to be refused there.
    if (!audio || audio.size === 0) {
      throw new BadRequestException('a recording is required');
    }

    return this.nats.send<AssistantTurnResponse>(ASSISTANT_PATTERNS.voice, {
      userId: user.userId,
      authorization,
      transcript: dto.transcript,
      // Base64 for the broker leg (section 4.2). The service decodes it, checks
      // the byte count again on what actually arrived, and never writes it down.
      audio: audio.buffer.toString('base64'),
      // What the browser said it recorded, forwarded as it came: the service owns
      // the whitelist, and a gateway that second guessed the container would be a
      // second place to edit when a browser changes its mind.
      mimeType: audio.mimetype,
      // Two flat form fields become the one object the contract carries. Both or
      // neither: half a scope is ambiguous rather than narrow, and the service
      // would have to decide what it meant (plan 0044).
      scope:
        dto.zoneId !== undefined && dto.listId !== undefined
          ? { zoneId: dto.zoneId, listId: dto.listId }
          : undefined,
    });
  }
}
