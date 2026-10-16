import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IMPERSONATION_PATTERNS,
  type AuthTokens,
  type EndImpersonationResult,
} from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { ExchangeImpersonationDto } from './auth.dto';
import { AuthUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { CurrentUser } from './jwt.strategy';

/**
 * The app's half of a support session (plan 0194): take the session that an
 * operator started, and end it.
 *
 * The operator's half is `AdminImpersonationController`. The two are apart
 * because they answer two principals: that one takes an operator token, and
 * neither route here does. An operator never presents an admin token to a user
 * route, which is the rule `admin-token-separation.spec.ts` asserts.
 */
@ApiTags('auth')
@Controller({ path: 'auth/impersonation', version: '1' })
export class ImpersonationController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Trade the handoff code for the token pair of the session.
   *
   * No guard: the code is the credential. It is random, 32 bytes, good for
   * sixty seconds and for one use. The answer is `AuthTokens`, unchanged in
   * shape, so the app stores the pair as it stores any other. The access token
   * carries `act`, which is how the app knows to draw the "Viewing as" strip.
   *
   * A missing, used, old or ended code gets one answer,
   * `impersonation_code_invalid`. So does every code while support sessions
   * are switched off.
   */
  @Post('exchange')
  // The bucket of a link being consumed, as `verify-email` uses: a guess at a
  // 32 byte code is hopeless, and this stops one from being tried at speed.
  @Throttle(THROTTLE_LIMITS.verifyConsume)
  @ApiContractResponse(IMPERSONATION_PATTERNS.exchange, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, impersonation: 'exchange' })
  exchange(@Body() dto: ExchangeImpersonationDto): Promise<AuthTokens> {
    return this.nats.send<AuthTokens>(IMPERSONATION_PATTERNS.exchange, {
      code: dto.code,
    });
  }

  /**
   * End the session the caller's token belongs to.
   *
   * Both ids come from the verified token and never from a body, so a caller
   * ends its own session and no other. A token with no `act` is an ordinary
   * session and gets `not_impersonating`.
   *
   * The refresh rows of the session are revoked, and every later request with a
   * token of the session answers 401 `impersonation_ended`, this route
   * included. The sessions the person holds are not touched.
   */
  @Post('end')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(IMPERSONATION_PATTERNS.end, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, impersonation: 'end' })
  end(@AuthUser() user: CurrentUser): Promise<EndImpersonationResult> {
    return this.nats.send<EndImpersonationResult>(IMPERSONATION_PATTERNS.end, {
      userId: user.userId,
      sessionId: user.impersonation?.sessionId,
    });
  }
}
