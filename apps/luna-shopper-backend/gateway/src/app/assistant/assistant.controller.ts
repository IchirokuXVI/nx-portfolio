import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
import { AssistantTurnDto } from './assistant.dto';

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
    });
  }
}
